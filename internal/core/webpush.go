package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/crypto"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/emails"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/ids"
	"github.com/useopendesk/opendesk/internal/push"
)

// Web Push to browsers (contracts/native.md "Web Push"): the web app subscribes the
// browser for its session, and the push worker sends each notification whose desktop
// channel is on to the user's subscribed browsers.

const webPushPerUserHour = 60

// liveWebPush joins a subscription to its session: it counts only while the session lives.
const liveWebPush = `web_push_subscriptions w JOIN sessions s ON s.id = w.session_id AND s.revoked_at IS NULL AND s.expires_at > now()`

func (s *svc) registerWebPush(api huma.API) {
	register(s, api, huma.Operation{OperationID: "put-web-push", Method: http.MethodPut, Path: "/v1/me/web-push",
		Summary: "Subscribe this browser to web pushes", Tags: []string{"Account"}, DefaultStatus: http.StatusNoContent},
		func(ctx context.Context, in *struct{ Body push.WebSubscription }) (*struct{}, error) {
			p, err := auth.RequireUser(ctx)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			if s.push.web == nil {
				return nil, httpx.E(422, "push_unavailable", "This server does not send web pushes.")
			}
			if err := s.limit("webpush:"+p.UserID.String(), webPushPerUserHour, time.Hour); err != nil {
				return nil, err
			}
			if !in.Body.Valid() {
				return nil, httpx.Validation("Send the browser's push subscription: an https endpoint with its p256dh and auth keys.")
			}
			raw, err := json.Marshal(in.Body)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			sealed, err := s.d.Box.Seal(raw)
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			hash := crypto.HashToken("web:" + in.Body.Endpoint)
			err = s.tx(ctx, func(tx pgx.Tx) error {
				var live bool
				if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2
					AND revoked_at IS NULL AND expires_at > now())`, p.SessionID, p.UserID).Scan(&live); err != nil {
					return err
				}
				if !live {
					return httpx.E(401, "unauthenticated", auth.ErrUnauthenticated.Error())
				}
				// The endpoint now belongs to this sign-in, whoever subscribed it before.
				var id uuid.UUID
				if err := tx.QueryRow(ctx, `INSERT INTO web_push_subscriptions (id, user_id, session_id, endpoint_hash, sealed)
					VALUES ($1, $2, $3, $4, $5)
					ON CONFLICT (endpoint_hash) DO UPDATE SET user_id = $2, session_id = $3, sealed = $5, updated_at = now(),
						last_push_at = CASE WHEN web_push_subscriptions.user_id = $2 THEN web_push_subscriptions.last_push_at END
					RETURNING id`, ids.New(), p.UserID, p.SessionID, hash, sealed).Scan(&id); err != nil {
					return err
				}
				// One subscription per session: one a browser replaced stops receiving pushes.
				_, err := tx.Exec(ctx, `DELETE FROM web_push_subscriptions WHERE session_id = $1 AND id <> $2`, p.SessionID, id)
				return err
			})
			if err != nil {
				return nil, httpx.Wrap(err)
			}
			return nil, nil
		})
}

type webSub struct {
	id     uuid.UUID
	sealed []byte
}

// liveWebSubs are the user's subscribed browsers whose sessions are still signed in.
func liveWebSubs(ctx context.Context, q db.Querier, uid uuid.UUID) ([]webSub, error) {
	rows, err := q.Query(ctx, `SELECT w.id, w.sealed FROM `+liveWebPush+` WHERE w.user_id = $1 LIMIT 50`, uid)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (webSub, error) {
		var x webSub
		err := r.Scan(&x.id, &x.sealed)
		return x, err
	})
}

// deliverWeb sends one notification to each browser. A subscription the push service
// dropped is deleted. Like deliverAll, it fails only when no browser could be reached.
func (s *svc) deliverWeb(ctx context.Context, subs []webSub, wid uuid.UUID, n emails.Note) error {
	title, body, link := emails.WebPush(emails.SiteFrom(s.d.Cfg), wid, n)
	payload, err := json.Marshal(push.WebAlert{ID: n.ID.String(), WorkspaceID: wid.String(), Title: title, Body: body, URL: link})
	if err != nil {
		return err
	}
	var firstErr error
	failed := 0
	for _, sub := range subs {
		if err := s.sendWeb(ctx, sub, payload); err != nil {
			s.d.Log.Warn("web push delivery failed", "subscription_id", sub.id, "err", err)
			failed++
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	if failed == len(subs) {
		return firstErr
	}
	return nil
}

func (s *svc) sendWeb(ctx context.Context, sub webSub, payload []byte) error {
	raw, err := s.d.Box.Open(sub.sealed)
	if err != nil {
		return err
	}
	var ws push.WebSubscription
	if err := json.Unmarshal(raw, &ws); err != nil {
		return err
	}
	err = s.push.web.Send(ctx, ws, payload)
	if errors.Is(err, push.ErrUnregistered) {
		_, err = s.d.DB.Pool.Exec(ctx, `DELETE FROM web_push_subscriptions WHERE id = $1`, sub.id)
		return err
	}
	if err != nil {
		return err
	}
	_, err = s.d.DB.Pool.Exec(ctx, `UPDATE web_push_subscriptions SET last_push_at = now() WHERE id = $1`, sub.id)
	return err
}

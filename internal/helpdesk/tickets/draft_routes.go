package tickets

import (
	"context"
	"crypto/hmac"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/ids"
)

func registerDrafts(d *deps.Deps, api huma.API) {
	if d.Cfg.SharedDraftsDisabled {
		return
	}
	tags := []string{"Tickets"}
	huma.Register(api, huma.Operation{OperationID: "get-ticket-draft", Method: http.MethodGet, Path: "/v1/tickets/{id}/draft", Summary: "Get the shared email draft", Tags: tags}, func(ctx context.Context, in *struct {
		ID string `path:"id"`
	}) (*draftResponse, error) {
		p, err := auth.RequireWorkspace(ctx, auth.RoleViewer, auth.ScopeTicketsRead)
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		var x *ticketDraft
		err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
			tid, err := lockDraftTicket(ctx, tx, p, in.ID)
			if err != nil {
				return err
			}
			x, err = loadDraft(ctx, tx, p.WorkspaceID, tid, nil, true)
			if db.IsNotFound(err) {
				return nil
			}
			return err
		})
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		out := &draftResponse{}
		out.Body.Draft = x
		return out, nil
	})
	huma.Register(api, huma.Operation{OperationID: "create-ticket-draft", Method: http.MethodPost, Path: "/v1/tickets/{id}/draft", Summary: "Create the shared email draft", Tags: tags, DefaultStatus: 201}, func(ctx context.Context, in *struct {
		ID   string `path:"id"`
		Body createDraftBody
	}) (*draftCreateResponse, error) {
		p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		var x *ticketDraft
		status := 201
		err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
			tid, err := lockDraftTicket(ctx, tx, p, in.ID)
			if err != nil {
				return err
			}
			if utf8.RuneCountInString(in.Body.RequestID) < 1 || utf8.RuneCountInString(in.Body.RequestID) > 255 {
				return httpx.Validation("request_id must have 1 to 255 characters")
			}
			v := ticketDraft{TicketID: tid, Cc: []string{}, Bcc: []string{}, Attachments: []domain.Attachment{}}
			att, err := applyDraftValues(&v, in.Body.DraftValues)
			if err != nil {
				return err
			}
			hash := draftHash(d, "create-draft", struct {
				Body        string
				Mailbox     *uuid.UUID
				Cc, Bcc     []string
				Attachments []uuid.UUID
			}{v.BodyHTML, v.MailboxID, v.Cc, v.Bcc, att})
			var prior uuid.UUID
			var original []byte
			err = tx.QueryRow(ctx, `SELECT id,creation_hash FROM ticket_drafts WHERE workspace_id=$1 AND ticket_id=$2 AND creation_key=$3`, p.WorkspaceID, tid, in.Body.RequestID).Scan(&prior, &original)
			if err == nil {
				x, err = loadDraft(ctx, tx, p.WorkspaceID, tid, &prior, false)
				if err != nil {
					return err
				}
				if !hmac.Equal(hash, original) {
					return httpx.E(409, "draft_request_conflict", "This request_id was used with different draft content.")
				}
				status = 200
				return nil
			}
			if !db.IsNotFound(err) {
				return err
			}
			var active bool
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ticket_drafts WHERE workspace_id=$1 AND ticket_id=$2 AND state='draft')`, p.WorkspaceID, tid).Scan(&active); err != nil {
				return err
			}
			if active {
				return httpx.E(409, "draft_exists", "This ticket already has a shared draft.")
			}
			if err := validateDraftMailbox(ctx, tx, p, &v); err != nil {
				return err
			}
			v.ID = ids.New()
			actor := draftActorOf(p)
			_, err = tx.Exec(ctx, `INSERT INTO ticket_drafts(id,workspace_id,ticket_id,creation_key,creation_hash,body_html,mailbox_id,cc_emails,bcc_emails,created_by_type,created_by_user_id,created_by_api_key_id,updated_by_type,updated_by_user_id,updated_by_api_key_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$10,$11,$12)`, v.ID, p.WorkspaceID, tid, in.Body.RequestID, hash, v.BodyHTML, v.MailboxID, v.Cc, v.Bcc, actor.Type, p.ActorUserID(), p.ActorAPIKeyID())
			if err != nil {
				return err
			}
			if err = reserveDraftAttachments(ctx, tx, p, &v, att); err != nil {
				return err
			}
			x, err = loadDraft(ctx, tx, p.WorkspaceID, tid, &v.ID, false)
			if err != nil {
				return err
			}
			return publishDraft(ctx, tx, p.WorkspaceID, x, "created")
		})
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		out := &draftCreateResponse{Status: status}
		out.Body.Draft = x
		return out, nil
	})
	huma.Register(api, huma.Operation{OperationID: "update-ticket-draft", Method: http.MethodPatch, Path: "/v1/tickets/{id}/draft", Summary: "Update the shared email draft", Tags: tags}, func(ctx context.Context, in *struct {
		ID   string `path:"id"`
		Body updateDraftBody
	}) (*draftResponse, error) {
		p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		var x *ticketDraft
		err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
			tid, err := lockDraftTicket(ctx, tx, p, in.ID)
			if err != nil {
				return err
			}
			x, err = loadDraft(ctx, tx, p.WorkspaceID, tid, &in.Body.DraftID, true)
			if err != nil {
				return draftLoadError(err)
			}
			if err = checkDraftRevision(x, in.Body.DraftIdentity); err != nil {
				return err
			}
			before := draftHash(d, "values", x)
			att, err := applyDraftValues(x, in.Body.DraftValues)
			if err != nil {
				return err
			}
			if err := validateDraftMailbox(ctx, tx, p, x); err != nil {
				return err
			}
			if in.Body.AttachmentIDs == nil {
				att = draftAttachmentIDs(x)
			}
			sameFiles := slices.Equal(att, draftAttachmentIDs(x))
			if sameFiles && hmac.Equal(before, draftHash(d, "values", x)) {
				return nil
			}
			if err = reserveDraftAttachments(ctx, tx, p, x, att); err != nil {
				return err
			}
			actor := draftActorOf(p)
			_, err = tx.Exec(ctx, `UPDATE ticket_drafts SET body_html=$3,mailbox_id=$4,cc_emails=$5,bcc_emails=$6,revision=revision+1,updated_at=now(),updated_by_type=$7,updated_by_user_id=$8,updated_by_api_key_id=$9 WHERE workspace_id=$1 AND id=$2`, p.WorkspaceID, x.ID, x.BodyHTML, x.MailboxID, x.Cc, x.Bcc, actor.Type, p.ActorUserID(), p.ActorAPIKeyID())
			if err != nil {
				return err
			}
			x, err = loadDraft(ctx, tx, p.WorkspaceID, tid, &x.ID, false)
			if err != nil {
				return err
			}
			return publishDraft(ctx, tx, p.WorkspaceID, x, "updated")
		})
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		out := &draftResponse{}
		out.Body.Draft = x
		return out, nil
	})
	huma.Register(api, huma.Operation{OperationID: "discard-ticket-draft", Method: http.MethodDelete, Path: "/v1/tickets/{id}/draft", Summary: "Discard the shared email draft", Tags: tags, DefaultStatus: 204}, func(ctx context.Context, in *struct {
		ID   string `path:"id"`
		Body DraftIdentity
	}) (*struct{}, error) {
		p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
			tid, err := lockDraftTicket(ctx, tx, p, in.ID)
			if err != nil {
				return err
			}
			x, err := loadDraft(ctx, tx, p.WorkspaceID, tid, &in.Body.DraftID, true)
			if err != nil {
				return draftLoadError(err)
			}
			if x.State == "discarded" {
				return nil
			}
			if err = checkDraftRevision(x, in.Body); err != nil {
				return err
			}
			return finishDraft(ctx, tx, p, x, "discarded", nil)
		})
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		return nil, nil
	})
	huma.Register(api, huma.Operation{OperationID: "preview-ticket-draft", Method: http.MethodPost, Path: "/v1/tickets/{id}/draft/preview", Summary: "Review an email draft", Tags: tags}, func(ctx context.Context, in *struct {
		ID   string `path:"id"`
		Body DraftIdentity
	}) (*struct{ Body draftPreview }, error) {
		p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsRead)
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		var preview draftPreview
		err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
			tid, err := lockDraftTicket(ctx, tx, p, in.ID)
			if err != nil {
				return err
			}
			x, err := loadDraft(ctx, tx, p.WorkspaceID, tid, &in.Body.DraftID, true)
			if err != nil {
				return draftLoadError(err)
			}
			if err = checkDraftRevision(x, in.Body); err != nil {
				return err
			}
			preview, _, err = prepareDraft(ctx, tx, d, p, x)
			return err
		})
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		return &struct{ Body draftPreview }{preview}, nil
	})
	huma.Register(api, huma.Operation{OperationID: "send-ticket-draft", Method: http.MethodPost, Path: "/v1/tickets/{id}/draft/send", Summary: "Send a reviewed email draft", Tags: tags, DefaultStatus: 201}, func(ctx context.Context, in *struct {
		ID   string `path:"id"`
		Body sendDraftBody
	}) (*draftSendResponse, error) {
		p, err := auth.RequireWorkspace(ctx, auth.RoleAgent, auth.ScopeTicketsWrite)
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		out := &draftSendResponse{Status: 201}
		err = d.DB.Tx(ctx, func(tx pgx.Tx) error {
			tid, err := lockDraftTicket(ctx, tx, p, in.ID)
			if err != nil {
				return err
			}
			x, err := loadDraft(ctx, tx, p.WorkspaceID, tid, &in.Body.DraftID, true)
			if err != nil {
				return draftLoadError(err)
			}
			if x.State == "sent" {
				out.Status = 200
				out.Body, err = sentDraftResult(ctx, tx, p, x)
				return err
			}
			if err = checkDraftRevision(x, in.Body.DraftIdentity); err != nil {
				return err
			}
			preview, nm, err := prepareDraft(ctx, tx, d, p, x)
			if err != nil {
				return err
			}
			if !hmac.Equal([]byte(preview.ReviewToken), []byte(in.Body.ReviewToken)) {
				return httpx.E(409, "draft_context_changed", "The email context changed. Review the saved draft again.")
			}
			if nm.BodyText == "" && len(nm.AttachmentIDs) == 0 && !strings.Contains(nm.BodyHTML, "<img") {
				return httpx.Validation("the message is empty")
			}
			if nm.MailboxID != nil {
				if _, err = applyPatch(ctx, tx, d, p.WorkspaceID, tid, actorOf(p), Patch{Mailbox: nm.MailboxID}, applyOpts{}); err != nil {
					return err
				}
			}
			msg, err := domain.AddMessage(ctx, tx, d.Jobs, nm)
			if err != nil {
				return err
			}
			if err = finishDraft(ctx, tx, p, x, "sent", &msg.ID); err != nil {
				return err
			}
			if in.Body.Status != nil {
				if _, err = applyPatch(ctx, tx, d, p.WorkspaceID, tid, actorOf(p), Patch{Status: in.Body.Status}, applyOpts{Enqueue: true, RequireFields: true}); err != nil {
					return err
				}
			}
			x.MessageID = &msg.ID
			out.Body, err = sentDraftResult(ctx, tx, p, x)
			return err
		})
		if err != nil {
			return nil, httpx.Wrap(err)
		}
		return out, nil
	})
}

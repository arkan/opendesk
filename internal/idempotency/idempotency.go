// Package idempotency implements the Idempotency-Key header (docs: api/idempotency).
//
// An authenticated POST (user session or API key) that carries the header is claimed
// in Postgres before the handler runs. The finished response (status < 500) is stored
// for 24 hours and replayed for a retry with the same key, method, path and body,
// with Idempotent-Replayed: true. Keys are scoped to the workspace and the principal.
package idempotency

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/crypto"
	"github.com/useopendesk/opendesk/internal/httpx"
)

const (
	// Header is the request header a client sends.
	Header = "Idempotency-Key"
	// ReplayedHeader marks a response served from a stored result.
	ReplayedHeader = "Idempotent-Replayed"

	// TTL is how long a key is kept; after it the same key is a new request.
	TTL = 24 * time.Hour
	// MaxKeyLength is the longest accepted key.
	MaxKeyLength = 255
	// MaxResponseBody is the largest response stored; a larger one is not kept.
	MaxResponseBody = 1 << 20
	// maxRequestBody bounds the request body read to hash it (uploads are 25 MB).
	maxRequestBody = 32 << 20
	// staleAfter releases a claim whose request never finished (the process stopped).
	staleAfter = 5 * time.Minute
)

// skipPrefixes are POST routes outside idempotency: credential exchanges (their
// responses are tokens or set cookies) and routes called by other systems.
var skipPrefixes = []string{
	"/v1/auth/",
	"/mcp",
	"/v1/me/password",
	"/v1/me/passkeys/register/",
	"/v1/realtime/token",
	"/v1/inbound/",
	"/v1/billing/stripe/",
	"/v1/widget/",
	"/v1/public/",
	"/v1/admin/",
}

// Store holds idempotency keys in Postgres.
type Store struct {
	Pool *pgxpool.Pool
	// Box seals stored response bodies.
	Box *crypto.Box
	// HashKey keys the request hash, so a stored hash says nothing about the body.
	HashKey []byte
	Log     *slog.Logger
}

// New returns a Store whose request hashes are keyed from secret.
func New(pool *pgxpool.Pool, box *crypto.Box, secret []byte, log *slog.Logger) *Store {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte("opendesk idempotency request hash"))
	return &Store{Pool: pool, Box: box, HashKey: m.Sum(nil), Log: log}
}

// ValidKey reports a key of 1..255 printable ASCII characters.
func ValidKey(k string) bool {
	if len(k) == 0 || len(k) > MaxKeyLength {
		return false
	}
	for i := 0; i < len(k); i++ {
		if k[i] < 0x20 || k[i] > 0x7e {
			return false
		}
	}
	return true
}

// Middleware applies idempotency. It runs after the auth resolver.
func (s *Store) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vals, has := r.Header[http.CanonicalHeaderKey(Header)]
		if !has || r.Method != http.MethodPost || skipped(r) {
			next.ServeHTTP(w, r)
			return
		}
		p := auth.FromContext(r.Context())
		if p == nil || (p.Kind != auth.KindUser && p.Kind != auth.KindAPIKey) {
			next.ServeHTTP(w, r)
			return
		}
		if len(vals) != 1 || !ValidKey(vals[0]) {
			writeProblem(w, r, httpx.Validation("Idempotency-Key must be 1 to 255 printable ASCII characters."))
			return
		}
		key := vals[0]
		if strings.HasPrefix(r.URL.Path, "/v1/tickets/") && strings.Contains(r.URL.Path, "/draft") {
			next.ServeHTTP(w, r)
			return
		}

		body, err := io.ReadAll(io.LimitReader(r.Body, maxRequestBody+1))
		if err != nil {
			writeProblem(w, r, httpx.BadRequest("The request body could not be read."))
			return
		}
		if len(body) > maxRequestBody {
			writeProblem(w, r, httpx.E(http.StatusRequestEntityTooLarge, "too_large", "The request body is too large."))
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		if r.URL.Path == "/v1/tickets" {
			var obj map[string]json.RawMessage
			if json.Unmarshal(body, &obj) == nil && len(obj["preparation"]) > 0 && string(obj["preparation"]) != "null" {
				next.ServeHTTP(w, r)
				return
			}
		}
		hash := s.hash(r.URL.RawQuery, body)

		sc := scope{workspace: p.WorkspaceID, user: p.ActorUserID(), apiKey: p.ActorAPIKeyID(), key: key}
		id, prior, err := s.claim(r.Context(), sc, r.Method, r.URL.Path, hash)
		if err != nil {
			s.Log.Error("idempotency claim", "err", err, "request_id", httpx.RequestIDFrom(r.Context()))
			writeProblem(w, r, httpx.E(http.StatusInternalServerError, "internal", internalMessage))
			return
		}
		if prior != nil {
			s.answer(w, r, prior, r.Method, r.URL.Path, hash)
			return
		}
		s.run(w, r, next, id)
	})
}

func skipped(r *http.Request) bool {
	for _, p := range skipPrefixes {
		if strings.HasPrefix(r.URL.Path, p) {
			return true
		}
	}
	// A streamed response cannot be replayed.
	return strings.Contains(r.Header.Get("Accept"), "text/event-stream")
}

func (s *Store) hash(query string, body []byte) []byte {
	m := hmac.New(sha256.New, s.HashKey)
	m.Write([]byte(query))
	m.Write([]byte{0})
	m.Write(body)
	return m.Sum(nil)
}

type scope struct {
	workspace uuid.UUID
	user      *uuid.UUID
	apiKey    *uuid.UUID
	key       string
}

func (sc scope) principal() uuid.UUID {
	if sc.user != nil {
		return *sc.user
	}
	return *sc.apiKey
}

func (sc scope) workspaceArg() *uuid.UUID {
	if sc.workspace == uuid.Nil {
		return nil
	}
	return &sc.workspace
}

// record is a stored key.
type record struct {
	id          uuid.UUID
	method      string
	path        string
	hash        []byte
	status      *int
	contentType string
	location    string
	body        []byte
	createdAt   time.Time
}

// claim inserts an in-progress row and returns its id, or returns the live row that
// already holds the key. Expired and abandoned rows are removed and the claim retried.
func (s *Store) claim(ctx context.Context, sc scope, method, path string, hash []byte) (uuid.UUID, *record, error) {
	for range 3 {
		var id uuid.UUID
		err := s.Pool.QueryRow(ctx, `INSERT INTO idempotency_keys (workspace_id, user_id, api_key_id, key, method, path, request_hash)
			VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING id`,
			sc.workspaceArg(), sc.user, sc.apiKey, sc.key, method, path, hash).Scan(&id)
		if err == nil {
			return id, nil, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, nil, err
		}
		var rec record
		err = s.Pool.QueryRow(ctx, `SELECT id, method, path, request_hash, status, content_type, location, body_enc, created_at
			FROM idempotency_keys
			WHERE COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid) = $1
			  AND COALESCE(user_id, api_key_id) = $2 AND key = $3`,
			sc.workspace, sc.principal(), sc.key).Scan(&rec.id, &rec.method, &rec.path, &rec.hash, &rec.status,
			&rec.contentType, &rec.location, &rec.body, &rec.createdAt)
		if errors.Is(err, pgx.ErrNoRows) {
			continue // removed in between; claim again
		}
		if err != nil {
			return uuid.Nil, nil, err
		}
		age := time.Since(rec.createdAt)
		if age < TTL && (rec.status != nil || age < staleAfter) {
			return uuid.Nil, &rec, nil
		}
		if _, err := s.Pool.Exec(ctx, `DELETE FROM idempotency_keys WHERE id = $1`, rec.id); err != nil {
			return uuid.Nil, nil, err
		}
	}
	return uuid.Nil, nil, errors.New("idempotency key claim did not settle")
}

// answer responds to a request whose key is already held.
func (s *Store) answer(w http.ResponseWriter, r *http.Request, rec *record, method, path string, hash []byte) {
	if rec.method != method || rec.path != path || !hmac.Equal(rec.hash, hash) {
		writeProblem(w, r, httpx.E(http.StatusUnprocessableEntity, "idempotency_key_reused",
			"This Idempotency-Key was used for a different request. Use a new key for a new request."))
		return
	}
	if rec.status == nil {
		writeProblem(w, r, httpx.E(http.StatusConflict, "idempotency_in_progress",
			"A request with this Idempotency-Key is still in progress. Retry it shortly."))
		return
	}
	var body []byte
	if len(rec.body) > 0 {
		var err error
		if body, err = s.Box.Open(rec.body); err != nil {
			s.Log.Error("idempotency open", "err", err, "request_id", httpx.RequestIDFrom(r.Context()))
			writeProblem(w, r, httpx.E(http.StatusInternalServerError, "internal", internalMessage))
			return
		}
	}
	h := w.Header()
	if rec.contentType != "" {
		h.Set("Content-Type", rec.contentType)
	}
	if rec.location != "" {
		h.Set("Location", rec.location)
	}
	h.Set(ReplayedHeader, "true")
	w.WriteHeader(*rec.status)
	_, _ = w.Write(body)
}

// run serves the request and stores its result, or releases the key when the result
// should not be kept (server errors, throttling, streams, oversized bodies, panics).
func (s *Store) run(w http.ResponseWriter, r *http.Request, next http.Handler, id uuid.UUID) {
	rec := &recorder{ResponseWriter: w, status: http.StatusOK}
	ctx := context.WithoutCancel(r.Context())
	done := false
	defer func() {
		if done {
			return
		}
		if _, err := s.Pool.Exec(ctx, `DELETE FROM idempotency_keys WHERE id = $1`, id); err != nil {
			s.Log.Error("idempotency release", "err", err, "request_id", httpx.RequestIDFrom(ctx))
		}
	}()
	next.ServeHTTP(rec, r)

	if !keep(rec) {
		return
	}
	var sealed []byte
	if rec.buf.Len() > 0 {
		var err error
		if sealed, err = s.Box.Seal(rec.buf.Bytes()); err != nil {
			s.Log.Error("idempotency seal", "err", err, "request_id", httpx.RequestIDFrom(ctx))
			return
		}
	}
	h := rec.Header()
	if _, err := s.Pool.Exec(ctx, `UPDATE idempotency_keys SET status = $2, content_type = $3, location = $4, body_enc = $5,
		completed_at = now() WHERE id = $1`, id, rec.status, h.Get("Content-Type"), h.Get("Location"), sealed); err != nil {
		s.Log.Error("idempotency save", "err", err, "request_id", httpx.RequestIDFrom(ctx))
		return
	}
	done = true
}

func keep(rec *recorder) bool {
	switch {
	case rec.stream, rec.overflow:
		return false
	case rec.status >= 500, rec.status < 200, rec.status == http.StatusTooManyRequests, rec.status == 499:
		return false
	}
	return true
}

// recorder passes the response through and keeps a copy of up to MaxResponseBody bytes.
type recorder struct {
	http.ResponseWriter
	status   int
	wrote    bool
	stream   bool
	overflow bool
	buf      bytes.Buffer
}

func (w *recorder) WriteHeader(code int) {
	if !w.wrote {
		w.wrote = true
		w.status = code
		w.stream = strings.HasPrefix(w.Header().Get("Content-Type"), "text/event-stream")
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *recorder) Write(b []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	if !w.stream && !w.overflow {
		if w.buf.Len()+len(b) > MaxResponseBody {
			w.overflow = true
			w.buf = bytes.Buffer{}
		} else {
			w.buf.Write(b)
		}
	}
	return w.ResponseWriter.Write(b)
}

func (w *recorder) Unwrap() http.ResponseWriter { return w.ResponseWriter }

const internalMessage = "Something went wrong on our side. Quote the request id if you contact support."

func writeProblem(w http.ResponseWriter, r *http.Request, e *httpx.Error) {
	e.RequestID = httpx.RequestIDFrom(r.Context())
	raw, _ := json.Marshal(e)
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(e.Status)
	_, _ = w.Write(raw)
}

package idempotency

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/auth"
)

func TestDurableFeatureRequestsAlwaysReachCurrentAuthorization(t *testing.T) {
	for _, tc := range []struct{ path, body string }{
		{"/v1/tickets/123/draft", `{"request_id":"create"}`},
		{"/v1/tickets/123/draft/preview", `{"draft_id":"saved"}`},
		{"/v1/tickets/123/draft/send", `{"draft_id":"saved"}`},
		{"/v1/tickets", `{"subject":"Order","preparation":{"namespace":"orders","reference":"42"}}`},
		{"/mcp", `{"jsonrpc":"2.0","method":"tools/call"}`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			// A nil store pool ensures the middleware never attempts transport replay.
			store := &Store{}
			calls := 0
			handler := store.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				b, err := io.ReadAll(r.Body)
				if err != nil || string(b) != tc.body {
					t.Errorf("body was not preserved: %v", err)
				}
				if auth.FromContext(r.Context()).Role == auth.RoleViewer {
					w.WriteHeader(403)
					return
				}
				w.WriteHeader(201)
			}))
			userID, workspaceID := uuid.New(), uuid.New()
			for i, role := range []auth.Role{auth.RoleAgent, auth.RoleViewer} {
				req := httptest.NewRequest("POST", tc.path, strings.NewReader(tc.body))
				req.Header.Set(Header, "same-transport-key")
				req = req.WithContext(auth.WithPrincipal(req.Context(), &auth.Principal{Kind: auth.KindUser, UserID: userID, WorkspaceID: workspaceID, Role: role}))
				rw := httptest.NewRecorder()
				handler.ServeHTTP(rw, req)
				want := 201
				if i == 1 {
					want = 403
				}
				if rw.Code != want {
					t.Fatalf("status %d, want %d", rw.Code, want)
				}
			}
			if calls != 2 {
				t.Fatalf("handler called %d times", calls)
			}
		})
	}
}

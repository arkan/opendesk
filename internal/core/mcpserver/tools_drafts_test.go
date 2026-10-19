package mcpserver

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/useopendesk/opendesk/internal/auth"
)

func TestDraftToolsForwardOnlyExplicitFields(t *testing.T) {
	for _, tc := range []struct {
		name, method, args, want string
		run                      func(context.Context, *caller, json.RawMessage) (any, error)
	}{
		{"read", "GET", `{"ticket":"123"}`, ``, getTicketDraft},
		{"create empty", "POST", `{"ticket":"123","request_id":"order-1","body":""}`, `{"body_html":"","request_id":"order-1"}`, createTicketDraft},
		{"update null mailbox", "PATCH", `{"ticket":"123","draft_id":"draft","expected_revision":2,"mailbox_id":null}`, `{"draft_id":"draft","expected_revision":2,"mailbox_id":null}`, updateTicketDraft},
		{"update markdown", "PATCH", `{"ticket":"123","draft_id":"draft","expected_revision":2,"body":"**Hello**"}`, `{"body_html":"<p><strong>Hello</strong></p>","draft_id":"draft","expected_revision":2}`, updateTicketDraft},
		{"discard", "DELETE", `{"ticket":"123","draft_id":"draft","expected_revision":2}`, `{"draft_id":"draft","expected_revision":2}`, discardTicketDraft},
		{"preview", "POST", `{"ticket":"123","draft_id":"draft","expected_revision":2}`, `{"draft_id":"draft","expected_revision":2}`, previewTicketDraft},
	} {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			c := &caller{h: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				if r.Method != tc.method {
					t.Errorf("method: %s", r.Method)
				}
				wantPath := "/v1/tickets/%23123/draft"
				if tc.name == "preview" {
					wantPath += "/preview"
				}
				if r.URL.EscapedPath() != wantPath {
					t.Errorf("path: %s", r.URL.EscapedPath())
				}
				body, _ := io.ReadAll(r.Body)
				if tc.want == "" {
					if len(body) != 0 {
						t.Errorf("unexpected body: %s", body)
					}
				} else {
					var got, want any
					if json.Unmarshal(body, &got) != nil || json.Unmarshal([]byte(tc.want), &want) != nil || !reflect.DeepEqual(got, want) {
						t.Errorf("body = %s; want %s", body, tc.want)
					}
				}
				if r.Method == "DELETE" {
					w.WriteHeader(204)
				} else {
					_, _ = w.Write([]byte(`{"draft":null}`))
				}
			})}
			out, err := tc.run(context.Background(), c, json.RawMessage(tc.args))
			if err != nil {
				t.Fatal(err)
			}
			if !called {
				t.Fatal("did not call API")
			}
			if tc.name == "discard" {
				b, _ := json.Marshal(out)
				if string(b) != `{"discarded":true}` {
					t.Fatalf("discard result: %s", b)
				}
			}
		})
	}
}

func TestDraftToolsRejectUnknownAndInvalidBody(t *testing.T) {
	c := &caller{h: http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("invalid input reached API") })}
	for _, raw := range []string{`{"ticket":"123","send":true}`, `{"ticket":"123","body":null}`, `{"ticket":"123","body":42}`} {
		if _, err := createTicketDraft(context.Background(), c, json.RawMessage(raw)); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
}

func TestMCPUploadUsesBoundedMultipartAndCurrentPermissions(t *testing.T) {
	p := &auth.Principal{Kind: auth.KindAPIKey, WorkspaceID: uuid.New(), Scopes: []string{auth.ScopeTicketsWrite}}
	calls := 0
	var previousBody string
	c := &caller{p: p, h: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "POST" || r.URL.Path != "/v1/attachments" {
			t.Errorf("route: %s %s", r.Method, r.URL.Path)
		}
		if got := auth.FromContext(r.Context()); got != p {
			t.Error("upload principal lost")
		}
		raw, _ := io.ReadAll(r.Body)
		if previousBody != "" && previousBody != string(raw) {
			t.Error("retry multipart changed")
		}
		previousBody = string(raw)
		r.Body = io.NopCloser(strings.NewReader(string(raw)))
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		data, _ := io.ReadAll(file)
		if header.Filename != "order.pdf" || string(data) != "%PDF-test" {
			t.Errorf("file: %s %q", header.Filename, data)
		}
		_, _ = w.Write([]byte(`{"id":"file"}`))
	})}
	args, _ := json.Marshal(map[string]any{"filename": "order.pdf", "content_base64": base64.StdEncoding.EncodeToString([]byte("%PDF-test"))})
	for range 2 {
		if _, err := uploadAttachment(context.Background(), c, args); err != nil {
			t.Fatal(err)
		}
	}
	for _, data := range []string{"", "data:application/pdf;base64,QQ==", "QQ==\n", "!", "QR==", strings.Repeat("A", maxUploadBase64+1)} {
		args, _ := json.Marshal(map[string]any{"filename": "order.pdf", "content_base64": data})
		if _, err := uploadAttachment(context.Background(), c, args); err == nil {
			t.Errorf("invalid upload accepted (length %d)", len(data))
		}
	}
	p.Scopes = nil
	if _, err := uploadAttachment(context.Background(), c, args); statusOf(err) != 403 {
		t.Fatalf("revoked upload: %v", err)
	}
	if calls != 2 {
		t.Fatalf("API calls: %d", calls)
	}
}

func TestMCPSharedDraftWorkflow(t *testing.T) {
	e := newEnv(t)
	mailbox := uuid.New()
	e.Exec(`INSERT INTO mailboxes(id,workspace_id,name,email,inbound_kind,forwarding_token,outbound_kind,brand_id) VALUES($1,$2,'Orders',$3,'forwarding',$4,'smtp',$5)`, mailbox, e.WS.ID, "orders-"+mailbox.String()+"@example.com", uuid.NewString(), e.WS.BrandID)
	s := e.session(e.APIKey(e.WS, auth.ScopeTicketsRead, auth.ScopeTicketsWrite))
	var ticket outTicket
	prep := map[string]any{"email": "publisher@example.com", "subject": "Weekly order", "body": "Internal order context", "mailbox_id": mailbox.String(), "preparation": map[string]any{"namespace": "orders", "reference": "week-1"}}
	call(t, s, "create_ticket", prep, &ticket)
	var repeated outTicket
	call(t, s, "create_ticket", prep, &repeated)
	if ticket.ID != repeated.ID {
		t.Fatal("preparation created a duplicate ticket")
	}
	var attachment struct {
		ID string `json:"id"`
	}
	call(t, s, "upload_attachment", map[string]any{"filename": "order.pdf", "content_base64": base64.StdEncoding.EncodeToString([]byte("%PDF-order"))}, &attachment)
	type draft struct {
		ID          string `json:"id"`
		Revision    int64  `json:"revision"`
		Body        string `json:"body_html"`
		Attachments []struct {
			ID string `json:"id"`
		} `json:"attachments"`
	}
	var created struct {
		Draft draft `json:"draft"`
	}
	input := map[string]any{"ticket": ticket.ID, "request_id": "week-1-draft", "body": "Please find our **order** attached.", "attachment_ids": []string{attachment.ID}}
	call(t, s, "create_ticket_draft", input, &created)
	if created.Draft.ID == "" || created.Draft.Revision != 1 || len(created.Draft.Attachments) != 1 {
		t.Fatalf("draft: %+v", created)
	}
	var updated struct {
		Draft draft `json:"draft"`
	}
	call(t, s, "update_ticket_draft", map[string]any{"ticket": ticket.ID, "draft_id": created.Draft.ID, "expected_revision": created.Draft.Revision, "body": "Sylvia's approved wording"}, &updated)
	call(t, s, "create_ticket_draft", input, &created)
	if created.Draft.Revision != updated.Draft.Revision || created.Draft.Body != updated.Draft.Body {
		t.Fatal("creation replay overwrote shared edits")
	}
	res := call(t, s, "update_ticket_draft", map[string]any{"ticket": ticket.ID, "draft_id": created.Draft.ID, "expected_revision": 1, "body": "stale"}, nil)
	if !res.IsError || !strings.Contains(text(res), "draft_revision_conflict") {
		t.Fatalf("stale write: %s", text(res))
	}
	var preview struct {
		ReviewToken string   `json:"review_token"`
		To          []string `json:"to"`
	}
	call(t, s, "preview_ticket_draft", map[string]any{"ticket": ticket.ID, "draft_id": updated.Draft.ID, "expected_revision": updated.Draft.Revision}, &preview)
	if preview.ReviewToken == "" || len(preview.To) != 1 || preview.To[0] != "publisher@example.com" {
		t.Fatalf("preview: %+v", preview)
	}
	var public int
	if err := e.D.DB.Pool.QueryRow(e.Ctx, `SELECT count(*) FROM messages WHERE workspace_id=$1 AND ticket_id=$2 AND kind='reply'`, e.WS.ID, ticket.ID).Scan(&public); err != nil {
		t.Fatal(err)
	}
	if public != 0 {
		t.Fatalf("preparation sent %d public messages", public)
	}
	call(t, s, "discard_ticket_draft", map[string]any{"ticket": ticket.ID, "draft_id": updated.Draft.ID, "expected_revision": updated.Draft.Revision}, nil)
	var read struct {
		Draft *draft `json:"draft"`
	}
	call(t, s, "get_ticket_draft", map[string]any{"ticket": ticket.ID}, &read)
	if read.Draft != nil {
		t.Fatal("discarded draft still active")
	}
}

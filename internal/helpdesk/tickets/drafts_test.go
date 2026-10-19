package tickets_test

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/helpdesk/hdtest"
	"github.com/useopendesk/opendesk/internal/helpdesk/tickets"
	"github.com/useopendesk/opendesk/internal/helpdesk/widget"
	"github.com/useopendesk/opendesk/internal/ids"
	"github.com/useopendesk/opendesk/internal/jobs"
)

type sharedDraft struct {
	ID          uuid.UUID           `json:"id"`
	TicketID    uuid.UUID           `json:"ticket_id"`
	Revision    int64               `json:"revision"`
	State       string              `json:"state"`
	BodyHTML    string              `json:"body_html"`
	MailboxID   *uuid.UUID          `json:"mailbox_id"`
	Cc          []string            `json:"cc"`
	Bcc         []string            `json:"bcc"`
	Attachments []domain.Attachment `json:"attachments"`
	MessageID   *uuid.UUID          `json:"message_id"`
}
type sharedDraftResponse struct {
	Draft *sharedDraft `json:"draft"`
}

func draftTicket(t *testing.T, e *hdtest.Env, ws hdtest.WS) domain.Ticket {
	mb := addMailbox(t, e, ws)
	e.Exec(`UPDATE mailboxes SET outbound_kind='smtp' WHERE id=$1`, mb)
	return createTicket(t, e, ws, map[string]any{"mailbox_id": mb.String(), "contact": map[string]any{"email": "publisher@example.com"}, "kind": "note"})
}
func draftIdentityBody(d *sharedDraft) map[string]any {
	return map[string]any{"draft_id": d.ID.String(), "expected_revision": d.Revision}
}
func TestSharedDraftLifecycleAndReviewedSend(t *testing.T) {
	e, ws := newEnv(t)
	tk := draftTicket(t, e, ws)
	path := "/v1/tickets/" + tk.ID.String() + "/draft"
	var empty sharedDraftResponse
	e.Do("GET", path, ws.Viewer.As(ws), nil).Want(t, 200).JSON(t, &empty)
	if empty.Draft != nil {
		t.Fatal("unexpected draft")
	}
	original := map[string]any{"request_id": "order-42", "body_html": "<p>Order <script>bad()</script>ready</p>", "cc": []string{"copy@example.com"}}
	var created sharedDraftResponse
	e.Do("POST", path, ws.Agent.As(ws), original).Want(t, 201).JSON(t, &created)
	x := created.Draft
	if x == nil || x.Revision != 1 || x.State != "draft" || x.BodyHTML != "<p>Order ready</p>" {
		t.Fatalf("draft: %+v", x)
	}
	e.Do("POST", path, ws.Admin.As(ws), map[string]any{"request_id": "other"}).Want(t, 409)
	e.Do("PATCH", path, ws.Viewer.As(ws), draftIdentityBody(x)).Want(t, 403)
	update := draftIdentityBody(x)
	update["body_html"] = "<p>Reviewed order</p>"
	update["mailbox_id"] = nil
	var changed sharedDraftResponse
	e.Do("PATCH", path, ws.Admin.As(ws), update).Want(t, 200).JSON(t, &changed)
	if changed.Draft.Revision != 2 || changed.Draft.BodyHTML != "<p>Reviewed order</p>" {
		t.Fatalf("updated: %+v", changed.Draft)
	}
	e.Do("PATCH", path, ws.Agent.As(ws), update).Want(t, 409)
	var replay sharedDraftResponse
	e.Do("POST", path, ws.Agent.As(ws), original).Want(t, 200).JSON(t, &replay)
	if replay.Draft.BodyHTML != changed.Draft.BodyHTML {
		t.Fatal("replay overwrote edits")
	}
	original["body_html"] = "different"
	e.Do("POST", path, ws.Agent.As(ws), original).Want(t, 409)
	x = changed.Draft
	var preview struct {
		ReviewToken string   `json:"review_token"`
		BodyHTML    string   `json:"body_html"`
		To          []string `json:"to"`
	}
	e.Do("POST", path+"/preview", ws.Agent.As(ws), draftIdentityBody(x)).Want(t, 200).JSON(t, &preview)
	if preview.ReviewToken == "" || preview.BodyHTML != x.BodyHTML || len(preview.To) != 1 {
		t.Fatalf("preview: %+v", preview)
	}
	send := draftIdentityBody(x)
	send["review_token"] = preview.ReviewToken
	send["status"] = "solved"
	// A review belongs to its reviewing principal.
	e.Do("POST", path+"/send", ws.Admin.As(ws), send).Want(t, 409)
	// Subject changes invalidate a review even if draft content remains unchanged.
	e.Exec(`UPDATE tickets SET subject='Changed subject' WHERE id=$1`, tk.ID)
	e.Do("POST", path+"/send", ws.Agent.As(ws), send).Want(t, 409)
	e.Do("POST", path+"/preview", ws.Agent.As(ws), draftIdentityBody(x)).Want(t, 200).JSON(t, &preview)
	send["review_token"] = preview.ReviewToken
	var sent struct {
		MessageID      uuid.UUID `json:"message_id"`
		Status         string    `json:"status"`
		DeliveryStatus string    `json:"delivery_status"`
	}
	e.Do("POST", path+"/send", ws.Agent.As(ws), send).Want(t, 201).JSON(t, &sent)
	if sent.MessageID == uuid.Nil || sent.Status != "solved" || sent.DeliveryStatus != "pending" {
		t.Fatalf("sent: %+v", sent)
	}
	var again struct {
		MessageID uuid.UUID `json:"message_id"`
		Status    string    `json:"status"`
	}
	e.Exec(`UPDATE tickets SET status='open' WHERE id=$1`, tk.ID)
	e.Do("POST", path+"/send", ws.Agent.As(ws), send).Want(t, 200).JSON(t, &again)
	if again.MessageID != sent.MessageID || again.Status != "open" {
		t.Fatalf("send replay: %+v", again)
	}
	original["body_html"] = "<p>Order <script>bad()</script>ready</p>"
	e.Do("POST", path, ws.Agent.As(ws), original).Want(t, 200).JSON(t, &replay)
	if replay.Draft.State != "sent" || replay.Draft.BodyHTML != "" || replay.Draft.MailboxID != nil || len(replay.Draft.Cc) > 0 || len(replay.Draft.Attachments) > 0 {
		t.Fatalf("terminal: %+v", replay.Draft)
	}
	if n := len(e.Jobs(jobs.SendMessageArgs{}.Kind(), ws.ID)); n != 1 {
		t.Fatalf("send jobs: %d", n)
	}
	var locked bool
	if err := e.D.DB.Pool.QueryRow(e.Ctx, `SELECT recipient_locked FROM messages WHERE id=$1`, sent.MessageID).Scan(&locked); err != nil || !locked {
		t.Fatalf("recipient lock: %v %v", locked, err)
	}
}
func TestSharedDraftConcurrentCreateAndSend(t *testing.T) {
	e, ws := newEnv(t)
	tk := draftTicket(t, e, ws)
	path := "/v1/tickets/" + tk.ID.String() + "/draft"
	var wg sync.WaitGroup
	results := make(chan *hdtest.Resp, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- e.Do("POST", path, ws.Agent.As(ws), map[string]any{"request_id": "same", "body_html": "<p>Ready</p>"})
		}()
	}
	wg.Wait()
	close(results)
	var x sharedDraftResponse
	var statuses []int
	for r := range results {
		statuses = append(statuses, r.Status)
		r.JSON(t, &x)
	}
	if statuses[0]+statuses[1] != 401 {
		t.Fatalf("create statuses: %v", statuses)
	}
	var preview struct {
		ReviewToken string `json:"review_token"`
	}
	e.Do("POST", path+"/preview", ws.Agent.As(ws), draftIdentityBody(x.Draft)).Want(t, 200).JSON(t, &preview)
	send := draftIdentityBody(x.Draft)
	send["review_token"] = preview.ReviewToken
	results = make(chan *hdtest.Resp, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); results <- e.Do("POST", path+"/send", ws.Agent.As(ws), send) }()
	}
	wg.Wait()
	close(results)
	statuses = nil
	var mid uuid.UUID
	for r := range results {
		statuses = append(statuses, r.Status)
		var got struct {
			MessageID uuid.UUID `json:"message_id"`
		}
		r.JSON(t, &got)
		if mid != uuid.Nil && mid != got.MessageID {
			t.Fatal("double send")
		}
		mid = got.MessageID
	}
	if statuses[0]+statuses[1] != 401 {
		t.Fatalf("send statuses: %v", statuses)
	}
}
func TestPreparationDurableReplayAndGuard(t *testing.T) {
	e, ws := newEnv(t)
	e.SetSettings(ws, map[string]any{"csat_enabled": true})
	addAutomation(t, e, ws, jobs.TriggerTicketCreated, 0, []map[string]string{}, []map[string]string{{"type": "send_reply", "value": "<p>Automatic reply</p>"}})
	mb := addMailbox(t, e, ws)
	body := map[string]any{"subject": "Order 42", "mailbox_id": mb.String(), "contact": map[string]any{"email": "publisher@example.com"}, "body_html": "Internal context", "preparation": map[string]any{"namespace": "orders", "reference": "42"}}
	var tk domain.Ticket
	e.Do("POST", "/v1/tickets", ws.Agent.As(ws), body).Want(t, 201).JSON(t, &tk)
	var count int
	e.D.DB.Pool.QueryRow(e.Ctx, `SELECT count(*) FROM messages WHERE ticket_id=$1 AND kind='reply'`, tk.ID).Scan(&count)
	if count != 0 {
		t.Fatal("preparation created an outgoing reply")
	}
	runTriggers(t, e, ws.ID)
	e.Do("PATCH", "/v1/tickets/"+tk.ID.String(), ws.Agent.As(ws), map[string]any{"status": "solved"}).Want(t, 200)
	if n := len(e.Jobs(jobs.SendMessageArgs{}.Kind(), ws.ID)); n != 0 {
		t.Fatalf("automatic replies before review: %d", n)
	}
	if n := len(e.Jobs(jobs.SendTicketEmailArgs{}.Kind(), ws.ID)); n != 0 {
		t.Fatalf("CSAT before review: %d", n)
	}

	guarded, err := domain.PreparationGuarded(e.Ctx, e.D.DB.Pool, ws.ID, tk.ID)
	if err != nil || !guarded {
		t.Fatalf("guard: %v %v", guarded, err)
	}
	e.Exec(`UPDATE ticket_preparations SET created_at=now()-interval '48 hours' WHERE ticket_id=$1`, tk.ID)
	e.Exec(`UPDATE tickets SET subject='Human edits' WHERE id=$1`, tk.ID)
	var got domain.Ticket
	e.Do("POST", "/v1/tickets", ws.Admin.As(ws), body).Want(t, 200).JSON(t, &got)
	if got.ID != tk.ID || got.Subject != "Human edits" {
		t.Fatal("replay changed ticket")
	}
	body["subject"] = "Changed input"
	e.Do("POST", "/v1/tickets", ws.Agent.As(ws), body).Want(t, 409)
	body["subject"] = "Order 42"
	e.Do("POST", "/v1/tickets/"+tk.ID.String()+"/messages", ws.Agent.As(ws), map[string]any{"kind": "reply", "body_html": "Explicit approved send"}).Want(t, 201)
	guarded, err = domain.PreparationGuarded(e.Ctx, e.D.DB.Pool, ws.ID, tk.ID)
	if err != nil || guarded {
		t.Fatalf("release: %v %v", guarded, err)
	}
	e.Exec(`DELETE FROM tickets WHERE id=$1`, tk.ID)
	e.Do("POST", "/v1/tickets", ws.Agent.As(ws), body).Want(t, 410)
}
func TestSharedDraftAttachmentReservationAndDiscard(t *testing.T) {
	e, ws := newEnv(t)
	tk := draftTicket(t, e, ws)
	path := "/v1/tickets/" + tk.ID.String() + "/draft"
	att := ids.New()
	e.Exec(`INSERT INTO attachments(id,workspace_id,filename,size_bytes,storage_key,uploaded_by,created_at) VALUES($1,$2,'order.pdf',3,'draft-test',$3,now()-interval '48 hours')`, att, ws.ID, ws.Agent.ID)
	var out sharedDraftResponse
	e.Do("POST", path, ws.Agent.As(ws), map[string]any{"request_id": "attachments", "attachment_ids": []string{att.String()}}).Want(t, 201).JSON(t, &out)
	if len(out.Draft.Attachments) != 1 || out.Draft.Attachments[0].URL != "/v1/attachments/"+att.String() {
		t.Fatalf("attachments: %+v", out)
	}
	e.Do("POST", "/v1/tickets/"+tk.ID.String()+"/messages", ws.Agent.As(ws), map[string]any{"kind": "note", "body_html": "test", "attachment_ids": []string{att.String()}}).Want(t, 422)
	// Collaborators can send files already reserved on the shared draft.
	var preview struct {
		ReviewToken string `json:"review_token"`
	}
	e.Do("POST", path+"/preview", ws.Admin.As(ws), draftIdentityBody(out.Draft)).Want(t, 200).JSON(t, &preview)
	send := draftIdentityBody(out.Draft)
	send["review_token"] = preview.ReviewToken
	e.Do("POST", path+"/send", ws.Admin.As(ws), send).Want(t, 201)
	var origin, msg *uuid.UUID
	e.D.DB.Pool.QueryRow(e.Ctx, `SELECT draft_ticket_id,message_id FROM attachments WHERE id=$1`, att).Scan(&origin, &msg)
	if origin != nil || msg == nil {
		t.Fatalf("linked origin=%v message=%v", origin, msg)
	}
	var second sharedDraftResponse
	e.Do("POST", path, ws.Agent.As(ws), map[string]any{"request_id": "next", "body_html": "Next"}).Want(t, 201).JSON(t, &second)
	e.Do("POST", "/v1/tickets/"+tk.ID.String()+"/merge", ws.Agent.As(ws), map[string]any{"into_id": fmt.Sprint(tk.ID)}).Want(t, 422)
	e.Do("DELETE", path, ws.Admin.As(ws), draftIdentityBody(second.Draft)).Want(t, 204)
	e.Do("DELETE", path, ws.Admin.As(ws), draftIdentityBody(second.Draft)).Want(t, 204)
	e.Do("PATCH", path, ws.Agent.As(ws), draftIdentityBody(second.Draft)).Want(t, 409)
}

func TestDraftFilesRequireCurrentOriginAccessAndSurvivePurge(t *testing.T) {
	e := hdtest.New(t, tickets.Register, widget.Register)
	ws := e.NewWorkspace()
	tk := draftTicket(t, e, ws)
	path := "/v1/tickets/" + tk.ID.String() + "/draft"
	var upload domain.Attachment
	e.Upload("/v1/attachments", ws.Agent.As(ws), "order.pdf", []byte("%PDF-1.4 order")).Want(t, 201).JSON(t, &upload)
	oldURL := strings.TrimPrefix(upload.URL, e.D.Cfg.APIURL)
	var draft sharedDraftResponse
	e.Do("POST", path, ws.Agent.As(ws), map[string]any{"request_id": "files", "attachment_ids": []string{upload.ID.String()}}).Want(t, 201).JSON(t, &draft)
	e.Exec(`UPDATE attachments SET created_at=now()-interval '48 hours' WHERE id=$1`, upload.ID)
	if err := tickets.PurgeAttachments(e.Ctx, e.D); err != nil {
		t.Fatal(err)
	}
	var n int
	e.D.DB.Pool.QueryRow(e.Ctx, `SELECT count(*) FROM attachments WHERE id=$1`, upload.ID).Scan(&n)
	if n != 1 {
		t.Fatal("purged reserved attachment")
	}
	// Generic signed links never authorize a draft-origin file.
	e.Do("GET", oldURL, hdtest.Auth{}, nil).Want(t, 404)
	download := e.Do("GET", "/v1/attachments/"+upload.ID.String(), ws.Admin.As(ws), nil).Want(t, 200)
	if download.Header.Get("Cache-Control") != "private, no-store" || download.Header.Get("Location") != "" {
		t.Fatalf("draft download headers: %v", download.Header)
	}
	e.Do("DELETE", path, ws.Admin.As(ws), draftIdentityBody(draft.Draft)).Want(t, 204)
	e.Do("GET", oldURL, hdtest.Auth{}, nil).Want(t, 404)
	team := addTeam(t, e, ws, ws.Admin.ID)
	e.Exec(`UPDATE teams SET private=true WHERE id=$1`, team)
	e.Exec(`UPDATE tickets SET team_id=$2 WHERE id=$1`, tk.ID, team)
	e.Do("GET", "/v1/attachments/"+upload.ID.String(), ws.Agent.As(ws), nil).Want(t, 404)
	other := draftTicket(t, e, ws)
	e.Do("POST", "/v1/tickets/"+other.ID.String()+"/messages", ws.Agent.As(ws), map[string]any{"kind": "note", "body_html": "reuse", "attachment_ids": []string{upload.ID.String()}}).Want(t, 422)
	e.Do("GET", "/v1/attachments/"+upload.ID.String(), ws.Admin.As(ws), nil).Want(t, 200)
	e.Exec(`UPDATE tickets SET deleted_at=now() WHERE id=$1`, tk.ID)
	e.Do("GET", "/v1/attachments/"+upload.ID.String(), ws.Admin.As(ws), nil).Want(t, 404)
	if err := tickets.PurgeAttachments(e.Ctx, e.D); err != nil {
		t.Fatal(err)
	}
	e.D.DB.Pool.QueryRow(e.Ctx, `SELECT count(*) FROM attachments WHERE id=$1`, upload.ID).Scan(&n)
	if n != 0 {
		t.Fatal("discarded stale upload not purged")
	}
}

func TestSharedDraftUpdateAndTerminalRaces(t *testing.T) {
	e, ws := newEnv(t)
	tk := draftTicket(t, e, ws)
	path := "/v1/tickets/" + tk.ID.String() + "/draft"
	var x sharedDraftResponse
	e.Do("POST", path, ws.Agent.As(ws), map[string]any{"request_id": "races", "body_html": "Ready"}).Want(t, 201).JSON(t, &x)
	var wg sync.WaitGroup
	results := make(chan *hdtest.Resp, 2)
	for _, body := range []string{"First edit", "Second edit"} {
		wg.Add(1)
		go func(body string) {
			defer wg.Done()
			patch := draftIdentityBody(x.Draft)
			patch["body_html"] = body
			results <- e.Do("PATCH", path, ws.Agent.As(ws), patch)
		}(body)
	}
	wg.Wait()
	close(results)
	success, conflict := 0, 0
	for r := range results {
		switch r.Status {
		case 200:
			success++
			r.JSON(t, &x)
		case 409:
			conflict++
		default:
			t.Fatalf("update status %d: %s", r.Status, r.Body)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("update race success=%d conflict=%d", success, conflict)
	}
	dest := draftTicket(t, e, ws)
	e.Do("POST", "/v1/tickets/"+tk.ID.String()+"/merge", ws.Agent.As(ws), map[string]any{"into_id": dest.ID.String()}).Want(t, 409)
	var preview struct {
		ReviewToken string `json:"review_token"`
	}
	e.Do("POST", path+"/preview", ws.Agent.As(ws), draftIdentityBody(x.Draft)).Want(t, 200).JSON(t, &preview)
	send := draftIdentityBody(x.Draft)
	send["review_token"] = preview.ReviewToken
	results = make(chan *hdtest.Resp, 2)
	wg.Add(2)
	go func() { defer wg.Done(); results <- e.Do("POST", path+"/send", ws.Agent.As(ws), send) }()
	go func() { defer wg.Done(); results <- e.Do("DELETE", path, ws.Admin.As(ws), draftIdentityBody(x.Draft)) }()
	wg.Wait()
	close(results)
	success, conflict = 0, 0
	for r := range results {
		switch r.Status {
		case 201, 204:
			success++
		case 409:
			conflict++
		default:
			t.Fatalf("terminal race status %d: %s", r.Status, r.Body)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("terminal race success=%d conflict=%d", success, conflict)
	}
	if n := len(e.Jobs(jobs.SendMessageArgs{}.Kind(), ws.ID)); n > 1 {
		t.Fatalf("terminal race queued %d sends", n)
	}
}

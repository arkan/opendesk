package tickets_test

import (
	"strings"
	"testing"
	"time"

	"github.com/useopendesk/opendesk/internal/helpdesk/hdtest"
	"github.com/useopendesk/opendesk/internal/ids"
)

func TestSharedDraftPreservesTemplateAttributes(t *testing.T) {
	e, ws := newEnv(t)
	tk := draftTicket(t, e, ws)
	path := "/v1/tickets/" + tk.ID.String() + "/draft"
	e.Exec(`UPDATE brands SET help_center_enabled=true WHERE id=$1`, ws.BrandID)
	var slug string
	e.Scalar(`SELECT slug FROM brands WHERE id=$1`, &slug, ws.BrandID)
	const body = `<p>{{ contact.email }}</p><a href="{{ brand.help_center_url }}">Help</a><img src="https://cdn.example.com/agent.png" onerror="alert(1)">`
	var draft sharedDraftResponse
	e.Do("POST", path, ws.Agent.As(ws), map[string]any{"request_id": "templates", "body_html": body}).Want(t, 201).JSON(t, &draft)
	for _, step := range []string{"create", "update"} {
		if step == "update" {
			patch := draftIdentityBody(draft.Draft)
			patch["body_html"] = body + "<p>Updated</p>"
			e.Do("PATCH", path, ws.Agent.As(ws), patch).Want(t, 200).JSON(t, &draft)
		}
		for _, tag := range []string{`{{ contact.email }}`, `href="{{ brand.help_center_url }}"`} {
			if !strings.Contains(draft.Draft.BodyHTML, tag) {
				t.Errorf("%s removed template %q: %s", step, tag, draft.Draft.BodyHTML)
			}
		}
		if strings.Contains(draft.Draft.BodyHTML, "onerror") {
			t.Errorf("%s kept unsafe HTML: %s", step, draft.Draft.BodyHTML)
		}
		var preview struct {
			BodyHTML string `json:"body_html"`
		}
		e.Do("POST", path+"/preview", ws.Agent.As(ws), draftIdentityBody(draft.Draft)).Want(t, 200).JSON(t, &preview)
		for _, rendered := range []string{"publisher@example.com", `href="` + e.D.Cfg.HelpCenterURL(slug) + `"`, `src="https://cdn.example.com/agent.png"`} {
			if !strings.Contains(preview.BodyHTML, rendered) {
				t.Errorf("%s preview is missing %q: %s", step, rendered, preview.BodyHTML)
			}
		}
		if strings.Contains(preview.BodyHTML, "{{") || strings.Contains(preview.BodyHTML, "onerror") {
			t.Errorf("%s preview contains unrendered or unsafe HTML: %s", step, preview.BodyHTML)
		}
	}
}

func TestSharedDraftReservationAfterWaitingForAnotherTicket(t *testing.T) {
	e, ws := newEnv(t)
	first := draftTicket(t, e, ws)
	second := draftTicket(t, e, ws)
	var firstDraft, secondDraft sharedDraftResponse
	firstPath := "/v1/tickets/" + first.ID.String() + "/draft"
	secondPath := "/v1/tickets/" + second.ID.String() + "/draft"
	e.Do("POST", firstPath, ws.Agent.As(ws), map[string]any{"request_id": "first"}).Want(t, 201).JSON(t, &firstDraft)
	e.Do("POST", secondPath, ws.Agent.As(ws), map[string]any{"request_id": "second"}).Want(t, 201).JSON(t, &secondDraft)
	attachment := ids.New()
	e.Exec(`INSERT INTO attachments(id,workspace_id,filename,size_bytes,storage_key,uploaded_by) VALUES($1,$2,'order.pdf',3,'reservation-test',$3)`, attachment, ws.ID, ws.Agent.ID)

	// Hold an uncommitted reservation while the other ticket waits for its file lock.
	tx, err := e.D.DB.Pool.Begin(e.Ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(e.Ctx)
	if _, err := tx.Exec(e.Ctx, `UPDATE attachments SET draft_ticket_id=$3 WHERE workspace_id=$1 AND id=$2`, ws.ID, attachment, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(e.Ctx, `INSERT INTO ticket_draft_attachments(workspace_id,draft_id,attachment_id,position) VALUES($1,$2,$3,0)`, ws.ID, firstDraft.Draft.ID, attachment); err != nil {
		t.Fatal(err)
	}
	patch := draftIdentityBody(secondDraft.Draft)
	patch["attachment_ids"] = []string{attachment.String()}
	result := make(chan *hdtest.Resp, 1)
	go func() { result <- e.Do("PATCH", secondPath, ws.Agent.As(ws), patch) }()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		var blocked bool
		if err := e.D.DB.Pool.QueryRow(e.Ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))`, tx.Conn().PgConn().PID()).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		select {
		case response := <-result:
			t.Fatalf("reservation did not wait for the file lock: %d %s", response.Status, response.Body)
		case <-deadline.C:
			t.Fatal("reservation did not reach the locked attachment")
		case <-tick.C:
		}
	}
	if err := tx.Commit(e.Ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case response := <-result:
		response.Want(t, 422)
	case <-time.After(5 * time.Second):
		t.Fatal("reservation did not finish after the file lock was released")
	}
	e.Do("GET", secondPath, ws.Agent.As(ws), nil).Want(t, 200).JSON(t, &secondDraft)
	if secondDraft.Draft.Revision != 1 || len(secondDraft.Draft.Attachments) != 0 {
		t.Fatalf("failed reservation changed the draft: %+v", secondDraft.Draft)
	}
	e.Do("GET", firstPath, ws.Agent.As(ws), nil).Want(t, 200).JSON(t, &firstDraft)
	if len(firstDraft.Draft.Attachments) != 1 || firstDraft.Draft.Attachments[0].ID != attachment {
		t.Fatalf("failed reservation changed the winning draft: %+v", firstDraft.Draft)
	}
}

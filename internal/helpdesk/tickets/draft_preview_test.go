package tickets_test

import (
	"strings"
	"testing"
)

func TestSharedDraftPreviewUsesMailboxAliasInSignature(t *testing.T) {
	e, ws := newEnv(t)
	ticket := draftTicket(t, e, ws)
	const alias = "orders@acme.test"
	e.Exec(`UPDATE mailboxes SET aliases=ARRAY[$2],signature_html='<p>Contact {{mailbox.email}}</p>' WHERE id=$1`, ticket.MailboxID, alias)
	e.Exec(`UPDATE tickets SET received_at=$2 WHERE id=$1`, ticket.ID, alias)
	path := "/v1/tickets/" + ticket.ID.String() + "/draft"
	var saved sharedDraftResponse
	e.Do("POST", path, ws.Agent.As(ws), map[string]any{"request_id": "alias-review", "body_html": "<p>Order ready</p>"}).Want(t, 201).JSON(t, &saved)
	var preview struct {
		From struct {
			Email string `json:"email"`
		} `json:"from"`
		SignatureHTML string `json:"signature_html"`
	}
	e.Do("POST", path+"/preview", ws.Agent.As(ws), draftIdentityBody(saved.Draft)).Want(t, 200).JSON(t, &preview)
	if preview.From.Email != alias || !strings.Contains(preview.SignatureHTML, alias) {
		t.Fatalf("preview sender and signature disagree: %+v", preview)
	}
}

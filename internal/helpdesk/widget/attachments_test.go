package widget_test

import (
	"net/url"
	"testing"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/helpdesk/hdtest"
	"github.com/useopendesk/opendesk/internal/helpdesk/tickets"
	"github.com/useopendesk/opendesk/internal/helpdesk/widget"
)

func TestDraftOriginAttachmentRequiresActiveWorkspace(t *testing.T) {
	e := hdtest.New(t, widget.Register, tickets.Register)
	ws := e.NewWorkspace()
	var ticket domain.Ticket
	e.Do("POST", "/v1/tickets", ws.Agent.As(ws), map[string]any{"subject": "Review order", "kind": "note"}).Want(t, 201).JSON(t, &ticket)
	var attachment domain.Attachment
	e.Upload("/v1/attachments", ws.Agent.As(ws), "order.pdf", []byte("%PDF-order")).Want(t, 201).JSON(t, &attachment)
	e.Exec(`UPDATE attachments SET draft_ticket_id=$2 WHERE id=$1`, attachment.ID, ticket.ID)
	readers := []hdtest.Auth{ws.Viewer.As(ws), {Bearer: e.APIKey(ws, auth.ScopeTicketsRead)}}
	signed, err := url.Parse(attachment.URL)
	if err != nil {
		t.Fatal(err)
	}
	paths := []string{"/v1/attachments/" + attachment.ID.String(), signed.RequestURI()}
	for _, reader := range readers {
		for _, path := range paths {
			e.Do("GET", path, reader, nil).Want(t, 200)
		}
	}
	e.Exec(`UPDATE workspaces SET suspended_at=now() WHERE id=$1`, ws.ID)
	for _, reader := range readers {
		for _, path := range paths {
			e.Do("GET", path, reader, nil).Want(t, 404)
		}
	}
}

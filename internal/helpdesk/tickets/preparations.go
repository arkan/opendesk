package tickets

import (
	"context"
	"crypto/hmac"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/httpx"
)

func preparationInput(b ticketCreateBody) ticketCreateBody {
	b.Preparation = nil
	if b.Kind == "" {
		b.Kind = "note"
	}
	if b.Channel == "" {
		b.Channel = "email"
	}
	if b.Status == "" {
		b.Status = domain.StatusOpen
	}
	if b.Priority == "" {
		b.Priority = "normal"
	}
	for _, ref := range []*string{&b.ContactID, &b.MailboxID, &b.AssigneeID, &b.TeamID, &b.BrandID} {
		if id, err := uuid.Parse(*ref); err == nil {
			*ref = id.String()
		}
	}
	if b.Contact != nil {
		contact := *b.Contact
		contact.Email = strings.ToLower(strings.TrimSpace(contact.Email))
		contact.Name = strings.TrimSpace(contact.Name)
		b.Contact = &contact
	}
	if cc, err := cleanEmails(b.Cc); err == nil {
		b.Cc = cc
	}
	if bcc, err := cleanEmails(b.Bcc); err == nil {
		b.Bcc = bcc
	}
	if att, err := hd.ParseAttachmentIDs(b.AttachmentIDs); err == nil {
		b.AttachmentIDs = nil
		for _, id := range att {
			b.AttachmentIDs = append(b.AttachmentIDs, id.String())
		}
	}
	b.Subject = strings.TrimSpace(b.Subject)
	b.BodyHTML = hd.SanitizeRich(b.BodyHTML)
	return b
}
func createPreparedTicket(ctx context.Context, tx pgx.Tx, d *deps.Deps, p *auth.Principal, b ticketCreateBody) (domain.Ticket, bool, error) {
	if b.Preparation == nil {
		t, err := createTicket(ctx, tx, d, p, b)
		return t, false, err
	}
	if d.Cfg.SharedDraftsDisabled {
		return domain.Ticket{}, false, httpx.E(503, "shared_drafts_unavailable", "Shared drafts are not enabled on this instance yet.")
	}
	ref := b.Preparation
	if utf8.RuneCountInString(ref.Namespace) < 1 || utf8.RuneCountInString(ref.Namespace) > 100 || utf8.RuneCountInString(ref.Reference) < 1 || utf8.RuneCountInString(ref.Reference) > 255 {
		return domain.Ticket{}, false, httpx.Validation("preparation namespace and reference are required within their length limits")
	}
	// A transaction-scoped reference lock serializes creation without taking a reference-row lock before a ticket lock.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, p.WorkspaceID.String()+":"+ref.Namespace+":"+ref.Reference); err != nil {
		return domain.Ticket{}, false, err
	}
	var tid *uuid.UUID
	var hash []byte
	err := tx.QueryRow(ctx, `SELECT ticket_id,request_hash FROM ticket_preparations WHERE workspace_id=$1 AND namespace=$2 AND reference=$3`, p.WorkspaceID, ref.Namespace, ref.Reference).Scan(&tid, &hash)
	if db.IsNotFound(err) {
		t, err := createTicket(ctx, tx, d, p, b)
		return t, false, err
	}
	if err != nil {
		return domain.Ticket{}, false, err
	}
	if tid == nil {
		return domain.Ticket{}, false, httpx.E(410, "preparation_result_gone", "The prepared ticket no longer exists.")
	}
	id, err := resolveVisible(ctx, tx, p, tid.String())
	if err != nil {
		return domain.Ticket{}, false, err
	}
	if !hmac.Equal(hash, draftHash(d, "preparation", preparationInput(b))) {
		return domain.Ticket{}, false, httpx.E(409, "preparation_conflict", "This preparation reference was used with different ticket input.")
	}
	t, err := domain.LoadTicket(ctx, tx, p.WorkspaceID, id)
	return t, true, err
}

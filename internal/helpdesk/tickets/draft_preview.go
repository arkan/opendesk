package tickets

import (
	"context"
	"encoding/hex"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/email"
	"github.com/useopendesk/opendesk/internal/httpx"
	"github.com/useopendesk/opendesk/internal/templates"
)

func prepareDraft(ctx context.Context, tx pgx.Tx, d *deps.Deps, p *auth.Principal, x *ticketDraft) (draftPreview, domain.NewMessage, error) {
	var out draftPreview
	var nm domain.NewMessage
	address, err := email.ResolveDraftAddress(ctx, tx, d.Cfg, p, x.TicketID, x.MailboxID)
	if err != nil {
		return out, nm, err
	}
	ref := templates.Ref{WorkspaceID: p.WorkspaceID, TicketID: &x.TicketID, AuthorUserID: p.ActorUserID(), MailboxID: &address.MailboxID, MailboxEmail: address.MailboxEmail}
	rawIDs := make([]string, len(x.Attachments))
	for i, a := range x.Attachments {
		rawIDs[i] = a.ID.String()
	}
	nm, err = prepareTicketMessage(ctx, tx, d, p, x.TicketID, ticketMessageBody{Kind: "reply", BodyHTML: x.BodyHTML, MailboxID: address.MailboxID.String(), Cc: x.Cc, Bcc: x.Bcc, AttachmentIDs: rawIDs}, prepareMessageOptions{Draft: x, AllowEmpty: true})
	if err != nil {
		return out, nm, err
	}
	body := nm.BodyHTML
	vars, err := templates.Load(ctx, tx, d.Cfg, ref)
	if err != nil {
		return out, nm, err
	}
	out = draftPreview{DraftID: x.ID, Revision: x.Revision, Subject: replySubject(address.Subject), From: address.From, To: address.To, Cc: x.Cc, Bcc: x.Bcc, BodyHTML: body, SignatureHTML: vars.Signature(), Attachments: x.Attachments}
	var latest *uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM messages WHERE workspace_id=$1 AND ticket_id=$2 AND kind='reply' ORDER BY created_at DESC,id DESC LIMIT 1`, p.WorkspaceID, x.TicketID).Scan(&latest); err != nil && !db.IsNotFound(err) {
		return out, nm, err
	}
	token := draftHash(d, "review", struct {
		Workspace, Ticket uuid.UUID
		Actor             draftActor
		Preview           draftPreview
		Mailbox           uuid.UUID
		Latest            *uuid.UUID
	}{p.WorkspaceID, x.TicketID, draftActorOf(p), out, address.MailboxID, latest})
	out.ReviewToken = hex.EncodeToString(token)
	nm.FromEmail, nm.FromName = out.From.Email, out.From.Name
	nm.To = out.To
	nm.DraftID = &x.ID
	nm.RecipientLocked = true

	return out, nm, nil
}
func sentDraftResult(ctx context.Context, q db.Querier, p *auth.Principal, x *ticketDraft) (draftSendResult, error) {
	var out draftSendResult
	if x.MessageID == nil {
		return out, httpx.E(410, "draft_result_gone", "The sent message no longer exists.")
	}
	err := q.QueryRow(ctx, `SELECT m.id,m.ticket_id,t.status,m.delivery_status FROM messages m JOIN tickets t ON t.workspace_id=m.workspace_id AND t.id=m.ticket_id AND t.deleted_at IS NULL WHERE m.workspace_id=$1 AND m.id=$2`, p.WorkspaceID, x.MessageID).Scan(&out.MessageID, &out.TicketID, &out.Status, &out.DeliveryStatus)
	if db.IsNotFound(err) {
		return out, httpx.E(410, "draft_result_gone", "The sent message no longer exists.")
	}
	if err != nil {
		return out, err
	}
	_, err = resolveVisible(ctx, q, p, out.TicketID.String())
	return out, err
}

package email

import (
	"context"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/config"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/httpx"
)

// DraftSender is the non-secret sender projection shown during review.
type DraftSender struct {
	Email string `json:"email"`
	Name  string `json:"name"`
}
type DraftAddress struct {
	MailboxID uuid.UUID
	Subject   string
	From      DraftSender
	To        []string
}

// ResolveDraftAddress applies the delivery addressing rules without reading credentials.
func ResolveDraftAddress(ctx context.Context, q db.Querier, cfg *config.Config, p *auth.Principal, tid uuid.UUID, preferred *uuid.UUID) (DraftAddress, error) {
	var out DraftAddress
	t, err := loadTicketInfo(ctx, q, p.WorkspaceID, tid)
	if err != nil {
		return out, err
	}
	if t.contactEmail == nil || *t.contactEmail == "" {
		return out, httpx.Validation("this ticket's contact has no email address")
	}
	id := preferred
	if id == nil {
		id = t.mailboxID
	}
	if id == nil {
		id, err = domain.BrandMailboxFor(ctx, q, p.WorkspaceID, t.brandID, t.teamID)
		if err != nil {
			return out, err
		}
	}
	if id == nil {
		return out, httpx.Validation("this ticket's brand has no address to reply from")
	}
	var m mailboxRow
	err = q.QueryRow(ctx, `SELECT id,name,email,display_name,inbound_kind,forwarding_token,outbound_kind,status,brand_id,aliases,from_name_format FROM mailboxes WHERE workspace_id=$1 AND id=$2`, p.WorkspaceID, id).Scan(&m.ID, &m.Name, &m.Email, &m.DisplayName, &m.InboundKind, &m.ForwardingToken, &m.OutboundKind, &m.Status, &m.BrandID, &m.Aliases, &m.FromNameFormat)
	if err != nil {
		return out, err
	}
	if m.BrandID != t.brandID {
		return out, httpx.Validation("mailbox_id must belong to the ticket's brand")
	}
	ok, err := domain.CanSendFrom(ctx, q, p, m.ID)
	if err != nil {
		return out, err
	}
	if !ok {
		return out, httpx.E(403, "forbidden", "You cannot send from this mailbox.")
	}
	if m.Status == "disabled" {
		return out, httpx.Validation("the mailbox is disabled")
	}
	if m.OutboundKind == OutboundSystem && !cfg.MailboxSystemSend {
		return out, domain.ErrCannotSend
	}
	names := t.names
	names.mailbox = m.displayName()
	if p.ActorUserID() != nil {
		u, err := domain.LoadUserRef(ctx, q, *p.ActorUserID())
		if err != nil {
			return out, err
		}
		names.agent = agentName(u.Name)
	}
	s := &service{d: &deps.Deps{Cfg: cfg}}
	from, _, _ := s.addressing(&m, fromName(m.FromNameFormat, names), t.number, m.alias(t.receivedAt))
	to, err := replyDestination(ctx, q, p.WorkspaceID, tid, t.contactEmail, []string{*t.contactEmail})
	if err != nil {
		return out, err
	}
	return DraftAddress{MailboxID: m.ID, Subject: t.subject, From: DraftSender{Email: from.Address, Name: from.Name}, To: to}, nil
}

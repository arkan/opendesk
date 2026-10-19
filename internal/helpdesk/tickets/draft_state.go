package tickets

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/deps"
	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/events"
	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/httpx"
)

func draftActorOf(p *auth.Principal) draftActor {
	if p.Kind == auth.KindUser {
		return draftActor{"user", p.ActorUserID()}
	}
	return draftActor{"api", p.ActorAPIKeyID()}
}
func draftHash(d *deps.Deps, namespace string, v any) []byte {
	b, _ := json.Marshal(v)
	m := hmac.New(sha256.New, d.Cfg.AuthSecret)
	m.Write([]byte("opendesk shared drafts v1:" + namespace + "\x00"))
	m.Write(b)
	return m.Sum(nil)
}
func lockDraftTicket(ctx context.Context, tx pgx.Tx, p *auth.Principal, ref string) (uuid.UUID, error) {
	tid, err := resolveVisible(ctx, tx, p, ref)
	if err != nil {
		return uuid.Nil, err
	}
	var channel string
	if err = tx.QueryRow(ctx, `SELECT channel FROM tickets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`, p.WorkspaceID, tid).Scan(&channel); err != nil {
		return uuid.Nil, draftLoadError(err)
	}
	if _, err = domain.LoadVisibleTicket(ctx, tx, p, tid); err != nil {
		return uuid.Nil, draftLoadError(err)
	}
	if channel != domain.ChannelEmail {
		return uuid.Nil, httpx.Validation("shared drafts require an email ticket")
	}
	return tid, nil
}
func loadDraft(ctx context.Context, q db.Querier, wid, tid uuid.UUID, id *uuid.UUID, lock bool) (*ticketDraft, error) {
	query := `SELECT id,ticket_id,state,revision,body_html,mailbox_id,cc_emails,bcc_emails,created_by_type,COALESCE(created_by_user_id,created_by_api_key_id),updated_by_type,COALESCE(updated_by_user_id,updated_by_api_key_id),created_at,updated_at,ended_at,message_id FROM ticket_drafts WHERE workspace_id=$1 AND ticket_id=$2`
	args := []any{wid, tid}
	if id != nil {
		query += ` AND id=$3`
		args = append(args, *id)
	} else {
		query += ` AND state='draft'`
	}
	if lock {
		query += ` FOR UPDATE`
	}
	var x ticketDraft
	err := q.QueryRow(ctx, query, args...).Scan(&x.ID, &x.TicketID, &x.State, &x.Revision, &x.BodyHTML, &x.MailboxID, &x.Cc, &x.Bcc, &x.CreatedBy.Type, &x.CreatedBy.ID, &x.UpdatedBy.Type, &x.UpdatedBy.ID, &x.CreatedAt, &x.UpdatedAt, &x.EndedAt, &x.MessageID)
	if err != nil {
		return nil, err
	}
	x.Attachments = []domain.Attachment{}
	rows, err := q.Query(ctx, `SELECT a.id,a.filename,a.content_type,a.size_bytes,a.inline FROM ticket_draft_attachments r JOIN attachments a ON a.workspace_id=r.workspace_id AND a.id=r.attachment_id WHERE r.workspace_id=$1 AND r.draft_id=$2 ORDER BY r.position`, wid, x.ID)
	if err != nil {
		return nil, err
	}
	x.Attachments, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Attachment, error) {
		var a domain.Attachment
		err := r.Scan(&a.ID, &a.Filename, &a.ContentType, &a.SizeBytes, &a.Inline)
		a.URL = "/v1/attachments/" + a.ID.String()
		return a, err
	})
	if x.Attachments == nil {
		x.Attachments = []domain.Attachment{}
	}
	return &x, err
}
func draftLoadError(err error) error {
	if db.IsNotFound(err) {
		return httpx.NotFound("Draft")
	}
	return err
}
func checkDraftRevision(x *ticketDraft, in DraftIdentity) error {
	if x.State != "draft" {
		return httpx.E(409, "draft_not_active", "This draft is no longer active.")
	}
	if x.Revision != in.ExpectedRevision {
		return httpx.E(409, "draft_revision_conflict", "The shared draft has changed. Reload it before saving or sending.")
	}
	return nil
}
func draftAttachmentIDs(x *ticketDraft) []uuid.UUID {
	out := make([]uuid.UUID, len(x.Attachments))
	for i, a := range x.Attachments {
		out[i] = a.ID
	}
	return out
}
func applyDraftValues(x *ticketDraft, v DraftValues) ([]uuid.UUID, error) {
	if v.BodyHTML != nil {
		x.BodyHTML = hd.SanitizeRichTemplate(*v.BodyHTML)
	}
	if v.MailboxID.Set {
		x.MailboxID = nil
		if !v.MailboxID.Null {
			id, err := hd.ParseRef(v.MailboxID.Value, "mailbox_id")
			if err != nil {
				return nil, err
			}
			x.MailboxID = &id
		}
	}
	if v.Cc != nil {
		a, err := cleanEmails(*v.Cc)
		if err != nil {
			return nil, err
		}
		x.Cc = a
	}
	if v.Bcc != nil {
		a, err := cleanEmails(*v.Bcc)
		if err != nil {
			return nil, err
		}
		x.Bcc = a
	}
	if x.Cc == nil {
		x.Cc = []string{}
	}
	if x.Bcc == nil {
		x.Bcc = []string{}
	}
	if v.AttachmentIDs == nil {
		return []uuid.UUID{}, nil
	}
	a, err := hd.ParseAttachmentIDs(*v.AttachmentIDs)
	if err == nil && len(a) != len(*v.AttachmentIDs) {
		return nil, httpx.Validation("attachment_ids must be distinct")
	}
	return a, err
}
func reserveDraftAttachments(ctx context.Context, tx pgx.Tx, p *auth.Principal, x *ticketDraft, att []uuid.UUID) error {
	all := append(slices.Clone(att), draftAttachmentIDs(x)...)
	rows, err := tx.Query(ctx, `SELECT id FROM attachments WHERE workspace_id=$1 AND id=ANY($2) ORDER BY id FOR UPDATE`, p.WorkspaceID, all)
	if err != nil {
		return err
	}
	if _, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID]); err != nil {
		return err
	}
	// Read reservations after obtaining every lock so concurrent commits are visible.
	for _, id := range att {
		var user, key, visitor, origin, reservation *uuid.UUID
		err := tx.QueryRow(ctx, `SELECT a.uploaded_by,a.uploaded_by_api_key_id,a.uploaded_by_contact_id,a.draft_ticket_id,(SELECT r.draft_id FROM ticket_draft_attachments r WHERE r.attachment_id=a.id) FROM attachments a WHERE a.workspace_id=$1 AND a.id=$2 AND a.message_id IS NULL`, p.WorkspaceID, id).Scan(&user, &key, &visitor, &origin, &reservation)
		if db.IsNotFound(err) {
			return httpx.Validation("attachment_ids must be available uploads")
		}
		if err != nil {
			return err
		}
		if reservation != nil && *reservation != x.ID {
			return httpx.Validation("an attachment is reserved by another draft")
		}
		if reservation == nil && (!sameID(user, p.ActorUserID()) || !sameID(key, p.ActorAPIKeyID()) || visitor != nil) {
			return httpx.Validation("new draft attachments must be your own uploads")
		}
		if origin != nil {
			if _, err := resolveVisible(ctx, tx, p, origin.String()); err != nil {
				return httpx.Validation("attachment origin is unavailable")
			}
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM ticket_draft_attachments WHERE workspace_id=$1 AND draft_id=$2`, p.WorkspaceID, x.ID); err != nil {
		return err
	}
	for i, id := range att {
		if _, err := tx.Exec(ctx, `UPDATE attachments SET draft_ticket_id=$3 WHERE workspace_id=$1 AND id=$2`, p.WorkspaceID, id, x.TicketID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO ticket_draft_attachments(workspace_id,draft_id,attachment_id,position) VALUES($1,$2,$3,$4)`, p.WorkspaceID, x.ID, id, i); err != nil {
			return err
		}
	}
	return nil
}
func publishDraft(ctx context.Context, tx pgx.Tx, wid uuid.UUID, x *ticketDraft, action string) error {
	_, err := events.Publish(ctx, tx, events.Event{WorkspaceID: wid, TicketID: &x.TicketID, Type: "ticket_draft." + action, Data: map[string]any{"ticket_id": x.TicketID, "draft_id": x.ID, "revision": x.Revision, "state": x.State}})
	return err
}
func finishDraft(ctx context.Context, tx pgx.Tx, p *auth.Principal, x *ticketDraft, state string, mid *uuid.UUID) error {
	rows, err := tx.Query(ctx, `SELECT a.id FROM attachments a JOIN ticket_draft_attachments r ON r.workspace_id=a.workspace_id AND r.attachment_id=a.id WHERE r.workspace_id=$1 AND r.draft_id=$2 ORDER BY a.id FOR UPDATE OF a`, p.WorkspaceID, x.ID)
	if err != nil {
		return err
	}
	if _, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID]); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM ticket_draft_attachments WHERE workspace_id=$1 AND draft_id=$2`, p.WorkspaceID, x.ID); err != nil {
		return err
	}
	a := draftActorOf(p)
	if _, err := tx.Exec(ctx, `UPDATE ticket_drafts SET state=$3,body_html='',mailbox_id=NULL,cc_emails='{}',bcc_emails='{}',message_id=$4,revision=revision+1,updated_at=now(),ended_at=now(),updated_by_type=$5,updated_by_user_id=$6,updated_by_api_key_id=$7 WHERE workspace_id=$1 AND id=$2`, p.WorkspaceID, x.ID, state, mid, a.Type, p.ActorUserID(), p.ActorAPIKeyID()); err != nil {
		return err
	}
	x.State = state
	x.Revision++
	return publishDraft(ctx, tx, p.WorkspaceID, x, state)
}

func validateDraftMailbox(ctx context.Context, q db.Querier, p *auth.Principal, x *ticketDraft) error {
	if x.MailboxID != nil {
		var same bool
		if err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mailboxes m JOIN tickets t ON t.workspace_id=m.workspace_id AND t.brand_id=m.brand_id WHERE m.workspace_id=$1 AND m.id=$2 AND t.id=$3)`, p.WorkspaceID, x.MailboxID, x.TicketID).Scan(&same); err != nil {
			return err
		}
		if !same {
			return httpx.Validation("mailbox_id must belong to the ticket's brand")
		}
		ok, err := domain.CanSendFrom(ctx, q, p, *x.MailboxID)
		if err != nil {
			return err
		}
		if !ok {
			return httpx.E(403, "forbidden", "You cannot send from this mailbox.")
		}
	}
	return nil
}

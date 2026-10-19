package tickets

import (
	"time"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/domain"
	"github.com/useopendesk/opendesk/internal/email"
)

type draftActor struct {
	Type string     `json:"type"`
	ID   *uuid.UUID `json:"id"`
}
type ticketDraft struct {
	ID          uuid.UUID           `json:"id"`
	TicketID    uuid.UUID           `json:"ticket_id"`
	State       string              `json:"state"`
	Revision    int64               `json:"revision"`
	BodyHTML    string              `json:"body_html"`
	MailboxID   *uuid.UUID          `json:"mailbox_id"`
	Cc          []string            `json:"cc"`
	Bcc         []string            `json:"bcc"`
	Attachments []domain.Attachment `json:"attachments"`
	CreatedBy   draftActor          `json:"created_by"`
	UpdatedBy   draftActor          `json:"updated_by"`
	CreatedAt   time.Time           `json:"created_at"`
	UpdatedAt   time.Time           `json:"updated_at"`
	EndedAt     *time.Time          `json:"ended_at"`
	MessageID   *uuid.UUID          `json:"message_id"`
}
type DraftValues struct {
	BodyHTML      *string     `json:"body_html,omitempty" maxLength:"500000"`
	MailboxID     Opt[string] `json:"mailbox_id,omitempty"`
	Cc            *[]string   `json:"cc,omitempty" maxItems:"20"`
	Bcc           *[]string   `json:"bcc,omitempty" maxItems:"20"`
	AttachmentIDs *[]string   `json:"attachment_ids,omitempty" maxItems:"20"`
}
type createDraftBody struct {
	RequestID string `json:"request_id" minLength:"1" maxLength:"255"`
	DraftValues
}
type DraftIdentity struct {
	DraftID          uuid.UUID `json:"draft_id"`
	ExpectedRevision int64     `json:"expected_revision" minimum:"1"`
}
type updateDraftBody struct {
	DraftIdentity
	DraftValues
}
type draftResponse struct {
	Body struct {
		Draft *ticketDraft `json:"draft"`
	}
}
type draftCreateResponse struct {
	Status int
	Body   struct {
		Draft *ticketDraft `json:"draft"`
	}
}
type draftPreview struct {
	DraftID       uuid.UUID           `json:"draft_id"`
	Revision      int64               `json:"revision"`
	Subject       string              `json:"subject"`
	From          email.DraftSender   `json:"from"`
	To            []string            `json:"to"`
	Cc            []string            `json:"cc"`
	Bcc           []string            `json:"bcc"`
	BodyHTML      string              `json:"body_html"`
	SignatureHTML string              `json:"signature_html"`
	Attachments   []domain.Attachment `json:"attachments"`
	ReviewToken   string              `json:"review_token"`
}
type sendDraftBody struct {
	DraftIdentity
	ReviewToken string  `json:"review_token" minLength:"1"`
	Status      *string `json:"status,omitempty" enum:"open,pending,on_hold,solved,closed"`
}
type draftSendResult struct {
	MessageID      uuid.UUID `json:"message_id"`
	TicketID       uuid.UUID `json:"ticket_id"`
	Status         string    `json:"status"`
	DeliveryStatus string    `json:"delivery_status"`
}
type draftSendResponse struct {
	Status int
	Body   draftSendResult
}

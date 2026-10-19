package email

import (
	"context"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/domain"
)

func TestReviewedRecipientsStayFrozenDuringDelivery(t *testing.T) {
	for _, locked := range []bool{true, false} {
		t.Run(map[bool]string{true: "reviewed", false: "legacy"}[locked], func(t *testing.T) {
			w := newWorld(t)
			m := w.mailbox(InboundForwarding, OutboundSystem, nil)
			customerEmail := customer()
			tk, _ := firstTicket(t, w, m, customerEmail)
			reviewed := []string{"reviewed@example.test"}
			var sent []string
			w.s.rawSend = func(_ context.Context, _ string, to []string, _ []byte) error { sent = slices.Clone(to); return nil }
			var mid uuid.UUID
			err := w.d.DB.Tx(w.ctx, func(tx pgxTx) error {
				msg, err := domain.AddMessage(w.ctx, tx, w.d.Jobs, domain.NewMessage{WorkspaceID: w.wid, TicketID: tk.ID, Kind: "reply", Direction: "outbound", AuthorType: "user", AuthorUserID: &w.uid, BodyHTML: "<p>Approved</p>", BodyText: "Approved", To: []string{customerEmail}, DeliveryStatus: "pending", RecipientLocked: locked})
				mid = msg.ID
				return err
			})
			if err != nil {
				t.Fatal(err)
			}
			if locked {
				mustExec(t, w.d, `UPDATE messages SET to_emails=$2 WHERE id=$1`, mid, reviewed)
			}
			// The validated same-domain Reply-To changes after queue acceptance.
			mustExec(t, w.d, `UPDATE messages SET reply_to='later@'||split_part(from_email,'@',2) WHERE ticket_id=$1 AND direction='inbound'`, tk.ID)
			if err := w.s.sendMessage(w.ctx, w.wid, mid, false); err != nil {
				t.Fatal(err)
			}
			if locked && !slices.Equal(sent, reviewed) {
				t.Fatalf("reviewed recipients changed: %v", sent)
			}
			if !locked && (len(sent) != 1 || sent[0] == customerEmail) {
				t.Fatalf("legacy recipient resolution stopped working: %v", sent)
			}
		})
	}
}

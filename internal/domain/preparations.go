package domain

import (
	"context"

	"github.com/google/uuid"

	"github.com/useopendesk/opendesk/internal/db"
)

// PreparationGuarded reports whether customer email still requires explicit approval.
func PreparationGuarded(ctx context.Context, q db.Querier, wid, tid uuid.UUID) (bool, error) {
	var guarded bool
	err := q.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ticket_preparations WHERE workspace_id=$1 AND ticket_id=$2 AND released_at IS NULL)`, wid, tid).Scan(&guarded)
	return guarded, err
}

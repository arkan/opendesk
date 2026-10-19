package domain

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/auth"
	"github.com/useopendesk/opendesk/internal/db"
)

// A ticket in a private team is visible only to the team's members and observers, its
// assignee, and API keys granted the team (contracts/teams.md "Visibility"). Admins and
// owners are not exempt: they join the team first.

// ErrNotVisible is the answer for a ticket p may not see: the same as a missing one.
var ErrNotVisible = pgx.ErrNoRows

// HiddenTeams returns the private teams of p's workspace that p may not see. The answer is
// cached on p for the rest of the request.
func HiddenTeams(ctx context.Context, q db.Querier, p *auth.Principal) ([]uuid.UUID, error) {
	if p.HiddenTeamsLoaded {
		return p.HiddenTeams, nil
	}
	var hidden []uuid.UUID
	var err error
	switch p.Kind {
	case auth.KindUser:
		err = q.QueryRow(ctx, `SELECT COALESCE(array_agg(t.id), '{}') FROM teams t
			WHERE t.workspace_id = $1 AND t.private
			AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.user_id = $2)`,
			p.WorkspaceID, p.UserID).Scan(&hidden)
	case auth.KindAPIKey:
		err = q.QueryRow(ctx, `SELECT COALESCE(array_agg(t.id), '{}') FROM teams t
			WHERE t.workspace_id = $1 AND t.private
			AND NOT t.id = ANY(COALESCE((SELECT k.private_team_ids FROM api_keys k WHERE k.id = $2 AND k.workspace_id = $1), '{}'))`,
			p.WorkspaceID, p.APIKeyID).Scan(&hidden)
	default:
		// Visitors reach only their own conversations, which carry their own checks.
		hidden = []uuid.UUID{}
	}
	if err != nil {
		return nil, fmt.Errorf("hidden teams: %w", err)
	}
	if hidden == nil {
		hidden = []uuid.UUID{}
	}
	p.HiddenTeams, p.HiddenTeamsLoaded = hidden, true
	return hidden, nil
}

// VisibleTeams returns the private teams p may see: the ws token's teams claim.
func VisibleTeams(ctx context.Context, q db.Querier, p *auth.Principal) ([]uuid.UUID, error) {
	hidden, err := HiddenTeams(ctx, q, p)
	if err != nil {
		return nil, err
	}
	var out []uuid.UUID
	err = q.QueryRow(ctx, `SELECT COALESCE(array_agg(id), '{}') FROM teams WHERE workspace_id = $1 AND private AND NOT id = ANY($2::uuid[])`,
		p.WorkspaceID, hidden).Scan(&out)
	return out, err
}

// VisibleSQL is the predicate for tickets aliased alias that p may see, given the hidden
// teams bound as parameter $n: `WHERE ... AND ` + VisibleSQL("t", 4)`. The assignee of a
// ticket always sees it.
func VisibleSQL(alias string, n int) string {
	return fmt.Sprintf(`(%[1]s.team_id IS NULL OR NOT %[1]s.team_id = ANY($%[2]d::uuid[]))`, alias, n)
}

// VisibleSQLUser is VisibleSQL that also lets the assignee, bound as $m, see the ticket.
func VisibleSQLUser(alias string, n, m int) string {
	return fmt.Sprintf(`(%[1]s.team_id IS NULL OR NOT %[1]s.team_id = ANY($%[2]d::uuid[]) OR %[1]s.assignee_id = $%[3]d)`, alias, n, m)
}

// VisibleToUserSQL is the predicate for tickets aliased alias that the user bound as $n may
// see, without a principal: the ticket has no private team, the user is on that team, or
// it is assigned to them.
func VisibleToUserSQL(alias string, n int) string {
	return fmt.Sprintf(`(%[1]s.team_id IS NULL OR %[1]s.assignee_id = $%[2]d OR NOT EXISTS (SELECT 1 FROM teams vt
		WHERE vt.id = %[1]s.team_id AND vt.private
		AND NOT EXISTS (SELECT 1 FROM team_members vm WHERE vm.team_id = vt.id AND vm.user_id = $%[2]d)))`, alias, n)
}

// CanSee reports whether p may see a ticket with this team and assignee.
func CanSee(ctx context.Context, q db.Querier, p *auth.Principal, teamID *uuid.UUID, assigneeID *uuid.UUID) (bool, error) {
	if teamID == nil {
		return true, nil
	}
	if p.Kind == auth.KindUser && assigneeID != nil && *assigneeID == p.UserID {
		return true, nil
	}
	hidden, err := HiddenTeams(ctx, q, p)
	if err != nil {
		return false, err
	}
	for _, h := range hidden {
		if h == *teamID {
			return false, nil
		}
	}
	return true, nil
}

// LoadVisibleTicket is LoadTicket for a principal: a ticket p may not see is not found.
func LoadVisibleTicket(ctx context.Context, q db.Querier, p *auth.Principal, id uuid.UUID) (Ticket, error) {
	t, err := LoadTicket(ctx, q, p.WorkspaceID, id)
	if err != nil {
		return t, err
	}
	var assignee *uuid.UUID
	if t.Assignee != nil {
		assignee = &t.Assignee.ID
	}
	ok, err := CanSee(ctx, q, p, t.TeamID, assignee)
	if err != nil {
		return t, err
	}
	if !ok {
		return Ticket{}, ErrNotVisible
	}
	return t, nil
}

// TeamReplyMailbox returns the brand's active address whose default team is teamID: where a
// ticket moved to that team replies from (contracts/teams.md "Reply address").
func TeamReplyMailbox(ctx context.Context, q db.Querier, wid, brandID, teamID uuid.UUID) (*uuid.UUID, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `SELECT id FROM mailboxes WHERE workspace_id = $1 AND brand_id = $2 AND team_id = $3
		AND status <> 'disabled' ORDER BY (status = 'active') DESC, created_at, id LIMIT 1`, wid, brandID, teamID).Scan(&id)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// ReplyMailbox selects the team's reply address within a brand, then the brand's default.
func ReplyMailbox(ctx context.Context, q db.Querier, wid, brand uuid.UUID, team *uuid.UUID) (*uuid.UUID, error) {
	if team != nil {
		id, err := TeamReplyMailbox(ctx, q, wid, brand, *team)
		if err != nil || id != nil {
			return id, err
		}
	}
	return BrandMailboxFor(ctx, q, wid, brand, team)
}

// BrandMailboxFor is the brand's default address for a ticket of team (nil: none): its
// oldest active address that is not another private team's, as only that team's members
// send from it (contracts/teams.md "Reply address").
func BrandMailboxFor(ctx context.Context, q db.Querier, wid, brandID uuid.UUID, team *uuid.UUID) (*uuid.UUID, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `SELECT m.id FROM mailboxes m WHERE m.workspace_id = $1 AND m.brand_id = $2 AND m.status <> 'disabled'
		AND (m.team_id IS NULL OR m.team_id IS NOT DISTINCT FROM $3
			OR NOT EXISTS (SELECT 1 FROM teams pt WHERE pt.id = m.team_id AND pt.private))
		ORDER BY (m.status = 'active') DESC, m.created_at, m.id LIMIT 1`, wid, brandID, team).Scan(&id)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// CanSendFrom reports whether p may send from the mailbox: it is the workspace's, and when
// its default team is private, p may see that team.
func CanSendFrom(ctx context.Context, q db.Querier, p *auth.Principal, mailboxID uuid.UUID) (bool, error) {
	var team *uuid.UUID
	err := q.QueryRow(ctx, `SELECT m.team_id FROM mailboxes m WHERE m.workspace_id = $1 AND m.id = $2`, p.WorkspaceID, mailboxID).Scan(&team)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return CanSee(ctx, q, p, team, nil)
}

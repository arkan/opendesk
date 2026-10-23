package sealed

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/useopendesk/opendesk/internal/crypto"
	"github.com/useopendesk/opendesk/internal/db"
	"github.com/useopendesk/opendesk/internal/jobs"
)

const (
	// batchSize is the rows read per query.
	batchSize = 200
	// maxUnreadableLogged bounds the rows named per column in one pass.
	maxUnreadableLogged = 50
	// every is how often a pass runs while CREDENTIALS_KEY_PREVIOUS is set.
	every = 15 * time.Minute
)

// ColumnResult counts one column's values in a pass.
type ColumnResult struct {
	Column
	// Checked values were read. Current ones already open with the current key.
	Checked, Current int
	// Resealed values opened with a previous key and now carry the current one.
	Resealed int
	// Changed values were written again between the read and the update, so the newer
	// value stayed as it was; the next pass checks it.
	Changed int
	// Unreadable values open with no configured key. They are left as they are.
	Unreadable int
}

// Result is a whole pass.
type Result struct {
	Columns                                []ColumnResult
	Checked, Resealed, Changed, Unreadable int
}

// Done reports that nothing read needed a previous key: CREDENTIALS_KEY_PREVIOUS can go.
func (r Result) Done() bool { return r.Resealed == 0 && r.Changed == 0 }

// Pass re-encrypts sealed values with the box's current key.
type Pass struct {
	Q       db.Querier
	Box     *crypto.Box
	Log     *slog.Logger
	Columns []Column
	// beforeUpdate runs between reading a value and writing it back (tests).
	beforeUpdate func(c Column, key any)
}

// Run walks every column in key order. Each value a previous key opens is sealed again
// and written only if the column still holds what was read, so a concurrent write always
// wins. Values are never logged; an unreadable one is named by table, column and key.
// Running it again, or after an interruption, is safe: values already on the current key
// are left alone.
func (p *Pass) Run(ctx context.Context) (Result, error) {
	var res Result
	for _, c := range p.Columns {
		cr, err := p.column(ctx, c)
		res.Columns = append(res.Columns, cr)
		res.Checked += cr.Checked
		res.Resealed += cr.Resealed
		res.Changed += cr.Changed
		res.Unreadable += cr.Unreadable
		if err != nil {
			return res, fmt.Errorf("reseal %s.%s: %w", c.Table, c.Column, err)
		}
	}
	return res, nil
}

type item struct {
	key    any
	id     string
	sealed []byte
}

func (p *Pass) column(ctx context.Context, c Column) (ColumnResult, error) {
	cr := ColumnResult{Column: c}
	table, key, col := pgx.Identifier{c.Table}.Sanitize(), pgx.Identifier{c.Key}.Sanitize(), pgx.Identifier{c.Column}.Sanitize()
	read := fmt.Sprintf(`SELECT %[1]s, %[1]s::text AS key_text, %[2]s FROM %[3]s WHERE %[2]s IS NOT NULL AND length(%[2]s) > 0`, key, col, table)
	update := fmt.Sprintf(`UPDATE %[3]s SET %[2]s = $1 WHERE %[1]s = $2 AND %[2]s = $3`, key, col, table)
	var after any
	for {
		q, args := read, []any(nil)
		if after != nil {
			q, args = q+` AND `+key+` > $1`, []any{after}
		}
		rows, err := p.Q.Query(ctx, q+` ORDER BY `+key+fmt.Sprintf(` LIMIT %d`, batchSize), args...)
		if err != nil {
			return cr, err
		}
		batch, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (item, error) {
			var it item
			err := r.Scan(&it.key, &it.id, &it.sealed)
			return it, err
		})
		if err != nil {
			return cr, err
		}
		for _, it := range batch {
			cr.Checked++
			next, err := p.Box.Reseal(it.sealed)
			switch {
			case err != nil:
				cr.Unreadable++
				if cr.Unreadable <= maxUnreadableLogged {
					p.Log.Warn("sealed value opens with no configured key", "table", c.Table, "column", c.Column, "id", it.id)
				}
				continue
			case next == nil:
				cr.Current++
				continue
			}
			if p.beforeUpdate != nil {
				p.beforeUpdate(c, it.key)
			}
			tag, err := p.Q.Exec(ctx, update, next, it.key, it.sealed)
			if err != nil {
				return cr, err
			}
			if tag.RowsAffected() == 1 {
				cr.Resealed++
			} else {
				cr.Changed++
			}
		}
		if len(batch) < batchSize {
			return cr, nil
		}
		after = batch[len(batch)-1].key
	}
}

// Worker runs a pass while the box has previous keys, and logs what it found.
type Worker struct {
	river.WorkerDefaults[jobs.ResealArgs]
	Q   db.Querier
	Box *crypto.Box
	Log *slog.Logger
	// RelayServing is an instance that seals push relay tokens for other instances.
	RelayServing bool
	// columns replaces Columns (tests).
	columns []Column
}

func (w *Worker) Timeout(*river.Job[jobs.ResealArgs]) time.Duration { return time.Hour }

func (w *Worker) Work(ctx context.Context, _ *river.Job[jobs.ResealArgs]) error {
	if !w.Box.Rotating() {
		return nil
	}
	log := w.Log.With("component", "sealed")
	cols := w.columns
	if cols == nil {
		cols = Columns
	}
	res, err := (&Pass{Q: w.Q, Box: w.Box, Log: log, Columns: cols}).Run(ctx)
	for _, c := range res.Columns {
		if c.Resealed > 0 || c.Changed > 0 || c.Unreadable > 0 {
			log.Info("credentials key rotation column", "table", c.Table, "column", c.Column, "checked", c.Checked,
				"reencrypted", c.Resealed, "changed_meanwhile", c.Changed, "unreadable", c.Unreadable)
		}
	}
	if err != nil {
		return err
	}
	log.Info("credentials key rotation pass", "checked", res.Checked, "reencrypted", res.Resealed,
		"changed_meanwhile", res.Changed, "unreadable", res.Unreadable)
	if !res.Done() {
		return nil
	}
	switch {
	case res.Unreadable > 0:
		log.Warn("no stored value needs CREDENTIALS_KEY_PREVIOUS any more, but some open with no configured key (named above): " +
			"add the key that sealed them to CREDENTIALS_KEY_PREVIOUS, or reconnect what they belong to")
	case w.RelayServing:
		log.Info("every stored value opens with CREDENTIALS_KEY; push relay tokens held by other instances open " +
			"with CREDENTIALS_KEY_PREVIOUS until their apps register again")
	default:
		log.Info("every stored value opens with CREDENTIALS_KEY: CREDENTIALS_KEY_PREVIOUS can be removed")
	}
	return nil
}

// Periodic runs a pass on start and every 15 minutes, one at a time across the instance.
// Callers add it only while the box has previous keys.
func Periodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(every), func() (river.JobArgs, *river.InsertOpts) {
		return jobs.ResealArgs{}, &river.InsertOpts{MaxAttempts: 3, UniqueOpts: river.UniqueOpts{ByState: []rivertype.JobState{
			rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRetryable, rivertype.JobStateRunning,
			rivertype.JobStateScheduled}}}
	}, &river.PeriodicJobOpts{RunOnStart: true})
}

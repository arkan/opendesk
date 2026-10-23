package sealed

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/useopendesk/opendesk/internal/crypto"
	"github.com/useopendesk/opendesk/internal/db"
)

var migrateOnce sync.Once

// pool is a migrated test database (OPENDESK_TEST_DATABASE_URL or TEST_DATABASE_URL).
func pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("OPENDESK_TEST_DATABASE_URL")
	if url == "" {
		url = os.Getenv("TEST_DATABASE_URL")
	}
	if url == "" {
		t.Skip("set OPENDESK_TEST_DATABASE_URL to run database tests")
	}
	ctx := context.Background()
	var merr error
	migrateOnce.Do(func() { merr = db.Migrate(ctx, url) })
	if merr != nil {
		t.Fatalf("migrate: %v", merr)
	}
	d, err := db.Open(ctx, url, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(d.Close)
	return d.Pool
}

func box(t *testing.T, current byte, previous ...byte) *crypto.Box {
	t.Helper()
	var prev [][]byte
	for _, p := range previous {
		prev = append(prev, bytes.Repeat([]byte{p}, 32))
	}
	b, err := crypto.NewBox(bytes.Repeat([]byte{current}, 32), prev...)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// TestRegistryCoversEveryByteaColumn keeps Columns complete: every bytea column in the
// schema is either sealed (Columns) or named in NotSealed, and every entry exists.
func TestRegistryCoversEveryByteaColumn(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	rows, err := p.Query(ctx, `SELECT table_name || '.' || column_name FROM information_schema.columns
		WHERE table_schema = 'public' AND data_type = 'bytea' AND table_name NOT LIKE 'sealed_test_%'`)
	if err != nil {
		t.Fatal(err)
	}
	var bytea []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			t.Fatal(err)
		}
		bytea = append(bytea, c)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	known := map[string]bool{}
	for _, c := range Columns {
		name := c.Table + "." + c.Column
		if known[name] {
			t.Errorf("%s is in Columns twice", name)
		}
		known[name] = true
		if !slices.Contains(bytea, name) {
			t.Errorf("Columns has %s, which is not a bytea column", name)
		}
		var pk []string
		if err := p.QueryRow(ctx, `SELECT coalesce(array_agg(a.attname::text), '{}') FROM pg_index i
			JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
			WHERE i.indrelid = $1::regclass AND i.indisprimary`, c.Table).Scan(&pk); err != nil {
			t.Fatalf("%s primary key: %v", c.Table, err)
		}
		if len(pk) != 1 || pk[0] != c.Key {
			t.Errorf("%s: Key %q, but the primary key is %v", name, c.Key, pk)
		}
	}
	for _, name := range NotSealed {
		if known[name] {
			t.Errorf("%s is in Columns and NotSealed", name)
		}
		known[name] = true
		if !slices.Contains(bytea, name) {
			t.Errorf("NotSealed has %s, which is not a bytea column", name)
		}
	}
	for _, name := range bytea {
		if !known[name] {
			t.Errorf("bytea column %s is in neither Columns (sealed with d.Box) nor NotSealed", name)
		}
	}
}

// scratch is a table of sealed values for one test.
func scratch(t *testing.T, p *pgxpool.Pool) Column {
	t.Helper()
	ctx := context.Background()
	name := "sealed_test_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "")
	if _, err := p.Exec(ctx, `CREATE TABLE `+name+` (id uuid PRIMARY KEY, v bytea)`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = p.Exec(context.Background(), `DROP TABLE `+name) })
	return Column{Table: name, Key: "id", Column: "v"}
}

func insert(t *testing.T, p *pgxpool.Pool, c Column, b *crypto.Box, plain string) uuid.UUID {
	t.Helper()
	sealed, err := b.Seal([]byte(plain))
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.New()
	if _, err := p.Exec(context.Background(), `INSERT INTO `+c.Table+` (id, v) VALUES ($1, $2)`, id, sealed); err != nil {
		t.Fatal(err)
	}
	return id
}

func value(t *testing.T, p *pgxpool.Pool, c Column, id uuid.UUID) []byte {
	t.Helper()
	var v []byte
	if err := p.QueryRow(context.Background(), `SELECT v FROM `+c.Table+` WHERE id = $1`, id).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestRotation(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	c := scratch(t, p)
	a := box(t, 'a')
	const n = batchSize*2 + 17 // several batches
	ids := map[uuid.UUID]string{}
	for i := range n {
		plain := fmt.Sprintf("secret-%d", i)
		ids[insert(t, p, c, a, plain)] = plain
	}
	if _, err := p.Exec(ctx, `INSERT INTO `+c.Table+` (id, v) VALUES ($1, NULL), ($2, '\x')`, uuid.New(), uuid.New()); err != nil {
		t.Fatal(err)
	}

	// Booted with current B and previous A: everything still opens.
	ba := box(t, 'b', 'a')
	for id, plain := range ids {
		if got, err := ba.Open(value(t, p, c, id)); err != nil || string(got) != plain {
			t.Fatalf("open with B+A before the pass: %q %v", got, err)
		}
	}

	res, err := (&Pass{Q: p, Box: ba, Log: quiet(), Columns: []Column{c}}).Run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if res.Checked != n || res.Resealed != n || res.Unreadable != 0 || res.Changed != 0 || res.Done() {
		t.Fatalf("first pass: %+v", res)
	}

	// After the pass B alone opens everything.
	b := box(t, 'b')
	for id, plain := range ids {
		if got, err := b.Open(value(t, p, c, id)); err != nil || string(got) != plain {
			t.Fatalf("open with B alone after the pass: %q %v", got, err)
		}
	}

	// A second pass finds nothing to do.
	res, err = (&Pass{Q: p, Box: ba, Log: quiet(), Columns: []Column{c}}).Run(ctx)
	if err != nil || res.Checked != n || res.Resealed != 0 || !res.Done() {
		t.Fatalf("second pass: %+v %v", res, err)
	}
}

// A write between the pass's read and its update wins: the pass never puts back an
// older value.
func TestRotationKeepsConcurrentWrites(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	c := scratch(t, p)
	a, ba := box(t, 'a'), box(t, 'b', 'a')
	raced := insert(t, p, c, a, "old-secret")
	other := insert(t, p, c, a, "other-secret")
	fresh, _ := ba.Seal([]byte("new-secret"))

	pass := &Pass{Q: p, Box: ba, Log: quiet(), Columns: []Column{c}, beforeUpdate: func(_ Column, key any) {
		if k, ok := key.([16]byte); ok && uuid.UUID(k) == raced {
			if _, err := p.Exec(ctx, `UPDATE `+c.Table+` SET v = $1 WHERE id = $2`, fresh, raced); err != nil {
				t.Error(err)
			}
		}
	}}
	res, err := pass.Run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if res.Changed != 1 || res.Resealed != 1 || res.Done() {
		t.Fatalf("pass: %+v", res)
	}
	if !bytes.Equal(value(t, p, c, raced), fresh) {
		t.Fatal("the pass overwrote a concurrent write")
	}
	if got, err := box(t, 'b').Open(value(t, p, c, other)); err != nil || string(got) != "other-secret" {
		t.Fatalf("other row: %q %v", got, err)
	}
}

// A value no configured key opens is reported by table, column and id, and left as it is.
func TestRotationReportsUnreadable(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	c := scratch(t, p)
	a, unknown := box(t, 'a'), box(t, 'z')
	good := insert(t, p, c, a, "known-secret")
	lost := insert(t, p, c, unknown, "unknown-secret")
	before := value(t, p, c, lost)

	var logs bytes.Buffer
	w := &Worker{Q: p, Box: box(t, 'b', 'a'), Log: slog.New(slog.NewTextHandler(&logs, nil)), columns: []Column{c}}
	if err := w.Work(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(value(t, p, c, lost), before) {
		t.Fatal("an unreadable value was changed")
	}
	if got, err := box(t, 'b').Open(value(t, p, c, good)); err != nil || string(got) != "known-secret" {
		t.Fatalf("readable row: %q %v", got, err)
	}
	out := logs.String()
	if !strings.Contains(out, "opens with no configured key") || !strings.Contains(out, lost.String()) ||
		!strings.Contains(out, "table="+c.Table) || !strings.Contains(out, "reencrypted=1") {
		t.Fatalf("logs do not name the unreadable row and count the pass:\n%s", out)
	}
	if strings.Contains(out, "secret") || strings.Contains(out, fmt.Sprintf("%x", before)) {
		t.Fatalf("logs carry a value:\n%s", out)
	}

	// The next pass has nothing on a previous key; the unreadable value is still named.
	logs.Reset()
	if err := w.Work(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if out := logs.String(); !strings.Contains(out, "no stored value needs CREDENTIALS_KEY_PREVIOUS") {
		t.Fatalf("second pass:\n%s", out)
	}
	if _, err := p.Exec(ctx, `DELETE FROM `+c.Table+` WHERE id = $1`, lost); err != nil {
		t.Fatal(err)
	}
	logs.Reset()
	if err := w.Work(ctx, nil); err != nil {
		t.Fatal(err)
	}
	if out := logs.String(); !strings.Contains(out, "CREDENTIALS_KEY_PREVIOUS can be removed") {
		t.Fatalf("clean pass:\n%s", out)
	}
}

// The pass runs over the whole registry, and re-encrypts a real sealed column.
func TestRotationOverRegistry(t *testing.T) {
	p := pool(t)
	ctx := context.Background()
	a := box(t, 'a')
	sealed, _ := a.Seal([]byte("JBSWY3DPEHPK3PXP"))
	var uid uuid.UUID
	if err := p.QueryRow(ctx, `INSERT INTO users (email, totp_secret_enc) VALUES ($1, $2) RETURNING id`,
		"keyrot-"+uuid.NewString()+"@example.com", sealed).Scan(&uid); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = p.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, uid) })

	res, err := (&Pass{Q: p, Box: box(t, 'b', 'a'), Log: quiet(), Columns: Columns}).Run(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Columns) != len(Columns) || res.Resealed < 1 {
		t.Fatalf("registry pass: %+v", res)
	}
	var now []byte
	if err := p.QueryRow(ctx, `SELECT totp_secret_enc FROM users WHERE id = $1`, uid).Scan(&now); err != nil {
		t.Fatal(err)
	}
	if got, err := box(t, 'b').Open(now); err != nil || string(got) != "JBSWY3DPEHPK3PXP" {
		t.Fatalf("users.totp_secret_enc after the pass: %v", err)
	}
}

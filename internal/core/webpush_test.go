package core

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/useopendesk/opendesk/internal/helpdesk/hd"
	"github.com/useopendesk/opendesk/internal/jobs"
	"github.com/useopendesk/opendesk/internal/push"
)

// fakeBrowser is a browser's push subscription and the push service behind its endpoint.
type fakeBrowser struct {
	priv   *ecdh.PrivateKey
	auth   []byte
	srv    *httptest.Server
	mu     sync.Mutex
	got    []push.WebAlert
	status int
}

func newFakeBrowser(t *testing.T) *fakeBrowser {
	t.Helper()
	b := &fakeBrowser{status: http.StatusCreated, auth: make([]byte, 16)}
	b.priv, _ = ecdh.P256().GenerateKey(rand.Reader)
	_, _ = rand.Read(b.auth)
	b.srv = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		b.mu.Lock()
		defer b.mu.Unlock()
		if b.status < 300 {
			var a push.WebAlert
			if err := json.Unmarshal(b.decrypt(t, body), &a); err != nil {
				t.Errorf("payload: %v", err)
			}
			b.got = append(b.got, a)
		}
		w.WriteHeader(b.status)
	}))
	t.Cleanup(b.srv.Close)
	return b
}

func (b *fakeBrowser) subscription() map[string]any {
	enc := base64.RawURLEncoding.EncodeToString
	// The shape PushSubscription.toJSON() gives, expirationTime included.
	return map[string]any{"endpoint": b.srv.URL + "/push/" + uuid.NewString(), "expirationTime": nil,
		"keys": map[string]any{"p256dh": enc(b.priv.PublicKey().Bytes()), "auth": enc(b.auth)}}
}

func (b *fakeBrowser) alerts() []push.WebAlert {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]push.WebAlert(nil), b.got...)
}

// decrypt opens an aes128gcm web push body as the browser does (RFC 8291, RFC 8188).
func (b *fakeBrowser) decrypt(t *testing.T, body []byte) []byte {
	t.Helper()
	salt, idLen := body[:16], int(body[20])
	server, err := ecdh.P256().NewPublicKey(body[21 : 21+idLen])
	if err != nil {
		t.Fatalf("server key: %v", err)
	}
	shared, _ := b.priv.ECDH(server)
	info := append(append([]byte("WebPush: info\x00"), b.priv.PublicKey().Bytes()...), server.Bytes()...)
	ikm, _ := hkdf.Key(sha256.New, shared, b.auth, string(info), 32)
	cek, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	if rs := binary.BigEndian.Uint32(body[16:20]); rs == 0 {
		t.Fatal("record size 0")
	}
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, body[21+idLen:], nil)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	for len(plain) > 0 && plain[len(plain)-1] == 0 {
		plain = plain[:len(plain)-1]
	}
	if len(plain) == 0 || plain[len(plain)-1] != 2 {
		t.Fatal("no last-record delimiter")
	}
	return plain[:len(plain)-1]
}

func (e *testEnv) webSubCount(where string, arg any) int {
	var n int
	_ = e.d.DB.Pool.QueryRow(context.Background(), `SELECT count(*) FROM web_push_subscriptions WHERE `+where, arg).Scan(&n)
	return n
}

// TestWebPush: a browser subscribes for its session, the push worker sends it the
// notification's text and link when the desktop channel is on, a subscription the push
// service dropped is deleted, and ending the session ends the subscription.
func TestWebPush(t *testing.T) {
	e := newEnv(t)
	browser := newFakeBrowser(t)
	e.s.push.web.HTTP = browser.srv.Client()

	keys, _ := push.DeriveVAPIDKeys(e.d.Cfg.AuthSecret)
	if r := e.client().do("GET", "/v1/auth/config", nil); r.str("web_push_key") != keys.Public {
		t.Fatalf("web push key: %s", r.Raw)
	}

	web, email := e.signup("webpush")
	wid := web.newWorkspace("Web Push")
	uid := web.do("GET", "/v1/me", nil).str("user", "id")
	bad := browser.subscription()
	bad["endpoint"] = "http://push.example/x"
	if r := web.do("PUT", "/v1/me/web-push", bad); r.Status != 422 {
		t.Fatalf("http endpoint: %d %s", r.Status, r.Raw)
	}
	sub := browser.subscription()
	if r := web.do("PUT", "/v1/me/web-push", sub); r.Status != 204 {
		t.Fatalf("subscribe: %d %s", r.Status, r.Raw)
	}
	// Subscribing again is idempotent; a new endpoint replaces the session's old one.
	_ = web.do("PUT", "/v1/me/web-push", sub)
	if e.webSubCount("user_id = $1", uid) != 1 {
		t.Fatal("same endpoint stored twice")
	}
	sub = browser.subscription()
	_ = web.do("PUT", "/v1/me/web-push", sub)
	if e.webSubCount("user_id = $1", uid) != 1 {
		t.Fatal("replaced endpoint kept")
	}

	nid, tid := e.notify(t, wid, uid, "assigned")
	args := jobs.PushNotificationArgs{WorkspaceID: uuid.MustParse(wid), UserID: uuid.MustParse(uid), NotificationID: nid}
	if err := runPush(t, e, args); err != nil {
		t.Fatal(err)
	}
	got := browser.alerts()
	if len(got) != 1 || got[0].ID != nid.String() || got[0].WorkspaceID != wid || got[0].Title != "A ticket was assigned to you" ||
		got[0].Body != "#1 Refund for order 42" || got[0].URL != "http://app.test/inbox/mine/"+tid.String()+"?ws="+wid {
		t.Fatalf("alerts = %+v", got)
	}

	// hd.Notify enqueues the push for a user whose only target is a browser.
	hd.ConfigurePush(e.d.Jobs)
	defer hd.ConfigurePush(nil)
	if err := pgx.BeginFunc(context.Background(), e.d.DB.Pool, func(tx pgx.Tx) error {
		return hd.Notify(context.Background(), tx, uuid.MustParse(wid), uuid.MustParse(uid), hd.NotifyAssigned, &tid, nil)
	}); err != nil {
		t.Fatal(err)
	}
	var queued int
	_ = e.d.DB.Pool.QueryRow(context.Background(), `SELECT count(*) FROM river_job WHERE kind = 'push.notification' AND args->>'user_id' = $1`,
		uid).Scan(&queued)
	if queued != 1 {
		t.Fatalf("push jobs = %d", queued)
	}

	// The desktop channel off for the type: nothing is sent.
	if r := web.do("PATCH", "/v1/me/notification-preferences", map[string]any{"types": []any{map[string]any{"type": "assigned", "desktop": false}}}); r.Status != 200 {
		t.Fatalf("preferences: %d %s", r.Status, r.Raw)
	}
	nid2, _ := e.notify(t, wid, uid, "assigned")
	if err := runPush(t, e, jobs.PushNotificationArgs{WorkspaceID: uuid.MustParse(wid), UserID: uuid.MustParse(uid), NotificationID: nid2}); err != nil ||
		len(browser.alerts()) != 1 {
		t.Fatalf("desktop off pushed: %v %d", err, len(browser.alerts()))
	}

	// A subscription the push service dropped is deleted.
	browser.status = http.StatusGone
	nid3, _ := e.notify(t, wid, uid, "mentioned")
	if err := runPush(t, e, jobs.PushNotificationArgs{WorkspaceID: uuid.MustParse(wid), UserID: uuid.MustParse(uid), NotificationID: nid3}); err != nil {
		t.Fatal(err)
	}
	if e.webSubCount("user_id = $1", uid) != 0 {
		t.Fatal("dropped subscription kept")
	}

	// Revoking the session from another sign-in ends its subscription.
	browser.status = http.StatusCreated
	_ = web.do("PUT", "/v1/me/web-push", browser.subscription())
	var sid string
	_ = e.d.DB.Pool.QueryRow(context.Background(), `SELECT session_id FROM web_push_subscriptions WHERE user_id = $1`, uid).Scan(&sid)
	other := e.client()
	other.token = other.do("POST", "/v1/auth/login", map[string]any{"email": email, "password": goodPassword}).str("access_token")
	if r := other.do("DELETE", "/v1/me/sessions/"+sid, nil); r.Status != 204 || e.webSubCount("user_id = $1", uid) != 0 {
		t.Fatalf("revoke session: %d subscriptions=%d", r.Status, e.webSubCount("user_id = $1", uid))
	}
}

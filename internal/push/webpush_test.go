package push

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestDeriveVAPIDKeys(t *testing.T) {
	a, err := DeriveVAPIDKeys([]byte("test-auth-secret-test-auth-secret-0000"))
	if err != nil {
		t.Fatal(err)
	}
	again, _ := DeriveVAPIDKeys([]byte("test-auth-secret-test-auth-secret-0000"))
	other, _ := DeriveVAPIDKeys([]byte("another-auth-secret-another-auth-secret"))
	if a != again || a.Public == other.Public {
		t.Fatal("keys are not derived from the secret alone")
	}
	pub, _ := base64.RawURLEncoding.DecodeString(a.Public)
	priv, _ := base64.RawURLEncoding.DecodeString(a.Private)
	k, err := ecdh.P256().NewPrivateKey(priv)
	if err != nil || len(pub) != 65 || pub[0] != 4 || string(k.PublicKey().Bytes()) != string(pub) {
		t.Fatalf("not a P-256 pair: %v", err)
	}
}

// browserSub is a subscription with real browser keys for endpoint.
func browserSub(t *testing.T, endpoint string) WebSubscription {
	t.Helper()
	k, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	_, _ = rand.Read(auth)
	var s WebSubscription
	s.Endpoint = endpoint
	s.Keys.P256dh = base64.RawURLEncoding.EncodeToString(k.PublicKey().Bytes())
	s.Keys.Auth = base64.RawURLEncoding.EncodeToString(auth)
	return s
}

func TestWebSubscriptionValid(t *testing.T) {
	ok := browserSub(t, "https://fcm.googleapis.com/fcm/send/abc")
	if !ok.Valid() {
		t.Fatal("a browser subscription is refused")
	}
	padded := ok
	padded.Keys.Auth += "=="
	if !padded.Valid() {
		t.Fatal("padded keys are refused")
	}
	for name, mut := range map[string]func(*WebSubscription){
		"http":       func(s *WebSubscription) { s.Endpoint = "http://push.example/x" },
		"no host":    func(s *WebSubscription) { s.Endpoint = "https:///x" },
		"userinfo":   func(s *WebSubscription) { s.Endpoint = "https://a:b@push.example/x" },
		"short key":  func(s *WebSubscription) { s.Keys.P256dh = s.Keys.P256dh[:20] },
		"bad auth":   func(s *WebSubscription) { s.Keys.Auth = "not base64!" },
		"empty keys": func(s *WebSubscription) { s.Keys.P256dh, s.Keys.Auth = "", "" },
	} {
		s := ok
		mut(&s)
		if s.Valid() {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestWebSubscriber(t *testing.T) {
	for _, c := range []struct{ api, from, want string }{
		{"https://api.opendesk.sh", "opendesk <team@opendesk.sh>", "https://api.opendesk.sh"},
		{"http://localhost:8080", "opendesk <notifications@localhost>", "notifications@localhost"},
		{"http://localhost:8080", "support@example.com", "support@example.com"},
	} {
		if got := WebSubscriber(c.api, c.from); got != c.want {
			t.Errorf("WebSubscriber(%q, %q) = %q, want %q", c.api, c.from, got, c.want)
		}
	}
}

// TestWebPusherSend: a send is a VAPID-signed, aes128gcm-encrypted POST to the
// endpoint, and the push service's answer maps to nil, ErrUnregistered or an error.
func TestWebPusherSend(t *testing.T) {
	keys, _ := DeriveVAPIDKeys([]byte("test-auth-secret-test-auth-secret-0000"))
	status := http.StatusCreated
	var got *http.Request
	var body []byte
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(status)
	}))
	defer srv.Close()
	w := &WebPusher{Keys: keys, Subscriber: "https://api.opendesk.sh", HTTP: srv.Client()}
	sub := browserSub(t, srv.URL+"/push/abc")

	if err := w.Send(context.Background(), sub, []byte(`{"title":"Refund for order 42"}`)); err != nil {
		t.Fatal(err)
	}
	if got.Method != http.MethodPost || got.URL.Path != "/push/abc" || got.Header.Get("Content-Encoding") != "aes128gcm" ||
		got.Header.Get("TTL") != "86400" || got.Header.Get("Urgency") != "high" {
		t.Fatalf("request: %s %s %v", got.Method, got.URL.Path, got.Header)
	}
	if strings.Contains(string(body), "Refund") {
		t.Fatal("payload sent in clear")
	}
	auth := got.Header.Get("Authorization")
	tok, k, ok := strings.Cut(strings.TrimPrefix(auth, "vapid t="), ", k=")
	if !ok || k != keys.Public {
		t.Fatalf("authorization: %q", auth)
	}
	pub, _ := base64.RawURLEncoding.DecodeString(keys.Public)
	x, y := new(big.Int).SetBytes(pub[1:33]), new(big.Int).SetBytes(pub[33:])
	claims := jwt.MapClaims{}
	if _, err := jwt.ParseWithClaims(tok, claims, func(*jwt.Token) (any, error) {
		return &ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, nil
	}, jwt.WithValidMethods([]string{"ES256"})); err != nil {
		t.Fatalf("vapid jwt: %v", err)
	}
	if claims["aud"] != srv.URL || claims["sub"] != "https://api.opendesk.sh" {
		t.Fatalf("claims: %v", claims)
	}

	status = http.StatusGone
	if err := w.Send(context.Background(), sub, []byte(`{}`)); !errors.Is(err, ErrUnregistered) {
		t.Fatalf("410: %v", err)
	}
	status = http.StatusNotFound
	if err := w.Send(context.Background(), sub, []byte(`{}`)); !errors.Is(err, ErrUnregistered) {
		t.Fatalf("404: %v", err)
	}
	status = http.StatusTooManyRequests
	if err := w.Send(context.Background(), sub, []byte(`{}`)); err == nil || errors.Is(err, ErrUnregistered) {
		t.Fatalf("429: %v", err)
	}
}

package push

import (
	"context"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// Web Push to browsers (contracts/native.md "Web Push"): the subscription a browser
// hands the web app, this instance's VAPID keys and one send.

const vapidKeyInfo = "opendesk-web-push-vapid/v1"

// WebTTL is how long a push service keeps a web push for a browser that is offline.
const WebTTL = 24 * 60 * 60

// VAPIDKeys is this instance's P-256 key pair for Web Push, base64url without padding:
// browsers subscribe with Public, and Private signs every send.
type VAPIDKeys struct {
	Public  string
	Private string
}

// DeriveVAPIDKeys derives the VAPID key pair from AUTH_SECRET (HKDF-SHA256, info
// "opendesk-web-push-vapid/v1"). It needs no storage and changes only with AUTH_SECRET,
// which ends every browser subscription.
func DeriveVAPIDKeys(secret []byte) (VAPIDKeys, error) {
	d, err := hkdf.Key(sha256.New, secret, nil, vapidKeyInfo, 32)
	if err != nil {
		return VAPIDKeys{}, err
	}
	k, err := ecdh.P256().NewPrivateKey(d)
	if err != nil {
		return VAPIDKeys{}, fmt.Errorf("push: vapid key: %w", err)
	}
	enc := base64.RawURLEncoding.EncodeToString
	return VAPIDKeys{Public: enc(k.PublicKey().Bytes()), Private: enc(d)}, nil
}

// WebSubscription is a browser's PushSubscription as its toJSON() gives it.
// ExpirationTime is accepted and not stored: a push service's 404 or 410 ends a
// subscription.
type WebSubscription struct {
	Endpoint       string `json:"endpoint" maxLength:"2048" doc:"The push service URL, https"`
	ExpirationTime *int64 `json:"expirationTime,omitempty" doc:"From toJSON(); not used"`
	Keys           struct {
		P256dh string `json:"p256dh" maxLength:"200" doc:"The browser's P-256 public key, base64url"`
		Auth   string `json:"auth" maxLength:"100" doc:"The 16-byte auth secret, base64url"`
	} `json:"keys"`
}

// Valid reports an https endpoint and keys of the sizes RFC 8291 uses.
func (s WebSubscription) Valid() bool {
	u, err := url.Parse(s.Endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return false
	}
	return keyLen(s.Keys.P256dh) == 65 && keyLen(s.Keys.Auth) == 16
}

func keyLen(s string) int {
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
	if err != nil {
		return -1
	}
	return len(b)
}

// WebAlert is the JSON a browser's service worker receives: what to show and where a
// click goes. It travels encrypted end to end, so it may carry the ticket subject.
type WebAlert struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	Title       string `json:"title"`
	Body        string `json:"body,omitempty"`
	URL         string `json:"url"`
}

// WebPusher sends web pushes signed with this instance's VAPID keys. Subscriber is the
// contact a push service may use: an https URL or an email address.
type WebPusher struct {
	Keys       VAPIDKeys
	Subscriber string
	HTTP       webpush.HTTPClient
}

// Send delivers one encrypted payload. ErrUnregistered means the push service no longer
// knows the subscription (the browser unsubscribed or revoked the permission).
func (w *WebPusher) Send(ctx context.Context, sub WebSubscription, payload []byte) error {
	resp, err := webpush.SendNotificationWithContext(ctx, payload,
		&webpush.Subscription{Endpoint: sub.Endpoint, Keys: webpush.Keys{P256dh: sub.Keys.P256dh, Auth: sub.Keys.Auth}},
		&webpush.Options{HTTPClient: w.HTTP, Subscriber: w.Subscriber, VAPIDPublicKey: w.Keys.Public,
			VAPIDPrivateKey: w.Keys.Private, TTL: WebTTL, Urgency: webpush.UrgencyHigh})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		return ErrUnregistered
	case resp.StatusCode >= 300:
		return fmt.Errorf("push: web push status %d", resp.StatusCode)
	}
	return nil
}

// WebSubscriber is the VAPID contact: the API URL when it is https, else the address
// notification emails come from.
func WebSubscriber(apiURL, mailFrom string) string {
	if strings.HasPrefix(apiURL, "https://") {
		return apiURL
	}
	if a, err := mail.ParseAddress(mailFrom); err == nil {
		return a.Address
	}
	return mailFrom
}

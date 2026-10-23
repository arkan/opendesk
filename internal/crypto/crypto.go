// Package crypto holds secret handling: AES-GCM sealing, token generation and hashing.
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
)

// Box seals small secrets (mailbox credentials, webhook secrets) with AES-256-GCM. It seals
// with the current key and opens with the current key or any previous one, so the key can
// be replaced while values sealed with the one before it still open (CREDENTIALS_KEY and
// CREDENTIALS_KEY_PREVIOUS; internal/sealed re-encrypts them with the current key).
type Box struct {
	aead     cipher.AEAD
	previous []cipher.AEAD
}

// ErrUnknownKey is a sealed value that none of the box's keys opens.
var ErrUnknownKey = errors.New("crypto: sealed with none of the configured keys")

// NewBox returns a box that seals with key and also opens what previous keys sealed.
func NewBox(key []byte, previous ...[]byte) (*Box, error) {
	aead, err := newAEAD(key)
	if err != nil {
		return nil, err
	}
	b := &Box{aead: aead}
	for _, k := range previous {
		p, err := newAEAD(k)
		if err != nil {
			return nil, err
		}
		b.previous = append(b.previous, p)
	}
	return b, nil
}

func newAEAD(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("crypto: key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Seal returns nonce || ciphertext, always under the current key.
func (b *Box) Seal(plaintext []byte) ([]byte, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return b.aead.Seal(nonce, nonce, plaintext, nil), nil
}

// Open opens a value sealed with the current key or a previous one.
func (b *Box) Open(sealed []byte) ([]byte, error) {
	plain, _, err := b.open(sealed)
	return plain, err
}

// Rotating reports whether the box has previous keys to move values off.
func (b *Box) Rotating() bool { return len(b.previous) > 0 }

// Reseal returns sealed under the current key when a previous key opened it, and nil when
// the current key already does. A value no key opens is ErrUnknownKey.
func (b *Box) Reseal(sealed []byte) ([]byte, error) {
	plain, current, err := b.open(sealed)
	if err != nil || current {
		return nil, err
	}
	return b.Seal(plain)
}

// open reports whether the current key was the one that opened sealed.
func (b *Box) open(sealed []byte) ([]byte, bool, error) {
	n := b.aead.NonceSize()
	if len(sealed) < n {
		return nil, false, errors.New("crypto: ciphertext too short")
	}
	if plain, err := b.aead.Open(nil, sealed[:n], sealed[n:], nil); err == nil {
		return plain, true, nil
	}
	for _, p := range b.previous {
		if plain, err := p.Open(nil, sealed[:n], sealed[n:], nil); err == nil {
			return plain, false, nil
		}
	}
	return nil, false, ErrUnknownKey
}

// SealJSON encrypts v as JSON.
func (b *Box) SealJSON(v any) ([]byte, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return b.Seal(raw)
}

// OpenJSON decrypts into v. A nil input leaves v untouched.
func (b *Box) OpenJSON(sealed []byte, v any) error {
	if len(sealed) == 0 {
		return nil
	}
	raw, err := b.Open(sealed)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

// RandomToken returns n random bytes, base64url without padding.
func RandomToken(n int) string {
	b := make([]byte, n)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// RandomString returns a lowercase alphanumeric string of length n.
func RandomString(n int) string {
	const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
	b := make([]byte, n)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = alphabet[int(b[i])%len(alphabet)]
	}
	return string(b)
}

// HashToken is the stored form of an opaque credential.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// HMACHex returns hex(HMAC-SHA256(key, msg)).
func HMACHex(key []byte, msg string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil))
}

// EqualHex compares two hex strings in constant time.
func EqualHex(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

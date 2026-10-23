package crypto

import (
	"bytes"
	"errors"
	"testing"
)

func key(b byte) []byte { return bytes.Repeat([]byte{b}, 32) }

func TestBoxOpensWithPreviousKeys(t *testing.T) {
	a, _ := NewBox(key('a'))
	c, _ := NewBox(key('c'))
	sealedA, err := a.Seal([]byte("secret-a"))
	if err != nil {
		t.Fatal(err)
	}
	sealedC, _ := c.Seal([]byte("secret-c"))

	b, err := NewBox(key('b'), key('c'), key('a'))
	if err != nil {
		t.Fatal(err)
	}
	if !b.Rotating() || a.Rotating() {
		t.Fatal("Rotating is whether previous keys are set")
	}
	for in, want := range map[string][]byte{"secret-a": sealedA, "secret-c": sealedC} {
		got, err := b.Open(want)
		if err != nil || string(got) != in {
			t.Fatalf("open %s: %q %v", in, got, err)
		}
	}
	// New values are sealed with the current key only.
	sealedB, _ := b.Seal([]byte("secret-b"))
	if _, err := a.Open(sealedB); err == nil {
		t.Fatal("a previous key opened a new value")
	}
	if only, _ := NewBox(key('b')); func() bool { p, err := only.Open(sealedB); return err != nil || string(p) != "secret-b" }() {
		t.Fatal("the current key alone does not open a new value")
	}

	// Reseal: nil for current values, the current key for previous ones.
	if next, err := b.Reseal(sealedB); err != nil || next != nil {
		t.Fatalf("reseal current: %v %v", next, err)
	}
	next, err := b.Reseal(sealedA)
	if err != nil || next == nil {
		t.Fatalf("reseal previous: %v", err)
	}
	only, _ := NewBox(key('b'))
	if p, err := only.Open(next); err != nil || string(p) != "secret-a" {
		t.Fatalf("resealed value with the current key alone: %q %v", p, err)
	}

	// A value no key opens is ErrUnknownKey, and so is Open's answer.
	d, _ := NewBox(key('d'))
	sealedD, _ := d.Seal([]byte("secret-d"))
	if _, err := b.Reseal(sealedD); !errors.Is(err, ErrUnknownKey) {
		t.Fatalf("reseal unknown: %v", err)
	}
	if _, err := b.Open(sealedD); !errors.Is(err, ErrUnknownKey) {
		t.Fatalf("open unknown: %v", err)
	}
	if _, err := NewBox(key('b'), []byte("short")); err == nil {
		t.Fatal("a short previous key was accepted")
	}
}

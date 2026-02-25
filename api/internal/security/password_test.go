package security

import "testing"

func TestHashAndVerifyPassword(t *testing.T) {
	hash, err := HashPassword("StrongPass123!")
	if err != nil {
		t.Fatalf("hash error: %v", err)
	}
	if !VerifyPassword(hash, "StrongPass123!") {
		t.Fatal("expected password verification to succeed")
	}
	if VerifyPassword(hash, "wrong") {
		t.Fatal("expected wrong password verification to fail")
	}
}

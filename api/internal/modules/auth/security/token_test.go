package security

import (
	"testing"
	"time"
)

func TestAccessTokenRoundTrip(t *testing.T) {
	token, _, err := NewAccessToken("secret", 5*time.Minute, "user-1", []string{"r1"}, []string{"users:read"})
	if err != nil {
		t.Fatalf("new token: %v", err)
	}
	claims, err := ParseAccessToken("secret", token)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Fatalf("unexpected user id: %s", claims.UserID)
	}
	if len(claims.Scope) != 1 || claims.Scope[0] != "users:read" {
		t.Fatalf("unexpected scope: %#v", claims.Scope)
	}
}

func TestRefreshTokenHash(t *testing.T) {
	tkn, err := NewRefreshToken()
	if err != nil {
		t.Fatalf("new refresh token: %v", err)
	}
	if tkn == "" {
		t.Fatal("expected non-empty refresh token")
	}
	h1 := HashToken(tkn)
	h2 := HashToken(tkn)
	if h1 != h2 {
		t.Fatal("expected deterministic hash")
	}
}

package security

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type Claims struct {
	UserID  string   `json:"sub"`
	RoleIDs []string `json:"role_ids"`
	Scope   []string `json:"scope"`
	JTI     string   `json:"jti"`
	jwt.RegisteredClaims
}

func NewAccessToken(secret string, ttl time.Duration, userID string, roleIDs []string, scope []string) (string, time.Time, error) {
	now := time.Now().UTC()
	expires := now.Add(ttl)
	claims := Claims{
		UserID:  userID,
		RoleIDs: roleIDs,
		Scope:   scope,
		JTI:     uuid.NewString(),
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expires),
		},
	}
	tkn := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tkn.SignedString([]byte(secret))
	return signed, expires, err
}

func ParseAccessToken(secret, raw string) (*Claims, error) {
	tkn, err := jwt.ParseWithClaims(raw, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if token.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, errors.New("invalid signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := tkn.Claims.(*Claims)
	if !ok || !tkn.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

func NewRefreshToken() (string, error) {
	buf := make([]byte, 48)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

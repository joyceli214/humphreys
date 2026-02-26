package middleware

import (
	"net/http"
	"strings"

	authsecurity "humphreys/api/internal/modules/auth/security"

	"github.com/gin-gonic/gin"
)

const claimsContextKey = "auth_claims"

func Auth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			return
		}
		raw := strings.TrimSpace(header[len("Bearer "):])
		claims, err := authsecurity.ParseAccessToken(secret, raw)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		c.Set(claimsContextKey, claims)
		c.Next()
	}
}

func Claims(c *gin.Context) (*authsecurity.Claims, bool) {
	value, ok := c.Get(claimsContextKey)
	if !ok {
		return nil, false
	}
	claims, ok := value.(*authsecurity.Claims)
	return claims, ok
}

func RequirePermission(permission string) gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := Claims(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing auth context"})
			return
		}
		for _, code := range claims.Scope {
			if code == permission {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	}
}

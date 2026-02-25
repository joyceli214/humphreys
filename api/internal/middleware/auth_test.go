package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"humphreys/api/internal/security"

	"github.com/gin-gonic/gin"
)

func TestRequirePermission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		tok, _, _ := security.NewAccessToken("secret", time.Minute, "u1", []string{"r1"}, []string{"users:read"})
		claims, _ := security.ParseAccessToken("secret", tok)
		c.Set("auth_claims", claims)
		c.Next()
	})
	r.GET("/test", RequirePermission("users:read"), func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSecurityHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(SecurityHeaders())
	r.GET("/x", func(c *gin.Context) { c.Status(http.StatusOK) })

	for _, path := range []string{"/x", "/missing"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if got := w.Header().Get("X-Frame-Options"); got != "SAMEORIGIN" {
			t.Fatalf("%s X-Frame-Options = %q", path, got)
		}
		if got := w.Header().Get("Content-Security-Policy"); got != "frame-ancestors 'self'" {
			t.Fatalf("%s Content-Security-Policy = %q", path, got)
		}
	}
}

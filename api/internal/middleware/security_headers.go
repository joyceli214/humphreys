package middleware

import "github.com/gin-gonic/gin"

// SecurityHeaders stops other sites from framing API responses (clickjacking)
// while still allowing same-origin frames. web/server.cjs sets the same
// headers on the web app's responses.
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Frame-Options", "SAMEORIGIN")
		h.Set("Content-Security-Policy", "frame-ancestors 'self'")
		c.Next()
	}
}

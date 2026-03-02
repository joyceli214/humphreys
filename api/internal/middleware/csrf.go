package middleware

import (
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func CSRFMiddleware(exemptPaths map[string]struct{}) gin.HandlerFunc {
	return func(c *gin.Context) {
		method := strings.ToUpper(c.Request.Method)
		if method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions {
			c.Next()
			return
		}
		if _, ok := exemptPaths[c.Request.URL.Path]; ok {
			c.Next()
			return
		}

		cookie, err := c.Cookie("csrf_token")
		if err != nil || cookie == "" {
			log.Printf(
				"[csrf] missing csrf cookie method=%s path=%s host=%s origin=%s referer=%s has_csrf_header=%t",
				method,
				c.Request.URL.Path,
				c.Request.Host,
				c.GetHeader("Origin"),
				c.GetHeader("Referer"),
				c.GetHeader("X-CSRF-Token") != "",
			)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "missing csrf cookie"})
			return
		}
		header := c.GetHeader("X-CSRF-Token")
		if header == "" || header != cookie {
			log.Printf(
				"[csrf] invalid csrf token method=%s path=%s host=%s origin=%s referer=%s header_present=%t cookie_present=%t",
				method,
				c.Request.URL.Path,
				c.Request.Host,
				c.GetHeader("Origin"),
				c.GetHeader("Referer"),
				header != "",
				cookie != "",
			)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "invalid csrf token"})
			return
		}
		c.Next()
	}
}

package middleware

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// ErrorLogger logs all responses with HTTP status >= 400.
func ErrorLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		status := c.Writer.Status()
		if status < 400 {
			return
		}

		userID := ""
		if claims, ok := Claims(c); ok {
			userID = claims.UserID
		}

		errText := c.Errors.ByType(gin.ErrorTypeAny).String()
		if errText == "" {
			errText = "-"
		}

		log.Printf(
			"[http-error] status=%d method=%s path=%s query=%q user_id=%q ip=%s origin=%q referer=%q ua=%q latency_ms=%d errors=%q",
			status,
			c.Request.Method,
			c.Request.URL.Path,
			c.Request.URL.RawQuery,
			userID,
			c.ClientIP(),
			c.GetHeader("Origin"),
			c.GetHeader("Referer"),
			c.GetHeader("User-Agent"),
			time.Since(start).Milliseconds(),
			errText,
		)
	}
}


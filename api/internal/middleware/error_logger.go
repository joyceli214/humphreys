package middleware

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const maxLoggedErrorBodyBytes = 2048

type responseBodyCaptureWriter struct {
	gin.ResponseWriter
	body      bytes.Buffer
	truncated bool
}

func (w *responseBodyCaptureWriter) Write(data []byte) (int, error) {
	w.capture(data)
	return w.ResponseWriter.Write(data)
}

func (w *responseBodyCaptureWriter) WriteString(s string) (int, error) {
	w.capture([]byte(s))
	return w.ResponseWriter.WriteString(s)
}

func (w *responseBodyCaptureWriter) capture(data []byte) {
	if len(data) == 0 || w.truncated {
		return
	}
	remaining := maxLoggedErrorBodyBytes - w.body.Len()
	if remaining <= 0 {
		w.truncated = true
		return
	}
	if len(data) > remaining {
		w.body.Write(data[:remaining])
		w.truncated = true
		return
	}
	w.body.Write(data)
}

// ErrorLogger logs all responses with HTTP status >= 400.
func ErrorLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		recorder := &responseBodyCaptureWriter{ResponseWriter: c.Writer}
		c.Writer = recorder
		c.Next()

		status := c.Writer.Status()
		if status < 400 {
			return
		}

		userID := ""
		if claims, ok := Claims(c); ok {
			userID = claims.UserID
		}

		errText := strings.TrimSpace(c.Errors.ByType(gin.ErrorTypeAny).String())
		errorDetail := extractErrorDetail(errText, recorder.body.String(), recorder.truncated)

		requestID := c.Writer.Header().Get("X-Request-ID")
		if requestID == "" {
			requestID = c.GetHeader("X-Request-ID")
		}
		if requestID == "" {
			requestID = "-"
		}

		log.Printf(
			"[http-error] status=%d method=%s path=%s query=%q request_id=%q user_id=%q ip=%s origin=%q referer=%q ua=%q latency_ms=%d errors=%q",
			status,
			c.Request.Method,
			c.Request.URL.Path,
			c.Request.URL.RawQuery,
			requestID,
			userID,
			c.ClientIP(),
			c.GetHeader("Origin"),
			c.GetHeader("Referer"),
			c.GetHeader("User-Agent"),
			time.Since(start).Milliseconds(),
			errorDetail,
		)
	}
}

func extractErrorDetail(ginErrors, responseBody string, truncated bool) string {
	details := make([]string, 0, 3)
	if ginErrors != "" {
		details = append(details, fmt.Sprintf("gin=%s", ginErrors))
	}

	bodyDetail := parseResponseErrorBody(responseBody)
	if bodyDetail != "" {
		if truncated {
			bodyDetail += " (truncated)"
		}
		details = append(details, fmt.Sprintf("response=%s", bodyDetail))
	}

	if len(details) == 0 {
		return "-"
	}
	return strings.Join(details, " | ")
}

func parseResponseErrorBody(body string) string {
	body = strings.TrimSpace(body)
	if body == "" {
		return ""
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return body
	}

	parts := make([]string, 0, 2)
	if v := asString(payload["error"]); v != "" {
		parts = append(parts, fmt.Sprintf("error=%s", v))
	}
	if v := asString(payload["detail"]); v != "" {
		parts = append(parts, fmt.Sprintf("detail=%s", v))
	}
	if v := asString(payload["message"]); v != "" {
		parts = append(parts, fmt.Sprintf("message=%s", v))
	}
	if len(parts) == 0 {
		return body
	}
	return strings.Join(parts, ", ")
}

func asString(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

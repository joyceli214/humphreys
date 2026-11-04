package workorders

import (
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const (
	// aiToolsMaxBodyBytes caps every /ai-tools request body.
	aiToolsMaxBodyBytes = 1 << 20
	// aiToolsMaxTextChars caps free-text fields (instruction, notes, item_name,
	// quantity_text). Counted in characters (runes), not bytes.
	aiToolsMaxTextChars = 2000
	// massUpdateTotalOpsCap bounds the number of operations in one request.
	massUpdateTotalOpsCap = 200
	// massUpdateOpsPerJobCap bounds the number of operations on a single job.
	massUpdateOpsPerJobCap = 20
	// aiToolsLLMRateLimit is how many LLM-backed requests a user may make per
	// aiToolsLLMRateWindow, shared across all LLM endpoints.
	aiToolsLLMRateLimit  = 20
	aiToolsLLMRateWindow = time.Minute
)

// checkTextLength returns a user-facing error when value exceeds the cap.
func checkTextLength(field, value string) error {
	if utf8.RuneCountInString(value) > aiToolsMaxTextChars {
		return fmt.Errorf("%s is too long (max %d characters)", field, aiToolsMaxTextChars)
	}
	return nil
}

// validateMassUpdateOps enforces the job / op count caps and the text length
// caps. Requests over a cap are rejected outright; jobs are never silently
// dropped.
func validateMassUpdateOps(ops []MassUpdateOp) error {
	perJob := make(map[int32]int)
	for _, op := range ops {
		perJob[op.ReferenceID]++
	}
	if len(perJob) > massUpdateJobCap {
		return fmt.Errorf("too many jobs: %d jobs requested, max %d per request; narrow the instruction or split it up", len(perJob), massUpdateJobCap)
	}
	if len(ops) > massUpdateTotalOpsCap {
		return fmt.Errorf("too many changes: %d changes requested, max %d per request; narrow the instruction or split it up", len(ops), massUpdateTotalOpsCap)
	}
	for _, op := range ops {
		if n := perJob[op.ReferenceID]; n > massUpdateOpsPerJobCap {
			return fmt.Errorf("too many changes for job #%d: %d requested, max %d per job", op.ReferenceID, n, massUpdateOpsPerJobCap)
		}
		if op.ItemName != nil {
			if err := checkTextLength("item_name", *op.ItemName); err != nil {
				return fmt.Errorf("job #%d: %w", op.ReferenceID, err)
			}
		}
		if op.QuantityText != nil {
			if err := checkTextLength("quantity_text", *op.QuantityText); err != nil {
				return fmt.Errorf("job #%d: %w", op.ReferenceID, err)
			}
		}
	}
	return validateWorkDoneOps(ops)
}

// aiToolsBodyLimit wraps the request body in http.MaxBytesReader so no
// /ai-tools handler can be made to read more than aiToolsMaxBodyBytes.
func aiToolsBodyLimit() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, aiToolsMaxBodyBytes)
		}
		c.Next()
	}
}

// bindAIToolsJSON binds the JSON body and writes the error response itself:
// 413 when the body exceeded aiToolsMaxBodyBytes, 400 otherwise. It returns
// false when the caller should stop.
func bindAIToolsJSON(c *gin.Context, target any) bool {
	if err := c.ShouldBindJSON(target); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": fmt.Sprintf("request body too large (max %d bytes)", aiToolsMaxBodyBytes)})
			return false
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return false
	}
	return true
}

// aiRateLimiter is an in-memory sliding-window limiter keyed by user id. It is
// per-process (not shared across replicas), which is enough to stop a single
// account from burning LLM spend in a loop.
type aiRateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	hits   map[string][]time.Time
}

func newAIRateLimiter(limit int, window time.Duration) *aiRateLimiter {
	return &aiRateLimiter{limit: limit, window: window, hits: make(map[string][]time.Time)}
}

// allow records a request for key at now and reports whether it is within the
// limit. Rejected requests are not recorded.
func (l *aiRateLimiter) allow(key string, now time.Time) bool {
	ok, _ := l.allowAt(key, now)
	return ok
}

// allowAt is allow plus, when rejected, how long until a slot frees up.
func (l *aiRateLimiter) allowAt(key string, now time.Time) (bool, time.Duration) {
	return l.allowNAt(key, 1, now)
}

// allowNAt records n requests for key at now only if all n fit within the
// limit (all-or-nothing): a rejected call charges no slots. When rejected it
// also returns how long until enough slots free up. n <= 0 always passes.
func (l *aiRateLimiter) allowNAt(key string, n int, now time.Time) (bool, time.Duration) {
	if n <= 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	cutoff := now.Add(-l.window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept)+n > l.limit {
		l.hits[key] = kept
		// The (len+n-limit)th oldest hit must expire before n slots are free.
		idx := len(kept) + n - l.limit - 1
		if idx >= len(kept) || n > l.limit {
			return false, l.window
		}
		return false, kept[idx].Sub(cutoff)
	}
	for i := 0; i < n; i++ {
		kept = append(kept, now)
	}
	l.hits[key] = kept
	// Opportunistically drop idle users so the map cannot grow without bound.
	if len(l.hits) > 1024 {
		for k, ts := range l.hits {
			if len(ts) == 0 || !ts[len(ts)-1].After(cutoff) {
				delete(l.hits, k)
			}
		}
	}
	return true, 0
}

// middleware returns 429 once the authenticated user exceeds the limit. It must
// run after auth so the user id is available.
func (l *aiRateLimiter) middleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		key := aiToolsActor(c)
		if key == "" {
			key = "ip:" + c.ClientIP()
		}
		ok, wait := l.allowAt(key, time.Now())
		if !ok {
			secs := int(math.Ceil(wait.Seconds()))
			if secs < 1 {
				secs = 1
			}
			c.Header("Retry-After", strconv.Itoa(secs))
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": fmt.Sprintf("too many AI requests (max %d per %s); try again in %d seconds", l.limit, l.window, secs),
			})
			return
		}
		c.Next()
	}
}

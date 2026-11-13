package workorders

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

// Allowed mass-update operation types. The LLM may only ever emit these; the
// backend rejects anything else. The model proposes, the admin approves, and
// every value is re-validated server-side before it touches the database.
const (
	massOpSetLabourTotal    = "set_labour_total"
	massOpSetLabourDiscount = "set_labour_discount"
	massOpSetLineItemPrice  = "set_line_item_price"
	massOpAddLineItem       = "add_line_item"
	massOpRemoveLineItem    = "remove_line_item"
	massOpSetStatus         = "set_status"
	massOpSetLocation       = "set_location"
	massOpGenerateWorkDone  = "generate_work_done"
)

// massUpdateJobCap bounds how many distinct jobs a single request may touch.
// Requests over the cap are rejected with 400 (see validateMassUpdateOps).
const massUpdateJobCap = 50

// aiSummaryJobCap bounds how many jobs are described to the LLM for the summary.
const aiSummaryJobCap = 60

// MassUpdateOp is a single proposed change to one job. It is both the shape the
// LLM must emit and the shape the apply endpoint accepts back from the client.
type MassUpdateOp struct {
	ReferenceID   int32    `json:"reference_id"`
	Op            string   `json:"op"`
	LabourTotal   *float64 `json:"labour_total,omitempty"`
	DiscountType  *string  `json:"discount_type,omitempty"`
	DiscountValue *float64 `json:"discount_value,omitempty"`
	LineItemID    *int64   `json:"line_item_id,omitempty"`
	UnitPrice     *float64 `json:"unit_price,omitempty"`
	ItemName      *string  `json:"item_name,omitempty"`
	QuantityText  *string  `json:"quantity_text,omitempty"`
	StatusName    *string  `json:"status_name,omitempty"`
	LocationName  *string  `json:"location_name,omitempty"`
	// WorkDoneText is filled by the server on preview (generated from repair
	// logs) and echoed back by the client on apply; apply never calls the LLM.
	WorkDoneText *string `json:"work_done_text,omitempty"`
}

// massUpdateResolvedOp is an op whose status/location names have been resolved to
// concrete ids after validation. Only valid ops get resolved; the repository
// apply layer trusts these ids because the handler verified them.
type massUpdateResolvedOp struct {
	Op            string
	LabourTotal   *float64
	DiscountType  *string
	DiscountValue *float64
	LineItemID    *int64
	UnitPrice     *float64
	ItemName      *string
	QuantityText  *string
	StatusID      *int64
	LocationID    *int64
	WorkDoneText  *string

	// PreviousWorkDone is the job's Work Done when the op was validated, used
	// after apply to delete images the new text no longer references (the
	// stale-version check guarantees it is what the apply replaced).
	PreviousWorkDone *string
}

// AIStatusOption is a work order status available for mass updates.
type AIStatusOption struct {
	ID    int64
	Name  string
	Group string
}

// AILocationOption is a storage location available for mass updates.
type AILocationOption struct {
	ID    int64
	Shelf string
	Floor int32
}

// Label renders a location the same way the catalog does: "<shelf>-<floor>".
func (o AILocationOption) Label() string {
	return aiLocationLabel(&o.Shelf, &o.Floor)
}

// AIStaleCandidate is a lightweight, non-sensitive row used to bucket idle jobs.
// It never carries customer email or phone — only the display name.
type AIStaleCandidate struct {
	ReferenceID    int32
	CustomerName   string
	ItemName       string
	StatusName     string
	StatusGroup    string
	LastActivity   *time.Time
	StatusChangeAt *time.Time
	RepairLog      string
	PartsStatus    string
}

// aiToolsRoutePrefix groups the admin-only AI Tools endpoints.
const aiToolsRoutePrefix = "/ai-tools"

// RegisterAIToolsRoutes wires the admin-only AI Tools endpoints. Every route is
// gated on work_orders:update — the same permission that guards AI Settings,
// which owners have and staff/workers do not — so staff receive a 403 and never
// reach these handlers.
func RegisterAIToolsRoutes(authed *gin.RouterGroup, h *Handler) {
	// Every /ai-tools body is capped; endpoints that call the LLM additionally
	// share one per-user rate limit (checked after the permission gate).
	group := authed.Group(aiToolsRoutePrefix, aiToolsBodyLimit())
	perm := middleware.RequirePermission(permUpdate)
	// The handler keeps the limiter so Mass Update preview can charge one extra
	// slot per generated Work Done (each is its own LLM call).
	if h.aiLimiter == nil {
		h.aiLimiter = newAIRateLimiter(aiToolsLLMRateLimit, aiToolsLLMRateWindow)
	}
	llm := h.aiLimiter.middleware()
	group.POST("/mass-update/preview", perm, llm, h.MassUpdatePreview)
	group.POST("/mass-update/apply", perm, h.MassUpdateApply)
	group.GET("/line-item-catalog", perm, h.LineItemCatalogList)
	group.POST("/search/interpret", perm, llm, h.InterpretSearch)
	group.POST("/search", perm, h.AdvancedSearch)
	// Job summary is no longer shown in the AI Tools UI (replaced by Advanced
	// Search); the endpoints stay registered so the dashboard can reuse them.
	group.POST("/job-summary", perm, llm, h.JobSummary)
	group.GET("/job-summary/stale", perm, h.JobSummaryStale)
	group.POST("/email-draft", perm, llm, h.EmailDraft)
	// Management Ask chat: classify only; reads/writes go through existing endpoints.
	group.POST("/ask/interpret", perm, llm, h.AskInterpret)
	// Management Email pen helper: rewrite on request, blanks must survive.
	group.POST("/email-rewrite", perm, llm, h.EmailRewrite)
}

// aiToolsActor returns the authenticated user id or "" when absent.
func aiToolsActor(c *gin.Context) string {
	claims, ok := middleware.Claims(c)
	if !ok {
		return ""
	}
	return claims.UserID
}

// parseStrictLLMJSON strips any markdown fencing the model added and unmarshals
// the first JSON object into target. It returns a clear error when the model
// returns junk so the caller can surface a helpful message.
func parseStrictLLMJSON(raw string, target any) error {
	cleaned := strings.TrimSpace(raw)
	if cleaned == "" {
		return fmt.Errorf("AI returned an empty response")
	}
	// Remove ```json ... ``` or ``` ... ``` fences if present.
	if strings.HasPrefix(cleaned, "```") {
		cleaned = strings.TrimPrefix(cleaned, "```")
		cleaned = strings.TrimPrefix(cleaned, "json")
		cleaned = strings.TrimPrefix(cleaned, "JSON")
		if idx := strings.LastIndex(cleaned, "```"); idx >= 0 {
			cleaned = cleaned[:idx]
		}
		cleaned = strings.TrimSpace(cleaned)
	}
	// Narrow to the outermost JSON object if the model added prose around it.
	start := strings.Index(cleaned, "{")
	end := strings.LastIndex(cleaned, "}")
	if start < 0 || end < start {
		return fmt.Errorf("AI did not return valid JSON")
	}
	cleaned = cleaned[start : end+1]
	decoder := json.NewDecoder(strings.NewReader(cleaned))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		// Retry without strict field checking so a stray extra key does not sink
		// an otherwise usable response, but still fail on structurally bad JSON.
		if err2 := json.Unmarshal([]byte(cleaned), target); err2 != nil {
			return fmt.Errorf("AI returned malformed JSON: %w", err2)
		}
	}
	return nil
}

// aiLocationLabel formats a storage location like the catalog: "<shelf>-<floor>"
// where floor 0 renders as "FLOOR". Returns an em dash when there is no shelf.
func aiLocationLabel(shelf *string, floor *int32) string {
	s := strings.TrimSpace(stringValue(shelf))
	if s == "" {
		return "—"
	}
	f := int32(0)
	if floor != nil {
		f = *floor
	}
	floorLabel := "FLOOR"
	if f != 0 {
		floorLabel = fmt.Sprintf("%d", f)
	}
	return fmt.Sprintf("%s-%s", s, floorLabel)
}

// aiCustomerName returns only the customer's display name (never email/phone),
// falling back to "Unknown" when the job has no customer.
func aiCustomerName(item domain.WorkOrderDetail) string {
	name := strings.TrimSpace(strings.Join([]string{
		stringValue(item.Customer.FirstName),
		stringValue(item.Customer.LastName),
	}, " "))
	if name == "" {
		return "Unknown"
	}
	return name
}

// aiMoney renders a plain dollar amount for preview rows. (ai_summary.go already
// defines a pointer-taking formatMoney; this one works on a plain float64.)
func aiMoney(v float64) string {
	return fmt.Sprintf("$%.2f", v)
}

// normalizeLookupName lowercases and collapses whitespace for name matching.
func normalizeLookupName(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

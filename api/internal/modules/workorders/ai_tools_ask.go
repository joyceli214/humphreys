package workorders

import (
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

// Ask (Management chat) intents. The model only classifies the request; the
// front end then calls the existing read endpoints (job search, parts list,
// work order detail) or the Mass Update preview. The model never writes SQL
// and never changes data: every write still goes through Mass Update preview
// and an explicit Apply.
const (
	askIntentCustomerJobs  = "customer_jobs"
	askIntentUpdateJobs    = "update_jobs"
	askIntentPartsRequests = "parts_requests"
	askIntentCharges       = "charges_summary"
	askIntentUnknown       = "unknown"
)

const (
	// askMaxString caps every free-text field the model returns.
	askMaxString = 200
	// askMaxReferenceIDs caps how many job numbers one answer may name.
	askMaxReferenceIDs = 50
	// askMaxReply caps the plain-text reply shown for "unknown".
	askMaxReply = 600
)

var askIntents = map[string]bool{
	askIntentCustomerJobs:  true,
	askIntentUpdateJobs:    true,
	askIntentPartsRequests: true,
	askIntentCharges:       true,
	askIntentUnknown:       true,
}

// askPartsStatuses mirrors parts_purchase_requests.status (migration 036).
var askPartsStatuses = map[string]bool{
	"draft": true, "waiting_approval": true, "approved": true, "ordered": true,
	"arrived": true, "used": true, "cancelled": true,
}

type askInterpretRequest struct {
	Message string `json:"message"`
}

type askInterpretResult struct {
	Intent        string   `json:"intent"`
	CustomerQuery string   `json:"customer_query"`
	ReferenceIDs  []int64  `json:"reference_ids"`
	PartsQuery    string   `json:"parts_query"`
	PartsStatuses []string `json:"parts_statuses"`
	Reply         string   `json:"reply"`
}

type askInterpretResponse struct {
	askInterpretResult
	Model string `json:"model"`
}

// AskInterpret classifies one Management chat message into an intent plus a few
// validated parameters. Only the message text is sent to the model.
func (h *Handler) AskInterpret(c *gin.Context) {
	var req askInterpretRequest
	if !bindAIToolsJSON(c, &req) {
		return
	}
	message := strings.TrimSpace(req.Message)
	if message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message is required"})
		return
	}
	if err := checkTextLength("message", message); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	settings, err := h.getAISettings(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI settings"})
		return
	}
	if !settings.HasOpenRouterAPIKey && strings.TrimSpace(settings.OpenRouterAPIKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI is not configured. Add an OpenRouter API key in AI Settings."})
		return
	}
	text, model, err := h.generateOpenRouterTextOnce(c, settings, askSystemPrompt(), "Request: "+message+"\n", 500)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": aiErrorMessage(err)})
		return
	}
	result, err := parseAskInterpretOutput(text)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, askInterpretResponse{askInterpretResult: result, Model: model})
}

// parseAskInterpretOutput parses the model's JSON and normalizes every field:
// unknown intents become "unknown", ids must be positive (deduped, capped),
// strings are trimmed and capped, statuses must be real parts statuses.
func parseAskInterpretOutput(text string) (askInterpretResult, error) {
	var raw askInterpretResult
	if err := parseStrictLLMJSON(text, &raw); err != nil {
		return askInterpretResult{}, err
	}
	out := askInterpretResult{
		Intent:        strings.ToLower(strings.TrimSpace(raw.Intent)),
		CustomerQuery: capRunes(strings.Join(strings.Fields(raw.CustomerQuery), " "), askMaxString),
		PartsQuery:    capRunes(strings.Join(strings.Fields(raw.PartsQuery), " "), askMaxString),
		Reply:         capRunes(strings.TrimSpace(raw.Reply), askMaxReply),
		ReferenceIDs:  make([]int64, 0),
		PartsStatuses: make([]string, 0),
	}
	if !askIntents[out.Intent] {
		out.Intent = askIntentUnknown
	}
	seen := make(map[int64]bool)
	for _, id := range raw.ReferenceIDs {
		if id <= 0 || id > 1<<31-1 || seen[id] {
			continue
		}
		if len(out.ReferenceIDs) >= askMaxReferenceIDs {
			break
		}
		seen[id] = true
		out.ReferenceIDs = append(out.ReferenceIDs, id)
	}
	seenStatus := make(map[string]bool)
	for _, s := range raw.PartsStatuses {
		key := strings.ToLower(strings.TrimSpace(s))
		if askPartsStatuses[key] && !seenStatus[key] {
			seenStatus[key] = true
			out.PartsStatuses = append(out.PartsStatuses, key)
		}
	}
	return out, nil
}

func capRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

func askSystemPrompt() string {
	return "You classify a repair-shop management request typed by the shop owner. " +
		"You never write SQL, never change data and never see customer data. " +
		"Respond with STRICT JSON only (no prose, no markdown) of the form " +
		`{"intent":"...","customer_query":"","reference_ids":[],"parts_query":"","parts_statuses":[],"reply":""}. ` +
		"intent must be one of:\n" +
		`- "customer_jobs": list or summarise jobs for a customer or for job numbers; put the customer name in customer_query\n` +
		`- "update_jobs": change one or more jobs (status, location, labour, line items, work done); put job numbers in reference_ids\n` +
		`- "parts_requests": show parts purchase requests; optional parts_query text and parts_statuses from: draft, waiting_approval, approved, ordered, arrived, used, cancelled\n` +
		`- "charges_summary": sum up labour, parts, deposit and balance for jobs; put job numbers in reference_ids or the customer in customer_query\n` +
		`- "unknown": anything else; put one short, plain sentence in reply saying what you can help with\n` +
		"reference_ids are job numbers as integers. Leave fields you do not need empty. " +
		fmt.Sprintf("Keep reply under %d characters.", askMaxReply)
}

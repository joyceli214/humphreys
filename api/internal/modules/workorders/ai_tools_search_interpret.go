package workorders

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const aiInterpretMaxQuestion = 500
const aiInterpretMaxExplanation = 300

type aiInterpretRequest struct {
	Question string `json:"question"`
}

type aiInterpretResponse struct {
	Filters     AISearchFilters `json:"filters"`
	Explanation string          `json:"explanation"`
	Model       string          `json:"model"`
}

// InterpretSearch asks the LLM to turn a plain-English question into an
// AISearchFilters object. The model only sees the question and the list of
// status names. Its output is validated strictly and returned for the admin to
// review; it is never executed here and never used as anything but filters.
func (h *Handler) InterpretSearch(c *gin.Context) {
	var req aiInterpretRequest
	if !bindAIToolsJSON(c, &req) {
		return
	}
	question := strings.Join(strings.Fields(req.Question), " ")
	if question == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "question is required"})
		return
	}
	if utf8.RuneCountInString(question) > aiInterpretMaxQuestion {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("question is too long (max %d characters)", aiInterpretMaxQuestion)})
		return
	}
	// "31200", "job #31200", "jobs 31200, 31201": answer deterministically so
	// job numbers match exactly instead of as fuzzy model/serial/text filters.
	if f, ok := jobNumberInterpretFilters(question); ok {
		c.JSON(http.StatusOK, aiInterpretResponse{Filters: f.toFilters(), Explanation: describeSearchFilters(f)})
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
	statuses, err := h.service.repo.AIStatuses(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load statuses"})
		return
	}

	prompt := buildInterpretPrompt(question, statuses, time.Now())
	text, model, err := h.generateOpenRouterTextOnce(c, settings, interpretSystemPrompt(), prompt, 600)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": aiErrorMessage(err)})
		return
	}
	filters, explanation, err := parseInterpretOutput(text, statuses)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, aiInterpretResponse{Filters: filters.toFilters(), Explanation: explanation, Model: model})
}

// parseInterpretOutput validates the LLM's reply: only {"filters", "explanation"}
// at the top level, only whitelisted filter keys, correct types, and values
// that pass the same normalization /search applies.
func parseInterpretOutput(text string, statuses []AIStatusOption) (aiResolvedSearchFilters, string, error) {
	var top map[string]json.RawMessage
	if err := parseStrictLLMJSON(text, &top); err != nil {
		return aiResolvedSearchFilters{}, "", err
	}
	for key := range top {
		if key != "filters" && key != "explanation" {
			return aiResolvedSearchFilters{}, "", fmt.Errorf("AI response had an unexpected field %q; try rephrasing the question", key)
		}
	}
	rawFilters, ok := top["filters"]
	if !ok {
		return aiResolvedSearchFilters{}, "", fmt.Errorf("AI response is missing filters; try rephrasing the question")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(rawFilters, &fields); err != nil || fields == nil {
		return aiResolvedSearchFilters{}, "", fmt.Errorf("AI returned malformed filters (expected an object)")
	}
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if !aiSearchFilterFields[key] {
			return aiResolvedSearchFilters{}, "", fmt.Errorf("AI proposed an unsupported filter field %q; try rephrasing the question", key)
		}
	}
	var proposed AISearchFilters
	if err := decodeStrictJSON(rawFilters, &proposed); err != nil {
		return aiResolvedSearchFilters{}, "", fmt.Errorf("AI returned malformed filters: %s", strings.TrimPrefix(err.Error(), "json: "))
	}
	resolved, err := normalizeSearchFilters(proposed, statuses)
	if err != nil {
		return aiResolvedSearchFilters{}, "", fmt.Errorf("AI proposed invalid filters: %s", err.Error())
	}

	var explanation string
	if raw, ok := top["explanation"]; ok {
		_ = json.Unmarshal(raw, &explanation)
	}
	explanation = strings.Join(strings.Fields(explanation), " ")
	if r := []rune(explanation); len(r) > aiInterpretMaxExplanation {
		explanation = string(r[:aiInterpretMaxExplanation]) + "…"
	}
	if explanation == "" {
		explanation = describeSearchFilters(resolved)
	}
	return resolved, explanation, nil
}

func interpretSystemPrompt() string {
	return "You convert a repair shop admin's search question into a JSON filter object for a job search. " +
		"You never write SQL and never see customer data. " +
		"Respond with STRICT JSON only (no prose, no markdown) of the form " +
		`{"filters":{...},"explanation":"one short sentence describing how you understood the question"}. ` +
		"Allowed filter keys (omit any you do not need; no other keys are allowed):\n" +
		`- "job_ids": array of exact job numbers (integers), e.g. "job 31200" = [31200]; ALWAYS use this for job numbers, never "text", "model" or "serial"\n` +
		`- "job_suffix": digits the job number ends with, e.g. "jobs ending in 200" = "200"\n` +
		`- "text": free text matched against customer name, equipment, brand, model, serial\n` +
		`- "customer_name": part of the customer's name\n` +
		`- "model": part of the model number\n` +
		`- "serial": part of the serial number\n` +
		`- "brand": brand name, e.g. "Yamaha"\n` +
		`- "equipment": equipment type, e.g. "receiver", "turntable"\n` +
		`- "statuses": array of status names, ONLY from the provided list\n` +
		`- "warranty": "any" (default), "only" (warranty / come-back jobs only) or "exclude"\n` +
		`- "include_linked": true to also show each job's original job and its warranty follow-ups together\n` +
		`- "min_units": integer, only customers who have at least this many jobs/units (e.g. "customers with multiple units" = 2)\n` +
		`- "min_model_jobs": integer, only models that appear on at least this many jobs\n` +
		`- "min_serial_jobs": integer, only serial numbers seen on at least this many jobs (repeat repairs of the same unit = 2)\n` +
		`- "created_from", "created_to": dates "YYYY-MM-DD" (inclusive) for when the job was created\n` +
		`- "group_by": "none", "customer", "model" or "serial"\n` +
		`- "limit": integer up to 200\n` +
		"Prefer group_by \"customer\" for questions about customers with several units, \"model\" for other units of the same model, " +
		"and \"serial\" for repeat repairs of the same unit."
}

// buildInterpretPrompt passes only the question, today's date and the status
// names. No customer, job or contact data is sent to the model.
func buildInterpretPrompt(question string, statuses []AIStatusOption, now time.Time) string {
	loc, err := time.LoadLocation("America/Toronto")
	if err == nil {
		now = now.In(loc)
	}
	names := make([]string, 0, len(statuses))
	for _, s := range statuses {
		names = append(names, s.Name)
	}
	var b strings.Builder
	b.WriteString("Today's date: " + now.Format("2006-01-02") + "\n")
	b.WriteString("Available statuses: " + strings.Join(names, ", ") + "\n\n")
	b.WriteString("Question: " + question + "\n")
	return b.String()
}

// describeSearchFilters is the fallback explanation when the model gives none.
func describeSearchFilters(f aiResolvedSearchFilters) string {
	parts := describeJobFilters(f)
	add := func(label, v string) {
		if v != "" {
			parts = append(parts, fmt.Sprintf("%s %q", label, v))
		}
	}
	add("matching", f.Text)
	add("customer", f.CustomerName)
	add("model", f.Model)
	add("serial", f.Serial)
	add("brand", f.Brand)
	add("equipment", f.Equipment)
	if len(f.StatusNames) > 0 {
		parts = append(parts, "status "+strings.Join(f.StatusNames, " or "))
	}
	switch f.Warranty {
	case aiWarrantyOnly:
		parts = append(parts, "warranty jobs only")
	case aiWarrantyExclude:
		parts = append(parts, "excluding warranty jobs")
	}
	if f.IncludeLinked {
		parts = append(parts, "with linked original/warranty jobs")
	}
	if f.MinUnits > 0 {
		parts = append(parts, fmt.Sprintf("customers with at least %d jobs", f.MinUnits))
	}
	if f.MinModelJobs > 0 {
		parts = append(parts, fmt.Sprintf("models on at least %d jobs", f.MinModelJobs))
	}
	if f.MinSerialJobs > 0 {
		parts = append(parts, fmt.Sprintf("serials on at least %d jobs", f.MinSerialJobs))
	}
	if f.CreatedFrom != "" || f.CreatedTo != "" {
		parts = append(parts, fmt.Sprintf("created %s to %s", orDash(f.CreatedFrom), orDash(f.CreatedTo)))
	}
	if f.GroupBy != aiGroupNone {
		parts = append(parts, "grouped by "+f.GroupBy)
	}
	if len(parts) == 0 {
		return "All jobs, newest first."
	}
	return "Jobs " + strings.Join(parts, ", ") + "."
}

func orDash(s string) string {
	if s == "" {
		return "…"
	}
	return s
}

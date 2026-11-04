package workorders

import (
	"errors"
	"net/http"
	"strings"

	"humphreys/api/internal/domain"

	"github.com/gin-gonic/gin"
)

// Allowed email draft types. The LLM drafts (never sends) a customer email in
// one of these neutral styles; "custom" leans on the admin's extra notes.
const (
	emailDraftTypeEstimate = "estimate"
	emailDraftTypeProgress = "progress_update"
	emailDraftTypePickup   = "ready_for_pickup"
	emailDraftTypeCustom   = "custom"
)

// emailDraftRequest accepts the legacy single work_order_id and/or
// work_order_ids (1..10 jobs, all for the same customer).
type emailDraftRequest struct {
	WorkOrderID  int    `json:"work_order_id"`
	WorkOrderIDs []int  `json:"work_order_ids"`
	Type         string `json:"type"`
	Notes        string `json:"notes"`
}

// emailDraftResponse never carries the customer's full email: only a masked
// hint ("j***@gmail.com") and whether one is on file.
type emailDraftResponse struct {
	Subject           string `json:"subject"`
	Body              string `json:"body"`
	Type              string `json:"type"`
	Model             string `json:"model"`
	WorkOrderIDs      []int  `json:"work_order_ids"`
	CustomerName      string `json:"customer_name"`
	RecipientHint     string `json:"recipient_hint"`
	HasRecipientEmail bool   `json:"has_recipient_email"`
}

type emailDraftLLMResponse struct {
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

// normalizeEmailDraftType maps the UI's type pills to a canonical value and
// reports whether it is one we support.
func normalizeEmailDraftType(raw string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case emailDraftTypeEstimate:
		return emailDraftTypeEstimate, true
	case emailDraftTypeProgress, "progress", "progress update", "progress-update":
		return emailDraftTypeProgress, true
	case emailDraftTypePickup, "pickup", "ready for pickup", "ready-for-pickup", "ready_for_pickup_reminder":
		return emailDraftTypePickup, true
	case emailDraftTypeCustom:
		return emailDraftTypeCustom, true
	default:
		return "", false
	}
}

// EmailDraft asks the LLM to draft a customer email (subject + body) for one
// job. It never sends anything and never passes the customer's email or phone
// to the model.
func (h *Handler) EmailDraft(c *gin.Context) {
	var req emailDraftRequest
	if !bindAIToolsJSON(c, &req) {
		return
	}
	if err := checkTextLength("notes", strings.TrimSpace(req.Notes)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ids, err := emailDraftJobIDs(req.WorkOrderID, req.WorkOrderIDs)
	if err != nil {
		respondEmailJobsError(c, err)
		return
	}
	draftType, ok := normalizeEmailDraftType(req.Type)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "type must be estimate, progress_update, ready_for_pickup, or custom"})
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

	items, repairLogs, err := h.loadEmailDraftJobs(c.Request.Context(), ids)
	if err != nil {
		respondEmailJobsError(c, err)
		return
	}

	systemPrompt := emailDraftSystemPrompt()
	prompt := buildMultiJobEmailDraftPrompt(draftType, strings.TrimSpace(req.Notes), items, repairLogs)
	text, model, err := h.generateOpenRouterTextOnce(c, settings, systemPrompt, prompt, 1500)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": aiErrorMessage(err)})
		return
	}

	var parsed emailDraftLLMResponse
	if err := parseStrictLLMJSON(text, &parsed); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	subject := strings.TrimSpace(parsed.Subject)
	body := strings.TrimSpace(parsed.Body)
	if subject == "" || body == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI returned an incomplete draft"})
		return
	}

	hint := maskEmailHint(stringValue(items[0].Customer.Email))
	c.JSON(http.StatusOK, emailDraftResponse{
		Subject:           subject,
		Body:              body,
		Type:              draftType,
		Model:             model,
		WorkOrderIDs:      ids,
		CustomerName:      aiCustomerName(items[0]),
		RecipientHint:     hint,
		HasRecipientEmail: hint != "",
	})
}

func respondEmailJobsError(c *gin.Context, err error) {
	var jobsErr *emailDraftJobsError
	if errors.As(err, &jobsErr) {
		c.JSON(jobsErr.status, gin.H{"error": jobsErr.msg})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load jobs"})
}

func emailDraftSystemPrompt() string {
	return "You draft customer emails for a repair shop. You never send email; a human reviews and sends it. " +
		"Write plain, neutral, friendly wording. Do not invent prices or parts — only use amounts explicitly provided in the notes or line items. " +
		"Do not mention internal staff names or internal process details. " +
		"Sign the email as \"Humphreys Stereo and TV\". " +
		"Respond with STRICT JSON only (no prose, no markdown fences) of the form " +
		`{"subject":"...","body":"..."}.`
}

func emailDraftTypeGuidance(draftType string) string {
	switch draftType {
	case emailDraftTypeEstimate:
		return "Purpose: share an estimate for the work. Summarize the diagnosed problem and any proposed work. Only state prices that appear in the line items or notes."
	case emailDraftTypeProgress:
		return "Purpose: a progress update. Briefly describe what has been done so far and what remains, based on the repair logs."
	case emailDraftTypePickup:
		return "Purpose: a ready-for-pickup reminder. Let the customer know the item is finished and ready to be collected."
	default:
		return "Purpose: a custom message. Follow the extra notes closely."
	}
}

// buildEmailDraftPrompt gathers the job context the model may use. It passes the
// customer's display name only — never their email or phone.
// The multi-job builder (ai_tools_email_jobs.go) handles a single job too.
func buildEmailDraftPrompt(draftType, notes string, item domain.WorkOrderDetail, repairLogs []domain.RepairLog) string {
	return buildMultiJobEmailDraftPrompt(draftType, notes, []domain.WorkOrderDetail{item}, [][]domain.RepairLog{repairLogs})
}

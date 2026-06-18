package workorders

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/modules/aisettings"

	"github.com/gin-gonic/gin"
	"github.com/jellydator/ttlcache/v3"
)

type aiSummaryCacheItem struct {
	Summary     string
	Model       string
	GeneratedAt string
}

type openRouterMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openRouterChatRequest struct {
	Model       string              `json:"model"`
	Messages    []openRouterMessage `json:"messages"`
	Temperature float64             `json:"temperature"`
	MaxTokens   int                 `json:"max_tokens"`
}

type openRouterChatResponse struct {
	Choices []struct {
		Text    string `json:"text"`
		Message struct {
			Content any `json:"content"`
			Refusal any `json:"refusal"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type generateAIMarkdownRequest struct {
	Field           string `json:"field" binding:"required"`
	Prompt          string `json:"prompt" binding:"required"`
	CurrentMarkdown string `json:"current_markdown"`
}

func getOpenRouterModel() string {
	value := strings.TrimSpace(os.Getenv("OPENROUTER_MODEL"))
	if value == "" {
		return aisettings.DefaultOpenRouterModel
	}
	return value
}

func (h *Handler) GenerateAISummary(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}
	cacheKey := fmt.Sprintf("work-order:%d", referenceID)
	if h.aiSummaryCache != nil {
		if cached := h.aiSummaryCache.Get(cacheKey); cached != nil {
			value := cached.Value()
			c.JSON(http.StatusOK, gin.H{
				"summary":      value.Summary,
				"model":        value.Model,
				"generated_at": value.GeneratedAt,
			})
			return
		}
	}
	settings, err := h.getAISettings(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI settings"})
		return
	}
	if strings.TrimSpace(settings.OpenRouterAPIKey) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "OPENROUTER_API_KEY is not configured"})
		return
	}

	item, err := h.service.GetWorkOrderDetail(c.Request.Context(), referenceID)
	if errors.Is(err, ErrWorkOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch work order"})
		return
	}
	repairLogs, err := h.service.ListRepairLogs(c.Request.Context(), referenceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch repair logs"})
		return
	}
	partsRequests, err := h.service.ListPartsPurchaseRequests(c.Request.Context(), referenceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch parts purchase requests"})
		return
	}
	if shouldUseSparseSummary(item, repairLogs, partsRequests) {
		summary := buildSparseSummary(item, partsRequests)
		generatedAt := time.Now().UTC().Format(time.RFC3339)
		if h.aiSummaryCache != nil {
			h.aiSummaryCache.Set(cacheKey, aiSummaryCacheItem{
				Summary:     summary,
				Model:       "system",
				GeneratedAt: generatedAt,
			}, ttlcache.DefaultTTL)
		}
		c.JSON(http.StatusOK, gin.H{
			"summary":      summary,
			"model":        "system",
			"generated_at": generatedAt,
		})
		return
	}

	summary, err := h.generateOpenRouterSummaryOnce(c, settings, buildWorkOrderAISummaryPrompt(settings.WorkOrderSummaryPrompt, item, repairLogs, partsRequests))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed"})
		return
	}

	generatedAt := time.Now().UTC().Format(time.RFC3339)
	if h.aiSummaryCache != nil {
		h.aiSummaryCache.Set(cacheKey, aiSummaryCacheItem{
			Summary:     summary,
			Model:       settings.OpenRouterModel,
			GeneratedAt: generatedAt,
		}, ttlcache.DefaultTTL)
	}

	c.JSON(http.StatusOK, gin.H{
		"summary":      summary,
		"model":        settings.OpenRouterModel,
		"generated_at": generatedAt,
	})
}

func (h *Handler) GenerateAIWorkDoneFromRepairLogs(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}
	settings, err := h.getAISettings(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI settings"})
		return
	}
	if strings.TrimSpace(settings.OpenRouterAPIKey) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "OPENROUTER_API_KEY is not configured"})
		return
	}

	_, err = h.service.GetWorkOrderDetail(c.Request.Context(), referenceID)
	if errors.Is(err, ErrWorkOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch work order"})
		return
	}
	repairLogs, err := h.service.ListRepairLogs(c.Request.Context(), referenceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch repair logs"})
		return
	}

	workDone, err := h.generateOpenRouterSummaryOnce(c, settings, buildWorkDoneFromRepairLogsPrompt(settings.WorkDonePrompt, repairLogs))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"work_done":    workDone,
		"model":        settings.OpenRouterModel,
		"generated_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) GenerateAIMarkdownWithoutWorkOrder(c *gin.Context) {
	h.generateAIMarkdown(c, nil)
}

func (h *Handler) GenerateAIMarkdown(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}
	h.generateAIMarkdown(c, &referenceID)
}

func (h *Handler) generateAIMarkdown(c *gin.Context, referenceID *int) {
	var req generateAIMarkdownRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	field := strings.TrimSpace(req.Field)
	if !isAIMarkdownField(field) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid field"})
		return
	}
	if strings.TrimSpace(req.Prompt) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "prompt is required"})
		return
	}

	settings, err := h.getAISettings(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI settings"})
		return
	}
	if strings.TrimSpace(settings.OpenRouterAPIKey) == "" {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "OPENROUTER_API_KEY is not configured"})
		return
	}

	var item *domain.WorkOrderDetail
	var repairLogs []domain.RepairLog
	var partsRequests []domain.PartsPurchaseRequest
	if referenceID != nil {
		detail, err := h.service.GetWorkOrderDetail(c.Request.Context(), *referenceID)
		if errors.Is(err, ErrWorkOrderNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch work order"})
			return
		}
		item = &detail
		repairLogs, err = h.service.ListRepairLogs(c.Request.Context(), *referenceID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch repair logs"})
			return
		}
		partsRequests, err = h.service.ListPartsPurchaseRequests(c.Request.Context(), *referenceID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch parts purchase requests"})
			return
		}
	}

	generated, err := h.generateOpenRouterTextOnce(
		c,
		settings,
		aiMarkdownSystemPrompt(field),
		buildAIMarkdownPrompt(field, strings.TrimSpace(req.Prompt), req.CurrentMarkdown, item, repairLogs, partsRequests),
		700,
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"markdown":     generated,
		"model":        settings.OpenRouterModel,
		"generated_at": time.Now().UTC().Format(time.RFC3339),
	})
}

func (h *Handler) getAISettings(c *gin.Context) (aisettings.Settings, error) {
	if h.aiSettings != nil {
		return h.aiSettings.Get(c.Request.Context())
	}
	key := strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY"))
	return aisettings.Settings{
		OpenRouterAPIKey:       key,
		HasOpenRouterAPIKey:    key != "",
		OpenRouterModel:        getOpenRouterModel(),
		WorkOrderSummaryPrompt: aisettings.DefaultWorkOrderSummaryPrompt,
		WorkDonePrompt:         aisettings.DefaultWorkDonePrompt,
	}, nil
}

func (h *Handler) generateOpenRouterSummaryOnce(c *gin.Context, settings aisettings.Settings, prompt string) (string, error) {
	return h.generateOpenRouterTextOnce(c, settings, aisettings.DefaultSystemPrompt, prompt, 320)
}

func (h *Handler) generateOpenRouterTextOnce(c *gin.Context, settings aisettings.Settings, systemPrompt string, prompt string, maxTokens int) (string, error) {
	payload := openRouterChatRequest{
		Model: settings.OpenRouterModel,
		Messages: []openRouterMessage{
			{
				Role:    "system",
				Content: systemPrompt,
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
		Temperature: 0.2,
		MaxTokens:   maxTokens,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, "https://openrouter.ai/api/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+settings.OpenRouterAPIKey)
	req.Header.Set("HTTP-Referer", "https://humphreys.local")
	req.Header.Set("X-Title", "Humphreys Work Orders")

	res, err := h.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	responseBody, err := io.ReadAll(res.Body)
	if err != nil {
		return "", err
	}

	var decoded openRouterChatResponse
	if err := json.Unmarshal(responseBody, &decoded); err != nil {
		return "", fmt.Errorf("invalid provider response: %w", err)
	}
	if res.StatusCode >= 300 {
		if decoded.Error != nil && decoded.Error.Message != "" {
			return "", fmt.Errorf("provider error: %s", decoded.Error.Message)
		}
		return "", fmt.Errorf("provider returned status %d", res.StatusCode)
	}
	if len(decoded.Choices) == 0 {
		return "", errors.New("provider returned no choices")
	}
	text := strings.TrimSpace(extractMessageText(decoded.Choices[0].Message.Content))
	if text == "" {
		text = strings.TrimSpace(decoded.Choices[0].Text)
	}
	if text == "" {
		text = strings.TrimSpace(extractMessageText(decoded.Choices[0].Message.Refusal))
	}
	if text == "" {
		return "", fmt.Errorf("provider returned an empty summary (finish_reason=%s)", decoded.Choices[0].FinishReason)
	}
	return text, nil
}

func isAIMarkdownField(field string) bool {
	switch field {
	case "problem_description", "work_done", "repair_log":
		return true
	default:
		return false
	}
}

func aiMarkdownSystemPrompt(field string) string {
	if field == "repair_log" {
		return "You help technicians write internal repair log entries. Write concise, factual markdown. Preserve technical details, parts, measurements, symptoms, and tests. Do not invent facts. Return only the markdown content to insert."
	}
	return "You help write work order markdown. Write concise, factual, useful text based on the user's instruction and available work order context. Do not invent facts. Return only the markdown content to insert."
}

func buildAIMarkdownPrompt(field string, userPrompt string, currentMarkdown string, item *domain.WorkOrderDetail, repairLogs []domain.RepairLog, partsRequests []domain.PartsPurchaseRequest) string {
	var b strings.Builder
	b.WriteString("Field: ")
	b.WriteString(field)
	b.WriteString("\n\nUser request:\n")
	b.WriteString(userPrompt)
	b.WriteString("\n\nCurrent markdown in this field:\n")
	if strings.TrimSpace(currentMarkdown) == "" {
		b.WriteString("None")
	} else {
		b.WriteString(strings.TrimSpace(currentMarkdown))
	}

	if item != nil {
		b.WriteString("\n\nWork order context:\n")
		b.WriteString(buildAIMarkdownWorkOrderContext(*item, repairLogs, partsRequests))
	}

	b.WriteString("\n\nOutput requirements:\n")
	b.WriteString("- Return only the new markdown text to insert above the existing content.\n")
	b.WriteString("- Do not repeat the current markdown unless the user explicitly asks to rewrite it.\n")
	b.WriteString("- Do not include explanations, labels, or commentary outside the generated content.\n")
	if field == "work_done" {
		b.WriteString("- Prefer customer-facing completed-work language.\n")
	}
	if field == "repair_log" {
		b.WriteString("- Prefer technician-facing repair log language with concrete actions taken and observations.\n")
	}
	return b.String()
}

func buildAIMarkdownWorkOrderContext(item domain.WorkOrderDetail, repairLogs []domain.RepairLog, partsRequests []domain.PartsPurchaseRequest) string {
	customerName := strings.TrimSpace(strings.Join([]string{orEmpty(item.Customer.FirstName), orEmpty(item.Customer.LastName)}, " "))
	data := fmt.Sprintf(`- Reference ID: %d
- Status: %s
- Customer Name: %s
- Equipment Type: %s
- Equipment Brand: %s
- Model: %s
- Serial: %s
- Problem Description: %s
- Work Done: %s
- Technicians: %s
- Repair Logs Summary: %s
- Parts Purchase Requests: %s
`,
		item.ReferenceID,
		orUnknown(item.StatusName),
		orUnknownString(customerName),
		orUnknown(item.ItemName),
		orUnknown(joinOrEmpty(item.BrandNames)),
		orUnknown(item.ModelNumber),
		orUnknown(item.SerialNumber),
		orUnknown(item.ProblemDescription),
		orUnknown(item.WorkDone),
		orUnknown(joinOrEmpty(item.WorkerNames)),
		summarizeRepairLogs(repairLogs),
		summarizePartsRequests(partsRequests),
	)
	return data
}

func buildWorkDoneFromRepairLogsPrompt(template string, repairLogs []domain.RepairLog) string {
	logSummary := summarizeRepairLogs(repairLogs)
	return strings.ReplaceAll(template, "{{repair_logs_summary}}", logSummary)
}

func extractMessageText(content any) string {
	if direct, ok := content.(string); ok {
		return direct
	}
	if content == nil {
		return ""
	}
	parts, ok := content.([]any)
	if ok {
		segments := make([]string, 0, len(parts))
		for _, raw := range parts {
			if text := strings.TrimSpace(extractMessageText(raw)); text != "" {
				segments = append(segments, text)
			}
		}
		return strings.Join(segments, "\n")
	}

	entry, ok := content.(map[string]any)
	if !ok {
		return ""
	}

	// Common OpenAI/OpenRouter content part patterns.
	for _, key := range []string{"text", "content", "output_text", "refusal", "reasoning"} {
		value, exists := entry[key]
		if !exists {
			continue
		}
		if text := strings.TrimSpace(extractMessageText(value)); text != "" {
			return text
		}
	}

	return ""
}

func buildWorkOrderAISummaryPrompt(template string, item domain.WorkOrderDetail, repairLogs []domain.RepairLog, partsRequests []domain.PartsPurchaseRequest) string {
	customerName := strings.TrimSpace(strings.Join([]string{orEmpty(item.Customer.FirstName), orEmpty(item.Customer.LastName)}, " "))
	if customerName == "" {
		customerName = "-"
	}
	homePhone := cleanPhone(item.Customer.HomePhone)
	workPhone := cleanPhone(item.Customer.WorkPhone)
	phone := "-"
	switch {
	case homePhone != "" && workPhone != "":
		phone = homePhone + " / " + workPhone
	case homePhone != "":
		phone = homePhone
	case workPhone != "":
		phone = workPhone
	}
	email := orUnknown(item.Customer.Email)
	repairLogSummary := summarizeRepairLogs(repairLogs)
	pendingActions := summarizeActionsRequired(item.StatusName, partsRequests)
	partsRequestSummary := summarizePartsRequests(partsRequests)

	data := fmt.Sprintf(`Work order data:
- Reference ID: %d
- Status: %s
- Customer Name: %s
- Customer Phone: %s
- Customer Email: %s
- Equipment Type: %s
- Equipment Brand: %s
- Model: %s
- Serial: %s
- Problem Description: %s
- Work Done: %s
- Technicians: %s
- Parts Total: %s
- Labour Total: %s
- Delivery Total: %s
- Deposit: %.2f
- Line Items Count: %d
- Payment Methods: %s
- Repair Logs Summary: %s
- Parts Purchase Requests: %s
- Actions Required: %s
`,
		item.ReferenceID,
		orUnknown(item.StatusName),
		orUnknownString(customerName),
		orUnknownString(phone),
		email,
		orUnknown(item.ItemName),
		orUnknown(joinOrEmpty(item.BrandNames)),
		orUnknown(item.ModelNumber),
		orUnknown(item.SerialNumber),
		orUnknown(item.ProblemDescription),
		orUnknown(item.WorkDone),
		orUnknown(joinOrEmpty(item.WorkerNames)),
		formatMoney(item.PartsTotal),
		formatMoney(item.LabourTotal),
		formatMoney(item.DeliveryTotal),
		item.Deposit,
		len(item.LineItems),
		orUnknown(joinOrEmpty(item.PaymentMethodNames)),
		repairLogSummary,
		partsRequestSummary,
		pendingActions,
	)
	return strings.ReplaceAll(template, "{{work_order_data}}", data)
}

func summarizeRepairLogs(logs []domain.RepairLog) string {
	if len(logs) == 0 {
		return "None"
	}
	limit := 4
	if len(logs) < limit {
		limit = len(logs)
	}
	entries := make([]string, 0, limit)
	for i := 0; i < limit; i++ {
		log := logs[i]
		tech := "Unknown tech"
		if log.CreatedByName != nil && strings.TrimSpace(*log.CreatedByName) != "" {
			tech = strings.TrimSpace(*log.CreatedByName)
		}
		details := strings.TrimSpace(log.Details)
		if details == "" {
			details = "updated repair notes"
		}
		entries = append(entries, fmt.Sprintf("%s did: %s", tech, details))
	}
	return strings.Join(entries, " | ")
}

func summarizePartsRequests(parts []domain.PartsPurchaseRequest) string {
	if len(parts) == 0 {
		return "None"
	}
	entries := make([]string, 0, len(parts))
	for _, req := range parts {
		name := strings.TrimSpace(req.ItemName)
		if name == "" {
			name = "Unnamed part"
		}
		entries = append(entries, fmt.Sprintf("%s x%d (%s)", name, req.Quantity, strings.TrimSpace(req.Status)))
	}
	return strings.Join(entries, "; ")
}

func summarizeActionsRequired(statusName *string, parts []domain.PartsPurchaseRequest) string {
	actions := make([]string, 0, 3)
	for _, req := range parts {
		status := strings.ToLower(strings.TrimSpace(req.Status))
		if status == "waiting_approval" {
			actions = append(actions, "Parts purchase request pending approval")
			break
		}
	}
	for _, req := range parts {
		status := strings.ToLower(strings.TrimSpace(req.Status))
		if status == "ordered" {
			actions = append(actions, "Awaiting ordered parts")
			break
		}
	}
	status := strings.ToLower(strings.TrimSpace(orUnknown(statusName)))
	if strings.Contains(status, "finished") {
		actions = append(actions, "Awaiting customer pickup")
	}
	if len(actions) == 0 {
		return "None"
	}
	return strings.Join(actions, "; ")
}

func orEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func cleanPhone(value *string) string {
	return strings.TrimSpace(orEmpty(value))
}

func orUnknown(value *string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return "Unknown"
	}
	return strings.TrimSpace(*value)
}

func orUnknownString(value string) string {
	if strings.TrimSpace(value) == "" || strings.TrimSpace(value) == "-" {
		return "Unknown"
	}
	return strings.TrimSpace(value)
}

func joinOrEmpty(values []string) *string {
	if len(values) == 0 {
		return nil
	}
	joined := strings.TrimSpace(strings.Join(values, ", "))
	if joined == "" {
		return nil
	}
	return &joined
}

func formatMoney(value *float64) string {
	if value == nil {
		return "Unknown"
	}
	return fmt.Sprintf("%.2f CAD", *value)
}

func shouldUseSparseSummary(item domain.WorkOrderDetail, repairLogs []domain.RepairLog, partsRequests []domain.PartsPurchaseRequest) bool {
	customerMissing := item.Customer.CustomerID == nil &&
		strings.TrimSpace(orEmpty(item.Customer.FirstName)) == "" &&
		strings.TrimSpace(orEmpty(item.Customer.LastName)) == "" &&
		strings.TrimSpace(orEmpty(item.Customer.Email)) == "" &&
		strings.TrimSpace(orEmpty(item.Customer.HomePhone)) == "" &&
		strings.TrimSpace(orEmpty(item.Customer.WorkPhone)) == ""
	equipmentMissing := item.ItemID == nil &&
		strings.TrimSpace(orEmpty(item.ItemName)) == "" &&
		len(item.BrandNames) == 0 &&
		strings.TrimSpace(orEmpty(item.ModelNumber)) == "" &&
		strings.TrimSpace(orEmpty(item.SerialNumber)) == ""
	return customerMissing && equipmentMissing && len(repairLogs) == 0 && len(partsRequests) > 0
}

func buildSparseSummary(item domain.WorkOrderDetail, partsRequests []domain.PartsPurchaseRequest) string {
	status := strings.TrimSpace(orUnknown(item.StatusName))
	parts := summarizePartsRequests(partsRequests)
	actions := summarizeActionsRequired(item.StatusName, partsRequests)
	return fmt.Sprintf(
		"Work order **#%d** has limited customer and equipment data. **Status:** %s. **Parts Purchase Requests:** %s. **Actions Required:** %s.",
		item.ReferenceID,
		status,
		parts,
		actions,
	)
}

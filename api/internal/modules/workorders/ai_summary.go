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

	"github.com/gin-gonic/gin"
	"github.com/jellydator/ttlcache/v3"
)

const defaultOpenRouterModel = "google/gemma-3-27b-it:free"

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

func getOpenRouterModel() string {
	value := strings.TrimSpace(os.Getenv("OPENROUTER_MODEL"))
	if value == "" {
		return defaultOpenRouterModel
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
	if strings.TrimSpace(h.openRouterAPIKey) == "" {
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

	summary, err := h.generateOpenRouterSummary(c, buildWorkOrderAISummaryPrompt(item, repairLogs, partsRequests))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to generate AI summary", "detail": err.Error()})
		return
	}

	generatedAt := time.Now().UTC().Format(time.RFC3339)
	if h.aiSummaryCache != nil {
		h.aiSummaryCache.Set(cacheKey, aiSummaryCacheItem{
			Summary:     summary,
			Model:       h.openRouterModel,
			GeneratedAt: generatedAt,
		}, ttlcache.DefaultTTL)
	}

	c.JSON(http.StatusOK, gin.H{
		"summary":      summary,
		"model":        h.openRouterModel,
		"generated_at": generatedAt,
	})
}

func (h *Handler) generateOpenRouterSummary(c *gin.Context, prompt string) (string, error) {
	summary, err := h.generateOpenRouterSummaryOnce(c, prompt)
	if err == nil {
		return summary, nil
	}

	// Some free models occasionally return an empty content payload. Retry once with stricter output guidance.
	retryPrompt := prompt + "\n\nReturn one short natural-language paragraph and do not return an empty response."
	return h.generateOpenRouterSummaryOnce(c, retryPrompt)
}

func (h *Handler) generateOpenRouterSummaryOnce(c *gin.Context, prompt string) (string, error) {
	payload := openRouterChatRequest{
		Model: h.openRouterModel,
		Messages: []openRouterMessage{
			{
				Role:    "system",
				Content: "You summarize technician work orders. Write short, factual natural language. Do not use bullet points.",
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
		Temperature: 0.2,
		MaxTokens:   320,
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
	req.Header.Set("Authorization", "Bearer "+h.openRouterAPIKey)
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

func buildWorkOrderAISummaryPrompt(item domain.WorkOrderDetail, repairLogs []domain.RepairLog, partsRequests []domain.PartsPurchaseRequest) string {
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
	if ext := strings.TrimSpace(orEmpty(item.Customer.Extension)); ext != "" {
		phone = strings.TrimSpace(phone + " ext " + ext)
	}
	email := orUnknown(item.Customer.Email)
	repairLogSummary := summarizeRepairLogs(repairLogs)
	pendingActions := summarizeActionsRequired(item.StatusName, partsRequests)
	partsRequestSummary := summarizePartsRequests(partsRequests)

	return fmt.Sprintf(`Write a single natural-language technician summary in 60 words max.
Use markdown and bold important fields with **...** (customer name, phone, email, equipment brand/type/model, required actions).
Do not use bullet points, numbered lists, markdown headings, or filler words.
Must include: customer name, phone, email, equipment brand, equipment type, model (if present).
Must include: repair logs summary with technician name(s) and key work done.
Must include: actions required (e.g., pending parts approval, awaiting customer pickup), if any.
Include only facts from provided data. If missing, say "Unknown".

Work order data:
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

package emailtemplates

import (
	"errors"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"humphreys/api/internal/mailer"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	service     *Service
	emailClient *mailer.GraphClient
}

type updateTemplateRequest struct {
	SubjectTemplate string `json:"subject_template" binding:"required"`
	BodyTemplate    string `json:"body_template" binding:"required"`
}

type sendTestTemplateRequest struct {
	To              string `json:"to" binding:"required"`
	SubjectTemplate string `json:"subject_template" binding:"required"`
	BodyTemplate    string `json:"body_template" binding:"required"`
}

func New(db *pgxpool.Pool) *Handler {
	httpClient := &http.Client{Timeout: 25 * time.Second}
	return &Handler{
		service:     NewService(NewRepository(db)),
		emailClient: mailer.NewGraphClientFromEnv(httpClient),
	}
}

func (h *Handler) List(c *gin.Context) {
	items, err := h.service.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load email templates"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) Update(c *gin.Context) {
	var req updateTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	item, err := h.service.Update(c.Request.Context(), c.Param("key"), req.SubjectTemplate, req.BodyTemplate)
	if errors.Is(err, ErrUnknownTemplate) {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrSubjectRequired) || errors.Is(err, ErrBodyRequired) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update email template"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) SendTest(c *gin.Context) {
	var req sendTestTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	to := strings.TrimSpace(req.To)
	if _, err := mail.ParseAddress(to); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email address"})
		return
	}

	subject := strings.TrimSpace(req.SubjectTemplate)
	body := strings.TrimSpace(req.BodyTemplate)
	if subject == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": ErrSubjectRequired.Error()})
		return
	}
	if body == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": ErrBodyRequired.Error()})
		return
	}

	msg := mailer.Message{
		To:      to,
		Subject: "[Test] " + renderTestTemplateString(subject),
		Body:    renderTestTemplateString(body),
	}
	if err := h.emailClient.Send(c.Request.Context(), msg); err != nil {
		if errors.Is(err, mailer.ErrNotConfigured) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "email sending is not configured"})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": "failed to send test email", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"sent": true})
}

func renderTestTemplateString(template string) string {
	return templateTokenPattern.ReplaceAllStringFunc(template, func(match string) string {
		parts := templateTokenPattern.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		if value, ok := testTemplateValues[normalizeTemplateTokenKey(parts[1])]; ok {
			return value
		}
		return match
	})
}

func normalizeTemplateTokenKey(value string) string {
	return strings.ReplaceAll(strings.TrimSpace(value), `\`, "")
}

var templateTokenPattern = regexp.MustCompile(`\{\{\s*([^{}]+?)\s*\}\}`)

var testTemplateValues = map[string]string{
	"reference_id":         "12345",
	"customer_name":        "Test Customer",
	"customer.first_name":  "Test",
	"customer.last_name":   "Customer",
	"customer.email":       "customer@example.com",
	"customer.home_phone":  "416-555-0100",
	"customer.work_phone":  "416-555-0101",
	"equipment_name":       "Sony Receiver STR-DH190",
	"item_name":            "Receiver",
	"brand_names":          "Sony",
	"model_number":         "STR-DH190",
	"serial_number":        "SN123456",
	"status_name":          "Completed",
	"job_type_name":        "Repair",
	"location_code":        "A-1",
	"problem_description":  "No audio output from left channel.",
	"work_done":            "Cleaned controls and replaced speaker relay.",
	"parts_total":          "$35.00",
	"delivery_total":       "$0.00",
	"labour_total":         "$120.00",
	"total_before_deposit": "$175.15",
	"deposit":              "$25.00",
	"total_payable":        "$150.15",
	"payment_method_names": "Visa",
	"worker_names":         "Technician",
}

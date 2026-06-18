package aisettings

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	service *Service
}

type updateSettingsRequest struct {
	OpenRouterAPIKey       *string `json:"openrouter_api_key"`
	OpenRouterModel        string  `json:"openrouter_model" binding:"required"`
	WorkOrderSummaryPrompt string  `json:"work_order_summary_prompt" binding:"required"`
	WorkDonePrompt         string  `json:"work_done_prompt" binding:"required"`
}

func New(db *pgxpool.Pool) *Handler {
	return &Handler{service: NewService(NewRepository(db))}
}

func (h *Handler) Get(c *gin.Context) {
	item, err := h.service.Get(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI settings"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) Update(c *gin.Context) {
	var req updateSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	key := ""
	updateKey := false
	if req.OpenRouterAPIKey != nil {
		key = *req.OpenRouterAPIKey
		updateKey = true
	}

	item, err := h.service.Update(c.Request.Context(), UpdateInput{
		OpenRouterAPIKey:       key,
		UpdateOpenRouterAPIKey: updateKey,
		OpenRouterModel:        req.OpenRouterModel,
		WorkOrderSummaryPrompt: req.WorkOrderSummaryPrompt,
		WorkDonePrompt:         req.WorkDonePrompt,
	})
	if isValidationError(err) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update AI settings"})
		return
	}
	c.JSON(http.StatusOK, item)
}

func isValidationError(err error) bool {
	return errors.Is(err, ErrModelRequired) ||
		errors.Is(err, ErrSummaryPromptRequired) ||
		errors.Is(err, ErrWorkDonePromptRequired) ||
		errors.Is(err, ErrSummaryPlaceholder) ||
		errors.Is(err, ErrWorkDonePlaceholder)
}

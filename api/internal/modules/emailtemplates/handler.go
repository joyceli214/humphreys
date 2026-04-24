package emailtemplates

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	service *Service
}

type updateTemplateRequest struct {
	SubjectTemplate string `json:"subject_template" binding:"required"`
	BodyTemplate    string `json:"body_template" binding:"required"`
}

func New(db *pgxpool.Pool) *Handler {
	return &Handler{service: NewService(NewRepository(db))}
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

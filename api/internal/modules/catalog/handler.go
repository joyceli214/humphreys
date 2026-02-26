package catalog

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	service *Service
}

func New(db *pgxpool.Pool) *Handler {
	return &Handler{
		service: NewService(NewRepository(db)),
	}
}

func NewWithService(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) ListResources(c *gin.Context) {
	resources, err := h.service.ListResources(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list resources"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": resources})
}

func (h *Handler) ListPermissions(c *gin.Context) {
	permissions, err := h.service.ListPermissions(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list permissions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": permissions})
}

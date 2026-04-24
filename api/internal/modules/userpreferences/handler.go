package userpreferences

import (
	"encoding/json"
	"net/http"

	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	repo *Repository
}

func New(db *pgxpool.Pool) *Handler {
	return &Handler{repo: NewRepository(db)}
}

type savePreferenceRequest struct {
	Value json.RawMessage `json:"value" binding:"required"`
}

func (h *Handler) Get(c *gin.Context) {
	claims, ok := middleware.Claims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing auth context"})
		return
	}

	value, found, err := h.repo.Get(c.Request.Context(), claims.UserID, c.Param("key"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load preference"})
		return
	}
	if !found {
		c.JSON(http.StatusOK, gin.H{"value": nil})
		return
	}
	c.JSON(http.StatusOK, gin.H{"value": value})
}

func (h *Handler) Save(c *gin.Context) {
	claims, ok := middleware.Claims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing auth context"})
		return
	}

	var req savePreferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil || !json.Valid(req.Value) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}

	value, err := h.repo.Upsert(c.Request.Context(), claims.UserID, c.Param("key"), req.Value)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save preference"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"value": value})
}

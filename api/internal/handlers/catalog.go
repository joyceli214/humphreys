package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) ListResources(c *gin.Context) {
	resources, err := h.Store.ListResources(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list resources"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": resources})
}

func (h *Handler) ListPermissions(c *gin.Context) {
	permissions, err := h.Store.ListPermissions(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list permissions"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": permissions})
}

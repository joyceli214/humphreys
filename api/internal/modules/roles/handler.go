package roles

import (
	"errors"
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

type rolePayload struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

type rolePermissionsPayload struct {
	PermissionIDs []string `json:"permission_ids"`
}

func (h *Handler) ListRoles(c *gin.Context) {
	roles, err := h.service.ListRoles(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list roles"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": roles})
}

func (h *Handler) CreateRole(c *gin.Context) {
	var req rolePayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	role, err := h.service.CreateRole(c.Request.Context(), req.Name, req.Description)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, role)
}

func (h *Handler) GetRole(c *gin.Context) {
	role, err := h.service.GetRole(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}
	c.JSON(http.StatusOK, role)
}

func (h *Handler) UpdateRole(c *gin.Context) {
	var req rolePayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	role, err := h.service.UpdateRole(c.Request.Context(), c.Param("id"), req.Name, req.Description)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, role)
}

func (h *Handler) DeleteRole(c *gin.Context) {
	if err := h.service.DeleteRole(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) SetRolePermissions(c *gin.Context) {
	var req rolePermissionsPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	role, err := h.service.SetRolePermissions(c.Request.Context(), c.Param("id"), req.PermissionIDs)
	if errors.Is(err, ErrRoleNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "role not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, role)
}

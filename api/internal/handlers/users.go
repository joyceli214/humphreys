package handlers

import (
	"net/http"
	"strconv"

	"humphreys/api/internal/security"

	"github.com/gin-gonic/gin"
)

type createUserRequest struct {
	Email    string   `json:"email" binding:"required,email"`
	Password string   `json:"password" binding:"required,min=8"`
	FullName string   `json:"full_name" binding:"required"`
	Status   string   `json:"status"`
	RoleIDs  []string `json:"role_ids"`
}

type updateUserRequest struct {
	Email    string  `json:"email" binding:"required,email"`
	FullName string  `json:"full_name" binding:"required"`
	Password *string `json:"password"`
}

type updateStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

type setRolesRequest struct {
	RoleIDs []string `json:"role_ids"`
}

func (h *Handler) ListUsers(c *gin.Context) {
	q := c.Query("q")
	status := c.Query("status")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	users, err := h.Store.ListUsers(c.Request.Context(), q, status, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list users"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": users})
}

func (h *Handler) CreateUser(c *gin.Context) {
	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if req.Status == "" {
		req.Status = "active"
	}
	hash, err := security.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}
	user, err := h.Store.CreateUser(c.Request.Context(), req.Email, hash, req.FullName, req.Status, req.RoleIDs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, user)
}

func (h *Handler) GetUser(c *gin.Context) {
	user, err := h.Store.GetUserByID(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *Handler) UpdateUser(c *gin.Context) {
	var req updateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	var passHash *string
	if req.Password != nil && *req.Password != "" {
		hash, err := security.HashPassword(*req.Password)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
			return
		}
		passHash = &hash
	}
	user, err := h.Store.UpdateUser(c.Request.Context(), c.Param("id"), req.Email, req.FullName, passHash)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *Handler) UpdateUserStatus(c *gin.Context) {
	var req updateStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if req.Status != "active" && req.Status != "disabled" && req.Status != "deleted" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}
	user, err := h.Store.SetUserStatus(c.Request.Context(), c.Param("id"), req.Status)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *Handler) SetUserRoles(c *gin.Context) {
	var req setRolesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if err := h.Store.SetUserRoles(c.Request.Context(), c.Param("id"), req.RoleIDs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user, err := h.Store.GetUserByID(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

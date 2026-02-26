package users

import (
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

const (
	permRead   = "users:read"
	permCreate = "users:create"
	permUpdate = "users:update"
	permAssign = "users:assign"
)

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	users := authed.Group("/users")
	users.GET("", middleware.RequirePermission(permRead), h.ListUsers)
	users.POST("", middleware.RequirePermission(permCreate), h.CreateUser)
	users.GET("/:id", middleware.RequirePermission(permRead), h.GetUser)
	users.PATCH("/:id", middleware.RequirePermission(permUpdate), h.UpdateUser)
	users.PATCH("/:id/status", middleware.RequirePermission(permUpdate), h.UpdateUserStatus)
	users.PATCH("/:id/roles", middleware.RequirePermission(permAssign), h.SetUserRoles)
}

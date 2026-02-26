package roles

import (
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

const (
	permRead   = "roles:read"
	permCreate = "roles:create"
	permUpdate = "roles:update"
	permDelete = "roles:delete"
	permAssign = "roles:assign"
)

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	roles := authed.Group("/roles")
	roles.GET("", middleware.RequirePermission(permRead), h.ListRoles)
	roles.POST("", middleware.RequirePermission(permCreate), h.CreateRole)
	roles.GET("/:id", middleware.RequirePermission(permRead), h.GetRole)
	roles.PATCH("/:id", middleware.RequirePermission(permUpdate), h.UpdateRole)
	roles.DELETE("/:id", middleware.RequirePermission(permDelete), h.DeleteRole)
	roles.PATCH("/:id/permissions", middleware.RequirePermission(permAssign), h.SetRolePermissions)
}

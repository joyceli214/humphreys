package catalog

import (
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

const (
	permResourcesRead   = "resources:read"
	permPermissionsRead = "permissions:read"
)

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	authed.GET("/resources", middleware.RequirePermission(permResourcesRead), h.ListResources)
	authed.GET("/permissions", middleware.RequirePermission(permPermissionsRead), h.ListPermissions)
}

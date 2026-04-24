package emailtemplates

import (
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

const (
	permWorkOrdersRead   = "work_orders:read"
	permWorkOrdersUpdate = "work_orders:update"
)

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	group := authed.Group("/email-templates")
	group.GET("", middleware.RequirePermission(permWorkOrdersRead), h.List)
	group.PATCH("/:key", middleware.RequirePermission(permWorkOrdersUpdate), h.Update)
}

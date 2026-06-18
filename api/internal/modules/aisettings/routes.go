package aisettings

import (
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

const permWorkOrdersUpdate = "work_orders:update"

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	group := authed.Group("/ai-settings")
	group.GET("", middleware.RequirePermission(permWorkOrdersUpdate), h.Get)
	group.PATCH("", middleware.RequirePermission(permWorkOrdersUpdate), h.Update)
}

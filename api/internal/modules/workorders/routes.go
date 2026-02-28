package workorders

import (
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

const (
	permRead = "work_orders:read"
)

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	group := authed.Group("/work-orders")
	group.GET("", middleware.RequirePermission(permRead), h.ListWorkOrders)
	group.GET("/:reference_id", middleware.RequirePermission(permRead), h.GetWorkOrder)
}

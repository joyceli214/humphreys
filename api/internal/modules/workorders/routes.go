package workorders

import (
	"humphreys/api/internal/middleware"
	"net/http"

	"github.com/gin-gonic/gin"
)

const (
	permCreate           = "work_orders:create"
	permRead             = "work_orders:read"
	permUpdate           = "work_orders:update"
	permStatusUpdate     = "work_orders_status:update"
	permSensitiveRead    = "work_orders_sensitive:read"
	permRepairLogsRead   = "repair_logs:read"
	permRepairLogsCreate = "repair_logs:create"
	permRepairLogsUpdate = "repair_logs:update"
	permRepairLogsDelete = "repair_logs:delete"
	permPartsRead        = "parts_purchase_requests:read"
	permPartsCreate      = "parts_purchase_requests:create"
	permPartsUpdate      = "parts_purchase_requests:update"
	permPartsDelete      = "parts_purchase_requests:delete"
)

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	authed.GET(
		"/parts-purchase-requests",
		middleware.RequirePermission(permPartsRead),
		middleware.RequirePermission(permSensitiveRead),
		h.ListAllPartsPurchaseRequests,
	)

	group := authed.Group("/work-orders")
	group.GET("/customers", middleware.RequirePermission(permRead), h.ListCustomers)
	group.GET("/dashboard", middleware.RequirePermission(permRead), h.Dashboard)
	group.POST("", middleware.RequirePermission(permCreate), h.CreateWorkOrder)
	group.DELETE("/:reference_id", middleware.RequirePermission(permCreate), h.DeleteWorkOrder)
	group.GET("", middleware.RequirePermission(permRead), h.ListWorkOrders)
	group.GET("/:reference_id", middleware.RequirePermission(permRead), h.GetWorkOrder)
	group.POST(
		"/:reference_id/ai-summary",
		middleware.RequirePermission(permRead),
		middleware.RequirePermission(permSensitiveRead),
		h.GenerateAISummary,
	)
	group.PATCH("/:reference_id/status", middleware.RequirePermission(permStatusUpdate), h.UpdateStatus)
	group.PATCH("/:reference_id/equipment", requireEquipmentUpdatePermission(), h.UpdateEquipment)
	group.PATCH("/:reference_id/work-notes", middleware.RequirePermission(permUpdate), h.UpdateWorkNotes)
	group.PATCH("/:reference_id/line-items", middleware.RequirePermission(permUpdate), h.UpdateLineItems)
	group.PATCH("/:reference_id/totals", middleware.RequirePermission(permUpdate), h.UpdateTotals)
	group.PATCH("/:reference_id/customer", middleware.RequirePermission(permUpdate), h.UpdateCustomer)
	group.GET("/:reference_id/repair-logs", middleware.RequirePermission(permRepairLogsRead), h.ListRepairLogs)
	group.POST("/:reference_id/repair-logs", middleware.RequirePermission(permRepairLogsCreate), h.CreateRepairLog)
	group.PATCH("/:reference_id/repair-logs/:repair_log_id", middleware.RequirePermission(permRepairLogsUpdate), h.UpdateRepairLog)
	group.DELETE("/:reference_id/repair-logs/:repair_log_id", middleware.RequirePermission(permRepairLogsDelete), h.DeleteRepairLog)
	group.GET("/:reference_id/parts-purchase-requests", middleware.RequirePermission(permPartsRead), h.ListPartsPurchaseRequests)
	group.POST("/:reference_id/parts-purchase-requests", middleware.RequirePermission(permPartsCreate), h.CreatePartsPurchaseRequest)
	group.PATCH("/:reference_id/parts-purchase-requests/:parts_purchase_request_id", middleware.RequirePermission(permPartsUpdate), h.UpdatePartsPurchaseRequest)
	group.DELETE("/:reference_id/parts-purchase-requests/:parts_purchase_request_id", middleware.RequirePermission(permPartsDelete), h.DeletePartsPurchaseRequest)
}

func requireEquipmentUpdatePermission() gin.HandlerFunc {
	return func(c *gin.Context) {
		claims, ok := middleware.Claims(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing auth context"})
			return
		}
		for _, code := range claims.Scope {
			if code == permUpdate || code == permStatusUpdate {
				c.Next()
				return
			}
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	}
}

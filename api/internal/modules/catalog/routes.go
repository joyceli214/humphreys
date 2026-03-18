package catalog

import (
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

const (
	permResourcesRead    = "resources:read"
	permPermissionsRead  = "permissions:read"
	permWorkOrdersRead   = "work_orders:read"
	permWorkOrdersUpdate = "work_orders:update"
)

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	authed.GET("/resources", middleware.RequirePermission(permResourcesRead), h.ListResources)
	authed.GET("/permissions", middleware.RequirePermission(permPermissionsRead), h.ListPermissions)
	authed.GET("/catalog/dropdown-management", middleware.RequirePermission(permWorkOrdersRead), h.ListDropdownManagement)
	authed.PATCH("/catalog/dropdown-management/:key/freeze", middleware.RequirePermission(permWorkOrdersUpdate), h.SetDropdownFrozen)
	authed.PATCH("/catalog/dropdown-management/:key/options/:optionId/active", middleware.RequirePermission(permWorkOrdersUpdate), h.SetDropdownOptionActive)
	authed.GET("/catalog/work-order-statuses", middleware.RequirePermission(permWorkOrdersRead), h.ListWorkOrderStatuses)
	authed.GET("/catalog/job-types", middleware.RequirePermission(permWorkOrdersRead), h.ListJobTypes)
	authed.GET("/catalog/items", middleware.RequirePermission(permWorkOrdersRead), h.ListItems)
	authed.GET("/catalog/brands", middleware.RequirePermission(permWorkOrdersRead), h.ListBrands)
	authed.GET("/catalog/workers", middleware.RequirePermission(permWorkOrdersRead), h.ListWorkers)
	authed.GET("/catalog/payment-methods", middleware.RequirePermission(permWorkOrdersRead), h.ListPaymentMethods)
	authed.GET("/catalog/locations", middleware.RequirePermission(permWorkOrdersRead), h.ListLocations)
	authed.GET("/catalog/parts-item-presets", middleware.RequirePermission(permWorkOrdersRead), h.ListPartsItemPresets)
	authed.POST("/catalog/work-order-statuses", middleware.RequirePermission(permWorkOrdersUpdate), h.CreateWorkOrderStatus)
	authed.POST("/catalog/job-types", middleware.RequirePermission(permWorkOrdersUpdate), h.CreateJobType)
	authed.POST("/catalog/items", middleware.RequirePermission(permWorkOrdersUpdate), h.CreateItem)
	authed.POST("/catalog/brands", middleware.RequirePermission(permWorkOrdersUpdate), h.CreateBrand)
	authed.POST("/catalog/workers", middleware.RequirePermission(permWorkOrdersUpdate), h.CreateWorker)
	authed.POST("/catalog/payment-methods", middleware.RequirePermission(permWorkOrdersUpdate), h.CreatePaymentMethod)
	authed.POST("/catalog/locations", middleware.RequirePermission(permWorkOrdersUpdate), h.CreateLocation)
	authed.POST("/catalog/parts-item-presets", middleware.RequirePermission(permWorkOrdersUpdate), h.CreatePartsItemPreset)
}

package uploads

import (
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
)

const permUploadsCreate = "uploads:create"

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	authed.POST("/uploads/markdown-image", middleware.RequirePermission(permUploadsCreate), h.UploadMarkdownImage)
	authed.DELETE("/uploads/markdown-image", middleware.RequirePermission(permUploadsCreate), h.DeleteMarkdownImage)
}

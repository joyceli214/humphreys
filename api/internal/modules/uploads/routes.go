package uploads

import (
	"github.com/gin-gonic/gin"
)

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	authed.POST("/uploads/markdown-image", h.UploadMarkdownImage)
	authed.DELETE("/uploads/markdown-image", h.DeleteMarkdownImage)
}

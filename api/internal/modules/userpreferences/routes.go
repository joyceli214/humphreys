package userpreferences

import "github.com/gin-gonic/gin"

func RegisterRoutes(authed *gin.RouterGroup, h *Handler) {
	group := authed.Group("/user-preferences")
	group.GET("/:key", h.Get)
	group.PATCH("/:key", h.Save)
}

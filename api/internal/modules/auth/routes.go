package auth

import "github.com/gin-gonic/gin"

func CSRFExemptPaths() map[string]struct{} {
	return map[string]struct{}{
		"/auth/login": {},
	}
}

func RegisterPublicRoutes(r gin.IRoutes, h *Handler) {
	r.POST("/auth/login", h.Login)
	r.POST("/auth/refresh", h.Refresh)
}

func RegisterProtectedRoutes(authed *gin.RouterGroup, h *Handler) {
	authed.POST("/auth/logout", h.Logout)
	authed.GET("/auth/me", h.Me)
}

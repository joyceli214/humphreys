package auth

import (
	"errors"
	"net/http"
	"strings"

	"humphreys/api/internal/config"
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	service *Service
	cfg     cookieConfig
}

type cookieConfig struct {
	refreshTTLSeconds int
	domain            string
	secure            bool
}

func New(db *pgxpool.Pool, cfg config.Config) *Handler {
	return NewWithService(NewService(NewRepository(db), cfg), cfg)
}

func NewWithService(service *Service, cfg config.Config) *Handler {
	return &Handler{
		service: service,
		cfg: cookieConfig{
			refreshTTLSeconds: int(cfg.RefreshTokenTTL.Seconds()),
			domain:            cfg.CookieDomain,
			secure:            cfg.CookieSecure,
		},
	}
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	session, err := h.service.Login(c.Request.Context(), req.Email, req.Password, c.ClientIP(), c.GetHeader("User-Agent"))
	if errors.Is(err, ErrInvalidCredentials) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	if errors.Is(err, ErrUserNotActive) {
		c.JSON(http.StatusForbidden, gin.H{"error": "user not active"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
		return
	}
	h.setRefreshCookie(c, session.RefreshToken)
	h.setCSRFCookie(c)

	c.JSON(http.StatusOK, gin.H{
		"access_token": session.AccessToken,
		"expires_in":   session.ExpiresIn,
		"scope":        session.Scope,
		"user":         session.User,
	})
}

func (h *Handler) Refresh(c *gin.Context) {
	cookieToken, err := c.Cookie("refresh_token")
	if err != nil {
		cookieToken = ""
	}
	session, err := h.service.Refresh(c.Request.Context(), cookieToken, c.ClientIP(), c.GetHeader("User-Agent"))
	if errors.Is(err, ErrMissingRefreshToken) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing refresh token"})
		return
	}
	if errors.Is(err, ErrInvalidRefreshToken) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
		return
	}
	if errors.Is(err, ErrRefreshTokenReuse) {
		h.clearCookies(c)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token reuse detected"})
		return
	}
	if errors.Is(err, ErrRefreshTokenExpired) {
		h.clearCookies(c)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token expired"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to refresh"})
		return
	}
	h.setRefreshCookie(c, session.RefreshToken)
	h.setCSRFCookie(c)

	c.JSON(http.StatusOK, gin.H{
		"access_token": session.AccessToken,
		"expires_in":   session.ExpiresIn,
		"scope":        session.Scope,
		"user":         session.User,
	})
}

func (h *Handler) Logout(c *gin.Context) {
	token, err := c.Cookie("refresh_token")
	if err != nil {
		token = ""
	}
	_ = h.service.Logout(c.Request.Context(), token)
	h.clearCookies(c)
	c.Status(http.StatusNoContent)
}

func (h *Handler) Me(c *gin.Context) {
	claims, ok := middleware.Claims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	me, err := h.service.Me(c.Request.Context(), claims.UserID)
	if errors.Is(err, ErrAuthenticatedUserAbsent) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
		return
	}
	c.JSON(http.StatusOK, me)
}

func (h *Handler) setRefreshCookie(c *gin.Context, token string) {
	c.SetCookie("refresh_token", token, h.cfg.refreshTTLSeconds, "/", h.cfg.domain, h.cfg.secure, true)
}

func (h *Handler) setCSRFCookie(c *gin.Context) {
	csrf := strings.ReplaceAll(uuid.NewString(), "-", "")
	c.SetCookie("csrf_token", csrf, h.cfg.refreshTTLSeconds, "/", h.cfg.domain, h.cfg.secure, false)
}

func (h *Handler) clearCookies(c *gin.Context) {
	c.SetCookie("refresh_token", "", -1, "/", h.cfg.domain, h.cfg.secure, true)
	c.SetCookie("csrf_token", "", -1, "/", h.cfg.domain, h.cfg.secure, false)
}

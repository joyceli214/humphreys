package handlers

import (
	"errors"
	"net/http"
	"strings"

	"humphreys/api/internal/middleware"
	"humphreys/api/internal/security"
	"humphreys/api/internal/store"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

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
	user, err := h.Store.GetUserByEmail(c.Request.Context(), req.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
		return
	}
	if user.Status != "active" {
		c.JSON(http.StatusForbidden, gin.H{"error": "user not active"})
		return
	}
	if !security.VerifyPassword(user.PasswordHash, req.Password) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	accessToken, expiresIn, scope, err := h.issueSession(c, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue session"})
		return
	}

	_ = h.Store.MarkLastLogin(c.Request.Context(), user.ID)
	me, err := h.Store.GetUserByID(c.Request.Context(), user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token": accessToken,
		"expires_in":   expiresIn,
		"scope":        scope,
		"user":         me,
	})
}

func (h *Handler) issueSession(c *gin.Context, userID string) (string, int, []string, error) {
	perms, roleIDs, err := h.Store.ListPermissionsByUserID(c.Request.Context(), userID)
	if err != nil {
		return "", 0, nil, err
	}
	scope := make([]string, 0, len(perms))
	for _, p := range perms {
		scope = append(scope, p.Code)
	}
	accessToken, accessExpAt, err := security.NewAccessToken(h.Cfg.JWTSecret, h.Cfg.AccessTokenTTL, userID, roleIDs, scope)
	if err != nil {
		return "", 0, nil, err
	}

	refreshToken, err := security.NewRefreshToken()
	if err != nil {
		return "", 0, nil, err
	}
	familyID := store.NewUUID()
	if _, err := h.Store.SaveRefreshToken(
		c.Request.Context(),
		userID,
		security.HashToken(refreshToken),
		familyID,
		h.Now().Add(h.Cfg.RefreshTokenTTL),
		c.ClientIP(),
		c.GetHeader("User-Agent"),
	); err != nil {
		return "", 0, nil, err
	}

	h.setRefreshCookie(c, refreshToken)
	h.setCSRFCookie(c)

	return accessToken, int(accessExpAt.Sub(h.Now()).Seconds()), scope, nil
}

func (h *Handler) Refresh(c *gin.Context) {
	cookieToken, err := c.Cookie("refresh_token")
	if err != nil || cookieToken == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing refresh token"})
		return
	}

	rec, err := h.Store.GetRefreshToken(c.Request.Context(), security.HashToken(cookieToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid refresh token"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to refresh"})
		return
	}

	if rec.RevokedAt != nil {
		_ = h.Store.RevokeFamily(c.Request.Context(), rec.FamilyID)
		h.clearCookies(c)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token reuse detected"})
		return
	}
	if rec.ExpiresAt.Before(h.Now()) {
		h.clearCookies(c)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token expired"})
		return
	}

	newRefreshToken, err := security.NewRefreshToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to refresh"})
		return
	}
	replacementID, err := h.Store.SaveRefreshToken(
		c.Request.Context(), rec.UserID, security.HashToken(newRefreshToken), rec.FamilyID,
		h.Now().Add(h.Cfg.RefreshTokenTTL), c.ClientIP(), c.GetHeader("User-Agent"),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to refresh"})
		return
	}
	if err := h.Store.RevokeTokenAndSetReplacement(c.Request.Context(), rec.ID, replacementID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to refresh"})
		return
	}

	perms, roleIDs, err := h.Store.ListPermissionsByUserID(c.Request.Context(), rec.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to refresh"})
		return
	}
	scope := make([]string, 0, len(perms))
	for _, p := range perms {
		scope = append(scope, p.Code)
	}
	accessToken, accessExpAt, err := security.NewAccessToken(h.Cfg.JWTSecret, h.Cfg.AccessTokenTTL, rec.UserID, roleIDs, scope)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to refresh"})
		return
	}

	h.setRefreshCookie(c, newRefreshToken)
	h.setCSRFCookie(c)
	me, err := h.Store.GetUserByID(c.Request.Context(), rec.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load user"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"access_token": accessToken,
		"expires_in":   int(accessExpAt.Sub(h.Now()).Seconds()),
		"scope":        scope,
		"user":         me,
	})
}

func (h *Handler) Logout(c *gin.Context) {
	if token, err := c.Cookie("refresh_token"); err == nil && token != "" {
		_ = h.Store.RevokeByHash(c.Request.Context(), security.HashToken(token))
	}
	h.clearCookies(c)
	c.Status(http.StatusNoContent)
}

func (h *Handler) Me(c *gin.Context) {
	claims, ok := middleware.Claims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	me, err := h.Store.GetUserByID(c.Request.Context(), claims.UserID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, me)
}

func (h *Handler) setRefreshCookie(c *gin.Context, token string) {
	c.SetCookie("refresh_token", token, int(h.Cfg.RefreshTokenTTL.Seconds()), "/", h.Cfg.CookieDomain, h.Cfg.CookieSecure, true)
}

func (h *Handler) setCSRFCookie(c *gin.Context) {
	csrf := strings.ReplaceAll(uuid.NewString(), "-", "")
	c.SetCookie("csrf_token", csrf, int(h.Cfg.RefreshTokenTTL.Seconds()), "/", h.Cfg.CookieDomain, h.Cfg.CookieSecure, false)
}

func (h *Handler) clearCookies(c *gin.Context) {
	c.SetCookie("refresh_token", "", -1, "/", h.Cfg.CookieDomain, h.Cfg.CookieSecure, true)
	c.SetCookie("csrf_token", "", -1, "/", h.Cfg.CookieDomain, h.Cfg.CookieSecure, false)
}

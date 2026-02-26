package auth

import (
	"context"
	"errors"
	"time"

	"humphreys/api/internal/config"
	"humphreys/api/internal/domain"
	"humphreys/api/internal/modules/auth/security"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrInvalidCredentials      = errors.New("invalid credentials")
	ErrUserNotActive           = errors.New("user not active")
	ErrMissingRefreshToken     = errors.New("missing refresh token")
	ErrInvalidRefreshToken     = errors.New("invalid refresh token")
	ErrRefreshTokenReuse       = errors.New("refresh token reuse detected")
	ErrRefreshTokenExpired     = errors.New("refresh token expired")
	ErrAuthenticatedUserAbsent = errors.New("user not found")
)

type Service struct {
	repo Repository
	cfg  config.Config
	now  func() time.Time
}

type SessionResult struct {
	AccessToken  string
	ExpiresIn    int
	Scope        []string
	User         domain.User
	RefreshToken string
}

func NewService(repo Repository, cfg config.Config) *Service {
	return &Service{
		repo: repo,
		cfg:  cfg,
		now:  time.Now,
	}
}

func (s *Service) Login(ctx context.Context, email, password, clientIP, userAgent string) (SessionResult, error) {
	user, err := s.repo.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SessionResult{}, ErrInvalidCredentials
		}
		return SessionResult{}, err
	}
	if user.Status != "active" {
		return SessionResult{}, ErrUserNotActive
	}
	if !security.VerifyPassword(user.PasswordHash, password) {
		return SessionResult{}, ErrInvalidCredentials
	}

	session, err := s.issueSession(ctx, user.ID, clientIP, userAgent)
	if err != nil {
		return SessionResult{}, err
	}

	_ = s.repo.MarkLastLogin(ctx, user.ID)
	me, err := s.repo.GetUserByID(ctx, user.ID)
	if err != nil {
		return SessionResult{}, err
	}
	session.User = me
	return session, nil
}

func (s *Service) Refresh(ctx context.Context, cookieToken, clientIP, userAgent string) (SessionResult, error) {
	if cookieToken == "" {
		return SessionResult{}, ErrMissingRefreshToken
	}

	rec, err := s.repo.GetRefreshToken(ctx, security.HashToken(cookieToken))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SessionResult{}, ErrInvalidRefreshToken
		}
		return SessionResult{}, err
	}

	if rec.RevokedAt != nil {
		_ = s.repo.RevokeFamily(ctx, rec.FamilyID)
		return SessionResult{}, ErrRefreshTokenReuse
	}
	if rec.ExpiresAt.Before(s.now()) {
		return SessionResult{}, ErrRefreshTokenExpired
	}

	newRefreshToken, err := security.NewRefreshToken()
	if err != nil {
		return SessionResult{}, err
	}
	replacementID, err := s.repo.SaveRefreshToken(
		ctx,
		rec.UserID,
		security.HashToken(newRefreshToken),
		rec.FamilyID,
		s.now().Add(s.cfg.RefreshTokenTTL),
		clientIP,
		userAgent,
	)
	if err != nil {
		return SessionResult{}, err
	}
	if err := s.repo.RevokeTokenAndSetReplacement(ctx, rec.ID, replacementID); err != nil {
		return SessionResult{}, err
	}

	perms, roleIDs, err := s.repo.ListPermissionsByUserID(ctx, rec.UserID)
	if err != nil {
		return SessionResult{}, err
	}
	scope := make([]string, 0, len(perms))
	for _, p := range perms {
		scope = append(scope, p.Code)
	}
	accessToken, accessExpAt, err := security.NewAccessToken(s.cfg.JWTSecret, s.cfg.AccessTokenTTL, rec.UserID, roleIDs, scope)
	if err != nil {
		return SessionResult{}, err
	}
	me, err := s.repo.GetUserByID(ctx, rec.UserID)
	if err != nil {
		return SessionResult{}, err
	}

	return SessionResult{
		AccessToken:  accessToken,
		ExpiresIn:    int(accessExpAt.Sub(s.now()).Seconds()),
		Scope:        scope,
		User:         me,
		RefreshToken: newRefreshToken,
	}, nil
}

func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	if refreshToken == "" {
		return nil
	}
	return s.repo.RevokeByHash(ctx, security.HashToken(refreshToken))
}

func (s *Service) Me(ctx context.Context, userID string) (domain.User, error) {
	me, err := s.repo.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, ErrAuthenticatedUserAbsent
	}
	return me, err
}

func (s *Service) issueSession(ctx context.Context, userID, clientIP, userAgent string) (SessionResult, error) {
	perms, roleIDs, err := s.repo.ListPermissionsByUserID(ctx, userID)
	if err != nil {
		return SessionResult{}, err
	}
	scope := make([]string, 0, len(perms))
	for _, p := range perms {
		scope = append(scope, p.Code)
	}
	accessToken, accessExpAt, err := security.NewAccessToken(s.cfg.JWTSecret, s.cfg.AccessTokenTTL, userID, roleIDs, scope)
	if err != nil {
		return SessionResult{}, err
	}

	refreshToken, err := security.NewRefreshToken()
	if err != nil {
		return SessionResult{}, err
	}
	familyID := uuid.NewString()
	if _, err := s.repo.SaveRefreshToken(
		ctx,
		userID,
		security.HashToken(refreshToken),
		familyID,
		s.now().Add(s.cfg.RefreshTokenTTL),
		clientIP,
		userAgent,
	); err != nil {
		return SessionResult{}, err
	}

	return SessionResult{
		AccessToken:  accessToken,
		ExpiresIn:    int(accessExpAt.Sub(s.now()).Seconds()),
		Scope:        scope,
		RefreshToken: refreshToken,
	}, nil
}

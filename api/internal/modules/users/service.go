package users

import (
	"context"
	"errors"

	"humphreys/api/internal/domain"
	authsecurity "humphreys/api/internal/modules/auth/security"

	"github.com/jackc/pgx/v5"
)

var (
	ErrInvalidStatus = errors.New("invalid status")
	ErrUserNotFound  = errors.New("user not found")
)

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) ListUsers(ctx context.Context, query, status string, page, pageSize int) ([]domain.User, error) {
	return s.repo.ListUsers(ctx, query, status, page, pageSize)
}

func (s *Service) CreateUser(ctx context.Context, email, password, fullName, status string, roleIDs []string) (domain.User, error) {
	if status == "" {
		status = "active"
	}
	hash, err := authsecurity.HashPassword(password)
	if err != nil {
		return domain.User{}, err
	}
	return s.repo.CreateUser(ctx, email, hash, fullName, status, roleIDs)
}

func (s *Service) GetUser(ctx context.Context, id string) (domain.User, error) {
	return s.repo.GetUserByID(ctx, id)
}

func (s *Service) UpdateUser(ctx context.Context, id, email, fullName string, password *string) (domain.User, error) {
	var passHash *string
	if password != nil && *password != "" {
		hash, err := authsecurity.HashPassword(*password)
		if err != nil {
			return domain.User{}, err
		}
		passHash = &hash
	}
	return s.repo.UpdateUser(ctx, id, email, fullName, passHash)
}

func (s *Service) UpdateUserStatus(ctx context.Context, id, status string) (domain.User, error) {
	if status != "active" && status != "disabled" && status != "deleted" {
		return domain.User{}, ErrInvalidStatus
	}
	return s.repo.SetUserStatus(ctx, id, status)
}

func (s *Service) SetUserRoles(ctx context.Context, id string, roleIDs []string) (domain.User, error) {
	if err := s.repo.SetUserRoles(ctx, id, roleIDs); err != nil {
		return domain.User{}, err
	}
	user, err := s.repo.GetUserByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, ErrUserNotFound
	}
	return user, err
}

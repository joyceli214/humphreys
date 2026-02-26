package roles

import (
	"context"
	"errors"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5"
)

var ErrRoleNotFound = errors.New("role not found")

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) ListRoles(ctx context.Context) ([]domain.Role, error) {
	return s.repo.ListRoles(ctx)
}

func (s *Service) CreateRole(ctx context.Context, name, description string) (domain.Role, error) {
	return s.repo.CreateRole(ctx, name, description)
}

func (s *Service) GetRole(ctx context.Context, id string) (domain.Role, error) {
	return s.repo.GetRole(ctx, id)
}

func (s *Service) UpdateRole(ctx context.Context, id, name, description string) (domain.Role, error) {
	return s.repo.UpdateRole(ctx, id, name, description)
}

func (s *Service) DeleteRole(ctx context.Context, id string) error {
	return s.repo.DeleteRole(ctx, id)
}

func (s *Service) SetRolePermissions(ctx context.Context, roleID string, permissionIDs []string) (domain.Role, error) {
	if err := s.repo.ReplaceRolePermissions(ctx, roleID, permissionIDs); err != nil {
		return domain.Role{}, err
	}
	role, err := s.repo.GetRole(ctx, roleID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Role{}, ErrRoleNotFound
	}
	return role, err
}

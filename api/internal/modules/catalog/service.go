package catalog

import (
	"context"

	"humphreys/api/internal/domain"
)

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) ListResources(ctx context.Context) ([]domain.Resource, error) {
	return s.repo.ListResources(ctx)
}

func (s *Service) ListPermissions(ctx context.Context) ([]domain.Permission, error) {
	return s.repo.ListPermissions(ctx)
}

package workorders

import (
	"context"
	"errors"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5"
)

var ErrWorkOrderNotFound = errors.New("work order not found")

type Service struct {
	repo Repository
}

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) ListWorkOrders(ctx context.Context, query string, page, pageSize int) ([]domain.WorkOrderListItem, error) {
	return s.repo.ListWorkOrders(ctx, query, page, pageSize)
}

func (s *Service) GetWorkOrderDetail(ctx context.Context, referenceID int) (domain.WorkOrderDetail, error) {
	detail, err := s.repo.GetWorkOrderDetail(ctx, referenceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.WorkOrderDetail{}, ErrWorkOrderNotFound
	}
	return detail, err
}

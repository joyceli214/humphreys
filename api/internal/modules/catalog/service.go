package catalog

import (
	"context"
	"errors"
	"strings"

	"humphreys/api/internal/domain"
)

type Service struct {
	repo Repository
}

var ErrInvalidLookupLabel = errors.New("label is required")
var ErrInvalidLocationShelf = errors.New("shelf is required")
var ErrInvalidLocationFloor = errors.New("floor must be zero or greater")
var ErrUnknownDropdownKey = errors.New("unknown dropdown key")
var ErrDropdownOptionNotFound = errors.New("dropdown option not found")
var ErrInvalidDropdownOptionID = errors.New("dropdown option id must be greater than zero")
var ErrDropdownFrozen = errors.New("dropdown is frozen")

func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) ListResources(ctx context.Context) ([]domain.Resource, error) {
	return s.repo.ListResources(ctx)
}

func (s *Service) ListPermissions(ctx context.Context) ([]domain.Permission, error) {
	return s.repo.ListPermissions(ctx)
}

func (s *Service) ListDropdownManagement(ctx context.Context) ([]DropdownManagementEntry, error) {
	return s.repo.ListDropdownManagement(ctx)
}

func (s *Service) SetDropdownFrozen(ctx context.Context, dropdownKey string, frozen bool) error {
	return s.repo.SetDropdownFrozen(ctx, dropdownKey, frozen)
}

func (s *Service) SetDropdownOptionActive(ctx context.Context, dropdownKey string, optionID int64, active bool) error {
	if optionID <= 0 {
		return ErrInvalidDropdownOptionID
	}
	return s.repo.SetDropdownOptionActive(ctx, dropdownKey, optionID, active)
}

func (s *Service) ListWorkOrderStatuses(ctx context.Context, query string) ([]LookupOption, error) {
	return s.repo.ListWorkOrderStatuses(ctx, query)
}

func (s *Service) ListJobTypes(ctx context.Context, query string) ([]LookupOption, error) {
	return s.repo.ListJobTypes(ctx, query)
}

func (s *Service) ListItems(ctx context.Context, query string) ([]LookupOption, error) {
	return s.repo.ListItems(ctx, query)
}

func (s *Service) ListBrands(ctx context.Context, query string) ([]LookupOption, error) {
	return s.repo.ListBrands(ctx, query)
}

func (s *Service) ListWorkers(ctx context.Context, query string) ([]LookupOption, error) {
	return s.repo.ListWorkers(ctx, query)
}

func (s *Service) ListPaymentMethods(ctx context.Context, query string) ([]LookupOption, error) {
	return s.repo.ListPaymentMethods(ctx, query)
}

func (s *Service) ListLocations(ctx context.Context, query string) ([]LookupOption, error) {
	return s.repo.ListLocations(ctx, query)
}

func (s *Service) CreateWorkOrderStatus(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	if value == "" {
		return LookupOption{}, ErrInvalidLookupLabel
	}
	if err := s.ensureDropdownNotFrozen(ctx, DropdownKeyWorkOrderStatuses); err != nil {
		return LookupOption{}, err
	}
	return s.repo.CreateWorkOrderStatus(ctx, value)
}

func (s *Service) CreateJobType(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	if value == "" {
		return LookupOption{}, ErrInvalidLookupLabel
	}
	if err := s.ensureDropdownNotFrozen(ctx, DropdownKeyJobTypes); err != nil {
		return LookupOption{}, err
	}
	return s.repo.CreateJobType(ctx, value)
}

func (s *Service) CreateItem(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	if value == "" {
		return LookupOption{}, ErrInvalidLookupLabel
	}
	if err := s.ensureDropdownNotFrozen(ctx, DropdownKeyItems); err != nil {
		return LookupOption{}, err
	}
	return s.repo.CreateItem(ctx, value)
}

func (s *Service) CreateBrand(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	if value == "" {
		return LookupOption{}, ErrInvalidLookupLabel
	}
	if err := s.ensureDropdownNotFrozen(ctx, DropdownKeyBrands); err != nil {
		return LookupOption{}, err
	}
	return s.repo.CreateBrand(ctx, value)
}

func (s *Service) CreateWorker(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	if value == "" {
		return LookupOption{}, ErrInvalidLookupLabel
	}
	if err := s.ensureDropdownNotFrozen(ctx, DropdownKeyWorkers); err != nil {
		return LookupOption{}, err
	}
	return s.repo.CreateWorker(ctx, value)
}

func (s *Service) CreatePaymentMethod(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	if value == "" {
		return LookupOption{}, ErrInvalidLookupLabel
	}
	if err := s.ensureDropdownNotFrozen(ctx, DropdownKeyPaymentMethods); err != nil {
		return LookupOption{}, err
	}
	return s.repo.CreatePaymentMethod(ctx, value)
}

func (s *Service) CreateLocation(ctx context.Context, shelf string, floor int32) (LookupOption, error) {
	value := strings.TrimSpace(shelf)
	if value == "" {
		return LookupOption{}, ErrInvalidLocationShelf
	}
	if floor < 0 {
		return LookupOption{}, ErrInvalidLocationFloor
	}
	if err := s.ensureDropdownNotFrozen(ctx, DropdownKeyLocations); err != nil {
		return LookupOption{}, err
	}
	return s.repo.CreateLocation(ctx, value, floor)
}

func (s *Service) ensureDropdownNotFrozen(ctx context.Context, key string) error {
	frozen, err := s.repo.IsDropdownFrozen(ctx, key)
	if err != nil {
		return err
	}
	if frozen {
		return ErrDropdownFrozen
	}
	return nil
}

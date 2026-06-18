package aisettings

import (
	"context"
	"errors"
	"os"
	"strings"
)

var (
	ErrModelRequired          = errors.New("model is required")
	ErrSummaryPromptRequired  = errors.New("work order summary prompt is required")
	ErrWorkDonePromptRequired = errors.New("work done prompt is required")
	ErrSummaryPlaceholder     = errors.New(`work order summary prompt must include {{work_order_data}}`)
	ErrWorkDonePlaceholder    = errors.New(`work done prompt must include {{repair_logs_summary}}`)
)

type Service struct {
	repo *Repository
}

type UpdateInput struct {
	OpenRouterAPIKey       string
	UpdateOpenRouterAPIKey bool
	OpenRouterModel        string
	WorkOrderSummaryPrompt string
	WorkDonePrompt         string
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) Get(ctx context.Context) (Settings, error) {
	if err := s.repo.UpsertDefaults(ctx, getEnvOpenRouterModel(), DefaultWorkOrderSummaryPrompt, DefaultWorkDonePrompt); err != nil {
		return Settings{}, err
	}
	item, err := s.repo.Get(ctx)
	if err != nil {
		return Settings{}, err
	}
	return s.withEnvFallbacks(item), nil
}

func (s *Service) Update(ctx context.Context, input UpdateInput) (Settings, error) {
	item, err := s.Get(ctx)
	if err != nil {
		return Settings{}, err
	}

	next := Settings{
		OpenRouterAPIKey:       strings.TrimSpace(input.OpenRouterAPIKey),
		OpenRouterModel:        strings.TrimSpace(input.OpenRouterModel),
		WorkOrderSummaryPrompt: strings.TrimSpace(input.WorkOrderSummaryPrompt),
		WorkDonePrompt:         strings.TrimSpace(input.WorkDonePrompt),
	}
	if next.OpenRouterModel == "" {
		next.OpenRouterModel = item.OpenRouterModel
	}
	if err := validate(next); err != nil {
		return Settings{}, err
	}

	saved, err := s.repo.Update(ctx, next, input.UpdateOpenRouterAPIKey)
	if err != nil {
		return Settings{}, err
	}
	return s.withEnvFallbacks(saved), nil
}

func (s *Service) withEnvFallbacks(item Settings) Settings {
	if strings.TrimSpace(item.OpenRouterAPIKey) == "" {
		item.OpenRouterAPIKey = strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY"))
	}
	item.HasOpenRouterAPIKey = strings.TrimSpace(item.OpenRouterAPIKey) != ""
	if strings.TrimSpace(item.OpenRouterModel) == "" {
		item.OpenRouterModel = getEnvOpenRouterModel()
	}
	return item
}

func validate(item Settings) error {
	if strings.TrimSpace(item.OpenRouterModel) == "" {
		return ErrModelRequired
	}
	if strings.TrimSpace(item.WorkOrderSummaryPrompt) == "" {
		return ErrSummaryPromptRequired
	}
	if !strings.Contains(item.WorkOrderSummaryPrompt, "{{work_order_data}}") {
		return ErrSummaryPlaceholder
	}
	if strings.TrimSpace(item.WorkDonePrompt) == "" {
		return ErrWorkDonePromptRequired
	}
	if !strings.Contains(item.WorkDonePrompt, "{{repair_logs_summary}}") {
		return ErrWorkDonePlaceholder
	}
	return nil
}

func getEnvOpenRouterModel() string {
	value := strings.TrimSpace(os.Getenv("OPENROUTER_MODEL"))
	if value == "" {
		return DefaultOpenRouterModel
	}
	return value
}

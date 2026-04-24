package emailtemplates

import (
	"context"
	"errors"
	"strings"
)

var (
	ErrUnknownTemplate = errors.New("unknown email template")
	ErrSubjectRequired = errors.New("subject template is required")
	ErrBodyRequired    = errors.New("body template is required")
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) List(ctx context.Context) ([]Template, error) {
	return s.repo.List(ctx)
}

func (s *Service) Update(ctx context.Context, key, subject, body string) (Template, error) {
	subject = strings.TrimSpace(subject)
	body = strings.TrimSpace(body)
	if subject == "" {
		return Template{}, ErrSubjectRequired
	}
	if body == "" {
		return Template{}, ErrBodyRequired
	}
	return s.repo.Update(ctx, key, subject, body)
}

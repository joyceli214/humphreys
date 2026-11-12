package emailtemplates

import (
	"context"
	"errors"
	"regexp"
	"strings"
)

var (
	ErrUnknownTemplate = errors.New("unknown email template")
	ErrSubjectRequired = errors.New("subject template is required")
	ErrBodyRequired    = errors.New("body template is required")
	ErrJobCardsSlot    = errors.New("job cards slot is invalid")
)

const (
	KindCustomer = "customer"
	KindSupplier = "supplier"
	KindShop     = "shop"
)

// templateKinds lists the fixed built-in template keys (migrations 029 + 044).
var templateKinds = map[string]string{
	"job_started":             KindCustomer,
	"job_completed":           KindCustomer,
	"supplier_parts_inquiry":  KindSupplier,
	"supplier_order_followup": KindSupplier,
	"shop_approval":           KindShop,
	"shop_update":             KindShop,
}

// jobCardsPattern matches {{job_cards}}, tolerating spaces and the markdown
// escape MDXEditor adds ({{job\_cards}}).
var jobCardsPattern = regexp.MustCompile(`\{\{\s*job\\*_cards\s*\}\}`)

type jobCardsError struct{ msg string }

func (e jobCardsError) Error() string        { return e.msg }
func (e jobCardsError) Is(target error) bool { return target == ErrJobCardsSlot }

// validateTemplateBody: Supplier and Shop bodies need exactly one {{job_cards}}
// slot (the Write step fills it from the picked jobs); customer bodies none.
func validateTemplateBody(kind, body string) error {
	count := len(jobCardsPattern.FindAllStringIndex(body, -1))
	switch kind {
	case KindSupplier, KindShop:
		if count != 1 {
			return jobCardsError{"supplier and shop templates must contain the job cards slot {{job_cards}} exactly once"}
		}
	default:
		if count != 0 {
			return jobCardsError{"customer templates cannot contain {{job_cards}}"}
		}
	}
	return nil
}

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
	kind, ok := templateKinds[key]
	if !ok {
		return Template{}, ErrUnknownTemplate
	}
	subject = strings.TrimSpace(subject)
	body = strings.TrimSpace(body)
	if subject == "" {
		return Template{}, ErrSubjectRequired
	}
	if body == "" {
		return Template{}, ErrBodyRequired
	}
	if err := validateTemplateBody(kind, body); err != nil {
		return Template{}, err
	}
	return s.repo.Update(ctx, key, subject, body)
}

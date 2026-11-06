package workorders

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/gin-gonic/gin"
)

// MaxCustomerEmailCc caps how many staff can be copied on one customer email.
const MaxCustomerEmailCc = 10

var (
	// ErrCcNotStaff is returned when a Cc address is not an active staff user.
	ErrCcNotStaff = errors.New("cc must be an active staff email")
	// ErrTooManyCc is returned when more than MaxCustomerEmailCc addresses are given.
	ErrTooManyCc = errors.New("too many cc recipients")
)

// StaffContact is an active staff user that can be copied on customer email.
type StaffContact struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	FullName string `json:"full_name"`
}

func (s *Service) ListActiveStaffContacts(ctx context.Context) ([]StaffContact, error) {
	return s.repo.ListActiveStaffContacts(ctx)
}

func (r *storeRepository) ListActiveStaffContacts(ctx context.Context) ([]StaffContact, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id::text, email, full_name
		FROM users
		WHERE status = 'active' AND deleted_at IS NULL AND BTRIM(email) <> ''
		ORDER BY LOWER(full_name), LOWER(email)
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]StaffContact, 0)
	for rows.Next() {
		var item StaffContact
		if err := rows.Scan(&item.ID, &item.Email, &item.FullName); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// resolveStaffCc validates requested Cc addresses against the active staff
// directory. Free-typed outside addresses are rejected. The result keeps the
// request order, is de-duplicated case-insensitively, and drops the To address.
func resolveStaffCc(requested []string, staff []StaffContact, to string) ([]string, error) {
	allowed := make(map[string]string, len(staff))
	for _, contact := range staff {
		email := strings.ToLower(strings.TrimSpace(contact.Email))
		if email != "" {
			allowed[email] = strings.TrimSpace(contact.Email)
		}
	}
	toKey := strings.ToLower(strings.TrimSpace(to))
	seen := map[string]struct{}{}
	out := make([]string, 0, len(requested))
	for _, raw := range requested {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		parsed, err := mail.ParseAddress(value)
		if err != nil || !strings.EqualFold(parsed.Address, value) {
			// Only bare addresses; "Name <x@y>" forms are not accepted.
			return nil, ErrCcNotStaff
		}
		key := strings.ToLower(parsed.Address)
		address, ok := allowed[key]
		if !ok {
			return nil, ErrCcNotStaff
		}
		if key == toKey {
			continue
		}
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, address)
	}
	if len(out) > MaxCustomerEmailCc {
		return nil, ErrTooManyCc
	}
	return out, nil
}

// customerEmailCc loads the staff directory only when Cc was requested.
func (h *Handler) customerEmailCc(ctx context.Context, requested []string, to string) ([]string, int, error) {
	hasAny := false
	for _, value := range requested {
		if strings.TrimSpace(value) != "" {
			hasAny = true
			break
		}
	}
	if !hasAny {
		return nil, http.StatusOK, nil
	}
	if len(requested) > MaxCustomerEmailCc*2 {
		return nil, http.StatusBadRequest, ErrTooManyCc
	}
	staff, err := h.service.ListActiveStaffContacts(ctx)
	if err != nil {
		return nil, http.StatusInternalServerError, errors.New("failed to load staff")
	}
	cc, err := resolveStaffCc(requested, staff, to)
	if err != nil {
		return nil, http.StatusBadRequest, err
	}
	return cc, http.StatusOK, nil
}

// ListEmailStaff returns active staff that can be copied (Cc) on customer email.
func (h *Handler) ListEmailStaff(c *gin.Context) {
	items, err := h.service.ListActiveStaffContacts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load staff"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": items, "max_cc": MaxCustomerEmailCc})
}

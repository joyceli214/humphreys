package workorders

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

// MaxCustomerEmailCc caps how many staff can be copied on one customer email.
const MaxCustomerEmailCc = 10

var (
	// ErrCcNotStaff is returned when a Cc address is neither an active staff
	// user nor an active common contact (and the sender may not type addresses).
	ErrCcNotStaff = errors.New("cc must be an active staff or common contact email")
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

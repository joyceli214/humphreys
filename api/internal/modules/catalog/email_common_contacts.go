package catalog

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Common contacts (常用聯絡人): addresses owners/admins keep on hand for the
// Management customer email recipient picker. The active list is read by the
// workorders module (GET /work-orders/email-common-contacts) and enforced when
// sending.

const (
	MaxEmailCommonContacts       = 100
	MaxEmailCommonContactName    = 120
	MaxEmailCommonContactEmail   = 254
	MaxEmailCommonContactSortAbs = 100000
)

var EmailCommonContactRoles = []string{"boss", "staff", "other"}

var (
	ErrEmailContactNotFound      = errors.New("common contact not found")
	ErrEmailContactDuplicate     = errors.New("a common contact with this email already exists")
	ErrEmailContactTooMany       = errors.New("too many common contacts")
	ErrEmailContactNameRequired  = errors.New("name is required")
	ErrEmailContactNameTooLong   = errors.New("name is too long (max 120 characters)")
	ErrEmailContactEmailRequired = errors.New("email is required")
	ErrEmailContactEmailInvalid  = errors.New("email must be a plain address like name@example.com")
	ErrEmailContactRoleInvalid   = errors.New("role must be boss, staff, or other")
	ErrEmailContactSortInvalid   = errors.New("sort_order is out of range")
)

type EmailCommonContact struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	IsActive  bool      `json:"is_active"`
	IsPinned  bool      `json:"is_pinned"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// EmailCommonContactPatch holds optional field updates; nil leaves a field as is.
type EmailCommonContactPatch struct {
	Name      *string `json:"name"`
	Email     *string `json:"email"`
	Role      *string `json:"role"`
	IsActive  *bool   `json:"is_active"`
	IsPinned  *bool   `json:"is_pinned"`
	SortOrder *int    `json:"sort_order"`
}

// normalizeEmailCommonContact trims and validates fields, lower-casing email.
func normalizeEmailCommonContact(item EmailCommonContact) (EmailCommonContact, error) {
	item.Name = strings.TrimSpace(item.Name)
	if item.Name == "" {
		return item, ErrEmailContactNameRequired
	}
	if utf8.RuneCountInString(item.Name) > MaxEmailCommonContactName {
		return item, ErrEmailContactNameTooLong
	}
	email := strings.TrimSpace(item.Email)
	if email == "" {
		return item, ErrEmailContactEmailRequired
	}
	parsed, err := mail.ParseAddress(email)
	if err != nil || !strings.EqualFold(parsed.Address, email) || len(email) > MaxEmailCommonContactEmail {
		return item, ErrEmailContactEmailInvalid
	}
	item.Email = strings.ToLower(parsed.Address)
	item.Role = strings.ToLower(strings.TrimSpace(item.Role))
	validRole := false
	for _, role := range EmailCommonContactRoles {
		if item.Role == role {
			validRole = true
			break
		}
	}
	if !validRole {
		return item, ErrEmailContactRoleInvalid
	}
	if item.SortOrder > MaxEmailCommonContactSortAbs || item.SortOrder < -MaxEmailCommonContactSortAbs {
		return item, ErrEmailContactSortInvalid
	}
	return item, nil
}

func (s *Service) ListEmailCommonContacts(ctx context.Context) ([]EmailCommonContact, error) {
	return s.repo.ListEmailCommonContacts(ctx)
}

func (s *Service) CreateEmailCommonContact(ctx context.Context, input EmailCommonContact) (EmailCommonContact, error) {
	item, err := normalizeEmailCommonContact(input)
	if err != nil {
		return EmailCommonContact{}, err
	}
	return s.repo.CreateEmailCommonContact(ctx, item)
}

func (s *Service) UpdateEmailCommonContact(ctx context.Context, id int64, patch EmailCommonContactPatch) (EmailCommonContact, error) {
	if id <= 0 {
		return EmailCommonContact{}, ErrEmailContactNotFound
	}
	item, err := s.repo.GetEmailCommonContact(ctx, id)
	if err != nil {
		return EmailCommonContact{}, err
	}
	if patch.Name != nil {
		item.Name = *patch.Name
	}
	if patch.Email != nil {
		item.Email = *patch.Email
	}
	if patch.Role != nil {
		item.Role = *patch.Role
	}
	if patch.IsActive != nil {
		item.IsActive = *patch.IsActive
	}
	if patch.IsPinned != nil {
		item.IsPinned = *patch.IsPinned
	}
	if patch.SortOrder != nil {
		item.SortOrder = *patch.SortOrder
	}
	item, err = normalizeEmailCommonContact(item)
	if err != nil {
		return EmailCommonContact{}, err
	}
	return s.repo.UpdateEmailCommonContact(ctx, item)
}

func (s *Service) DeleteEmailCommonContact(ctx context.Context, id int64) error {
	if id <= 0 {
		return ErrEmailContactNotFound
	}
	return s.repo.DeleteEmailCommonContact(ctx, id)
}

const emailCommonContactColumns = `id, name, email, role, is_active, is_pinned, sort_order, created_at, updated_at`

func scanEmailCommonContact(row pgx.Row) (EmailCommonContact, error) {
	var item EmailCommonContact
	err := row.Scan(&item.ID, &item.Name, &item.Email, &item.Role, &item.IsActive, &item.IsPinned, &item.SortOrder, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrEmailContactNotFound
	}
	return item, mapEmailContactWriteError(err)
}

func mapEmailContactWriteError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrEmailContactDuplicate
	}
	return err
}

func (r *storeRepository) ListEmailCommonContacts(ctx context.Context) ([]EmailCommonContact, error) {
	rows, err := r.db.Query(ctx, `SELECT `+emailCommonContactColumns+`
		FROM public.email_common_contacts
		ORDER BY is_pinned DESC, sort_order ASC, LOWER(name), id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]EmailCommonContact, 0)
	for rows.Next() {
		item, err := scanEmailCommonContact(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *storeRepository) GetEmailCommonContact(ctx context.Context, id int64) (EmailCommonContact, error) {
	return scanEmailCommonContact(r.db.QueryRow(ctx, `SELECT `+emailCommonContactColumns+`
		FROM public.email_common_contacts WHERE id = $1`, id))
}

func (r *storeRepository) CreateEmailCommonContact(ctx context.Context, item EmailCommonContact) (EmailCommonContact, error) {
	// The count guard keeps the list bounded; a concurrent insert may overshoot
	// by one, which is acceptable for an admin-only list.
	created, err := scanEmailCommonContact(r.db.QueryRow(ctx, `
		INSERT INTO public.email_common_contacts (name, email, role, is_active, is_pinned, sort_order)
		SELECT $1, $2, $3, $4, $5, $6
		WHERE (SELECT COUNT(*) FROM public.email_common_contacts) < $7
		RETURNING `+emailCommonContactColumns,
		item.Name, item.Email, item.Role, item.IsActive, item.IsPinned, item.SortOrder, MaxEmailCommonContacts))
	if errors.Is(err, ErrEmailContactNotFound) {
		return EmailCommonContact{}, ErrEmailContactTooMany
	}
	return created, err
}

func (r *storeRepository) UpdateEmailCommonContact(ctx context.Context, item EmailCommonContact) (EmailCommonContact, error) {
	return scanEmailCommonContact(r.db.QueryRow(ctx, `
		UPDATE public.email_common_contacts
		SET name = $2, email = $3, role = $4, is_active = $5, is_pinned = $6, sort_order = $7, updated_at = now()
		WHERE id = $1
		RETURNING `+emailCommonContactColumns,
		item.ID, item.Name, item.Email, item.Role, item.IsActive, item.IsPinned, item.SortOrder))
}

func (r *storeRepository) DeleteEmailCommonContact(ctx context.Context, id int64) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM public.email_common_contacts WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrEmailContactNotFound
	}
	return nil
}

type createEmailCommonContactRequest struct {
	Name      string `json:"name"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	IsActive  *bool  `json:"is_active"`
	IsPinned  bool   `json:"is_pinned"`
	SortOrder int    `json:"sort_order"`
}

func emailContactErrorStatus(err error) (int, string) {
	switch {
	case errors.Is(err, ErrEmailContactNotFound):
		return http.StatusNotFound, err.Error()
	case errors.Is(err, ErrEmailContactDuplicate):
		return http.StatusConflict, err.Error()
	case errors.Is(err, ErrEmailContactTooMany),
		errors.Is(err, ErrEmailContactNameRequired),
		errors.Is(err, ErrEmailContactNameTooLong),
		errors.Is(err, ErrEmailContactEmailRequired),
		errors.Is(err, ErrEmailContactEmailInvalid),
		errors.Is(err, ErrEmailContactRoleInvalid),
		errors.Is(err, ErrEmailContactSortInvalid):
		return http.StatusBadRequest, err.Error()
	default:
		return http.StatusInternalServerError, "failed to save common contact"
	}
}

func emailContactID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid common contact id"})
		return 0, false
	}
	return id, true
}

func (h *Handler) ListEmailCommonContacts(c *gin.Context) {
	items, err := h.service.ListEmailCommonContacts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list common contacts"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": items, "max_contacts": MaxEmailCommonContacts})
}

func (h *Handler) CreateEmailCommonContact(c *gin.Context) {
	var req createEmailCommonContactRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	active := req.IsActive == nil || *req.IsActive
	item, err := h.service.CreateEmailCommonContact(c.Request.Context(), EmailCommonContact{
		Name: req.Name, Email: req.Email, Role: req.Role, IsActive: active, IsPinned: req.IsPinned, SortOrder: req.SortOrder,
	})
	if err != nil {
		status, msg := emailContactErrorStatus(err)
		c.JSON(status, gin.H{"error": msg})
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) UpdateEmailCommonContact(c *gin.Context) {
	id, ok := emailContactID(c)
	if !ok {
		return
	}
	var patch EmailCommonContactPatch
	if err := c.ShouldBindJSON(&patch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	item, err := h.service.UpdateEmailCommonContact(c.Request.Context(), id, patch)
	if err != nil {
		status, msg := emailContactErrorStatus(err)
		c.JSON(status, gin.H{"error": msg})
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) DeleteEmailCommonContact(c *gin.Context) {
	id, ok := emailContactID(c)
	if !ok {
		return
	}
	if err := h.service.DeleteEmailCommonContact(c.Request.Context(), id); err != nil {
		status, msg := emailContactErrorStatus(err)
		if status == http.StatusInternalServerError {
			msg = "failed to delete common contact"
		}
		c.JSON(status, gin.H{"error": msg})
		return
	}
	c.Status(http.StatusNoContent)
}

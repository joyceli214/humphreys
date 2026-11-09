package workorders

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/gin-gonic/gin"
)

// MaxCustomerEmailTo caps how many To recipients one customer email may have.
const MaxCustomerEmailTo = 10

var (
	// ErrTypedRecipientForbidden is returned when a sender without
	// work_orders:update tries to send to a free-typed address.
	ErrTypedRecipientForbidden = errors.New("only owners/admins can send to a typed email address")
	// ErrUnknownCommonContact is returned for a contact id that is missing or inactive.
	ErrUnknownCommonContact = errors.New("common contact not found or inactive")
	// ErrCustomerEmailMissing is returned when the customer is a recipient but
	// has no email on file.
	ErrCustomerEmailMissing = errors.New("customer email missing")
	// ErrNoToRecipient is returned when the resolved To list is empty.
	ErrNoToRecipient = errors.New("at least one To recipient is required")
	// ErrTooManyTo is returned when more than MaxCustomerEmailTo addresses are given.
	ErrTooManyTo = errors.New("too many to recipients")
	// ErrMixedRecipientFields is returned when legacy "to" is combined with the
	// recipient picker fields.
	ErrMixedRecipientFields = errors.New("use to_emails instead of to with the recipient picker fields")
)

// CommonEmailContact is an active common contact (常用聯絡人) offered in the
// customer email recipient picker.
type CommonEmailContact struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	IsPinned bool   `json:"is_pinned"`
}

func (s *Service) ListActiveCommonEmailContacts(ctx context.Context) ([]CommonEmailContact, error) {
	return s.repo.ListActiveCommonEmailContacts(ctx)
}

func (r *storeRepository) ListActiveCommonEmailContacts(ctx context.Context) ([]CommonEmailContact, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, name, email, role, is_pinned
		FROM public.email_common_contacts
		WHERE is_active
		ORDER BY is_pinned DESC, sort_order ASC, LOWER(name), id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CommonEmailContact, 0)
	for rows.Next() {
		var item CommonEmailContact
		if err := rows.Scan(&item.ID, &item.Name, &item.Email, &item.Role, &item.IsPinned); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// ListEmailCommonContacts returns active common contacts for the recipient picker.
func (h *Handler) ListEmailCommonContacts(c *gin.Context) {
	items, err := h.service.ListActiveCommonEmailContacts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load common contacts"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": items, "max_to": MaxCustomerEmailTo, "max_cc": MaxCustomerEmailCc})
}

// recipientDirectory supplies the address books used to validate recipients.
// Implementations load lazily so a plain send does not hit the database.
type recipientDirectory interface {
	Staff() ([]StaffContact, error)
	Contacts() ([]CommonEmailContact, error)
}

// errDirectoryLoad wraps failures loading staff / contacts (HTTP 500).
type errDirectoryLoad struct{ err error }

func (e errDirectoryLoad) Error() string { return "failed to load email recipients" }
func (e errDirectoryLoad) Unwrap() error { return e.err }

type lazyRecipientDirectory struct {
	ctx      context.Context
	service  *Service
	staff    []StaffContact
	contacts []CommonEmailContact
	loadedS  bool
	loadedC  bool
}

func (d *lazyRecipientDirectory) Staff() ([]StaffContact, error) {
	if !d.loadedS {
		staff, err := d.service.ListActiveStaffContacts(d.ctx)
		if err != nil {
			return nil, errDirectoryLoad{err}
		}
		d.staff, d.loadedS = staff, true
	}
	return d.staff, nil
}

func (d *lazyRecipientDirectory) Contacts() ([]CommonEmailContact, error) {
	if !d.loadedC {
		contacts, err := d.service.ListActiveCommonEmailContacts(d.ctx)
		if err != nil {
			return nil, errDirectoryLoad{err}
		}
		d.contacts, d.loadedC = contacts, true
	}
	return d.contacts, nil
}

// usesRecipientPicker reports whether the request uses the explicit recipient
// fields rather than the legacy to/cc pair.
func (req sendCustomerEmailRequest) usesRecipientPicker() bool {
	return req.ToCustomer != nil || req.ToContactIDs != nil || req.CcContactIDs != nil || req.ToEmails != nil || req.CcEmails != nil
}

// addressList keeps insertion order and de-duplicates case-insensitively.
type addressList struct {
	seen map[string]struct{}
	out  []string
}

func (l *addressList) add(address string) {
	key := strings.ToLower(address)
	if l.seen == nil {
		l.seen = map[string]struct{}{}
	}
	if _, dup := l.seen[key]; dup {
		return
	}
	l.seen[key] = struct{}{}
	l.out = append(l.out, address)
}

func (l *addressList) has(address string) bool {
	_, ok := l.seen[strings.ToLower(address)]
	return ok
}

// bareAddress parses a plain "x@y" address; "Name <x@y>" forms are rejected.
func bareAddress(raw string) (string, bool) {
	value := strings.TrimSpace(raw)
	parsed, err := mail.ParseAddress(value)
	if err != nil || !strings.EqualFold(parsed.Address, value) {
		return "", false
	}
	return parsed.Address, true
}

func customerAddress(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", ErrCustomerEmailMissing
	}
	parsed, err := mail.ParseAddress(value)
	if err != nil {
		return "", ErrInvalidEmailFormat
	}
	return parsed.Address, nil
}

func contactEmailByID(dir recipientDirectory, id int64) (string, error) {
	contacts, err := dir.Contacts()
	if err != nil {
		return "", err
	}
	for _, contact := range contacts {
		if contact.ID == id {
			if address, ok := bareAddress(contact.Email); ok {
				return address, nil
			}
			break
		}
	}
	return "", ErrUnknownCommonContact
}

// directoryCcAddress returns the directory spelling of a Cc address that is an
// active staff user or common contact, or "" when it is in neither.
func directoryCcAddress(dir recipientDirectory, address string) (string, error) {
	staff, err := dir.Staff()
	if err != nil {
		return "", err
	}
	for _, contact := range staff {
		if strings.EqualFold(strings.TrimSpace(contact.Email), address) {
			return strings.TrimSpace(contact.Email), nil
		}
	}
	contacts, err := dir.Contacts()
	if err != nil {
		return "", err
	}
	for _, contact := range contacts {
		if strings.EqualFold(strings.TrimSpace(contact.Email), address) {
			return strings.TrimSpace(contact.Email), nil
		}
	}
	return "", nil
}

// resolveCustomerEmailRecipients turns the send request into the final To and
// Cc lists. It is the only place that decides who receives a customer email:
//   - customer: the address on the work order record (never client-supplied)
//   - common contacts: by id, active only
//   - Cc addresses: active staff or active common contacts; any valid bare
//     address only when canType (work_orders:update)
//   - typed To addresses: only when canType
//
// Results keep request order, are de-duplicated case-insensitively, and Cc
// never repeats a To address.
func resolveCustomerEmailRecipients(req sendCustomerEmailRequest, customerEmail string, canType bool, dir recipientDirectory) ([]string, []string, error) {
	if len(req.ToContactIDs)+len(req.ToEmails) > MaxCustomerEmailTo*2 {
		return nil, nil, ErrTooManyTo
	}
	if len(req.CcContactIDs)+len(req.CcEmails)+len(req.Cc) > MaxCustomerEmailCc*2 {
		return nil, nil, ErrTooManyCc
	}

	var to addressList
	if req.usesRecipientPicker() {
		if strings.TrimSpace(req.To) != "" {
			return nil, nil, ErrMixedRecipientFields
		}
		if req.ToCustomer == nil || *req.ToCustomer {
			address, err := customerAddress(customerEmail)
			if err != nil {
				return nil, nil, err
			}
			to.add(address)
		}
		for _, id := range req.ToContactIDs {
			address, err := contactEmailByID(dir, id)
			if err != nil {
				return nil, nil, err
			}
			to.add(address)
		}
		for _, raw := range req.ToEmails {
			if strings.TrimSpace(raw) == "" {
				continue
			}
			if !canType {
				return nil, nil, ErrTypedRecipientForbidden
			}
			address, ok := bareAddress(raw)
			if !ok {
				return nil, nil, ErrInvalidEmailFormat
			}
			to.add(address)
		}
	} else {
		legacy := strings.TrimSpace(req.To)
		customer, customerErr := customerAddress(customerEmail)
		if legacy == "" {
			if customerErr != nil {
				return nil, nil, customerErr
			}
			to.add(customer)
		} else {
			parsed, err := mail.ParseAddress(legacy)
			if err != nil {
				return nil, nil, ErrInvalidEmailFormat
			}
			switch {
			case customerErr == nil && strings.EqualFold(parsed.Address, customer):
				to.add(customer)
			case canType:
				to.add(parsed.Address)
			default:
				return nil, nil, ErrTypedRecipientForbidden
			}
		}
	}

	var cc addressList
	for _, id := range req.CcContactIDs {
		address, err := contactEmailByID(dir, id)
		if err != nil {
			return nil, nil, err
		}
		cc.add(address)
	}
	for _, raw := range append(append([]string{}, req.CcEmails...), req.Cc...) {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		address, ok := bareAddress(raw)
		if !ok {
			if canType {
				return nil, nil, ErrInvalidEmailFormat
			}
			return nil, nil, ErrCcNotStaff
		}
		known, err := directoryCcAddress(dir, address)
		if err != nil {
			return nil, nil, err
		}
		switch {
		case known != "":
			cc.add(known)
		case canType:
			cc.add(address)
		default:
			return nil, nil, ErrCcNotStaff
		}
	}

	ccOut := make([]string, 0, len(cc.out))
	for _, address := range cc.out {
		if !to.has(address) {
			ccOut = append(ccOut, address)
		}
	}
	if len(to.out) == 0 {
		return nil, nil, ErrNoToRecipient
	}
	if len(to.out) > MaxCustomerEmailTo {
		return nil, nil, ErrTooManyTo
	}
	if len(ccOut) > MaxCustomerEmailCc {
		return nil, nil, ErrTooManyCc
	}
	return to.out, ccOut, nil
}

// recipientErrorStatus maps resolver errors to HTTP status codes.
func recipientErrorStatus(err error) int {
	var load errDirectoryLoad
	switch {
	case errors.As(err, &load):
		return http.StatusInternalServerError
	case errors.Is(err, ErrTypedRecipientForbidden):
		return http.StatusForbidden
	default:
		return http.StatusBadRequest
	}
}

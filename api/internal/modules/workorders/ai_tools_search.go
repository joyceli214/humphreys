package workorders

import (
	"fmt"
	"strings"
	"time"
)

// Advanced Search: the admin types a plain-English question, the LLM turns it
// into an AISearchFilters object (whitelisted fields only), the admin reviews
// it, and /ai-tools/search executes it with parameterized SQL. The LLM never
// sees customer data and its output is only ever used as filter values.

const (
	aiSearchDefaultLimit = 50
	aiSearchMaxLimit     = 200
	aiSearchMaxOffset    = 100000
	aiSearchMaxText      = 200
	aiSearchMaxStatuses  = 20
	aiSearchMaxMinCount  = 1000

	aiWarrantyAny     = "any"
	aiWarrantyOnly    = "only"
	aiWarrantyExclude = "exclude"

	aiGroupNone     = "none"
	aiGroupCustomer = "customer"
	aiGroupModel    = "model"
	aiGroupSerial   = "serial"
)

// aiWarrantyPredicate marks a job as a warranty job: it is linked to an
// original job (work_orders.original_job_id) or carries the 'warranty' job
// type. Requires the job_types alias jt to be joined.
const aiWarrantyPredicate = `wo.original_job_id IS NOT NULL OR LOWER(COALESCE(jt.job_type_key, '')) = 'warranty'`

// AISearchFilters is the whitelisted filter object. It is the exact shape the
// LLM must emit, the shape returned by /search/interpret, and the shape
// accepted by /search. Unknown fields are rejected wherever it is decoded.
type AISearchFilters struct {
	Text          string   `json:"text,omitempty"`            // job #, customer name, equipment, brand, model, serial
	CustomerName  string   `json:"customer_name,omitempty"`   // customer display name (contains)
	Model         string   `json:"model,omitempty"`           // model number (contains)
	Serial        string   `json:"serial,omitempty"`          // serial number (contains)
	Brand         string   `json:"brand,omitempty"`           // brand name (contains)
	Equipment     string   `json:"equipment,omitempty"`       // equipment / item name (contains)
	Statuses      []string `json:"statuses,omitempty"`        // status display names (any of)
	Warranty      string   `json:"warranty,omitempty"`        // any | only | exclude
	IncludeLinked bool     `json:"include_linked,omitempty"`  // also return originals + warranty follow-ups of matches
	MinUnits      int      `json:"min_units,omitempty"`       // only customers with at least N jobs (0 = off)
	MinModelJobs  int      `json:"min_model_jobs,omitempty"`  // only models seen on at least N jobs (0 = off)
	MinSerialJobs int      `json:"min_serial_jobs,omitempty"` // only serials seen on at least N jobs, i.e. repeat repairs (0 = off)
	CreatedFrom   string   `json:"created_from,omitempty"`    // YYYY-MM-DD inclusive
	CreatedTo     string   `json:"created_to,omitempty"`      // YYYY-MM-DD inclusive
	GroupBy       string   `json:"group_by,omitempty"`        // none | customer | model | serial
	Limit         int      `json:"limit,omitempty"`           // default 50, max 200
	Offset        int      `json:"offset,omitempty"`
}

// aiSearchFilterFields is the whitelist of JSON keys allowed in a filter object.
var aiSearchFilterFields = map[string]bool{
	"text": true, "customer_name": true, "model": true, "serial": true, "brand": true,
	"equipment": true, "statuses": true, "warranty": true, "include_linked": true,
	"min_units": true, "min_model_jobs": true, "min_serial_jobs": true,
	"created_from": true, "created_to": true, "group_by": true, "limit": true, "offset": true,
}

// aiResolvedSearchFilters is a validated, normalized filter set with status
// names resolved to ids. Only this type reaches the SQL builder.
type aiResolvedSearchFilters struct {
	Text          string
	CustomerName  string
	Model         string
	Serial        string
	Brand         string
	Equipment     string
	StatusIDs     []int64
	StatusNames   []string
	Warranty      string
	IncludeLinked bool
	MinUnits      int
	MinModelJobs  int
	MinSerialJobs int
	CreatedFrom   string
	CreatedTo     string
	GroupBy       string
	Limit         int
	Offset        int
}

// AISearchRow is one result row. It carries the customer's display name only,
// never email or phone.
type AISearchRow struct {
	ReferenceID      int32      `json:"reference_id"`
	CustomerID       *int64     `json:"customer_id"`
	CustomerName     string     `json:"customer_name"`
	EquipmentName    string     `json:"equipment_name"`
	BrandNames       []string   `json:"brand_names"`
	ModelNumber      string     `json:"model_number"`
	SerialNumber     string     `json:"serial_number"`
	StatusName       string     `json:"status_name"`
	StatusGroup      string     `json:"status_group"`
	CreatedAt        *time.Time `json:"created_at"`
	IsWarranty       bool       `json:"is_warranty"`
	OriginalJobID    *int32     `json:"original_job_id"`
	WarrantyJobIDs   []int32    `json:"warranty_job_ids"`
	CustomerJobCount int        `json:"customer_job_count"`
}

// AISearchGroup summarizes result rows sharing a customer, model or serial.
// UnitCount is the customer's total job count for customer groups (across all
// their jobs, not just this page) and the number of matched jobs otherwise.
type AISearchGroup struct {
	Key       string  `json:"key"`
	Label     string  `json:"label"`
	UnitCount int     `json:"unit_count"`
	JobIDs    []int32 `json:"job_ids"`
}

// cleanSearchText trims and collapses whitespace and enforces a length cap.
func cleanSearchText(field, raw string) (string, error) {
	s := strings.Join(strings.Fields(raw), " ")
	if len(s) > aiSearchMaxText {
		return "", fmt.Errorf("%s is too long (max %d characters)", field, aiSearchMaxText)
	}
	return s, nil
}

func validSearchDate(field, raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	if _, err := time.Parse("2006-01-02", s); err != nil {
		return "", fmt.Errorf("%s must be a date in YYYY-MM-DD format", field)
	}
	return s, nil
}

func validMinCount(field string, v int) error {
	if v < 0 || v > aiSearchMaxMinCount {
		return fmt.Errorf("%s must be between 0 and %d", field, aiSearchMaxMinCount)
	}
	return nil
}

// normalizeSearchFilters validates every field against the whitelist rules and
// resolves status names to ids. Any rejection returns a user-facing error.
func normalizeSearchFilters(in AISearchFilters, statuses []AIStatusOption) (aiResolvedSearchFilters, error) {
	var out aiResolvedSearchFilters
	var err error
	texts := []struct {
		field string
		src   string
		dst   *string
	}{
		{"text", in.Text, &out.Text},
		{"customer_name", in.CustomerName, &out.CustomerName},
		{"model", in.Model, &out.Model},
		{"serial", in.Serial, &out.Serial},
		{"brand", in.Brand, &out.Brand},
		{"equipment", in.Equipment, &out.Equipment},
	}
	for _, t := range texts {
		if *t.dst, err = cleanSearchText(t.field, t.src); err != nil {
			return out, err
		}
	}

	if len(in.Statuses) > aiSearchMaxStatuses {
		return out, fmt.Errorf("too many statuses (max %d)", aiSearchMaxStatuses)
	}
	byName := make(map[string]AIStatusOption, len(statuses))
	for _, s := range statuses {
		byName[normalizeLookupName(s.Name)] = s
	}
	seen := map[int64]bool{}
	for _, raw := range in.Statuses {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		s, ok := byName[normalizeLookupName(raw)]
		if !ok {
			return out, fmt.Errorf("unknown status %q", strings.TrimSpace(raw))
		}
		if !seen[s.ID] {
			seen[s.ID] = true
			out.StatusIDs = append(out.StatusIDs, s.ID)
			out.StatusNames = append(out.StatusNames, s.Name)
		}
	}

	switch w := strings.ToLower(strings.TrimSpace(in.Warranty)); w {
	case "", aiWarrantyAny:
		out.Warranty = aiWarrantyAny
	case aiWarrantyOnly, aiWarrantyExclude:
		out.Warranty = w
	default:
		return out, fmt.Errorf("warranty must be any, only, or exclude")
	}
	out.IncludeLinked = in.IncludeLinked

	switch g := strings.ToLower(strings.TrimSpace(in.GroupBy)); g {
	case "", aiGroupNone:
		out.GroupBy = aiGroupNone
	case aiGroupCustomer, aiGroupModel, aiGroupSerial:
		out.GroupBy = g
	default:
		return out, fmt.Errorf("group_by must be none, customer, model, or serial")
	}

	for _, m := range []struct {
		field string
		v     int
		dst   *int
	}{
		{"min_units", in.MinUnits, &out.MinUnits},
		{"min_model_jobs", in.MinModelJobs, &out.MinModelJobs},
		{"min_serial_jobs", in.MinSerialJobs, &out.MinSerialJobs},
	} {
		if err := validMinCount(m.field, m.v); err != nil {
			return out, err
		}
		*m.dst = m.v
	}

	if out.CreatedFrom, err = validSearchDate("created_from", in.CreatedFrom); err != nil {
		return out, err
	}
	if out.CreatedTo, err = validSearchDate("created_to", in.CreatedTo); err != nil {
		return out, err
	}
	// ISO dates compare correctly as strings.
	if out.CreatedFrom != "" && out.CreatedTo != "" && out.CreatedFrom > out.CreatedTo {
		return out, fmt.Errorf("created_from must be on or before created_to")
	}

	switch {
	case in.Limit <= 0:
		out.Limit = aiSearchDefaultLimit
	case in.Limit > aiSearchMaxLimit:
		out.Limit = aiSearchMaxLimit
	default:
		out.Limit = in.Limit
	}
	if in.Offset < 0 || in.Offset > aiSearchMaxOffset {
		return out, fmt.Errorf("offset must be between 0 and %d", aiSearchMaxOffset)
	}
	out.Offset = in.Offset
	return out, nil
}

// toFilters converts resolved filters back to the public shape (canonical
// status names, defaults filled in) so the UI can show exactly what ran.
func (f aiResolvedSearchFilters) toFilters() AISearchFilters {
	return AISearchFilters{
		Text: f.Text, CustomerName: f.CustomerName, Model: f.Model, Serial: f.Serial,
		Brand: f.Brand, Equipment: f.Equipment, Statuses: f.StatusNames, Warranty: f.Warranty,
		IncludeLinked: f.IncludeLinked, MinUnits: f.MinUnits, MinModelJobs: f.MinModelJobs,
		MinSerialJobs: f.MinSerialJobs, CreatedFrom: f.CreatedFrom, CreatedTo: f.CreatedTo,
		GroupBy: f.GroupBy, Limit: f.Limit, Offset: f.Offset,
	}
}

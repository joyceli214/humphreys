package workorders

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type aiSearchRequest struct {
	Filters AISearchFilters `json:"filters"`
}

type aiSearchResponse struct {
	Filters AISearchFilters `json:"filters"` // normalized filters that actually ran
	Rows    []AISearchRow   `json:"rows"`
	Total   int             `json:"total"`
	Limit   int             `json:"limit"`
	Offset  int             `json:"offset"`
	GroupBy string          `json:"group_by"`
	Groups  []AISearchGroup `json:"groups"`
}

// decodeStrictJSON decodes body into target, rejecting unknown fields and
// trailing data.
func decodeStrictJSON(body []byte, target any) error {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(target); err != nil {
		return err
	}
	if dec.More() {
		return fmt.Errorf("unexpected trailing data")
	}
	return nil
}

// AdvancedSearch executes a whitelisted filter object with parameterized SQL.
// Results carry the customer's display name only, never email or phone.
func (h *Handler) AdvancedSearch(c *gin.Context) {
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 64<<10))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	var req aiSearchRequest
	if err := decodeStrictJSON(raw, &req); err != nil {
		msg := "invalid payload"
		if strings.Contains(err.Error(), "unknown field") {
			msg = "unsupported filter: " + strings.TrimPrefix(err.Error(), "json: ")
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}

	statuses, err := h.service.repo.AIStatuses(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load statuses"})
		return
	}
	filters, err := normalizeSearchFilters(req.Filters, statuses)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rows, total, err := h.service.repo.AISearch(c.Request.Context(), filters)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "search failed"})
		return
	}
	if rows == nil {
		rows = []AISearchRow{}
	}
	c.JSON(http.StatusOK, aiSearchResponse{
		Filters: filters.toFilters(),
		Rows:    rows,
		Total:   total,
		Limit:   filters.Limit,
		Offset:  filters.Offset,
		GroupBy: filters.GroupBy,
		Groups:  groupSearchRows(rows, filters.GroupBy),
	})
}

// groupSearchRows buckets the returned rows by customer, model or serial,
// preserving first-seen order. Rows without a customer / model / serial are
// left out of the groups (they still appear in rows). Model and serial keys
// are compared case-insensitively with surrounding whitespace ignored.
func groupSearchRows(rows []AISearchRow, groupBy string) []AISearchGroup {
	groups := make([]AISearchGroup, 0)
	if groupBy == aiGroupNone || groupBy == "" {
		return groups
	}
	index := map[string]int{}
	for _, row := range rows {
		var key, label string
		switch groupBy {
		case aiGroupCustomer:
			if row.CustomerID == nil {
				continue
			}
			key = fmt.Sprintf("%d", *row.CustomerID)
			label = row.CustomerName
		case aiGroupModel:
			label = strings.TrimSpace(row.ModelNumber)
			key = strings.ToUpper(label)
		case aiGroupSerial:
			label = strings.TrimSpace(row.SerialNumber)
			key = strings.ToUpper(label)
		default:
			return groups
		}
		if key == "" {
			continue
		}
		i, ok := index[key]
		if !ok {
			i = len(groups)
			index[key] = i
			groups = append(groups, AISearchGroup{Key: key, Label: label, JobIDs: []int32{}})
		}
		g := &groups[i]
		g.JobIDs = append(g.JobIDs, row.ReferenceID)
		if groupBy == aiGroupCustomer {
			// Total jobs on file for the customer, not just this page.
			if row.CustomerJobCount > g.UnitCount {
				g.UnitCount = row.CustomerJobCount
			}
			if len(g.JobIDs) > g.UnitCount {
				g.UnitCount = len(g.JobIDs)
			}
		} else {
			g.UnitCount = len(g.JobIDs)
		}
	}
	return groups
}

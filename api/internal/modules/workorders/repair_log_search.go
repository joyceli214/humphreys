package workorders

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	repairLogSearchDefaultPageSize = 20
	repairLogSearchMaxPageSize     = 50
	repairLogSnippetRadius         = 100
)

type RepairLogSearchParams struct {
	Query    string
	From, To *string // YYYY-MM-DD, inclusive
	Job      *int
	Page     int
	PageSize int
}

type RepairLogSearchItem struct {
	RepairLogID     int64      `json:"repair_log_id"`
	ReferenceID     int32      `json:"reference_id"`
	RepairDate      *time.Time `json:"repair_date"`
	HoursUsed       float64    `json:"hours_used"`
	CreatedByUserID string     `json:"created_by_user_id"`
	CreatedByName   *string    `json:"created_by_name"`
	Snippet         string     `json:"snippet"`
	details         string
}

// escapeLike escapes %, _ and \ so user text is matched literally by ILIKE.
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func (r *storeRepository) SearchRepairLogs(ctx context.Context, p RepairLogSearchParams) ([]RepairLogSearchItem, int, error) {
	where, args := []string{"TRUE"}, []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, strings.ReplaceAll(cond, "?", "$"+strconv.Itoa(len(args))))
	}
	if p.Query != "" {
		add(`rl.details ILIKE ? ESCAPE '\'`, "%"+escapeLike(p.Query)+"%")
	}
	if p.From != nil {
		add("rl.repair_date >= ?::date", *p.From)
	}
	if p.To != nil {
		add("rl.repair_date <= ?::date", *p.To)
	}
	if p.Job != nil {
		add("rl.reference_id = ?", *p.Job)
	}
	cond := strings.Join(where, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, `SELECT count(*) FROM public.repair_logs rl WHERE `+cond, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, p.PageSize, (p.Page-1)*p.PageSize)
	rows, err := r.db.Query(ctx, `
		SELECT rl.repair_log_id, rl.reference_id, rl.repair_date, rl.hours_used::double precision,
			rl.created_by_user_id::text, u.full_name, rl.details
		FROM public.repair_logs rl
		LEFT JOIN public.users u ON u.id = rl.created_by_user_id
		WHERE `+cond+`
		ORDER BY rl.repair_date DESC, rl.repair_log_id DESC
		LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []RepairLogSearchItem{}
	for rows.Next() {
		var it RepairLogSearchItem
		if err := rows.Scan(&it.RepairLogID, &it.ReferenceID, &it.RepairDate, &it.HoursUsed, &it.CreatedByUserID, &it.CreatedByName, &it.details); err != nil {
			return nil, 0, err
		}
		items = append(items, it)
	}
	return items, total, rows.Err()
}

var (
	snippetImageRE = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)`)
	snippetURLRE   = regexp.MustCompile(`https?://\S+`)
	snippetSpaceRE = regexp.MustCompile(`\s+`)
)

// repairLogSnippet strips markdown images and raw URLs, then returns about 200
// characters around the first case-insensitive match of query (or the start).
func repairLogSnippet(details, query string) string {
	text := snippetImageRE.ReplaceAllString(details, " ")
	text = snippetURLRE.ReplaceAllString(text, " ")
	text = strings.TrimSpace(snippetSpaceRE.ReplaceAllString(text, " "))
	runes := []rune(text)
	start := 0
	if query != "" {
		lower := []rune(strings.ToLower(text))
		if len(lower) == len(runes) { // same indexing as the original
			if idx := runeIndex(lower, []rune(strings.ToLower(query))); idx >= 0 {
				start = idx - repairLogSnippetRadius
			}
		}
	}
	if start < 0 {
		start = 0
	}
	end := start + 2*repairLogSnippetRadius
	if end > len(runes) {
		end = len(runes)
	}
	out := string(runes[start:end])
	if start > 0 {
		out = "…" + out
	}
	if end < len(runes) {
		out += "…"
	}
	return out
}

func runeIndex(hay, needle []rune) int {
	if len(needle) == 0 {
		return -1
	}
	for i := 0; i+len(needle) <= len(hay); i++ {
		if string(hay[i:i+len(needle)]) == string(needle) {
			return i
		}
	}
	return -1
}

func (s *Service) SearchRepairLogs(ctx context.Context, p RepairLogSearchParams) ([]RepairLogSearchItem, int, error) {
	items, total, err := s.repo.SearchRepairLogs(ctx, p)
	if err != nil {
		return nil, 0, err
	}
	for i := range items {
		items[i].Snippet = repairLogSnippet(items[i].details, p.Query)
	}
	return items, total, nil
}

func (h *Handler) SearchRepairLogs(c *gin.Context) {
	p := RepairLogSearchParams{Query: strings.TrimSpace(c.Query("q")), Page: 1, PageSize: repairLogSearchDefaultPageSize}
	bad := func(msg string) { c.JSON(http.StatusBadRequest, gin.H{"error": msg}) }
	for name, dst := range map[string]**string{"from": &p.From, "to": &p.To} {
		if v := strings.TrimSpace(c.Query(name)); v != "" {
			if _, err := time.Parse("2006-01-02", v); err != nil {
				bad(name + " must be YYYY-MM-DD")
				return
			}
			*dst = &v
		}
	}
	if v := strings.TrimSpace(c.Query("job")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			bad("invalid job")
			return
		}
		p.Job = &n
	}
	if p.Job == nil && len([]rune(p.Query)) < 2 {
		bad("q must be at least 2 characters unless job is given")
		return
	}
	if p.Query != "" && len([]rune(p.Query)) < 2 {
		bad("q must be at least 2 characters")
		return
	}
	if v := c.Query("page"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			bad("invalid page")
			return
		}
		p.Page = n
	}
	if v := c.Query("page_size"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			bad("invalid page_size")
			return
		}
		p.PageSize = min(n, repairLogSearchMaxPageSize)
	}
	items, total, err := h.service.SearchRepairLogs(c.Request.Context(), p)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to search repair logs"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "page": p.Page, "page_size": p.PageSize, "total": total})
}

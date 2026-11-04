package workorders

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func itoa(n int) string { return strconv.Itoa(n) }

// aiStaleThresholdDefault is the default idle threshold, in workdays, used to
// bucket jobs. It can be overridden per request with ?threshold=.
const aiStaleThresholdDefault = 5

// aiStaleBucketUnhandled and aiStaleBucketFinished name the two idle buckets.
const (
	aiStaleBucketUnhandled = "unhandled"
	aiStaleBucketFinished  = "finished_not_picked_up"
)

// AIStaleRow is one idle job rendered for the UI. It carries only non-sensitive
// fields (customer name, never email/phone).
type AIStaleRow struct {
	ReferenceID       int32  `json:"reference_id"`
	CustomerName      string `json:"customer_name"`
	ItemName          string `json:"item_name"`
	StatusName        string `json:"status_name"`
	DaysIdle          int    `json:"days_idle"`
	Bucket            string `json:"bucket"`
	SuggestedNextStep string `json:"suggested_next_step,omitempty"`
}

type jobSummaryStaleResponse struct {
	UnhandledCount    int          `json:"unhandled_count"`
	FinishedCount     int          `json:"finished_not_picked_up_count"`
	ThresholdWorkdays int          `json:"threshold_workdays"`
	Rows              []AIStaleRow `json:"rows"`
}

type jobSummaryResponse struct {
	Summary           string       `json:"summary"`
	UnhandledCount    int          `json:"unhandled_count"`
	FinishedCount     int          `json:"finished_not_picked_up_count"`
	ThresholdWorkdays int          `json:"threshold_workdays"`
	Truncated         bool         `json:"truncated"`
	Model             string       `json:"model"`
	Rows              []AIStaleRow `json:"rows"`
}

// jobSummaryLLMResponse is the strict JSON shape the model must emit: a short
// grouped summary plus an optional suggested next step per job.
type jobSummaryLLMResponse struct {
	Summary string `json:"summary"`
	Jobs    []struct {
		ReferenceID       int32  `json:"reference_id"`
		SuggestedNextStep string `json:"suggested_next_step"`
	} `json:"jobs"`
}

// staleThresholdParam reads an optional ?threshold= override, defaulting to 5
// and clamping to a sane range so a caller cannot ask for a zero/huge window.
func staleThresholdParam(c *gin.Context) int {
	threshold := aiStaleThresholdDefault
	if raw := strings.TrimSpace(c.Query("threshold")); raw != "" {
		if parsed := parsePositiveIntOrDefault(raw, aiStaleThresholdDefault); parsed > 0 {
			threshold = parsed
		}
	}
	if threshold > 60 {
		threshold = 60
	}
	return threshold
}

// staleDaysIdle counts idle workdays since ts. A nil timestamp means we have no
// activity on record, so the job is treated as maximally idle.
func staleDaysIdle(ts *time.Time, now time.Time, loc *time.Location) int {
	if ts == nil {
		return 9999
	}
	return WorkdaysBetween(*ts, now, loc)
}

// classifyStaleCandidates buckets candidates into "unhandled" and "finished but
// not picked up", keeping only jobs idle at least threshold workdays. Rows are
// returned most-idle first.
func classifyStaleCandidates(candidates []AIStaleCandidate, now time.Time, threshold int, loc *time.Location) (rows []AIStaleRow, unhandled, finished int) {
	rows = make([]AIStaleRow, 0, len(candidates))
	for _, cand := range candidates {
		row := AIStaleRow{
			ReferenceID:  cand.ReferenceID,
			CustomerName: cand.CustomerName,
			ItemName:     cand.ItemName,
			StatusName:   cand.StatusName,
		}
		if strings.EqualFold(strings.TrimSpace(cand.StatusGroup), "completed") {
			ref := cand.StatusChangeAt
			if ref == nil {
				ref = cand.LastActivity
			}
			days := staleDaysIdle(ref, now, loc)
			if days < threshold {
				continue
			}
			row.DaysIdle = days
			row.Bucket = aiStaleBucketFinished
			finished++
		} else {
			days := staleDaysIdle(cand.LastActivity, now, loc)
			if days < threshold {
				continue
			}
			row.DaysIdle = days
			row.Bucket = aiStaleBucketUnhandled
			unhandled++
		}
		rows = append(rows, row)
	}
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].DaysIdle > rows[j].DaysIdle })
	return rows, unhandled, finished
}

// JobSummaryStale is the cheap, non-LLM endpoint that powers the count cards and
// the idle-job table without spending any model tokens.
func (h *Handler) JobSummaryStale(c *gin.Context) {
	candidates, err := h.service.repo.AIStaleCandidates(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load jobs"})
		return
	}
	threshold := staleThresholdParam(c)
	rows, unhandled, finished := classifyStaleCandidates(candidates, time.Now(), threshold, torontoLocation())
	c.JSON(http.StatusOK, jobSummaryStaleResponse{
		UnhandledCount:    unhandled,
		FinishedCount:     finished,
		ThresholdWorkdays: threshold,
		Rows:              rows,
	})
}

// JobSummary asks the LLM for a short grouped summary and a suggested next step
// per idle job. Customer contact details are never sent to the model.
func (h *Handler) JobSummary(c *gin.Context) {
	settings, err := h.getAISettings(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI settings"})
		return
	}
	if !settings.HasOpenRouterAPIKey && strings.TrimSpace(settings.OpenRouterAPIKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI is not configured. Add an OpenRouter API key in AI Settings."})
		return
	}

	candidates, err := h.service.repo.AIStaleCandidates(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load jobs"})
		return
	}
	threshold := staleThresholdParam(c)
	rows, unhandled, finished := classifyStaleCandidates(candidates, time.Now(), threshold, torontoLocation())

	// Limit how many jobs are described to the model, most idle first.
	candByRef := make(map[int32]AIStaleCandidate, len(candidates))
	for _, cand := range candidates {
		candByRef[cand.ReferenceID] = cand
	}
	truncated := false
	promptRows := rows
	if len(promptRows) > aiSummaryJobCap {
		promptRows = promptRows[:aiSummaryJobCap]
		truncated = true
	}

	systemPrompt := jobSummarySystemPrompt()
	prompt := buildJobSummaryPrompt(promptRows, candByRef, threshold, truncated)
	text, model, err := h.generateOpenRouterTextOnce(c, settings, systemPrompt, prompt, 2500)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": aiErrorMessage(err)})
		return
	}

	var parsed jobSummaryLLMResponse
	if err := parseStrictLLMJSON(text, &parsed); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	nextSteps := make(map[int32]string, len(parsed.Jobs))
	for _, job := range parsed.Jobs {
		if step := strings.TrimSpace(job.SuggestedNextStep); step != "" {
			nextSteps[job.ReferenceID] = step
		}
	}
	for i := range rows {
		if step, ok := nextSteps[rows[i].ReferenceID]; ok {
			rows[i].SuggestedNextStep = step
		}
	}

	c.JSON(http.StatusOK, jobSummaryResponse{
		Summary:           strings.TrimSpace(parsed.Summary),
		UnhandledCount:    unhandled,
		FinishedCount:     finished,
		ThresholdWorkdays: threshold,
		Truncated:         truncated,
		Model:             model,
		Rows:              rows,
	})
}

func jobSummarySystemPrompt() string {
	return "You are a repair-shop assistant. You are given a list of idle work orders. " +
		"Write a short, grouped plain-text summary (one group for jobs finished and waiting for pickup, one group for unhandled jobs) " +
		"and suggest a concrete next step for each job. " +
		"Never invent customer contact details or prices. " +
		"Respond with STRICT JSON only (no prose, no markdown fences) of the form " +
		`{"summary":"...","jobs":[{"reference_id":123,"suggested_next_step":"..."}]}.`
}

// buildJobSummaryPrompt describes each idle job to the model using only
// non-sensitive fields.
func buildJobSummaryPrompt(rows []AIStaleRow, candByRef map[int32]AIStaleCandidate, threshold int, truncated bool) string {
	var b strings.Builder
	b.WriteString("Idle threshold: ")
	b.WriteString(itoa(threshold))
	b.WriteString(" workdays (Mon-Fri, America/Toronto).\n")
	if truncated {
		b.WriteString("Note: only the most idle jobs are listed; the full list is longer.\n")
	}
	b.WriteString("\nJobs:\n")
	for _, row := range rows {
		cand := candByRef[row.ReferenceID]
		b.WriteString("- Job #")
		b.WriteString(itoa(int(row.ReferenceID)))
		b.WriteString(" | customer: ")
		b.WriteString(nonEmptyOr(row.CustomerName, "Unknown"))
		b.WriteString(" | equipment: ")
		b.WriteString(nonEmptyOr(row.ItemName, "Unknown"))
		b.WriteString(" | status: ")
		b.WriteString(nonEmptyOr(row.StatusName, "Unknown"))
		b.WriteString(" | bucket: ")
		b.WriteString(row.Bucket)
		b.WriteString(" | days idle: ")
		b.WriteString(itoa(row.DaysIdle))
		if parts := strings.TrimSpace(cand.PartsStatus); parts != "" {
			b.WriteString(" | parts: ")
			b.WriteString(parts)
		}
		if log := strings.TrimSpace(cand.RepairLog); log != "" {
			b.WriteString(" | recent log: ")
			b.WriteString(truncateText(log, 240))
		}
		b.WriteString("\n")
	}
	b.WriteString("\nReturn one suggested_next_step per job id above.\n")
	return b.String()
}

func nonEmptyOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func truncateText(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return strings.TrimSpace(string(runes[:max])) + "…"
}

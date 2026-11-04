package workorders

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/modules/aisettings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
)

const (
	// massUpdateWorkDoneJobCap bounds how many jobs one Mass Update request may
	// generate Work Done for (each is a separate LLM call).
	massUpdateWorkDoneJobCap = 10
	// massUpdateWorkDoneMaxChars caps work_done_text, in runes.
	massUpdateWorkDoneMaxChars = 4000
	// workDoneGenerateConcurrency bounds parallel Work Done generations.
	workDoneGenerateConcurrency = 3
	// workDoneBatchMaxTokens is the per-job token budget in Mass Update (about
	// massUpdateWorkDoneMaxChars of text), lower than the per-job endpoint's.
	workDoneBatchMaxTokens = 1200
	// workDoneBatchAttemptTimeout bounds the single LLM request per job.
	workDoneBatchAttemptTimeout = 40 * time.Second
)

// massUpdatePreviewTimeout is the overall deadline for the LLM work of one
// Mass Update preview (the instruction call plus every Work Done job). Jobs
// still running when it fires get an error row; the rest still preview. A var
// so tests can shorten it.
var massUpdatePreviewTimeout = 90 * time.Second

var (
	errWorkDoneFetchWorkOrder  = errors.New("failed to fetch work order")
	errWorkDoneFetchRepairLogs = errors.New("failed to fetch repair logs")
	// errWorkDoneForeignImage means apply was sent Work Done text embedding a
	// managed image that does not belong to the job.
	errWorkDoneForeignImage = errors.New("work done references an image that does not belong to this job")
)

const workDoneForeignImageMessage = "The Work Done text contains an image from another job, so it was not saved. Preview again."

// existingImagePattern detects any embedded image (markdown or <img>).
var existingImagePattern = regexp.MustCompile(`!\[[^\]]*\]\([^)]*\)|(?i)<img\b`)

// workDonePrompt loads the job's repair logs and builds the Work Done prompt
// from them only (no customer email/phone is sent). It returns
// ErrWorkOrderNotFound or an error wrapping errWorkDoneFetchWorkOrder /
// errWorkDoneFetchRepairLogs.
func (h *Handler) workDonePrompt(ctx context.Context, settings aisettings.Settings, referenceID int) (string, error) {
	if _, err := h.service.GetWorkOrderDetail(ctx, referenceID); err != nil {
		if errors.Is(err, ErrWorkOrderNotFound) {
			return "", err
		}
		return "", fmt.Errorf("%w: %v", errWorkDoneFetchWorkOrder, err)
	}
	repairLogs, err := h.service.ListRepairLogs(ctx, referenceID)
	if err != nil {
		return "", fmt.Errorf("%w: %v", errWorkDoneFetchRepairLogs, err)
	}
	return buildWorkDoneFromRepairLogsPrompt(settings.WorkDonePrompt, repairLogs), nil
}

// generateWorkDoneText writes a job's Work Done for the per-job endpoint (with
// the usual retries and fallback model). It returns the workDonePrompt errors
// or the raw LLM error.
func (h *Handler) generateWorkDoneText(c *gin.Context, settings aisettings.Settings, referenceID int) (string, string, error) {
	prompt, err := h.workDonePrompt(c.Request.Context(), settings, referenceID)
	if err != nil {
		return "", "", err
	}
	return h.generateOpenRouterSummaryOnce(c, settings, prompt)
}

// generateWorkDoneTextBatch is the Mass Update variant: exactly one LLM
// attempt per job (no retries, no fallback model) with a smaller token budget,
// so a 10-job preview cannot multiply into dozens of slow calls.
func (h *Handler) generateWorkDoneTextBatch(ctx context.Context, settings aisettings.Settings, referenceID int) (string, error) {
	prompt, err := h.workDonePrompt(ctx, settings, referenceID)
	if err != nil {
		return "", err
	}
	text, _, err := h.generateOpenRouterTextSingle(ctx, settings, aisettings.DefaultSystemPrompt, prompt, workDoneBatchMaxTokens, workDoneBatchAttemptTimeout)
	return text, err
}

func (h *Handler) workDoneGen() func(context.Context, aisettings.Settings, int) (string, error) {
	if h.workDoneGenerator != nil {
		return h.workDoneGenerator
	}
	return h.generateWorkDoneTextBatch
}

// clearLLMWorkDoneText drops any work_done_text the mass-update LLM emitted:
// Work Done text only ever comes from the repair-log generator.
func clearLLMWorkDoneText(ops []MassUpdateOp) []MassUpdateOp {
	out := make([]MassUpdateOp, len(ops))
	for i, op := range ops {
		op.WorkDoneText = nil
		out[i] = op
	}
	return out
}

func countWorkDoneOps(ops []MassUpdateOp) int {
	n := 0
	for _, op := range ops {
		if op.Op == massOpGenerateWorkDone {
			n++
		}
	}
	return n
}

// chargeWorkDoneRateLimit consumes one shared LLM slot per job to generate,
// all-or-nothing: if the user does not have every slot free, none is charged.
// It returns false (after writing 429) when the user is over the limit.
func (h *Handler) chargeWorkDoneRateLimit(c *gin.Context, jobs int) bool {
	if h.aiLimiter == nil || jobs == 0 {
		return true
	}
	key := aiToolsActor(c)
	if key == "" {
		key = "ip:" + c.ClientIP()
	}
	if ok, wait := h.aiLimiter.allowNAt(key, jobs, time.Now()); !ok {
		secs := int(math.Max(1, math.Ceil(wait.Seconds())))
		c.Header("Retry-After", strconv.Itoa(secs))
		c.JSON(http.StatusTooManyRequests, gin.H{"error": fmt.Sprintf("Generating Work Done for %d jobs needs more AI requests than you have left; try again in %d seconds.", jobs, secs)})
		return false
	}
	return true
}

// workDonePreviewMessage is the top-level preview message when some Work Done
// generations failed (empty when none did).
func workDonePreviewMessage(errs map[int32]string, jobs int, timedOut bool) string {
	if len(errs) == 0 {
		return ""
	}
	msg := fmt.Sprintf("Work Done could not be generated for %d of %d jobs; those rows show why. The other changes can still be applied.", len(errs), jobs)
	if timedOut {
		msg += " The AI took too long, so the preview stopped waiting."
	}
	return msg
}

// fillGeneratedWorkDone generates Work Done text for each generate_work_done op
// in place. It returns a per-job user-facing error for jobs that failed (their
// text stays nil so the row is invalid). ops must already be deduped and
// validated against the job cap so nothing over the cap is generated. Jobs
// still running (or not started) when ctx ends fail with a timeout error.
func (h *Handler) fillGeneratedWorkDone(ctx context.Context, settings aisettings.Settings, ops []MassUpdateOp) map[int32]string {
	gen := h.workDoneGen()
	errs := make(map[int32]string)
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, workDoneGenerateConcurrency)
	for i := range ops {
		if ops[i].Op != massOpGenerateWorkDone {
			continue
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			ref := ops[i].ReferenceID
			var text string
			err := ctx.Err()
			if err == nil {
				text, err = gen(ctx, settings, int(ref))
			}
			text = strings.TrimSpace(text)
			msg := ""
			switch {
			case err != nil && ctx.Err() != nil:
				// Overall preview deadline: report it as a timeout even if it
				// surfaced as a wrapped DB error.
				msg = "Work Done could not be generated: " + aiErrorMessage(context.DeadlineExceeded)
			case errors.Is(err, ErrWorkOrderNotFound):
				msg = fmt.Sprintf("Job #%d was not found.", ref)
			case errors.Is(err, errWorkDoneFetchWorkOrder), errors.Is(err, errWorkDoneFetchRepairLogs):
				msg = "Work Done could not be generated: the job's repair logs could not be loaded."
			case err != nil:
				log.Printf("[ai] mass-update work-done job %d: %v", ref, redactAIError(err.Error(), settings.OpenRouterAPIKey))
				msg = "Work Done could not be generated: " + redactAIError(aiErrorMessage(err), settings.OpenRouterAPIKey)
			case text == "":
				msg = "Work Done could not be generated: AI returned an empty response."
			case utf8.RuneCountInString(text) > massUpdateWorkDoneMaxChars:
				msg = fmt.Sprintf("Work Done could not be generated: the text was longer than %d characters.", massUpdateWorkDoneMaxChars)
			default:
				ops[i].WorkDoneText = &text
			}
			if msg != "" {
				mu.Lock()
				errs[ref] = msg
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	return errs
}

// applyWorkDoneGenErrors replaces the generic "no text" error on rows whose
// generation failed with the actual reason.
func applyWorkDoneGenErrors(rows []MassUpdatePreviewRow, errs map[int32]string) {
	for i := range rows {
		if msg, ok := errs[rows[i].ReferenceID]; ok && rows[i].Operation.Op == massOpGenerateWorkDone && !rows[i].Valid {
			rows[i].Error = msg
		}
	}
}

// validateWorkDoneOps enforces the Work Done job cap and text length.
func validateWorkDoneOps(ops []MassUpdateOp) error {
	jobs := make(map[int32]bool)
	for _, op := range ops {
		if op.Op == massOpGenerateWorkDone {
			jobs[op.ReferenceID] = true
		}
		if op.WorkDoneText != nil && utf8.RuneCountInString(*op.WorkDoneText) > massUpdateWorkDoneMaxChars {
			return fmt.Errorf("job #%d: work_done_text is too long (max %d characters)", op.ReferenceID, massUpdateWorkDoneMaxChars)
		}
	}
	if len(jobs) > massUpdateWorkDoneJobCap {
		return fmt.Errorf("Generate Work Done is limited to %d jobs per request.", massUpdateWorkDoneJobCap)
	}
	return nil
}

// applyWorkDoneOpToRow validates a generate_work_done op for preview/apply.
// It also flags rows whose job already has Work Done (applying replaces it),
// so the client leaves them unchecked by default.
func applyWorkDoneOpToRow(row *MassUpdatePreviewRow, op MassUpdateOp, detail *domain.WorkOrderDetail, resolved massUpdateResolvedOp) (massUpdateResolvedOp, bool) {
	existing := strings.TrimSpace(stringValue(detail.WorkDone))
	row.HasExistingWorkDone = existing != ""
	row.ExistingWorkDoneHasImages = existing != "" && existingImagePattern.MatchString(existing)
	if row.HasExistingWorkDone {
		row.Warning = "Has existing Work Done; applying replaces it"
		if row.ExistingWorkDoneHasImages {
			row.Warning += " (contains images)"
		}
	}
	resolved.PreviousWorkDone = detail.WorkDone

	text := strings.TrimSpace(stringValue(op.WorkDoneText))
	if text == "" {
		row.Error = "There is no generated Work Done text to save. Preview again."
		return resolved, false
	}
	if utf8.RuneCountInString(text) > massUpdateWorkDoneMaxChars {
		row.Error = fmt.Sprintf("Work Done text is too long (max %d characters).", massUpdateWorkDoneMaxChars)
		return resolved, false
	}
	row.Before = stringValueOrDefault(detail.WorkDone, "—")
	row.After = text
	row.AmountDelta = 0
	resolved.WorkDoneText = &text
	return resolved, true
}

// workDoneImageStore is the subset of uploads.Handler the Work Done apply
// path uses (the same helpers UpdateWorkNotes uses).
type workDoneImageStore interface {
	Enabled() bool
	ManagedImageKeys(markdown string) []string
	PromoteTempImagesInMarkdown(ctx context.Context, markdown string, referenceID int, userID string) (string, error)
	NormalizeMarkdownImageURLsForStorage(markdown string) string
	DeleteRemovedManagedImages(ctx context.Context, previousMarkdown, nextMarkdown string)
}

// workDoneImages returns the uploads handler, or nil when not configured
// (avoiding a typed-nil interface).
func (h *Handler) workDoneImages() workDoneImageStore {
	if h.uploads == nil {
		return nil
	}
	return h.uploads
}

// prepareWorkDoneForApply makes client-sent Work Done text safe to store, the
// same way UpdateWorkNotes does (PromoteTempImagesInMarkdown then
// NormalizeMarkdownImageURLsForStorage).
//
// Apply never trusts the echoed text, so before any image is touched every
// managed-image key must belong to this job ("markdown/<ref>/...") or be the
// acting user's own temp upload ("markdown-temp/<user>/...", promoted into
// this job). Anything else, e.g. another job's image, is REJECTED with
// errWorkDoneForeignImage rather than stripped: generated text only ever
// contains this job's images, so a foreign key means tampering, and rejecting
// is simpler and cannot silently save altered text. Keys that are not in
// canonical form (".." segments, "//") are rejected too.
func prepareWorkDoneForApply(ctx context.Context, store workDoneImageStore, text string, referenceID int, userID string) (string, error) {
	text = strings.TrimSpace(text)
	if store == nil || !store.Enabled() {
		return text, nil
	}
	userID = strings.TrimSpace(userID)
	jobPrefix := fmt.Sprintf("markdown/%d/", referenceID)
	tempPrefix := "markdown-temp/" + userID + "/"
	for _, key := range store.ManagedImageKeys(text) {
		if path.Clean(key) != key {
			return "", errWorkDoneForeignImage
		}
		if strings.HasPrefix(key, jobPrefix) || (userID != "" && strings.HasPrefix(key, tempPrefix)) {
			continue
		}
		return "", errWorkDoneForeignImage
	}
	promoted, err := store.PromoteTempImagesInMarkdown(ctx, text, referenceID, userID)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(store.NormalizeMarkdownImageURLsForStorage(promoted)), nil
}

// prepareWorkDoneOps runs prepareWorkDoneForApply on each generate_work_done
// op of one job. It returns a copy of ops with the stored text, plus the
// job's previous Work Done and final text for image cleanup (hasWorkDone is
// false when the job has no Work Done op).
func prepareWorkDoneOps(ctx context.Context, store workDoneImageStore, referenceID int, userID string, ops []massUpdateResolvedOp) (out []massUpdateResolvedOp, previous, final string, hasWorkDone bool, err error) {
	out = make([]massUpdateResolvedOp, len(ops))
	copy(out, ops)
	for i := range out {
		if out[i].Op != massOpGenerateWorkDone || out[i].WorkDoneText == nil {
			continue
		}
		text, err := prepareWorkDoneForApply(ctx, store, *out[i].WorkDoneText, referenceID, userID)
		if err != nil {
			return nil, "", "", false, err
		}
		if text == "" {
			return nil, "", "", false, errors.New("generate_work_done requires work_done_text")
		}
		if !hasWorkDone {
			previous = stringValue(out[i].PreviousWorkDone)
		}
		hasWorkDone = true
		final = text
		out[i].WorkDoneText = &text
	}
	return out, previous, final, hasWorkDone, nil
}

// applyWorkDoneTx writes work_done inside the apply transaction and returns
// the audit before/after values.
func applyWorkDoneTx(ctx context.Context, tx pgx.Tx, referenceID int, text *string) (map[string]any, map[string]any, error) {
	if text == nil || strings.TrimSpace(*text) == "" {
		return nil, nil, errors.New("generate_work_done requires work_done_text")
	}
	var before *string
	if err := tx.QueryRow(ctx, `SELECT work_done FROM public.work_orders WHERE reference_id = $1 FOR UPDATE`, referenceID).Scan(&before); err != nil {
		return nil, nil, err
	}
	if _, err := tx.Exec(ctx, `UPDATE public.work_orders SET work_done = $2, updated_at = now() WHERE reference_id = $1`, referenceID, *text); err != nil {
		return nil, nil, err
	}
	return map[string]any{"work_done": before}, map[string]any{"work_done": *text}, nil
}

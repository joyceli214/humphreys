package workorders

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"humphreys/api/internal/domain"

	"github.com/gin-gonic/gin"
)

type massUpdatePreviewRequest struct {
	Instruction string `json:"instruction"`
}

// MassUpdatePreviewRow is one proposed change rendered as before -> after. The
// client echoes Operation back to the apply endpoint for the rows the admin
// keeps checked. Only CustomerName (never email/phone) is exposed.
type MassUpdatePreviewRow struct {
	Operation       MassUpdateOp `json:"operation"`
	ReferenceID     int32        `json:"reference_id"`
	CustomerName    string       `json:"customer_name"`
	Field           string       `json:"field"`
	Before          string       `json:"before"`
	After           string       `json:"after"`
	LowerThanBefore bool         `json:"lower_than_before"`
	Valid           bool         `json:"valid"`
	Error           string       `json:"error,omitempty"`
	// AmountDelta is the change (in dollars, rounded to cents) this op makes to
	// the job's total; 0 for invalid rows and non-money ops.
	AmountDelta float64 `json:"amount_delta"`
	// UpdatedAt is the job's work_orders.updated_at when previewed (null if the
	// column is NULL). The client sends it back per job on apply so a job that
	// changed since the preview is rejected instead of overwritten.
	UpdatedAt *time.Time `json:"updated_at"`
	// HasExistingWorkDone (generate_work_done rows) is true when the job's
	// current Work Done is non-empty, so applying would replace it.
	HasExistingWorkDone bool `json:"has_existing_work_done"`
	// ExistingWorkDoneHasImages is true when that existing Work Done embeds
	// images (applying replaces them and deletes removed managed images).
	ExistingWorkDoneHasImages bool `json:"existing_work_done_has_images"`
	// DefaultSelected is whether the client should check the row initially:
	// valid rows are, except Work Done rows that would replace existing text.
	DefaultSelected bool `json:"default_selected"`
	// Warning is a non-blocking notice shown with the row.
	Warning string `json:"warning,omitempty"`
}

type massUpdatePreviewResponse struct {
	Rows  []MassUpdatePreviewRow `json:"rows"`
	Model string                 `json:"model"`
	// Message summarises partial failures (e.g. some Work Done generations
	// failed or timed out); empty when everything previewed.
	Message string `json:"message,omitempty"`
}

type massUpdateApplyRequest struct {
	Operations []MassUpdateOp `json:"operations"`
	// ExpectedUpdatedAt maps reference_id to the updated_at from the preview. A
	// null value means the job had no updated_at; a missing key rejects the job.
	ExpectedUpdatedAt map[int32]*time.Time `json:"expected_updated_at"`
}

// ErrMassUpdateStale means the job was modified after the preview was built.
var ErrMassUpdateStale = errors.New("work order changed since preview")

const (
	massUpdateStaleMessage          = "This job was changed after the preview was created. Preview again before applying."
	massUpdateMissingVersionMessage = "This job's preview timestamp is missing. Preview again before applying."
)

// MassUpdateApplyResult reports the outcome of one job's operations.
type MassUpdateApplyResult struct {
	ReferenceID int32    `json:"reference_id"`
	Success     bool     `json:"success"`
	Applied     []string `json:"applied"`
	Error       string   `json:"error,omitempty"`
}

type massUpdateApplyResponse struct {
	Results []MassUpdateApplyResult `json:"results"`
}

type llmOperationsEnvelope struct {
	Operations []MassUpdateOp `json:"operations"`
}

// MassUpdatePreview turns a natural-language instruction into structured,
// strictly validated operations and returns an exact before -> after preview.
// Nothing is written to the database here.
func (h *Handler) MassUpdatePreview(c *gin.Context) {
	var req massUpdatePreviewRequest
	if !bindAIToolsJSON(c, &req) {
		return
	}
	instruction := strings.TrimSpace(req.Instruction)
	if instruction == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Describe what should change."})
		return
	}
	if err := checkTextLength("instruction", instruction); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	settings, err := h.getAISettings(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load the AI settings."})
		return
	}
	if !settings.HasOpenRouterAPIKey && strings.TrimSpace(settings.OpenRouterAPIKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI is not set up yet. Add an OpenRouter API key in AI Settings."})
		return
	}

	statuses, err := h.service.repo.AIStatuses(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load the job statuses."})
		return
	}
	locations, err := h.service.repo.AILocations(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load the locations."})
		return
	}

	// One deadline covers all LLM work of this preview (the instruction call
	// and every Work Done job). DB reads below use the request context so the
	// rows still build after the deadline.
	llmCtx, cancel := context.WithTimeout(c.Request.Context(), massUpdatePreviewTimeout)
	defer cancel()

	systemPrompt := massUpdateSystemPrompt()
	prompt := buildMassUpdatePrompt(instruction, statuses, locations)
	text, model, err := h.generateOpenRouterTextCtx(llmCtx, settings, systemPrompt, prompt, 2000)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": aiErrorMessage(err)})
		return
	}

	var envelope llmOperationsEnvelope
	if err := parseStrictLLMJSON(text, &envelope); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	// Validate caps before generating any Work Done so nothing over the cap
	// spends LLM calls; Work Done text only ever comes from the repair logs.
	ops := dedupeMassUpdateOps(clearLLMWorkDoneText(envelope.Operations))
	if err := validateMassUpdateOps(ops); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The AI's suggested changes could not be previewed: " + err.Error()})
		return
	}
	var workDoneErrs map[int32]string
	message := ""
	if n := countWorkDoneOps(ops); n > 0 {
		if !h.chargeWorkDoneRateLimit(c, n) {
			return
		}
		workDoneErrs = h.fillGeneratedWorkDone(llmCtx, settings, ops)
		message = workDonePreviewMessage(workDoneErrs, n, errors.Is(llmCtx.Err(), context.DeadlineExceeded))
	}

	rows, _, err := h.buildMassUpdateRows(c.Request.Context(), ops, statuses, locations)
	if err != nil {
		// Over a cap: reject rather than silently dropping jobs the admin asked about.
		c.JSON(http.StatusBadRequest, gin.H{"error": "The AI's suggested changes could not be previewed: " + err.Error()})
		return
	}
	applyWorkDoneGenErrors(rows, workDoneErrs)
	c.JSON(http.StatusOK, massUpdatePreviewResponse{Rows: rows, Model: model, Message: message})
}

// MassUpdateApply re-validates every operation server-side (it never trusts the
// client's preview), then applies each job in its own transaction so one
// failure does not block the others. It returns per-job success/failure.
func (h *Handler) MassUpdateApply(c *gin.Context) {
	userID := aiToolsActor(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "You are not signed in."})
		return
	}

	var req massUpdateApplyRequest
	if !bindAIToolsJSON(c, &req) {
		return
	}
	if len(req.Operations) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "There are no changes to apply."})
		return
	}

	statuses, err := h.service.repo.AIStatuses(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load the job statuses."})
		return
	}
	locations, err := h.service.repo.AILocations(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Could not load the locations."})
		return
	}

	rows, resolvedByJob, err := h.buildMassUpdateRows(c.Request.Context(), req.Operations, statuses, locations)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Preserve the order jobs first appear, and track the first validation error
	// per job so an invalid op fails its whole job atomically.
	order := make([]int32, 0)
	seen := make(map[int32]bool)
	firstError := make(map[int32]string)
	for _, row := range rows {
		if !seen[row.ReferenceID] {
			seen[row.ReferenceID] = true
			order = append(order, row.ReferenceID)
		}
		if !row.Valid && firstError[row.ReferenceID] == "" {
			firstError[row.ReferenceID] = row.Error
		}
	}

	results := make([]MassUpdateApplyResult, 0, len(order))
	for _, ref := range order {
		if msg := firstError[ref]; msg != "" {
			results = append(results, MassUpdateApplyResult{ReferenceID: ref, Success: false, Error: msg})
			continue
		}
		expected, ok := req.ExpectedUpdatedAt[ref]
		if !ok {
			results = append(results, MassUpdateApplyResult{ReferenceID: ref, Success: false, Error: massUpdateMissingVersionMessage})
			continue
		}
		ops := resolvedByJob[ref]
		if len(ops) == 0 {
			results = append(results, MassUpdateApplyResult{ReferenceID: ref, Success: false, Error: "This job has no valid changes to apply."})
			continue
		}
		// Work Done text gets the same image handling as UpdateWorkNotes, and
		// images from other jobs are rejected (see prepareWorkDoneForApply).
		store := h.workDoneImages()
		ops, previousWorkDone, finalWorkDone, hasWorkDone, prepErr := prepareWorkDoneOps(c.Request.Context(), store, int(ref), userID, ops)
		if prepErr != nil {
			msg := "The Work Done images could not be processed."
			if errors.Is(prepErr, errWorkDoneForeignImage) {
				msg = workDoneForeignImageMessage
			}
			results = append(results, MassUpdateApplyResult{ReferenceID: ref, Success: false, Error: msg})
			continue
		}
		applied, applyErr := h.service.repo.ApplyMassUpdateJob(c.Request.Context(), int(ref), expected, ops, userID)
		if applyErr != nil {
			results = append(results, MassUpdateApplyResult{ReferenceID: ref, Success: false, Error: applyErrorMessage(applyErr)})
			continue
		}
		if hasWorkDone && store != nil {
			store.DeleteRemovedManagedImages(c.Request.Context(), previousWorkDone, finalWorkDone)
		}
		results = append(results, MassUpdateApplyResult{ReferenceID: ref, Success: true, Applied: applied})
	}

	c.JSON(http.StatusOK, massUpdateApplyResponse{Results: results})
}

func applyErrorMessage(err error) string {
	switch {
	case errors.Is(err, ErrMassUpdateStale):
		return massUpdateStaleMessage
	case errors.Is(err, ErrInvalidLabourDiscount):
		return err.Error()
	case errors.Is(err, ErrWorkOrderNotFound):
		return "Job not found."
	case errors.Is(err, ErrLineItemNotFound):
		return "Line item not found."
	case errors.Is(err, ErrLocationNotFound):
		return "Location not found."
	default:
		return "The changes could not be applied."
	}
}

// buildMassUpdateRows validates each op and renders a preview row. Valid rows
// also yield resolved ops grouped by job for the apply path. A batch over the
// job / op / text caps is rejected with an error before any job is loaded;
// nothing is ever silently dropped.
func (h *Handler) buildMassUpdateRows(ctx context.Context, ops []MassUpdateOp, statuses []AIStatusOption, locations []AILocationOption) ([]MassUpdatePreviewRow, map[int32][]massUpdateResolvedOp, error) {
	// Drop repeated identical ops (the LLM sometimes repeats itself) so e.g.
	// "add Shipping $15" can never be added twice. Runs on preview and apply.
	ops = dedupeMassUpdateOps(ops)
	if err := validateMassUpdateOps(ops); err != nil {
		return nil, nil, err
	}

	statusByName := make(map[string]AIStatusOption, len(statuses))
	for _, s := range statuses {
		statusByName[normalizeLookupName(s.Name)] = s
	}
	locationByName := newLocationLookup(locations)

	// Last explicit labour-total change per job sets the labour used to validate
	// an amount discount in the same batch.
	labourOverride := make(map[int32]float64)
	for _, op := range ops {
		if op.Op == massOpSetLabourTotal && op.LabourTotal != nil {
			labourOverride[op.ReferenceID] = *op.LabourTotal
		}
	}

	detailCache := make(map[int32]*domain.WorkOrderDetail)
	detailErr := make(map[int32]bool)
	loadDetail := func(ref int32) *domain.WorkOrderDetail {
		if d, ok := detailCache[ref]; ok {
			return d
		}
		if detailErr[ref] {
			return nil
		}
		detail, err := h.service.GetWorkOrderDetail(ctx, int(ref))
		if err != nil {
			detailErr[ref] = true
			return nil
		}
		detailCache[ref] = &detail
		return &detail
	}

	rows := make([]MassUpdatePreviewRow, 0, len(ops))
	resolvedByJob := make(map[int32][]massUpdateResolvedOp)

	for _, op := range ops {
		row := MassUpdatePreviewRow{Operation: op, ReferenceID: op.ReferenceID}
		detail := loadDetail(op.ReferenceID)
		if detail == nil {
			row.Field = massOpField(op.Op)
			row.Error = fmt.Sprintf("Job #%d was not found.", op.ReferenceID)
			rows = append(rows, row)
			continue
		}
		row.CustomerName = aiCustomerName(*detail)
		row.UpdatedAt = detail.UpdatedAt

		var overrideLabour *float64
		if v, ok := labourOverride[op.ReferenceID]; ok {
			overrideLabour = &v
		}
		resolved, ok := applyOpToRow(&row, op, detail, statusByName, locationByName, overrideLabour)
		row.Valid = ok
		row.DefaultSelected = ok && !row.HasExistingWorkDone
		rows = append(rows, row)
		if ok {
			resolvedByJob[op.ReferenceID] = append(resolvedByJob[op.ReferenceID], resolved)
		}
	}

	return rows, resolvedByJob, nil
}

// dedupeMassUpdateOps keeps the first occurrence of each identical op (same job,
// same op type, same values). Strings compare trimmed and case-insensitively.
func dedupeMassUpdateOps(ops []MassUpdateOp) []MassUpdateOp {
	seen := make(map[string]bool, len(ops))
	out := make([]MassUpdateOp, 0, len(ops))
	for _, op := range ops {
		key := massUpdateOpKey(op)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, op)
	}
	return out
}

func massUpdateOpKey(op MassUpdateOp) string {
	f := func(v *float64) string {
		if v == nil {
			return "-"
		}
		return fmt.Sprintf("%.4f", *v)
	}
	s := func(v *string) string {
		if v == nil {
			return "-"
		}
		return "=" + normalizeLookupName(*v)
	}
	i := func(v *int64) string {
		if v == nil {
			return "-"
		}
		return fmt.Sprintf("%d", *v)
	}
	return strings.Join([]string{
		fmt.Sprintf("%d", op.ReferenceID),
		strings.ToLower(strings.TrimSpace(op.Op)),
		f(op.LabourTotal), s(op.DiscountType), f(op.DiscountValue), i(op.LineItemID),
		f(op.UnitPrice), s(op.ItemName), s(op.QuantityText), s(op.StatusName), s(op.LocationName),
		s(op.WorkDoneText),
	}, "\x1f")
}

func massOpField(op string) string {
	switch op {
	case massOpSetLabourTotal:
		return "Labour total"
	case massOpSetLabourDiscount:
		return "Labour discount"
	case massOpSetLineItemPrice:
		return "Line item price"
	case massOpAddLineItem:
		return "Add line item"
	case massOpRemoveLineItem:
		return "Remove line item"
	case massOpSetStatus:
		return "Status"
	case massOpSetLocation:
		return "Location"
	case massOpGenerateWorkDone:
		return "Work done"
	default:
		return "Change"
	}
}

// applyOpToRow validates one op against the job detail and fills in the preview
// row's Field/Before/After. It returns the resolved op and whether it is valid.
func applyOpToRow(row *MassUpdatePreviewRow, op MassUpdateOp, detail *domain.WorkOrderDetail, statusByName map[string]AIStatusOption, locationByName locationLookup, overrideLabour *float64) (massUpdateResolvedOp, bool) {
	row.Field = massOpField(op.Op)
	resolved := massUpdateResolvedOp{Op: op.Op}

	switch op.Op {
	case massOpSetLabourTotal:
		if op.LabourTotal == nil || !isFiniteNonNegative(*op.LabourTotal) {
			row.Error = "Labour total must be zero or more."
			return resolved, false
		}
		current := float64Value(detail.LabourTotal)
		row.Before = aiMoney(current)
		row.After = aiMoney(*op.LabourTotal)
		row.LowerThanBefore = *op.LabourTotal < current
		row.AmountDelta = labourTotalDelta(current, *op.LabourTotal)
		resolved.LabourTotal = op.LabourTotal
		return resolved, true

	case massOpSetLabourDiscount:
		kind := strings.TrimSpace(strings.ToLower(stringValue(op.DiscountType)))
		if kind != "percent" && kind != "amount" {
			row.Error = `Discount type must be "percent" or "amount".`
			return resolved, false
		}
		if op.DiscountValue == nil {
			row.Error = "A discount value is required."
			return resolved, false
		}
		labour := detail.LabourTotal
		if overrideLabour != nil {
			labour = overrideLabour
		}
		if err := ValidateLabourDiscount(&kind, op.DiscountValue, labour); err != nil {
			row.Error = err.Error()
			return resolved, false
		}
		row.Before = describeDiscount(detail.LabourDiscountType, detail.LabourDiscountValue)
		row.After = describeDiscount(&kind, op.DiscountValue)
		row.AmountDelta = labourDiscountDelta(detail, kind, *op.DiscountValue, float64Value(labour))
		resolved.DiscountType = &kind
		resolved.DiscountValue = op.DiscountValue
		return resolved, true

	case massOpSetLineItemPrice:
		if op.LineItemID == nil || *op.LineItemID <= 0 {
			row.Error = "A line item ID is required."
			return resolved, false
		}
		if op.UnitPrice == nil || !isFiniteNonNegative(*op.UnitPrice) {
			row.Error = "Price must be zero or more."
			return resolved, false
		}
		line, found := findLineItem(detail, *op.LineItemID)
		if !found {
			row.Error = fmt.Sprintf("Line item #%d was not found on this job.", *op.LineItemID)
			return resolved, false
		}
		row.Field = fmt.Sprintf("Line item %q price", stringValueOrDefault(line.ItemName, "item"))
		row.Before = aiMoney(float64Value(line.UnitPrice))
		row.After = aiMoney(*op.UnitPrice)
		row.LowerThanBefore = *op.UnitPrice < float64Value(line.UnitPrice)
		row.AmountDelta = lineItemPriceDelta(line, *op.UnitPrice)
		resolved.LineItemID = op.LineItemID
		resolved.UnitPrice = op.UnitPrice
		return resolved, true

	case massOpAddLineItem:
		name := strings.TrimSpace(stringValue(op.ItemName))
		if name == "" {
			row.Error = "An item name is required."
			return resolved, false
		}
		if op.UnitPrice != nil && !isFiniteNonNegative(*op.UnitPrice) {
			row.Error = "Price must be zero or more."
			return resolved, false
		}
		row.Before = "—"
		if op.UnitPrice != nil {
			row.After = fmt.Sprintf("%s @ %s", name, aiMoney(*op.UnitPrice))
		} else {
			row.After = name
		}
		row.AmountDelta = addLineItemDelta(op.UnitPrice, op.QuantityText)
		resolved.ItemName = &name
		resolved.UnitPrice = op.UnitPrice
		resolved.QuantityText = op.QuantityText
		return resolved, true

	case massOpRemoveLineItem:
		if op.LineItemID == nil || *op.LineItemID <= 0 {
			row.Error = "A line item ID is required."
			return resolved, false
		}
		line, found := findLineItem(detail, *op.LineItemID)
		if !found {
			row.Error = fmt.Sprintf("Line item #%d was not found on this job.", *op.LineItemID)
			return resolved, false
		}
		row.Before = fmt.Sprintf("%s @ %s", stringValueOrDefault(line.ItemName, "item"), aiMoney(float64Value(line.UnitPrice)))
		row.After = "—"
		row.AmountDelta = removeLineItemDelta(line)
		resolved.LineItemID = op.LineItemID
		return resolved, true

	case massOpSetStatus:
		name := strings.TrimSpace(stringValue(op.StatusName))
		if name == "" {
			row.Error = "A status name is required."
			return resolved, false
		}
		match, ok := statusByName[normalizeLookupName(name)]
		if !ok {
			row.Error = fmt.Sprintf("Unknown status %q.", name)
			return resolved, false
		}
		row.Before = stringValueOrDefault(detail.StatusName, "—")
		row.After = match.Name
		id := match.ID
		resolved.StatusID = &id
		return resolved, true

	case massOpSetLocation:
		name := strings.TrimSpace(stringValue(op.LocationName))
		if name == "" {
			row.Error = "A location name is required."
			return resolved, false
		}
		match, errMsg := locationByName.resolve(name)
		if errMsg != "" {
			row.Error = errMsg
			return resolved, false
		}
		row.Before = aiLocationLabel(detail.LocationShelf, detail.LocationFloor)
		row.After = match.Label()
		id := match.ID
		resolved.LocationID = &id
		return resolved, true

	case massOpGenerateWorkDone:
		return applyWorkDoneOpToRow(row, op, detail, resolved)

	default:
		row.Error = fmt.Sprintf("Unsupported change type %q.", op.Op)
		return resolved, false
	}
}

// locationLookup resolves a location name to a location. The full
// "<shelf>-<floor>" label always matches; a bare shelf name is accepted only
// when that shelf has exactly one floor, so it never silently picks a floor.
type locationLookup struct {
	byLabel map[string]AILocationOption
	byShelf map[string][]AILocationOption
}

func newLocationLookup(locations []AILocationOption) locationLookup {
	lk := locationLookup{
		byLabel: make(map[string]AILocationOption, len(locations)),
		byShelf: make(map[string][]AILocationOption),
	}
	for _, l := range locations {
		lk.byLabel[normalizeLookupName(l.Label())] = l
		if shelf := normalizeLookupName(l.Shelf); shelf != "" {
			lk.byShelf[shelf] = append(lk.byShelf[shelf], l)
		}
	}
	return lk
}

// resolve returns the matching location, or a user-facing error message when
// the name is unknown or a bare shelf name matches more than one floor.
func (lk locationLookup) resolve(name string) (AILocationOption, string) {
	key := normalizeLookupName(name)
	if match, ok := lk.byLabel[key]; ok {
		return match, ""
	}
	candidates := lk.byShelf[key]
	switch len(candidates) {
	case 0:
		return AILocationOption{}, fmt.Sprintf("Unknown location %q.", name)
	case 1:
		return candidates[0], ""
	default:
		labels := make([]string, len(candidates))
		for i, c := range candidates {
			labels[i] = c.Label()
		}
		return AILocationOption{}, fmt.Sprintf("Location %q is ambiguous. Specify one of: %s.", name, strings.Join(labels, ", "))
	}
}

func findLineItem(detail *domain.WorkOrderDetail, lineItemID int64) (domain.WorkOrderLineItem, bool) {
	for _, li := range detail.LineItems {
		if li.LineItemID == lineItemID {
			return li, true
		}
	}
	return domain.WorkOrderLineItem{}, false
}

// massUpdateAuditEntry records one applied mass-update op: the job, the op, and
// the field values captured inside the apply transaction before and after the
// change. Before is nil for add_line_item; After is nil for remove_line_item.
type massUpdateAuditEntry struct {
	ReferenceID int
	Op          string
	Before      map[string]any
	After       map[string]any
}

// massUpdateAuditAction is the audit_logs.action value for a mass-update op.
func massUpdateAuditAction(op string) string {
	return "work_order.ai_mass_update." + op
}

// massUpdateAuditMetadata renders the audit_logs.metadata_json payload. Work
// order ids are integers, so reference_id lives here rather than in the UUID
// target_id column.
func massUpdateAuditMetadata(e massUpdateAuditEntry) ([]byte, error) {
	return json.Marshal(map[string]any{
		"source":       "ai_mass_update",
		"reference_id": e.ReferenceID,
		"op":           e.Op,
		"before":       e.Before,
		"after":        e.After,
	})
}

func describeDiscount(kind *string, value *float64) string {
	if kind == nil || value == nil {
		return "none"
	}
	switch *kind {
	case "percent":
		return fmt.Sprintf("%.2f%%", *value)
	case "amount":
		return aiMoney(*value)
	default:
		return "none"
	}
}

func isFiniteNonNegative(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= 9999999999.99
}

func massUpdateSystemPrompt() string {
	return "You convert a shop manager's instruction into structured work-order edits. " +
		"You never write to the database; you only propose edits that a human will review and approve. " +
		"Respond with STRICT JSON only (no prose, no markdown fences). " +
		"Only use the allowed operation types. If the instruction is ambiguous or references data you were not given, return an empty operations array."
}

// buildMassUpdatePrompt describes the allowed operations plus the valid status
// names and location labels so the model resolves names it is allowed to use.
func buildMassUpdatePrompt(instruction string, statuses []AIStatusOption, locations []AILocationOption) string {
	var b strings.Builder
	b.WriteString("Instruction:\n")
	b.WriteString(instruction)
	b.WriteString("\n\nReturn JSON of the form:\n")
	b.WriteString(`{"operations":[{"reference_id":123,"op":"<op>", ...fields}]}` + "\n\n")
	b.WriteString("Allowed op values and their fields:\n")
	b.WriteString("- set_labour_total: labour_total (number)\n")
	b.WriteString("- set_labour_discount: discount_type ('percent'|'amount'), discount_value (number)\n")
	b.WriteString("- set_line_item_price: line_item_id (number), unit_price (number)\n")
	b.WriteString("- add_line_item: item_name (string), unit_price (number, optional), quantity_text (string, optional)\n")
	b.WriteString("- remove_line_item: line_item_id (number)\n")
	b.WriteString("- set_status: status_name (string, must match a status below)\n")
	b.WriteString("- set_location: location_name (string, the full \"<shelf>-<floor>\" label exactly as listed below)\n")
	b.WriteString("- generate_work_done: no extra fields (the server writes the Work Done text from the job's repair logs; use when asked to generate/write Work Done)\n")
	b.WriteString("\nEvery operation MUST include reference_id (the job number) and op.\n")
	b.WriteString("Example: \"generate work done for jobs 90001 and 90002\" -> " +
		`{"operations":[{"reference_id":90001,"op":"generate_work_done"},{"reference_id":90002,"op":"generate_work_done"}]}` + "\n")

	b.WriteString("\nValid status names:\n")
	for _, s := range statuses {
		b.WriteString("- ")
		b.WriteString(s.Name)
		b.WriteString("\n")
	}
	b.WriteString("\nValid location names:\n")
	for _, l := range locations {
		b.WriteString("- ")
		b.WriteString(l.Label())
		b.WriteString("\n")
	}
	writeCatalogPromptSection(&b)
	return b.String()
}

package workorders

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

// Ask (Management chat) intents. The model only classifies the request; the
// front end then calls the existing read endpoints (job search, parts list,
// work order detail) or the Mass Update preview. The model never writes SQL
// and never changes data: every write still goes through Mass Update preview
// and an explicit Apply.
const (
	askIntentCustomerJobs  = "customer_jobs"
	askIntentUpdateJobs    = "update_jobs"
	askIntentPartsRequests = "parts_requests"
	askIntentCharges       = "charges_summary"
	askIntentUnknown       = "unknown"
)

const (
	// askMaxString caps every free-text field the model returns.
	askMaxString = 200
	// askMaxReferenceIDs caps how many job numbers one answer may name (and
	// how many a customer search remembers).
	askMaxReferenceIDs = 50
	// askMaxReply caps the plain-text reply shown for "unknown".
	askMaxReply = 600
	// askCustomerSearchSize matches the front end's customer search page size.
	askCustomerSearchSize = 100
	// askSummaryRefs caps how many job numbers one summary lists.
	askSummaryRefs = 20
)

var askIntents = map[string]bool{
	askIntentCustomerJobs:  true,
	askIntentUpdateJobs:    true,
	askIntentPartsRequests: true,
	askIntentCharges:       true,
	askIntentUnknown:       true,
}

// askPartsStatuses mirrors parts_purchase_requests.status (migration 036).
var askPartsStatuses = map[string]bool{
	"draft": true, "waiting_approval": true, "approved": true, "ordered": true,
	"arrived": true, "used": true, "cancelled": true,
}

type askInterpretRequest struct {
	Message string `json:"message"`
}

type askInterpretResult struct {
	Intent        string   `json:"intent"`
	CustomerQuery string   `json:"customer_query"`
	ReferenceIDs  []int64  `json:"reference_ids"`
	PartsQuery    string   `json:"parts_query"`
	PartsStatuses []string `json:"parts_statuses"`
	Reply         string   `json:"reply"`
}

type askInterpretResponse struct {
	askInterpretResult
	Model string `json:"model"`
	// PreviewInstruction is the server-built Mass Update instruction naming
	// the resolved, existing jobs ("Jobs #275, #27501: update both to Finished").
	// update_jobs is only ever returned with it; the front end previews it.
	PreviewInstruction string `json:"preview_instruction,omitempty"`
	// ContextUsed is true when the job numbers (or customer) came from this
	// user's saved context or recent conversation rather than the message.
	ContextUsed bool `json:"context_used"`
	// FoundIDs / MissingIDs are set when the server checked the job numbers.
	FoundIDs   []int64 `json:"found_ids,omitempty"`
	MissingIDs []int64 `json:"missing_ids,omitempty"`
	// Notice is a short line shown above the answer ("No job #15.").
	Notice string `json:"notice,omitempty"`
}

// AskInterpret classifies one Management chat message into an intent plus a few
// validated parameters. The model receives the user's saved context (job
// numbers, customer, topic) and the last few turns so it can resolve
// follow-ups; the server then checks and completes its answer (resolveAsk)
// and records the turn.
func (h *Handler) AskInterpret(c *gin.Context) {
	var req askInterpretRequest
	if !bindAIToolsJSON(c, &req) {
		return
	}
	message := strings.TrimSpace(req.Message)
	if message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message is required"})
		return
	}
	if err := checkTextLength("message", message); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	settings, err := h.getAISettings(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI settings"})
		return
	}
	if !settings.HasOpenRouterAPIKey && strings.TrimSpace(settings.OpenRouterAPIKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI is not configured. Add an OpenRouter API key in AI Settings."})
		return
	}
	ctx := c.Request.Context()
	userID := aiToolsActor(c)
	now := time.Now()
	prev, canSave := h.loadAskContext(ctx, userID, now)
	// fail records the turn (so the conversation shows what happened) and
	// answers with an error.
	fail := func(status int, msg string) {
		if canSave {
			next := prev
			next.Turns = appendAskTurn(prev.Turns, message, "Could not answer: "+msg)
			h.saveAskContext(ctx, userID, next)
		}
		c.JSON(status, gin.H{"error": msg})
	}

	text, model, err := h.generateOpenRouterTextOnce(c, settings, askSystemPrompt(), buildAskUserPrompt(prev, message), 500)
	if err != nil {
		fail(http.StatusBadGateway, aiErrorMessage(err))
		return
	}
	result, err := parseAskInterpretOutput(text)
	if err != nil {
		fail(http.StatusBadGateway, err.Error())
		return
	}
	out := h.resolveAsk(ctx, askResolveInput{
		Message:          message,
		Result:           result,
		Prev:             prev,
		IncludeSensitive: hasPermission(c, permSensitiveRead),
	})
	if canSave {
		next := prev
		if out.save != nil {
			next = *out.save
		}
		next.Turns = appendAskTurn(prev.Turns, message, out.summary)
		h.saveAskContext(ctx, userID, next)
	}
	out.resp.Model = model
	c.JSON(http.StatusOK, out.resp)
}

// buildAskUserPrompt is the stable, line-based block the model (and the local
// stand-in) parses. Every line is single-line; the Request line is last.
func buildAskUserPrompt(prev askContext, message string) string {
	var b strings.Builder
	topic := "none"
	if !prev.UpdatedAt.IsZero() {
		topic = normalizeAskTopic(prev.Topic)
	}
	ids := make([]string, len(prev.ReferenceIDs))
	for i, id := range prev.ReferenceIDs {
		ids[i] = strconv.FormatInt(id, 10)
	}
	line := func(label, value string) {
		b.WriteString(label)
		if value != "" {
			b.WriteString(" ")
			b.WriteString(value)
		}
		b.WriteString("\n")
	}
	b.WriteString("Saved context from this user's recent Ask answers (may be empty):\n")
	line("SAVED_TOPIC:", topic)
	line("SAVED_JOBS:", strings.Join(ids, ", "))
	line("SAVED_CUSTOMER:", askOneLine(prev.CustomerQuery, askMaxString))
	b.WriteString("Recent conversation (oldest first):\n")
	if len(prev.Turns) == 0 {
		b.WriteString("(none)\n")
	}
	for _, t := range prev.Turns {
		line("USER:", askOneLine(t.User, askMaxTurnRunes))
		line("ASSISTANT:", askOneLine(t.Assistant, askMaxTurnRunes))
	}
	b.WriteString("Request: ")
	b.WriteString(askOneLine(message, aiToolsMaxTextChars))
	b.WriteString("\n")
	return b.String()
}

// askIntentTopic is the context topic an answer of this intent leaves behind.
func askIntentTopic(intent string) string {
	if intent == askIntentPartsRequests {
		return askTopicParts
	}
	return askTopicJobs
}

type askResolveInput struct {
	Message          string
	Result           askInterpretResult
	Prev             askContext
	IncludeSensitive bool
}

// askOutcome is the resolved answer, what to remember (nil keeps the saved
// jobs/customer/topic) and the one-line summary recorded as the turn.
type askOutcome struct {
	resp    askInterpretResponse
	save    *askContext
	summary string
}

// askResolver holds one message's resolution state.
type askResolver struct {
	h    *Handler
	ctx  context.Context
	in   askResolveInput
	resp askInterpretResponse
	save *askContext
	// customerHits are the jobs a customer search found (nil: no search ran,
	// or the lookup is unavailable).
	customerHits     []int64
	customerSearched bool
}

// resolveAsk applies the server rules on top of the model's classification.
// The model is primary; the word lists are a backup:
//   - typed job numbers win (plus the saved jobs when the text also refers back:
//     "update them and #275");
//   - model job numbers are kept only if they are saved, in the recent
//     conversation or typed; all are checked for existence;
//   - an update with no job numbers uses the saved jobs, and after a parts
//     answer stays on the parts path unless it clearly targets the jobs;
//   - follow-ups never fall back to "everything" (whole shop, raw text);
//   - update_jobs is only returned with a preview instruction naming jobs.
func (h *Handler) resolveAsk(ctx context.Context, in askResolveInput) askOutcome {
	r := &askResolver{h: h, ctx: ctx, in: in, resp: askInterpretResponse{askInterpretResult: in.Result}}
	if r.resp.ReferenceIDs == nil {
		r.resp.ReferenceIDs = []int64{}
	}
	if r.resp.PartsStatuses == nil {
		r.resp.PartsStatuses = []string{}
	}
	r.resolve()
	// Invariant: never an update without job numbers and an instruction.
	if r.resp.Intent == askIntentUpdateJobs && (r.resp.PreviewInstruction == "" || len(r.resp.ReferenceIDs) == 0) {
		r.plain(askNoContextReply)
	}
	return askOutcome{resp: r.resp, save: r.save, summary: r.summary()}
}

func (r *askResolver) resolve() {
	msg, prev := r.in.Message, r.in.Prev
	explicit := parseAskJobIDs(msg)
	followUp := isAskFollowUp(msg)
	customerRef := isAskCustomerFollowUp(msg)
	updateVerb := isAskUpdateVerb(msg)
	bare := len(explicit) > 0 && isAskBareJobNumbers(msg)

	if bare && (r.resp.Intent == askIntentUnknown || r.resp.Intent == askIntentUpdateJobs) {
		r.resp.Intent = askIntentCustomerJobs
		r.resp.CustomerQuery = ""
	}

	// A customer name from the model counts only when it was typed, is the
	// saved customer, or appears in the recent conversation.
	customerFromContext := false
	if cq := r.resp.CustomerQuery; cq != "" {
		typed := askTextHasWords(msg, cq)
		saved := prev.CustomerQuery != "" && strings.EqualFold(cq, prev.CustomerQuery)
		switch {
		case typed:
		case saved:
			r.resp.CustomerQuery = prev.CustomerQuery
			customerFromContext = true
		case askTurnsMention(prev.Turns, cq):
			customerFromContext = true
		default:
			r.resp.CustomerQuery = ""
		}
	}
	newCustomer := r.resp.CustomerQuery != "" && !customerFromContext

	isUpdate := r.resp.Intent == askIntentUpdateJobs ||
		(updateVerb && !bare && (r.resp.Intent == askIntentUnknown || (r.resp.Intent == askIntentCustomerJobs && r.resp.CustomerQuery == "")))
	partsUpdate := r.resp.Intent == askIntentPartsRequests && updateVerb && len(explicit) == 0 &&
		askPartsStatusWords.MatchString(msg)

	ids, fromContext := r.pickIDs(explicit, followUp, isUpdate)
	if len(explicit) > 0 && isUpdate {
		r.resp.Intent = askIntentUpdateJobs
	}

	// A parts-status change ("set their parts to ordered"), or an update right
	// after a parts answer that does not clearly target the jobs ("set them to
	// pending"), stays on the parts path even when the model already resolved
	// the job numbers: Ask cannot change parts request status.
	if len(explicit) == 0 && (partsUpdate ||
		(isUpdate && normalizeAskTopic(prev.Topic) == askTopicParts && !r.targetsJobs(msg))) {
		target := ids
		if len(target) == 0 {
			target = prev.ReferenceIDs
		}
		if len(target) == 0 {
			r.plain(askNoContextReply)
			return
		}
		r.resp, r.save = r.h.askPartsUpdateFollowUp(r.ctx, r.resp, target)
		return
	}

	if len(ids) == 0 {
		switch {
		case partsUpdate:
			r.partsUpdateOrNoContext()
			return
		case isUpdate:
			if newCustomer && !strings.EqualFold(r.resp.CustomerQuery, prev.CustomerQuery) {
				// Ask can't update by customer name; it needs the jobs.
				r.plain(askNoContextReply)
				return
			}
			if len(prev.ReferenceIDs) == 0 {
				r.plain(askNoContextReply)
				return
			}
			if normalizeAskTopic(prev.Topic) == askTopicParts && !r.targetsJobs(msg) {
				r.partsUpdateOrNoContext()
				return
			}
			ids, fromContext = append([]int64{}, prev.ReferenceIDs...), true
			r.resp.Intent = askIntentUpdateJobs
		case customerRef && !newCustomer && r.resp.Intent != askIntentPartsRequests:
			if prev.CustomerQuery == "" {
				r.plain(askNoContextReply)
				return
			}
			r.resp.CustomerQuery = prev.CustomerQuery
			r.resp.ContextUsed = true
			if r.resp.Intent != askIntentCharges {
				r.resp.Intent = askIntentCustomerJobs
			}
		case newCustomer || customerFromContext:
			// A customer search (typed, or the model resolved a reference).
			r.resp.ContextUsed = customerFromContext
		case followUp && r.resp.Intent != askIntentUnknown:
			switch {
			case len(prev.ReferenceIDs) > 0:
				ids, fromContext = append([]int64{}, prev.ReferenceIDs...), true
			case prev.CustomerQuery != "" && r.resp.Intent != askIntentPartsRequests:
				r.resp.CustomerQuery = prev.CustomerQuery
				r.resp.ContextUsed = true
				if r.resp.Intent == askIntentUpdateJobs {
					r.resp.Intent = askIntentCustomerJobs
				}
			default:
				r.plain(askNoContextReply)
				return
			}
		}
	}

	if len(ids) > 0 {
		if found, missing, ok := r.h.checkAskJobs(r.ctx, ids); ok {
			if r.resp.Intent != askIntentUnknown {
				r.resp.FoundIDs, r.resp.MissingIDs = found, missing
				r.resp.Notice = askNotice(found, missing)
			}
			ids = found
			if len(found) == 0 {
				// Never fall back to older jobs on the next follow-up.
				r.save = &askContext{ReferenceIDs: []int64{}, Topic: askIntentTopic(r.resp.Intent)}
				if r.resp.Intent != askIntentUnknown {
					r.plain(askNoJobsReply)
				}
				return
			}
		}
		r.resp.ReferenceIDs = ids
		r.resp.CustomerQuery = ""
		r.resp.ContextUsed = fromContext
	} else {
		r.resp.ReferenceIDs = []int64{}
	}

	r.finish(len(explicit) > 0)
}

// pickIDs chooses the job numbers before any saved-context fallback: typed
// numbers (plus saved ones when the text refers back), else the model's ids
// that the user could have meant.
func (r *askResolver) pickIDs(explicit []int64, followUp, isUpdate bool) ([]int64, bool) {
	prev := r.in.Prev
	if len(explicit) > 0 {
		if followUp && len(prev.ReferenceIDs) > 0 && !isAskBothTyped(r.in.Message, explicit) &&
			(isUpdate || r.resp.Intent != askIntentUnknown) {
			return askUnionIDs(prev.ReferenceIDs, explicit), true
		}
		return explicit, false
	}
	allowed := map[int64]bool{}
	for _, id := range prev.ReferenceIDs {
		allowed[id] = true
	}
	for _, t := range prev.Turns {
		for _, id := range parseAskJobIDs(t.User) {
			allowed[id] = true
		}
		for _, id := range parseAskJobIDs(t.Assistant) {
			allowed[id] = true
		}
	}
	typed := askStandaloneNumbers(r.in.Message)
	ids := make([]int64, 0, len(r.resp.ReferenceIDs))
	fromContext := false
	for _, id := range r.resp.ReferenceIDs {
		switch {
		case typed[id]:
			ids = append(ids, id)
		case allowed[id]:
			ids = append(ids, id)
			fromContext = true
		}
	}
	return ids, fromContext
}

// targetsJobs reports whether an update after a parts answer is clearly about
// the jobs: a job word, or a job status/location name with no parts status.
func (r *askResolver) targetsJobs(msg string) bool {
	if askJobWord.MatchString(msg) {
		return true
	}
	if askPartsStatusWords.MatchString(msg) {
		return false
	}
	return askNamesAny(msg, r.h.askJobFieldNames(r.ctx))
}

// askJobFieldNames lists the job status names and location labels.
func (h *Handler) askJobFieldNames(ctx context.Context) []string {
	if h.service == nil || h.service.repo == nil {
		return nil
	}
	names := []string{}
	if statuses, err := h.service.repo.AIStatuses(ctx); err == nil {
		for _, s := range statuses {
			names = append(names, s.Name)
		}
	} else {
		log.Printf("[ai] ask statuses: %v", err)
	}
	if locations, err := h.service.repo.AILocations(ctx); err == nil {
		for _, l := range locations {
			names = append(names, l.Label())
		}
	} else {
		log.Printf("[ai] ask locations: %v", err)
	}
	return names
}

func (r *askResolver) partsUpdateOrNoContext() {
	prev := r.in.Prev
	if len(prev.ReferenceIDs) == 0 {
		r.plain(askNoContextReply)
		return
	}
	r.resp, r.save = r.h.askPartsUpdateFollowUp(r.ctx, r.resp, prev.ReferenceIDs)
}

// finish builds the preview instruction and decides what to remember.
func (r *askResolver) finish(explicit bool) {
	ids := r.resp.ReferenceIDs
	switch r.resp.Intent {
	case askIntentUpdateJobs:
		if len(ids) > 0 {
			r.resp.PreviewInstruction = askPreviewInstruction(ids, r.in.Message)
			r.save = &askContext{ReferenceIDs: ids, CustomerQuery: r.customerFor(ids), Topic: askTopicJobs}
		}
	case askIntentPartsRequests:
		// A shop-wide list (no jobs) clears the saved jobs so a later "update
		// them" never reuses older ones.
		r.save = &askContext{ReferenceIDs: ids, Topic: askTopicParts}
	case askIntentCustomerJobs, askIntentCharges:
		switch {
		case len(ids) > 0:
			r.save = &askContext{ReferenceIDs: ids, CustomerQuery: r.customerFor(ids), Topic: askTopicJobs}
		case r.resp.CustomerQuery != "":
			saved := r.searchCustomer(r.resp.CustomerQuery)
			r.save = &askContext{ReferenceIDs: saved, CustomerQuery: r.resp.CustomerQuery, Topic: askTopicJobs}
		}
	default:
		// Unknown/help keeps the saved jobs; typed job numbers are remembered.
		if explicit && len(ids) > 0 {
			r.save = &askContext{ReferenceIDs: ids, CustomerQuery: r.customerFor(ids), Topic: askTopicJobs}
		}
		r.resp.ReferenceIDs = []int64{}
	}
}

// searchCustomer runs the front end's job search for a customer and returns
// the first askMaxReferenceIDs job numbers to remember.
func (r *askResolver) searchCustomer(query string) []int64 {
	r.customerSearched = true
	if r.h.askJobs == nil {
		return []int64{}
	}
	hits, err := r.h.askJobs.SearchJobIDs(r.ctx, query, r.in.IncludeSensitive, askCustomerSearchSize)
	if err != nil {
		log.Printf("[ai] ask customer search: %v", err)
		return []int64{}
	}
	r.customerHits = append([]int64{}, hits...)
	if len(hits) > askMaxReferenceIDs {
		hits = hits[:askMaxReferenceIDs]
	}
	return append([]int64{}, hits...)
}

// customerFor is the customer to remember with ids: the saved one when the
// jobs are unchanged, else the jobs' customer when they all share one.
func (r *askResolver) customerFor(ids []int64) string {
	prev := r.in.Prev
	if prev.CustomerQuery != "" && askSameIDs(ids, prev.ReferenceIDs) {
		return prev.CustomerQuery
	}
	if r.h.askJobs == nil || len(ids) == 0 {
		return ""
	}
	customers, err := r.h.askJobs.JobCustomers(r.ctx, ids)
	if err != nil {
		log.Printf("[ai] ask job customers: %v", err)
		return ""
	}
	var first askJobCustomer
	for i, id := range ids {
		c, ok := customers[id]
		if !ok || strings.TrimSpace(c.Name) == "" {
			return ""
		}
		if i == 0 {
			first = c
		} else if c.ID != first.ID {
			return ""
		}
	}
	return askOneLine(first.Name, askMaxString)
}

func (r *askResolver) plain(reply string) {
	r.resp = askPlainReply(r.resp, reply)
}

// summary is the short assistant line recorded for this turn.
func (r *askResolver) summary() string {
	resp := r.resp
	ids := resp.ReferenceIDs
	jobs := func(ids []int64) string {
		if len(ids) == 1 {
			return "job " + askRefList(ids, askSummaryRefs)
		}
		return "jobs " + askRefList(ids, askSummaryRefs)
	}
	var s string
	switch resp.Intent {
	case askIntentUpdateJobs:
		s = "Opened a preview to change " + jobs(ids) + " (nothing saved until Apply)."
	case askIntentPartsRequests:
		if len(ids) > 0 {
			s = "Showed parts requests on " + jobs(ids) + "."
		} else {
			s = "Showed all parts requests in the shop (not tied to specific jobs)."
		}
	case askIntentCustomerJobs, askIntentCharges:
		verb := "Showed"
		if resp.Intent == askIntentCharges {
			verb = "Summed up charges for"
		}
		switch {
		case len(ids) > 0:
			s = verb + " " + jobs(ids) + "."
		case resp.CustomerQuery != "":
			s = r.customerSummary(verb, resp.CustomerQuery)
		default:
			s = "Asked for a customer name or job number."
		}
	default:
		reply := strings.TrimSpace(resp.Reply)
		if reply == "" {
			// What the front end shows for an empty reply.
			reply = "I can find jobs, update jobs, list parts requests, or sum up charges."
		}
		s = "Said: " + reply
	}
	if resp.Notice != "" {
		s += " Notice: " + resp.Notice
	}
	return askOneLine(s, askMaxTurnRunes)
}

func (r *askResolver) customerSummary(verb, customer string) string {
	quoted := strconv.Quote(customer)
	if !r.customerSearched || r.customerHits == nil {
		if verb == "Showed" {
			return "Showed jobs for customer " + quoted + "."
		}
		return verb + " customer " + quoted + "."
	}
	n := len(r.customerHits)
	count := strconv.Itoa(n)
	if n >= askCustomerSearchSize {
		count += "+"
	}
	noun := " jobs"
	if n == 1 {
		noun = " job"
	}
	if n == 0 {
		return verb + " customer " + quoted + ": no jobs found."
	}
	head := "Showed " + count + noun + " for customer " + quoted
	if verb != "Showed" {
		head = verb + " " + count + noun + " of customer " + quoted
	}
	if n > askMaxReferenceIDs {
		head += fmt.Sprintf(" (first %d saved)", askMaxReferenceIDs)
		return head + ": " + askRefList(r.customerHits[:askMaxReferenceIDs], askSummaryRefs) + "."
	}
	return head + ": " + askRefList(r.customerHits, askSummaryRefs) + "."
}

// askTurnsMention reports whether a recent turn mentions the phrase.
func askTurnsMention(turns []askTurn, phrase string) bool {
	for _, t := range turns {
		if askTextHasWords(t.User, phrase) || askTextHasWords(t.Assistant, phrase) {
			return true
		}
	}
	return false
}

// askUnionIDs is a then b, deduped, capped.
func askUnionIDs(a, b []int64) []int64 {
	out := make([]int64, 0, len(a)+len(b))
	seen := map[int64]bool{}
	for _, id := range append(append([]int64{}, a...), b...) {
		if !seen[id] && len(out) < askMaxReferenceIDs {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func askSameIDs(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	set := map[int64]bool{}
	for _, id := range a {
		set[id] = true
	}
	for _, id := range b {
		if !set[id] {
			return false
		}
	}
	return true
}

// askPartsUpdateFollowUp answers an update follow-up ("set them to pending")
// whose saved context is a parts answer (or that names a parts status). Ask
// cannot change parts request status, so it never returns update_jobs or a
// preview instruction: with no parts requests on those jobs it says there is
// nothing to change, otherwise it shows those jobs' parts requests with a
// notice.
func (h *Handler) askPartsUpdateFollowUp(ctx context.Context, resp askInterpretResponse, ids []int64) (askInterpretResponse, *askContext) {
	ids = append([]int64{}, ids...)
	resp.ContextUsed = true
	resp.CustomerQuery = ""
	resp.PreviewInstruction = ""
	save := &askContext{ReferenceIDs: ids, Topic: askTopicParts}

	count := -1 // unknown: show the list rather than claim there is nothing
	if h.askJobs != nil {
		n, err := h.askJobs.PartsRequestCount(ctx, ids)
		if err != nil {
			log.Printf("[ai] ask parts count: %v", err)
		} else {
			count = n
		}
	}
	if count == 0 {
		return askPlainReply(resp, askNoPartsToChangeReply(ids)), save
	}
	resp.Intent = askIntentPartsRequests
	resp.ReferenceIDs = ids
	resp.PartsQuery = ""
	resp.PartsStatuses = []string{}
	resp.Reply = ""
	resp.Notice = askPartsStatusNotice
	return resp, save
}

// askNoPartsToChangeReply: "There are no parts requests on jobs #31221, #31121,
// #7, so there is nothing to change."
func askNoPartsToChangeReply(ids []int64) string {
	label := "jobs "
	if len(ids) == 1 {
		label = "job "
	}
	refs := make([]string, len(ids))
	for i, id := range ids {
		refs[i] = "#" + strconv.FormatInt(id, 10)
	}
	return "There are no parts requests on " + label + strings.Join(refs, ", ") + ", so there is nothing to change."
}

// askPlainReply turns resp into a plain "unknown" answer with reply text,
// keeping any notice and found/missing ids.
func askPlainReply(resp askInterpretResponse, reply string) askInterpretResponse {
	resp.Intent = askIntentUnknown
	resp.Reply = reply
	resp.ReferenceIDs = []int64{}
	resp.CustomerQuery = ""
	resp.PreviewInstruction = ""
	return resp
}

// parseAskInterpretOutput parses the model's JSON and normalizes every field:
// unknown intents become "unknown", ids must be positive (deduped, capped),
// strings are trimmed and capped, statuses must be real parts statuses.
func parseAskInterpretOutput(text string) (askInterpretResult, error) {
	var raw askInterpretResult
	if err := parseStrictLLMJSON(text, &raw); err != nil {
		return askInterpretResult{}, err
	}
	out := askInterpretResult{
		Intent:        strings.ToLower(strings.TrimSpace(raw.Intent)),
		CustomerQuery: capRunes(strings.Join(strings.Fields(raw.CustomerQuery), " "), askMaxString),
		PartsQuery:    capRunes(strings.Join(strings.Fields(raw.PartsQuery), " "), askMaxString),
		Reply:         capRunes(strings.TrimSpace(raw.Reply), askMaxReply),
		ReferenceIDs:  make([]int64, 0),
		PartsStatuses: make([]string, 0),
	}
	if !askIntents[out.Intent] {
		out.Intent = askIntentUnknown
	}
	seen := make(map[int64]bool)
	for _, id := range raw.ReferenceIDs {
		if id <= 0 || id > 1<<31-1 || seen[id] {
			continue
		}
		if len(out.ReferenceIDs) >= askMaxReferenceIDs {
			break
		}
		seen[id] = true
		out.ReferenceIDs = append(out.ReferenceIDs, id)
	}
	seenStatus := make(map[string]bool)
	for _, s := range raw.PartsStatuses {
		key := strings.ToLower(strings.TrimSpace(s))
		if askPartsStatuses[key] && !seenStatus[key] {
			seenStatus[key] = true
			out.PartsStatuses = append(out.PartsStatuses, key)
		}
	}
	return out, nil
}

func capRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

func askSystemPrompt() string {
	return "You classify a repair-shop management request typed by the shop owner. " +
		"You only classify: you never write SQL and never change data. Any data change happens later in a separate Mass Update preview that the user must review and Apply. " +
		"Respond with STRICT JSON only (no prose, no markdown) of the form " +
		`{"intent":"...","customer_query":"","reference_ids":[],"parts_query":"","parts_statuses":[],"reply":""}. ` +
		"intent must be one of:\n" +
		`- "customer_jobs": list or summarise jobs for a customer or for job numbers; put the customer name in customer_query or the job numbers in reference_ids\n` +
		`- "update_jobs": change one or more jobs (status, location, labour, line items, work done); put the job numbers in reference_ids\n` +
		`- "parts_requests": show parts purchase requests; optional parts_query text and parts_statuses from: draft, waiting_approval, approved, ordered, arrived, used, cancelled; put job numbers in reference_ids when the request is about specific jobs\n` +
		`- "charges_summary": sum up labour, parts, deposit and balance for jobs; put job numbers in reference_ids or the customer in customer_query\n` +
		`- "unknown": anything else; put one short, plain sentence in reply\n` +
		"You receive the user's saved context (SAVED_TOPIC, SAVED_JOBS, SAVED_CUSTOMER) and the recent conversation (USER/ASSISTANT lines, oldest first), then the Request line. " +
		"Use them to resolve pronouns and implicit references such as \"their\", \"they\", \"them\", \"the jobs\", \"both\", \"all\", \"it\", \"the same customer\", \"her jobs\", or Chinese 佢哋, 呢啲, 全部, and put the resolved job numbers in reference_ids. " +
		"An update with no pronoun right after a job list (\"update status to Finished\", \"set to pending\") means those jobs. " +
		"Only use job numbers that appear in the Request, in SAVED_JOBS or in the conversation; never invent job numbers. " +
		"Never invent labour, prices, shipping or line items. " +
		"After a parts answer (SAVED_TOPIC: parts), \"set them to <parts status>\" is parts_requests, but \"set those jobs to <job status>\" (a job status, location or labour) is update_jobs. " +
		"For a follow-up about the customer, put SAVED_CUSTOMER in customer_query. " +
		"If a follow-up needs jobs but there is no saved context, return unknown with a reply asking for the job numbers. " +
		"reference_ids are job numbers as integers. Leave fields you do not need empty. " +
		fmt.Sprintf("Keep reply under %d characters.", askMaxReply)
}

package workorders

// Interpret only reads. Apply uses existing portal endpoints.
import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"humphreys/api/internal/modules/catalog"
)

type askCatalogLookup interface {
	GetCompleteJobStatusID(context.Context) (*int64, error)
	ListWorkOrderStatuses(context.Context, string) ([]catalog.LookupOption, error)
	ListJobTypes(context.Context, string) ([]catalog.LookupOption, error)
	ListItems(context.Context, string) ([]catalog.LookupOption, error)
	ListBrands(context.Context, string) ([]catalog.LookupOption, error)
	ListPaymentMethods(context.Context, string) ([]catalog.LookupOption, error)
	ListPartsItemPresets(context.Context, string) ([]catalog.LookupOption, error)
}
type askLooseString string

func (s *askLooseString) UnmarshalJSON(b []byte) error {
	if string(b) == "null" {
		*s = ""
		return nil
	}
	var v string
	if err := json.Unmarshal(b, &v); err == nil {
		*s = askLooseString(v)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err != nil {
		return err
	}
	*s = askLooseString(n.String())
	return nil
}

type askInvoiceLine struct {
	Text       string           `json:"text"`
	Price      *float64         `json:"price"`
	Match      string           `json:"match"`
	Change     *askPartsChange  `json:"change,omitempty"`
	Candidates []askPartsChoice `json:"candidates,omitempty"`
}
type askInvoicePreview struct {
	InvoiceNumber string           `json:"invoice_number"`
	Lines         []askInvoiceLine `json:"lines"`
}
type askPartsCreatePreview struct {
	ReferenceID int64   `json:"reference_id"`
	ItemName    string  `json:"item_name"`
	Quantity    int32   `json:"quantity"`
	TotalPrice  float64 `json:"total_price"`
	Source      string  `json:"source"`
	SourceURL   *string `json:"source_url"`
	Status      string  `json:"status"`
	PresetMatch bool    `json:"preset_match"`
}
type askCompleteJobRow struct {
	ReferenceID       int64  `json:"reference_id"`
	CurrentStatusID   *int64 `json:"current_status_id"`
	CurrentStatusName string `json:"current_status_name"`
	Already           bool   `json:"already"`
}
type askCompleteJobPreview struct {
	TargetStatusID   int64               `json:"target_status_id"`
	TargetStatusName string              `json:"target_status_name"`
	TargetSource     string              `json:"target_source"`
	Jobs             []askCompleteJobRow `json:"jobs"`
}

var (
	askLabourWord     = regexp.MustCompile(`(?i)\blabou?r\b|人工`)
	askCreateJob      = regexp.MustCompile(`(?i)\b(?:new\s+(?:job|work\s+order)|(?:create|open|start)\s+(?:a\s+)?(?:new\s+)?(?:job|work\s+order))\b|開新\s*job`)
	askPartsCreate    = regexp.MustCompile(`(?i)\b(?:create|add|new|open)\s+(?:a\s+)?parts?\s+(?:purchase\s+)?request\b`)
	askInvoiceNumber  = regexp.MustCompile(`(?i)\b(INV-[A-Z0-9-]+)\b|\binvoice\s*(?:number|no\.?)?\s*[:#-]?\s*(\d[\w-]*)`)
	askTrailingPrice  = regexp.MustCompile(`\s+(\$\s*\d+(?:\.\d{1,2})?|\d+\.\d{1,2})\s*$`)
	askPartQuantity   = regexp.MustCompile(`(?i)\s+[x×]\s*(\d+)\b|\bqty\s*[:=]?\s*(\d+)\b`)
	askInvoiceCommand = regexp.MustCompile(`(?im)^(?:please\s+)?(?:mark|set|make)\b[^\n]*\bordered\b[^\n]*$|\binvoice\b`)
)

func askIsPartsCreate(msg string) bool { return askPartsCreate.MatchString(msg) }
func askInvoiceMessage(msg string, model bool) bool {
	command := askInvoiceCommand.MatchString(msg) && askOrderedWord.MatchString(msg)
	if strings.Contains(msg, "\n") {
		return model || command
	}
	// One line: "Supplier invoice INV-5521: Power switch $13.10, Filter cap $18.08. Mark them ordered."
	return (model || command) && askInvoiceWord.MatchString(msg) && len(askInvoiceLines(msg)) > 1
}

var (
	askInvoiceWord     = regexp.MustCompile(`(?i)\binvoice\b`)
	askInvoiceTailCmd  = regexp.MustCompile(`(?i)[.;,]?\s*(?:please\s+)?(?:mark|set|make)\b[^,;]*\bordered\b[^,;]*$`)
	askInvoiceSplitter = regexp.MustCompile(`\s*;\s*|,\s+`)
)

// askInvoiceLines is one entry per part: one per line, or for a single line,
// the comma/semicolon list after the "invoice ...:" header, without a trailing
// "mark them ordered" sentence.
func askInvoiceLines(msg string) []string {
	if strings.Contains(msg, "\n") {
		return strings.Split(msg, "\n")
	}
	text := msg
	if i := strings.Index(text, ":"); i >= 0 {
		text = text[i+1:]
	}
	text = askInvoiceTailCmd.ReplaceAllString(strings.TrimSpace(text), "")
	text = strings.TrimRight(strings.TrimSpace(text), ".")
	out := []string{}
	for _, part := range askInvoiceSplitter.Split(text, -1) {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
func askOr(s, fallback string) string {
	if s != "" {
		return s
	}
	return fallback
}
func (s *pgAskStore) OpenPartsRequests(ctx context.Context, statuses []string, limit int) ([]askPartsRow, error) {
	if limit < 1 || limit > 1000 {
		limit = 1000
	}
	return scanAskParts(ctx, s.db, askPartsSelect+` WHERE status = ANY($1::text[]) ORDER BY parts_purchase_request_id LIMIT `+strconv.Itoa(limit), statuses)
}
func (r *askResolver) partsInvoice() {
	if !r.in.CanReadParts {
		r.plain("You don't have access to parts requests.")
		return
	}
	if !r.in.CanUpdateParts {
		r.plain("You don't have permission to change parts requests.")
		return
	}
	if r.h.askParts == nil {
		r.plain("I can't look up parts requests right now.")
		return
	}
	rows, err := r.h.askParts.OpenPartsRequests(r.ctx, []string{"draft", "waiting_approval", "approved", "ordered", "arrived"}, 1000)
	if err != nil {
		r.plain("I couldn't load open parts requests right now.")
		return
	}
	p := &askInvoicePreview{Lines: []askInvoiceLine{}}
	if m := askInvoiceNumber.FindStringSubmatch(r.in.Message); m != nil {
		p.InvoiceNumber = askOr(m[1], m[2])
	}
	ids := []int64{}
	seen := map[int64]bool{}
	for _, line := range askInvoiceLines(r.in.Message) {
		if strings.TrimSpace(line) == "" || askInvoiceCommand.MatchString(strings.TrimSpace(line)) {
			continue
		}
		text := strings.TrimSpace(line)
		price := askPriceIn(text)
		if m := askTrailingPrice.FindStringSubmatch(text); m != nil {
			if v, e := strconv.ParseFloat(strings.TrimSpace(strings.TrimPrefix(m[1], "$")), 64); e == nil && askValidPrice(v) {
				price = &v
				text = strings.TrimSpace(text[:len(text)-len(m[0])])
			}
		}
		jobs := parseAskJobIDs(text)
		text = regexp.MustCompile(`(?i)\s+(?:for|on)\s+[#＃]\d+\b`).ReplaceAllString(text, "")
		text = strings.TrimSpace(strings.TrimLeft(text, "•*- "))
		l := askInvoiceLine{Text: text, Price: price, Match: "unmatched"}
		matches := []askPartsRow{}
		approved := []askPartsRow{}
		for _, row := range rows {
			if len(jobs) > 0 {
				found := false
				for _, id := range jobs {
					if id == row.ReferenceID {
						found = true
					}
				}
				if !found {
					continue
				}
			}
			name := strings.ToLower(strings.Join(strings.Fields(row.ItemName), " "))
			query := strings.ToLower(strings.Join(strings.Fields(text), " "))
			if query == "" || !strings.Contains(name, query) {
				continue
			}
			matches = append(matches, row)
			if row.Status == "approved" {
				approved = append(approved, row)
			}
		}
		if len(approved) > 0 {
			matches = approved
		}
		if len(matches) == 1 {
			l.Match = "matched"
			ch := r.partsChange(matches[0], "ordered", price, nil, nil)
			if seen[ch.PartsPurchaseRequestID] {
				ch.Valid = false
				ch.Error = "This request appears more than once on the invoice. Select only one line."
			}
			seen[ch.PartsPurchaseRequestID] = true
			l.Change = &ch
			ids = askUnionIDs(ids, []int64{ch.ReferenceID})
		} else if len(matches) > 1 {
			l.Match = "ambiguous"
			for _, m := range matches {
				l.Candidates = append(l.Candidates, askPartsChoice{PartsPurchaseRequestID: m.ID, ReferenceID: m.ReferenceID, ItemName: m.ItemName, Quantity: m.Quantity, Status: m.Status, TotalPrice: m.TotalPrice})
			}
		}
		p.Lines = append(p.Lines, l)
		if len(p.Lines) >= askMaxReferenceIDs {
			break
		}
	}
	if len(p.Lines) == 0 {
		r.plain("Paste one part per line, with an optional price and job number.")
		return
	}
	r.clearSkillFields(askIntentPartsInvoice)
	r.resp.Reply = ""
	r.resp.ReferenceIDs = ids
	r.resp.InvoicePreview = p
	r.save = &askContext{ReferenceIDs: ids, Topic: askTopicParts}
}
func (r *askResolver) invoiceSummary() string {
	p := r.resp.InvoicePreview
	if p == nil {
		return ""
	}
	parts := []string{}
	for _, l := range p.Lines {
		if l.Change != nil {
			parts = append(parts, fmt.Sprintf("request %d (job #%d), %s", l.Change.PartsPurchaseRequestID, l.Change.ReferenceID, l.Match))
		} else {
			parts = append(parts, l.Match+" line")
		}
	}
	return "Opened invoice " + p.InvoiceNumber + " preview: " + strings.Join(parts, "; ") + " (nothing saved until Apply)."
}
func (r *askResolver) createPartsRequest() {
	if !r.in.CanCreateParts {
		r.plain("You don't have permission to create parts requests.")
		return
	}
	ids := parseAskJobIDs(r.in.Message)
	if len(ids) == 0 && (!isAskFollowUp(r.in.Message) || len(r.in.Prev.ReferenceIDs) != 1) {
		r.plain("Which job should the parts request be on?")
		return
	}
	ids, ok := r.skillJobs(ids, false)
	if !ok {
		return
	}
	if len(ids) != 1 {
		r.plain("Which job should the parts request be on? Create one request at a time.")
		return
	}
	msg := r.in.Message
	name := ""
	if n := strings.TrimSpace(r.in.Result.ItemName); n != "" && askTextHasWords(msg, n) {
		name = n
	}
	if name == "" {
		if i := strings.Index(msg, ":"); i >= 0 {
			name = strings.TrimSpace(msg[i+1:])
		} else if m := regexp.MustCompile(`(?i)parts?\s+request\s+for\s+(?:a\s+|an\s+)?(.+?)\s+(?:on|for)\s+[#＃]\d+`).FindStringSubmatch(msg); m != nil {
			name = m[1]
		}
		name = regexp.MustCompile(`(?i)\s+(?:from\s+supplier|save\s+as\s+draft)\b.*`).ReplaceAllString(name, "")
		name = askPartQuantity.ReplaceAllString(name, "")
		name = askPriceDollar.ReplaceAllString(name, "")
		name = askURL.ReplaceAllString(name, "")
		name = strings.Trim(name, " ,;")
	}
	if name == "" {
		r.plain("What part should I request? Tell me the item name.")
		return
	}
	if regexp.MustCompile(`[$＄]\s*-|[$＄]\s*\d+\.\d{3}|(?i)[x×]\s*-|[x×]\s*\d+\.`).MatchString(msg) {
		r.plain("Parts quantity must be a whole number at least 1 and price must be non-negative, with at most two decimal places.")
		return
	}
	p := &askPartsCreatePreview{ReferenceID: ids[0], ItemName: capRunes(name, askMaxString), Quantity: 1, Source: "online", Status: "waiting_approval"}
	if m := askPartQuantity.FindStringSubmatch(msg); m != nil {
		n, e := strconv.ParseInt(askOr(m[1], m[2]), 10, 32)
		if e != nil || n < 1 {
			r.plain("Parts quantity must be at least 1.")
			return
		}
		p.Quantity = int32(n)
	} else if q := string(r.in.Result.Quantity); q != "" {
		v, _ := strconv.ParseFloat(q, 64)
		if askTypedNumber(msg, v) {
			n, e := strconv.ParseInt(q, 10, 32)
			if e != nil || n < 1 {
				r.plain("Parts quantity must be at least 1.")
				return
			}
			p.Quantity = int32(n)
		}
	}
	if v := askPriceIn(msg); v != nil {
		p.TotalPrice = *v
	}
	if strings.Contains(strings.ToLower(msg), "supplier") {
		p.Source = "supplier"
	}
	if regexp.MustCompile(`(?i)\bdraft\b`).MatchString(msg) {
		p.Status = "draft"
	}
	if u := askURL.FindString(msg); u != "" {
		p.SourceURL = &u
	}
	if r.h.askCatalog != nil {
		opts, err := r.h.askCatalog.ListPartsItemPresets(r.ctx, p.ItemName)
		if err != nil {
			r.plain("I couldn't load the parts presets right now.")
			return
		}
		for _, o := range opts {
			if strings.EqualFold(o.Label, p.ItemName) {
				p.PresetMatch = true
				p.ItemName = o.Label
				break
			}
		}
	}
	r.clearSkillFields(askIntentCreatePartsRequest)
	r.resp.Reply = ""
	r.resp.ReferenceIDs = ids
	r.resp.PartsCreatePreview = p
	r.save = &askContext{ReferenceIDs: ids, Topic: askTopicParts}
}
func (r *askResolver) completeJob() {
	typed := parseAskJobIDs(r.in.Message)
	if len(typed) == 0 && len(r.in.Prev.ReferenceIDs) > 1 && regexp.MustCompile(`(?i)\bit\b|that\s+(?:one|job)`).MatchString(r.in.Message) {
		r.plain("Which job should I complete?")
		return
	}
	ids, ok := r.skillJobs(typed, regexp.MustCompile(`(?i)\b(?:it|them|those|these)\b`).MatchString(r.in.Message))
	if !ok {
		return
	}
	if !r.in.CanUpdateStatus {
		r.plain("You don't have permission to change job status.")
		return
	}
	cat := r.h.askCatalog
	if cat == nil {
		r.plain("I couldn't load the Complete Job setting right now.")
		return
	}
	setting, _ := cat.GetCompleteJobStatusID(r.ctx) // The button falls back on a failed setting GET.
	statuses, err := cat.ListWorkOrderStatuses(r.ctx, "")
	if err != nil {
		r.plain("I couldn't load the job statuses right now.")
		return
	}
	p := &askCompleteJobPreview{Jobs: []askCompleteJobRow{}}
	if setting != nil {
		for _, s := range statuses {
			if s.ID == *setting {
				p.TargetStatusID = s.ID
				p.TargetStatusName = s.Label
				p.TargetSource = "setting"
				break
			}
		}
	} else {
		for _, s := range statuses {
			if s.StatusGroup != nil && *s.StatusGroup == "completed" {
				p.TargetStatusID = s.ID
				p.TargetStatusName = s.Label
				p.TargetSource = "completed_group"
				break
			}
		}
		if p.TargetStatusID == 0 {
			for _, s := range statuses {
				if strings.EqualFold(strings.TrimSpace(s.Label), "finished") {
					p.TargetStatusID = s.ID
					p.TargetStatusName = s.Label
					p.TargetSource = "label"
					break
				}
			}
		}
		if p.TargetStatusID == 0 {
			for _, s := range statuses {
				if strings.Contains(strings.ToLower(s.Label), "finish") {
					p.TargetStatusID = s.ID
					p.TargetStatusName = s.Label
					p.TargetSource = "label"
					break
				}
			}
		}
	}
	if p.TargetStatusID == 0 {
		r.plain("No status is configured in the completed group")
		return
	}
	allAlready := true
	for _, id := range ids {
		d, err := r.h.service.GetWorkOrderDetail(r.ctx, int(id))
		if err != nil {
			r.plain(fmt.Sprintf("I couldn't load job #%d right now.", id))
			return
		}
		j := askCompleteJobRow{ReferenceID: id, CurrentStatusID: d.StatusID, CurrentStatusName: stringValue(d.StatusName), Already: d.StatusID != nil && *d.StatusID == p.TargetStatusID}
		allAlready = allAlready && j.Already
		p.Jobs = append(p.Jobs, j)
	}
	if allAlready {
		r.plain(askJobRefs(ids, "and") + " already " + p.TargetStatusName + ".")
		return
	}
	r.clearSkillFields(askIntentCompleteJob)
	r.resp.Reply = "Same status change as the Complete Job button."
	r.resp.ReferenceIDs = ids
	r.resp.CompleteJobPreview = p
	r.save = &askContext{ReferenceIDs: ids, Topic: askTopicJobs}
}

// A new-job request is never remembered as typed, so unlabelled customer
// names, phones and addresses cannot leak into Ask memory or summaries.
func askScrubNewJobText(string) string { return "Asked to open a new job (customer details not kept)." }
func askTurnUserText(message, intent string) string {
	if askCreateJob.MatchString(message) {
		return askScrubNewJobText(message)
	}
	return message
}

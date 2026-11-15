package workorders

// Interpret only reads. Apply uses existing portal endpoints.
import (
	"context"
	"encoding/json"
	"fmt"
	"net/mail"
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

type askNewJobInput struct {
	CustomerName         string         `json:"customer_name"`
	ExistingCustomer     bool           `json:"existing_customer"`
	Phone                string         `json:"phone"`
	WorkPhone            string         `json:"work_phone"`
	Email                string         `json:"email"`
	Address              string         `json:"address"`
	Brand                string         `json:"brand"`
	Item                 string         `json:"item"`
	Model                string         `json:"model"`
	Serial               string         `json:"serial"`
	Problem              string         `json:"problem"`
	Quote                askLooseString `json:"quote"`
	Deposit              askLooseString `json:"deposit"`
	DepositCollected     any            `json:"deposit_collected"`
	DepositPaymentMethod string         `json:"deposit_payment_method"`
	Status               string         `json:"status"`
	JobType              string         `json:"job_type"`
}

func (n *askNewJobInput) clean() *askNewJobInput {
	if n == nil {
		return nil
	}
	c := *n
	for _, s := range []*string{&c.CustomerName, &c.Phone, &c.WorkPhone, &c.Email, &c.Address, &c.Brand, &c.Item, &c.Model, &c.Serial, &c.Problem, &c.DepositPaymentMethod, &c.Status, &c.JobType} {
		*s = capRunes(strings.TrimSpace(*s), askMaxString)
	}
	return &c
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
type askNewCustomer struct {
	Name         string `json:"name"`
	HomePhone    string `json:"home_phone"`
	WorkPhone    string `json:"work_phone"`
	Email        string `json:"email"`
	AddressLine1 string `json:"address_line_1"`
	AddressLine2 string `json:"address_line_2"`
	City         string `json:"city"`
	Province     string `json:"province"`
	PostalCode   string `json:"postal_code"`
}
type askCreateJobPreview struct {
	CustomerMode             string         `json:"customer_mode"`
	CustomerID               *int64         `json:"customer_id"`
	Customer                 askNewCustomer `json:"customer"`
	BrandID                  *int64         `json:"brand_id"`
	BrandName                string         `json:"brand_name"`
	BrandNew                 bool           `json:"brand_new"`
	ItemID                   *int64         `json:"item_id"`
	ItemName                 string         `json:"item_name"`
	ItemNew                  bool           `json:"item_new"`
	ModelNumber              string         `json:"model_number"`
	SerialNumber             string         `json:"serial_number"`
	ProblemDescription       string         `json:"problem_description"`
	StatusID                 *int64         `json:"status_id"`
	StatusName               string         `json:"status_name"`
	StatusIsDefault          bool           `json:"status_is_default"`
	JobTypeID                *int64         `json:"job_type_id"`
	JobTypeName              string         `json:"job_type_name"`
	Deposit                  float64        `json:"deposit"`
	DepositPaymentMethodID   *int64         `json:"deposit_payment_method_id"`
	DepositPaymentMethodName string         `json:"deposit_payment_method_name"`
	Quote                    *float64       `json:"quote"`
	Notes                    []string       `json:"notes"`
}

var (
	askLabourWord      = regexp.MustCompile(`(?i)\blabou?r\b|人工`)
	askCreateJob       = regexp.MustCompile(`(?i)\b(?:new\s+(?:job|work\s+order)|(?:create|open|start)\s+(?:a\s+)?(?:new\s+)?(?:job|work\s+order))\b|開新\s*job`)
	askPartsCreate     = regexp.MustCompile(`(?i)\b(?:create|add|new|open)\s+(?:a\s+)?parts?\s+(?:purchase\s+)?request\b`)
	askInvoiceNumber   = regexp.MustCompile(`(?i)\b(INV-[A-Z0-9-]+)\b|\binvoice\s*(?:number|no\.?)?\s*[:#-]?\s*(\d[\w-]*)`)
	askTrailingPrice   = regexp.MustCompile(`\s+(\$\s*\d+(?:\.\d{1,2})?|\d+\.\d{1,2})\s*$`)
	askPartQuantity    = regexp.MustCompile(`(?i)\s+[x×]\s*(\d+)\b|\bqty\s*[:=]?\s*(\d+)\b`)
	askInvoiceCommand  = regexp.MustCompile(`(?im)^(?:please\s+)?(?:mark|set|make)\b[^\n]*\bordered\b[^\n]*$|\binvoice\b`)
	askDepositEvidence = regexp.MustCompile(`(?i)\b(?:no\s+)?deposit\s+(?:was\s+)?(?:not\s+)?(?:collected|paid|uncollected|unpaid)\b(?:\s*[:?=]\s*(?:yes|no|not))?`)
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

// Discard intake prose entirely so unlabelled names and addresses cannot leak.
func askScrubNewJobText(string) string { return "Asked to open a new job (customer details not kept)." }
func askTurnUserText(message, intent string) string {
	if intent == askIntentCreateJob || askCreateJob.MatchString(message) {
		return askScrubNewJobText(message)
	}
	return message
}

type askAddress struct{ Line1, Line2, City, Province, Postal string }

var askPostal = regexp.MustCompile(`(?i)\b([A-Z]\d[A-Z])\s*(\d[A-Z]\d)\s*$`)
var askProvince = regexp.MustCompile(`(?i)(?:,\s*|\s+)(ON|Ontario|QC|Quebec|BC|British Columbia|AB|Alberta|MB|Manitoba|NB|New Brunswick|NL|Newfoundland and Labrador|NS|Nova Scotia|NT|Northwest Territories|NU|Nunavut|PE|Prince Edward Island|SK|Saskatchewan|YT|Yukon)\s*$`)

func parseAskAddress(raw string) (askAddress, bool) {
	a := askAddress{}
	text := strings.TrimSpace(raw)
	if m := askPostal.FindStringSubmatch(text); m != nil {
		a.Postal = strings.ToUpper(m[1] + " " + m[2])
		text = strings.TrimSpace(text[:len(text)-len(m[0])])
	}
	m := askProvince.FindStringSubmatch(text)
	if m == nil {
		return a, false
	}
	provinces := map[string]string{"on": "Ontario", "qc": "Quebec", "bc": "British Columbia", "ab": "Alberta", "mb": "Manitoba", "nb": "New Brunswick", "nl": "Newfoundland and Labrador", "ns": "Nova Scotia", "nt": "Northwest Territories", "nu": "Nunavut", "pe": "Prince Edward Island", "sk": "Saskatchewan", "yt": "Yukon"}
	a.Province = askOr(provinces[strings.ToLower(m[1])], m[1])
	text = strings.Trim(text[:len(text)-len(m[0])], " ,")
	parts := strings.Split(text, ",")
	if len(parts) < 2 || len(parts) > 3 {
		return a, false
	}
	a.Line1 = strings.TrimSpace(parts[0])
	a.City = strings.TrimSpace(parts[len(parts)-1])
	if len(parts) == 3 {
		a.Line2 = strings.TrimSpace(parts[1])
	}
	if m := regexp.MustCompile(`^(\d+)-(\d+\s+.+)$`).FindStringSubmatch(a.Line1); m != nil {
		if a.Line2 != "" {
			return a, false
		}
		a.Line2 = m[1]
		a.Line1 = m[2]
	}
	if !regexp.MustCompile(`^\d+\s+\S+`).MatchString(a.Line1) || a.City == "" {
		return a, false
	}
	return a, true
}

// Only typed model values count. Labelled values take precedence.
func askIntakeFields(msg string, model *askNewJobInput) map[string]string {
	f := map[string]string{}
	if model != nil {
		values := map[string]string{"customer name": model.CustomerName, "phone": model.Phone, "work phone": model.WorkPhone, "email": model.Email, "address": model.Address, "brand": model.Brand, "item": model.Item, "model": model.Model, "serial": model.Serial, "problem": model.Problem, "quote": string(model.Quote), "deposit": string(model.Deposit), "payment": model.DepositPaymentMethod, "status": model.Status, "job type": model.JobType}
		for k, v := range values {
			if strings.TrimSpace(v) != "" && strings.Contains(strings.ToLower(msg), strings.ToLower(v)) {
				f[k] = v
			}
		}
	}
	for _, line := range strings.Split(msg, "\n") {
		kv := strings.SplitN(line, ":", 2)
		if len(kv) != 2 {
			continue
		}
		key := strings.ToLower(strings.Trim(strings.TrimSpace(kv[0]), "|? "))
		value := strings.Trim(strings.TrimSpace(kv[1]), "| ")
		switch key {
		case "customer name", "name":
			key = "customer name"
		case "home phone", "phone":
			key = "phone"
		case "full address", "full address (one line)", "address":
			key = "address"
		case "problem description":
			key = "problem"
		case "quote before tax", "quote before tax (cad)":
			key = "quote"
		case "deposit payment method":
			key = "payment"
		}
		f[key] = value
	}
	if m := regexp.MustCompile(`(?i)\bexisting\s+customer\s+([^\n:]+)`).FindStringSubmatch(msg); m != nil {
		f["existing"] = strings.TrimSpace(m[1])
	}
	return f
}
func askProblemSymptoms(s string) string {
	if loc := regexp.MustCompile(`(?i)[,; .]*(?:quote(?:d)?(?: before tax)?|deposit(?: collected)?)\b[^$]*\$\s*\d`).FindStringIndex(s); loc != nil {
		s = s[:loc[0]]
	}
	return strings.TrimSpace(s)
}

func askIntakeMoney(s string) (*float64, bool) {
	if s == "" {
		return nil, true
	}
	m := regexp.MustCompile(`\$?\s*(\d+(?:\.\d{1,2})?)`).FindStringSubmatch(s)
	if m == nil {
		return nil, false
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil || !askValidPrice(v) || strings.Contains(s, "-") {
		return nil, false
	}
	return &v, true
}
func (r *askResolver) createJob() {
	r.newJob = true
	r.save = &askContext{ReferenceIDs: []int64{}, Topic: askTopicJobs}
	r.resp.CustomerQuery = ""
	r.resp.ReferenceIDs = []int64{}
	if !r.in.CanCreateJobs {
		r.plain("You don't have permission to create jobs.")
		return
	}
	if r.h.askCatalog == nil {
		r.plain("I couldn't load the job catalog right now.")
		return
	}
	f := askIntakeFields(r.in.Message, r.in.Result.NewJob)
	p := &askCreateJobPreview{CustomerMode: "new", Notes: []string{}, BrandName: f["brand"], ItemName: f["item"], ModelNumber: f["model"], SerialNumber: f["serial"], ProblemDescription: askProblemSymptoms(f["problem"])}
	if f["existing"] != "" {
		customers, err := r.h.service.ListCustomers(r.ctx, f["existing"])
		if err != nil {
			r.plain("I couldn't search customers right now.")
			return
		}
		if len(customers) > 1 {
			r.plain("Several customers match. Please identify the customer uniquely on the create page.")
			return
		}
		if len(customers) == 0 {
			r.plain("No existing customer matches. Check the name or provide new customer details.")
			return
		}
		p.CustomerMode = "existing"
		p.CustomerID = &customers[0].ID
		p.Customer.Name = customers[0].Label
	} else {
		p.Customer = askNewCustomer{Name: f["customer name"], Email: f["email"]}
		if p.Customer.Name == "" {
			r.plain("What is the customer name and phone number?")
			return
		}
		normalize := func(s string) string {
			return strings.NewReplacer(" ", "", "-", "", "(", "", ")", "", ".", "").Replace(s)
		}
		p.Customer.HomePhone = normalize(f["phone"])
		p.Customer.WorkPhone = normalize(f["work phone"])
		if p.Customer.HomePhone == "" && p.Customer.WorkPhone == "" {
			r.plain("What is the customer's home or work phone number?")
			return
		}
		for _, phone := range []string{p.Customer.HomePhone, p.Customer.WorkPhone} {
			if phone != "" && !askAllDigits(phone) {
				r.plain("Please provide a phone number using digits, spaces, dashes or parentheses.")
				return
			}
		}
		if p.Customer.Email != "" {
			if _, err := mail.ParseAddress(p.Customer.Email); err != nil {
				r.plain("Please check the email address.")
				return
			}
		}
		if f["address"] != "" {
			a, ok := parseAskAddress(f["address"])
			if !ok {
				r.plain("Please clarify the address: street, unit if any, city, province and postal code.")
				return
			}
			p.Customer.AddressLine1 = a.Line1
			p.Customer.AddressLine2 = a.Line2
			p.Customer.City = a.City
			p.Customer.Province = a.Province
			p.Customer.PostalCode = a.Postal
		}
	}
	var valid bool
	p.Quote, valid = askIntakeMoney(f["quote"])
	if !valid {
		r.plain("Please check the quote amount.")
		return
	}
	deposit, valid := askIntakeMoney(f["deposit"])
	if !valid {
		r.plain("Please check the deposit amount.")
		return
	}
	collected := strings.ToLower(f["deposit collected"])
	if collected == "" {
		// Negation belongs to the deposit statement. Symptoms such as "no
		// sound" must not cancel a separate "deposit collected" statement.
		collected = strings.ToLower(askDepositEvidence.FindString(r.in.Message))
	}
	if deposit != nil {
		p.Deposit = *deposit
	} else if regexp.MustCompile(`\b(?:yes|paid|collected)\b`).MatchString(collected) && !regexp.MustCompile(`\b(?:no|not|unpaid|uncollected)\b`).MatchString(collected) && p.Quote != nil {
		p.Deposit = round2(*p.Quote * 1.13)
		p.Notes = append(p.Notes, "Deposit = quote × 1.13 (13% Ontario HST), because the deposit was collected.")
	}
	cat := r.h.askCatalog
	lookup := func(list func(context.Context, string) ([]catalog.LookupOption, error), name string) (*int64, string, error) {
		opts, err := list(r.ctx, "")
		if err != nil {
			return nil, "", err
		}
		for _, o := range opts {
			if strings.EqualFold(o.Label, name) {
				id := o.ID
				return &id, o.Label, nil
			}
		}
		return nil, name, nil
	}
	var err error
	p.BrandID, p.BrandName, err = lookup(cat.ListBrands, p.BrandName)
	if err != nil {
		r.plain("I couldn't load brands right now.")
		return
	}
	p.BrandNew = p.BrandName != "" && p.BrandID == nil
	p.ItemID, p.ItemName, err = lookup(cat.ListItems, p.ItemName)
	if err != nil {
		r.plain("I couldn't load items right now.")
		return
	}
	p.ItemNew = p.ItemName != "" && p.ItemID == nil
	if p.ItemName == "" {
		r.plain("What item is the job for?")
		return
	}
	status := askOr(f["status"], "Received")
	p.StatusIsDefault = f["status"] == ""
	p.StatusID, p.StatusName, err = lookup(cat.ListWorkOrderStatuses, status)
	if err != nil || p.StatusID == nil {
		r.plain("I couldn't resolve the job status. Choose a configured status on the create page.")
		return
	}
	p.JobTypeID, p.JobTypeName, err = lookup(cat.ListJobTypes, askOr(f["job type"], "Repair"))
	if err != nil {
		r.plain("I couldn't load job types right now.")
		return
	}
	if f["job type"] != "" && p.JobTypeID == nil {
		r.plain("Please choose a configured job type.")
		return
	}
	if p.Deposit > 0 {
		paymentText := strings.ToLower(f["payment"] + " " + f["deposit"] + " " + collected)
		options, e := cat.ListPaymentMethods(r.ctx, "")
		if e != nil {
			r.plain("I couldn't load payment methods right now.")
			return
		}
		for _, o := range options {
			if regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(o.Label) + `\b`).MatchString(paymentText) {
				if p.DepositPaymentMethodID != nil {
					r.plain("Which deposit payment method should I use?")
					return
				}
				id := o.ID
				p.DepositPaymentMethodID = &id
				p.DepositPaymentMethodName = o.Label
			}
		}
		if p.DepositPaymentMethodID == nil {
			r.plain("What payment method was used for the deposit?")
			return
		}
	}
	if p.BrandNew || p.ItemNew {
		p.Notes = append(p.Notes, "New catalog names will use the same Add New catalog actions as the create page, subject to permissions and frozen dropdowns.")
	}
	r.clearSkillFields(askIntentCreateJob)
	r.resp.Reply = ""
	r.resp.CreateJobPreview = p
}

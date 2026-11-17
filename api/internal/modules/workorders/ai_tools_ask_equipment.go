package workorders

import (
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
)

// Ask: bare job numbers ("show 31121") and searching jobs by the item's make,
// model number or serial number ("find Marantz 2270", "serial 123456").

// ---------------------------------------------------------------------------
// Bare job numbers
// ---------------------------------------------------------------------------

var (
	// Words that may come right before a bare job number in a sentence.
	askLoneJobPrev = map[string]bool{
		"show": true, "open": true, "find": true, "check": true, "get": true, "see": true, "view": true,
		"lookup": true, "look": true, "pull": true, "up": true, "status": true, "of": true, "for": true,
		"on": true, "about": true, "is": true, "was": true, "what": true, "whats": true, "s": true,
		"with": true, "at": true, "in": true, "me": true, "details": true, "info": true, "where": true,
		"please": true, "pls": true, "history": true, "logs": true, "log": true, "charges": true,
		"parts": true, "summary": true, "summarise": true, "summarize": true,
	}
	// Anywhere in the message these mean the number is something else: a
	// price, a parts request, an invoice, a phone, a model or serial number.
	askLoneJobBlock = regexp.MustCompile(`(?i)[$＄£€¥]|\b(?:dollars?|bucks?|cad|usd|requests?|reqs?|prs?|ppr|invoices?|inv|phone|tel|call|model|serial|s/n|sn|make|brand|qty|quantity|pcs?|x)\b`)
)

// askLoneJobNumber returns the one unmarked number in a message when it reads
// as a job number: "31121", "show 31121", "what's the status of 31121",
// "parts for 31121". Prices, hours, quantities, request ids, years, phone
// numbers, model and serial numbers are never returned.
func askLoneJobNumber(message string) (int64, bool) {
	if askLoneJobBlock.MatchString(message) {
		return 0, false
	}
	toks := tokenizeAsk(message)
	p := askParser{toks: toks}
	idx := -1
	for i, t := range toks {
		if t.is(askTokNum) {
			if idx >= 0 {
				return 0, false // more than one number: leave it to the list rules
			}
			idx = i
		}
	}
	if idx < 0 || p.excluded(idx) || p.marked(idx) {
		return 0, false
	}
	t := toks[idx]
	if len(t.text) < 3 || t.text[0] == '0' {
		return 0, false
	}
	n, err := strconv.ParseInt(t.text, 10, 64)
	if err != nil || n <= 0 || n > 1<<31-1 {
		return 0, false
	}
	if len(t.text) == 4 && n >= 1900 && n <= 2099 {
		return 0, false // a year
	}
	if prev, ok := p.at(idx - 1); ok {
		switch {
		case prev.is(askTokWord):
			if !prev.ascii || !askLoneJobPrev[prev.text] {
				return 0, false // "Marantz 2270", "approve 480"
			}
		case prev.is(askTokPunct):
			// "SL-1200", "v.2270" stay model numbers; "?" or ":" before is fine.
			if !t.spaceBefore && prev.text != ":" && prev.text != "：" && prev.text != "(" {
				return 0, false
			}
			if pp, ok := p.at(idx - 2); ok && pp.is(askTokWord) && !askLoneJobPrev[pp.text] && prev.text != "?" && prev.text != "." && prev.text != "!" {
				return 0, false
			}
		}
	}
	if next, ok := p.at(idx + 1); ok && !next.spaceBefore && next.is(askTokPunct) && (next.text == "-" || next.text == "/") {
		return 0, false
	}
	return n, true
}

// askTypedJobIDs is parseAskJobIDs plus a bare job number typed on its own.
func askTypedJobIDs(message string) []int64 {
	if ids := parseAskJobIDs(message); len(ids) > 0 {
		return ids
	}
	if n, ok := askLoneJobNumber(message); ok {
		return []int64{n}
	}
	return []int64{}
}

// ---------------------------------------------------------------------------
// Equipment search
// ---------------------------------------------------------------------------

const askIntentSearchEquipment = "search_equipment"

type askEquipmentSearch struct {
	Brand  string            `json:"brand"`
	Model  string            `json:"model_number"`
	Serial string            `json:"serial"`
	Total  int               `json:"total"`
	Rows   []askEquipmentRow `json:"rows"`
}

type askEquipmentRow struct {
	ReferenceID  int64  `json:"reference_id"`
	StatusName   string `json:"status_name"`
	CustomerName string `json:"customer_name"`
	Brand        string `json:"brand"`
	ModelNumber  string `json:"model_number"`
	SerialNumber string `json:"serial_number"`
}

type askEquipmentFilter struct{ Brand, Model, Serial string }

func (f askEquipmentFilter) empty() bool { return f.Brand == "" && f.Model == "" && f.Serial == "" }

var (
	// "serial 123456", "s/n: AB-12", "model L-509", "model no. 2270", "make Luxman".
	askEquipField = regexp.MustCompile(`(?i)\b(serial|s/n|sn|model|make|brand)(?:\s*(?:no\.?|number|#|＃))?\s*[:：]?\s*([A-Za-z0-9][A-Za-z0-9\-./]*)`)
	// Words after make/model/brand that are not a value ("make and model",
	// "make it Finished", "model of #31178").
	askEquipStop = map[string]bool{
		"and": true, "or": true, "of": true, "on": true, "for": true, "is": true, "it": true, "the": true,
		"a": true, "an": true, "this": true, "that": true, "them": true, "those": true, "these": true,
		"all": true, "sure": true, "as": true, "to": true, "in": true, "number": true, "numbers": true,
		"no": true, "serial": true, "model": true, "make": true, "brand": true, "s": true,
	}
)

// askEquipmentTyped reads the explicit "serial X" / "model X" / "make X" forms.
// Model and serial values must contain a digit.
func askEquipmentTyped(msg string) askEquipmentFilter {
	var f askEquipmentFilter
	for _, m := range askEquipField.FindAllStringSubmatch(msg, -1) {
		val := strings.TrimRight(m[2], ".-/")
		if val == "" || askEquipStop[strings.ToLower(val)] {
			continue
		}
		hasDigit := strings.ContainsAny(val, "0123456789")
		switch strings.ToLower(m[1]) {
		case "serial", "s/n", "sn":
			if hasDigit && f.Serial == "" {
				f.Serial = val
			}
		case "model":
			if hasDigit && f.Model == "" {
				f.Model = val
			}
		default:
			if f.Brand == "" && !hasDigit {
				f.Brand = val
			}
		}
	}
	return f
}

// askTypedValue keeps a model value only when the user typed it.
func askTypedValue(msg, v string) string {
	v = strings.TrimSpace(v)
	if v == "" || !strings.Contains(strings.ToLower(msg), strings.ToLower(v)) {
		return ""
	}
	return v
}

// equipmentFilter merges the typed forms with the model's fields (typed only).
func (r *askResolver) equipmentFilter() askEquipmentFilter {
	f := askEquipmentTyped(r.in.Message)
	if r.in.Result.Intent != askIntentSearchEquipment {
		return f
	}
	res := r.in.Result
	if f.Brand == "" {
		f.Brand = askTypedValue(r.in.Message, res.EquipBrand)
	}
	if f.Model == "" {
		f.Model = askTypedValue(r.in.Message, res.EquipModel)
	}
	if f.Serial == "" {
		f.Serial = askTypedValue(r.in.Message, res.EquipSerial)
	}
	return f
}

// searchEquipment lists jobs whose item matches the make / model / serial,
// through the AI search filters (parameterised SQL), and saves the job
// numbers so "that job" / "those" follow-ups work.
func (r *askResolver) searchEquipment(f askEquipmentFilter) {
	r.clearSkillFields(askIntentSearchEquipment)
	r.resp.Reply = ""
	r.resp.ReferenceIDs = []int64{}
	out := &askEquipmentSearch{Brand: f.Brand, Model: f.Model, Serial: f.Serial, Rows: []askEquipmentRow{}}
	filters := aiResolvedSearchFilters{
		Brand: f.Brand, Model: f.Model, Serial: f.Serial,
		Warranty: aiWarrantyAny, GroupBy: aiGroupNone, Limit: askMaxReferenceIDs,
	}
	rows, total, err := r.h.service.repo.AISearch(r.ctx, filters)
	if err != nil {
		log.Printf("[ai] ask equipment search: %v", err)
		r.plain("I couldn't search jobs right now. Please try again.")
		return
	}
	saved := []int64{}
	for _, row := range rows {
		out.Rows = append(out.Rows, askEquipmentRow{
			ReferenceID: int64(row.ReferenceID), StatusName: row.StatusName, CustomerName: row.CustomerName,
			Brand: strings.Join(row.BrandNames, ", "), ModelNumber: row.ModelNumber, SerialNumber: row.SerialNumber,
		})
		saved = append(saved, int64(row.ReferenceID))
	}
	out.Total = total
	r.resp.ReferenceIDs = saved
	r.resp.EquipmentSearch = out
	r.save = &askContext{ReferenceIDs: saved, Topic: askTopicJobs}
}

// equipmentLabel describes the search for the conversation summary.
func (s *askEquipmentSearch) label() string {
	parts := []string{}
	if s.Brand != "" {
		parts = append(parts, "make "+s.Brand)
	}
	if s.Model != "" {
		parts = append(parts, "model "+s.Model)
	}
	if s.Serial != "" {
		parts = append(parts, "serial "+s.Serial)
	}
	return strings.Join(parts, ", ")
}

func (s *askEquipmentSearch) summary(ids []int64) string {
	if len(ids) == 0 {
		return fmt.Sprintf("Found no jobs for %s.", s.label())
	}
	return fmt.Sprintf("Found %d jobs for %s: %s.", s.Total, s.label(), askRefList(ids, askSummaryRefs))
}

package workorders

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

// Deterministic job-number parsing for Management Ask. The model may drop short
// job numbers (e.g. 15) or invent ids, so the server reads the numbers itself.
//
// A number is a job number when it is
//   - directly marked: "#15", "job 15", "jobs 15", "job no. 15", "job number 15",
//     "ref 15", "工單15", "單號 15"; or
//   - part of a list joined by , 、 ， / & "and" "or" 和 同 及 與 that either
//     starts with such a marker or has at least two numbers ("275, 15 and 27501").
//
// It is never a job number when it is a count ("2 jobs", "3 items", "2 張"),
// money ("$80", "80 dollars", "80.50"), a quantity ("qty 2", "x2", "2x"), part
// of a time or date ("10:30", "3pm", "Nov 12", "2026-11-12", "12/11/2026"), a
// phone number (8+ digits or joined by dashes), or glued to letters (model
// numbers like "RX-V671", "12D").

type askTokKind int

const (
	askTokNum askTokKind = iota
	askTokWord
	askTokPunct
)

type askTok struct {
	kind askTokKind
	// text is lowercased for ASCII words; non-ASCII letters (CJK) are one
	// token per rune.
	text        string
	ascii       bool
	spaceBefore bool
}

func tokenizeAsk(s string) []askTok {
	toks := make([]askTok, 0, len(s)/2)
	runes := []rune(s)
	space := false
	for i := 0; i < len(runes); {
		r := runes[i]
		switch {
		case unicode.IsSpace(r):
			space = true
			i++
			continue
		case r >= '0' && r <= '9':
			j := i
			for j < len(runes) && runes[j] >= '0' && runes[j] <= '9' {
				j++
			}
			toks = append(toks, askTok{kind: askTokNum, text: string(runes[i:j]), spaceBefore: space})
			i = j
		case r < 128 && unicode.IsLetter(r):
			j := i
			for j < len(runes) && runes[j] < 128 && unicode.IsLetter(runes[j]) {
				j++
			}
			toks = append(toks, askTok{kind: askTokWord, text: strings.ToLower(string(runes[i:j])), ascii: true, spaceBefore: space})
			i = j
		case unicode.IsLetter(r):
			toks = append(toks, askTok{kind: askTokWord, text: string(r), spaceBefore: space})
			i++
		default:
			toks = append(toks, askTok{kind: askTokPunct, text: string(r), spaceBefore: space})
			i++
		}
		space = false
	}
	return toks
}

var (
	askJobMarkerWords = map[string]bool{
		"job": true, "jobs": true, "ref": true, "refs": true, "reference": true, "references": true,
		"wo": true, "order": true, "orders": true,
	}
	askJobNumberWords = map[string]bool{"no": true, "nos": true, "num": true, "number": true, "numbers": true}
	// Words right after a number that make it a count, amount or time.
	askCountWords = map[string]bool{
		"job": true, "jobs": true, "item": true, "items": true, "unit": true, "units": true,
		"piece": true, "pieces": true, "pc": true, "pcs": true, "orders": true, "tickets": true,
		"hour": true, "hours": true, "hr": true, "hrs": true, "minute": true, "minutes": true,
		"min": true, "mins": true, "day": true, "days": true, "week": true, "weeks": true,
		"month": true, "months": true, "year": true, "years": true, "times": true,
		"am": true, "pm": true, "dollar": true, "dollars": true, "buck": true, "bucks": true,
		"cad": true, "usd": true, "cent": true, "cents": true, "percent": true, "x": true,
	}
	askQtyWords = map[string]bool{"qty": true, "quantity": true, "x": true, "times": true}
	askMonths   = map[string]bool{
		"jan": true, "january": true, "feb": true, "february": true, "mar": true, "march": true,
		"apr": true, "april": true, "may": true, "jun": true, "june": true, "jul": true, "july": true,
		"aug": true, "august": true, "sep": true, "sept": true, "september": true, "oct": true,
		"october": true, "nov": true, "november": true, "dec": true, "december": true,
	}
	// CJK counters / units / date-time characters that follow a count.
	askCJKCounters = map[string]bool{
		"張": true, "张": true, "件": true, "個": true, "个": true, "部": true, "台": true, "隻": true,
		"只": true, "單": true, "单": true, "日": true, "天": true, "年": true, "月": true, "號": true,
		"号": true, "點": true, "点": true, "分": true, "秒": true, "次": true, "元": true, "蚊": true,
		"位": true, "箱": true, "條": true, "条": true, "粒": true, "對": true, "套": true, "週": true,
		"周": true, "小": true, "鐘": true,
	}
	askCurrency     = map[string]bool{"$": true, "＄": true, "£": true, "€": true, "¥": true}
	askListPuncts   = map[string]bool{",": true, "、": true, "，": true, "/": true, "&": true, "＆": true, "#": true, "＃": true, "+": true}
	askListWords    = map[string]bool{"and": true, "or": true, "和": true, "同": true, "及": true, "與": true, "与": true, "或": true}
	askHashes       = map[string]bool{"#": true, "＃": true}
	askNumJoinPunct = map[string]bool{"-": true, ":": true, ".": true, "–": true}
)

func (t askTok) is(kind askTokKind) bool { return t.kind == kind }

// parseAskJobIDs returns the job numbers named in a Management Ask message,
// in order, deduped and capped at askMaxReferenceIDs.
func parseAskJobIDs(message string) []int64 {
	toks := tokenizeAsk(message)
	p := askParser{toks: toks}
	out := make([]int64, 0)
	seen := make(map[int64]bool)
	add := func(idx int) {
		n, err := strconv.ParseInt(toks[idx].text, 10, 64)
		if err != nil || n <= 0 || n > 1<<31-1 || seen[n] || len(out) >= askMaxReferenceIDs {
			return
		}
		seen[n] = true
		out = append(out, n)
	}
	chain := make([]int, 0, 4)
	flush := func() {
		if len(chain) >= 2 || (len(chain) == 1 && p.marked(chain[0])) {
			for _, idx := range chain {
				add(idx)
			}
		}
		chain = chain[:0]
	}
	last := -1
	for i, t := range toks {
		if !t.is(askTokNum) {
			continue
		}
		if p.excluded(i) {
			flush()
			last = -1
			continue
		}
		if last < 0 || !p.listJoined(last, i) {
			flush()
		}
		chain = append(chain, i)
		last = i
	}
	flush()
	return out
}

type askParser struct{ toks []askTok }

func (p askParser) at(i int) (askTok, bool) {
	if i < 0 || i >= len(p.toks) {
		return askTok{}, false
	}
	return p.toks[i], true
}

// glued reports whether toks[i] and toks[i+1] touch (no whitespace between).
func (p askParser) glued(i int) bool {
	next, ok := p.at(i + 1)
	return ok && i >= 0 && !next.spaceBefore
}

// marked reports whether number i is preceded by a job marker.
func (p askParser) marked(i int) bool {
	j := i - 1
	prev, ok := p.at(j)
	if !ok {
		return false
	}
	if prev.is(askTokPunct) && askHashes[prev.text] {
		return true
	}
	// "job: 15", "job no. 15", "ref.15"
	if prev.is(askTokPunct) && (prev.text == ":" || prev.text == "." || prev.text == "：") {
		j--
		if prev, ok = p.at(j); !ok {
			return false
		}
	}
	if !prev.is(askTokWord) {
		return false
	}
	if prev.ascii {
		if askJobMarkerWords[prev.text] {
			return true
		}
		if askJobNumberWords[prev.text] {
			k := j - 1
			before, ok := p.at(k)
			if ok && before.is(askTokPunct) && before.text == "." {
				before, ok = p.at(k - 1)
			}
			return ok && before.is(askTokWord) && before.ascii && askJobMarkerWords[before.text]
		}
		return false
	}
	// 工單15 / 單15 / 單號15 / 工单15
	if prev.text == "單" || prev.text == "单" {
		return true
	}
	if prev.text == "號" || prev.text == "号" {
		before, ok := p.at(j - 1)
		return ok && (before.text == "單" || before.text == "单")
	}
	return false
}

// excluded reports whether number i is clearly not a job number.
func (p askParser) excluded(i int) bool {
	t := p.toks[i]
	if len(strings.TrimLeft(t.text, "0")) >= 8 {
		return true // phone numbers and other long codes
	}
	prev, hasPrev := p.at(i - 1)
	next, hasNext := p.at(i + 1)
	gluedPrev := hasPrev && !t.spaceBefore
	gluedNext := hasNext && !next.spaceBefore

	// Letters glued on either side: model numbers ("V671", "12D"), "x2", "2x",
	// "3pm", "2nd". "job15" is still a job.
	if gluedPrev && prev.is(askTokWord) && prev.ascii && !askJobMarkerWords[prev.text] {
		return true
	}
	if gluedNext && next.is(askTokWord) && next.ascii {
		return true
	}
	// Digits joined by - : . (phone, dates, times, decimals, ranges).
	if gluedPrev && prev.is(askTokPunct) && askNumJoinPunct[prev.text] {
		if pp, ok := p.at(i - 2); ok && pp.is(askTokNum) && !prev.spaceBefore {
			return true
		}
	}
	if gluedNext && next.is(askTokPunct) && askNumJoinPunct[next.text] && p.glued(i+1) {
		if nn, ok := p.at(i + 2); ok && nn.is(askTokNum) {
			return true
		}
	}
	// Slash dates: 12/11/2026, or 12/11 without a job marker.
	if start, count, short := p.slashRun(i); count >= 3 || (count == 2 && short && !p.marked(start)) {
		return true
	}
	// Money and percentages.
	if hasPrev && prev.is(askTokPunct) && askCurrency[prev.text] {
		return true
	}
	if hasNext && next.is(askTokPunct) && (next.text == "%" || next.text == "％" || askCurrency[next.text]) {
		return true
	}
	// Quantities: "qty 2", "qty: 2", "× 2".
	if hasPrev {
		q := prev
		if q.is(askTokPunct) && (q.text == ":" || q.text == "：") {
			q, _ = p.at(i - 2)
		}
		if q.is(askTokWord) && q.ascii && askQtyWords[q.text] {
			return true
		}
		if prev.is(askTokPunct) && (prev.text == "×" || prev.text == "*") {
			return true
		}
	}
	if hasNext && next.is(askTokPunct) && (next.text == "×" || next.text == "*") {
		return true
	}
	// Counts and units right after the number.
	if hasNext && next.is(askTokWord) {
		if next.ascii && askCountWords[next.text] {
			return true
		}
		if !next.ascii && askCJKCounters[next.text] {
			return true
		}
	}
	// Month names around the number ("Nov 12", "12 November").
	if hasPrev && prev.is(askTokWord) && prev.ascii && askMonths[prev.text] {
		return true
	}
	if hasNext && next.is(askTokWord) && next.ascii && askMonths[next.text] {
		return true
	}
	return false
}

// slashRun finds the run of numbers glued by "/" around number i. short is true
// when every number in the run has at most two digits.
func (p askParser) slashRun(i int) (start, count int, short bool) {
	start = i
	for {
		s, ok := p.at(start - 1)
		n, ok2 := p.at(start - 2)
		if !ok || !ok2 || s.text != "/" || !n.is(askTokNum) || p.toks[start].spaceBefore || s.spaceBefore {
			break
		}
		start -= 2
	}
	short = true
	end := start
	count = 1
	if len(p.toks[start].text) > 2 {
		short = false
	}
	for {
		s, ok := p.at(end + 1)
		n, ok2 := p.at(end + 2)
		if !ok || !ok2 || s.text != "/" || !n.is(askTokNum) || s.spaceBefore || n.spaceBefore {
			break
		}
		end += 2
		count++
		if len(n.text) > 2 {
			short = false
		}
	}
	return start, count, short
}

// listJoined reports whether numbers a < b are joined only by list separators
// (", ", "、", " and ", " & ", ", and #", "/").
func (p askParser) listJoined(a, b int) bool {
	if b-a < 2 || b-a > 4 {
		return false
	}
	sawSep := false
	for k := a + 1; k < b; k++ {
		t := p.toks[k]
		switch {
		case t.is(askTokPunct) && askHashes[t.text]:
		case t.is(askTokPunct) && askListPuncts[t.text]:
			sawSep = true
		case t.is(askTokWord) && askListWords[t.text]:
			sawSep = true
		default:
			return false
		}
	}
	return sawSep
}

// ---------------------------------------------------------------------------
// Follow-up detection ("update both", "those jobs", "呢啲")
// ---------------------------------------------------------------------------

// The model reads the conversation and resolves follow-ups itself; these word
// lists are the server's backup when it does not.
var (
	askFollowUpEN = regexp.MustCompile(`(?i)\b(?:both|those|these|them|their|they|its|the jobs|the same|same jobs?|that job|this job|that one|this one|all of them|the above|above jobs?|the last ones?|(?:the\s+)?previous jobs?|the ones above|the ones?\s+(?:i|you|we)\s+(?:just\s+)?(?:asked(?:\s+about)?|showed|shown|mentioned|listed|found|looked\s+up|had|got))\b`)
	// "it" only counts right after an action verb ("set it to Finished").
	askFollowUpIt = regexp.MustCompile(`(?i)\b(?:set|update|change|move|mark|put|make|sum\s+up|total|show|open)\s+it\b`)
	// "all" only counts right after an update verb ("update all to Finished").
	askFollowUpAll = regexp.MustCompile(`(?i)\b(?:set|update|change|move|mark|put|make|finish|close|complete)\s+all\b`)
	// "all jobs" counts unless it starts a new search ("show all jobs for X").
	askAllJobs     = regexp.MustCompile(`(?i)\ball\s+jobs\b(\s+[a-z]+)?`)
	askAllJobsNext = map[string]bool{
		"for": true, "of": true, "from": true, "with": true, "by": true, "where": true,
		"that": true, "in": true, "on": true, "at": true, "since": true, "named": true, "under": true,
	}
	askFollowUpZH = []string{
		"呢啲", "嗰啲", "啱啱嗰啲", "啱啱", "頭先", "兩張", "兩單", "兩部", "兩個", "两张", "两单",
		"這些", "这些", "那些", "佢哋", "呢張", "嗰張", "呢單", "嗰單", "上面",
	}
	// 全部 and 個 (個狀態) count only together with an update verb.
	askFollowUpZHWithVerb = regexp.MustCompile(`全部|^個|佢個|\s個`)
	askUpdateVerb         = regexp.MustCompile(`(?i)\b(?:set|update|change|move|add|remove|put|make|finish|close|complete)\b|\bmark\s+(?:(?:as|it|them|those|these|both|all|the|this|that|jobs?|done|finished)\b|[#＃0-9])|改|設|设|更新|轉|转|搬|加|標|标`)
	askAddUp              = regexp.MustCompile(`(?i)\badd\s+(?:it\s+|them\s+|those\s+)?up\b`)
	// Customer follow-ups ("show her other jobs", "that customer").
	askCustomerRefEN = regexp.MustCompile(`(?i)\b(?:her|his|that customer|this customer|the same customer|same customer)\b`)
	askJobWord       = regexp.MustCompile(`(?i)\bjobs?\b|工單|工单|單|单`)
	// Parts request statuses as typed (draft … cancelled, plus "pending").
	askPartsStatusWords = regexp.MustCompile(`(?i)\b(?:draft|waiting[\s_-]*(?:for\s+)?approval|approved|ordered|arrived|used|cancell?ed|pending)\b`)
)

// isAskFollowUp reports whether a message refers back to earlier jobs.
func isAskFollowUp(message string) bool {
	if askFollowUpEN.MatchString(message) || askFollowUpIt.MatchString(message) || askFollowUpAll.MatchString(message) {
		return true
	}
	for _, m := range askAllJobs.FindAllStringSubmatch(message, -1) {
		if next := strings.ToLower(strings.TrimSpace(m[1])); !askAllJobsNext[next] {
			return true
		}
	}
	for _, phrase := range askFollowUpZH {
		if strings.Contains(message, phrase) {
			return true
		}
	}
	return askFollowUpZHWithVerb.MatchString(message) && isAskUpdateVerb(message)
}

func isAskUpdateVerb(message string) bool {
	return askUpdateVerb.MatchString(askAddUp.ReplaceAllString(message, " "))
}

// isAskCustomerFollowUp reports whether a message refers back to the saved
// customer ("her other jobs", "that customer", 佢 but not 佢哋).
func isAskCustomerFollowUp(message string) bool {
	if askCustomerRefEN.MatchString(message) {
		return true
	}
	return strings.Contains(strings.ReplaceAll(strings.ReplaceAll(message, "佢哋", ""), "佢個", ""), "佢")
}

// isAskBothTyped reports whether "both" is the only follow-up word and names
// at least two typed job numbers ("set both #275 and #15 to Finished").
func isAskBothTyped(message string, explicit []int64) bool {
	if len(explicit) < 2 {
		return false
	}
	without := regexp.MustCompile(`(?i)\bboth\b`).ReplaceAllString(message, " ")
	return without != message && !isAskFollowUp(without)
}

// isAskBareJobNumbers reports whether the message is only job numbers and
// separators: "#31121 #7", "jobs 31121 and 7", "#31121 同 #7".
func isAskBareJobNumbers(message string) bool {
	toks := tokenizeAsk(message)
	nums := 0
	for _, t := range toks {
		switch {
		case t.is(askTokNum):
			nums++
		case t.is(askTokPunct) && (askListPuncts[t.text] || t.text == ":" || t.text == "." || t.text == "：" || t.text == "？" || t.text == "?"):
		case t.is(askTokWord) && (askListWords[t.text] || t.text == "job" || t.text == "jobs" || t.text == "工" || t.text == "單" || t.text == "单" || t.text == "号" || t.text == "號"):
		default:
			return false
		}
	}
	return nums > 0 && len(parseAskJobIDs(message)) > 0
}

// askStandaloneNumbers returns every number token in the message (a model id
// is trusted when the user typed it, even unmarked: "show 275").
func askStandaloneNumbers(message string) map[int64]bool {
	out := map[int64]bool{}
	for _, t := range tokenizeAsk(message) {
		if t.is(askTokNum) {
			if n, err := strconv.ParseInt(t.text, 10, 64); err == nil {
				out[n] = true
			}
		}
	}
	return out
}

// askTextHasWords reports whether every word of phrase appears in text
// (case-insensitive): a customer name the user actually typed.
func askTextHasWords(text, phrase string) bool {
	words := strings.Fields(strings.ToLower(phrase))
	if len(words) == 0 {
		return false
	}
	lower := strings.ToLower(text)
	for _, w := range words {
		if !strings.Contains(lower, w) {
			return false
		}
	}
	return true
}

// askNamesAny reports whether text names one of names as a whole phrase
// (case-insensitive): a job status or location.
func askNamesAny(text string, names []string) bool {
	lower := " " + strings.ToLower(strings.Join(strings.FieldsFunc(text, askNotWordRune), " ")) + " "
	for _, name := range names {
		n := strings.ToLower(strings.Join(strings.FieldsFunc(name, askNotWordRune), " "))
		if n != "" && strings.Contains(lower, " "+n+" ") {
			return true
		}
	}
	return false
}

func askNotWordRune(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

func askJobRefs(ids []int64, conj string) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = "#" + strconv.FormatInt(id, 10)
	}
	if len(parts) <= 1 {
		return strings.Join(parts, "")
	}
	return strings.Join(parts[:len(parts)-1], ", ") + " " + conj + " " + parts[len(parts)-1]
}

// askNotice explains which job numbers were not found, e.g.
// "Found #275 and #27501. No job #15." It is empty when nothing is missing.
func askNotice(found, missing []int64) string {
	if len(missing) == 0 {
		return ""
	}
	miss := "No job " + askJobRefs(missing, "or") + "."
	if len(missing) > 1 {
		miss = "No jobs " + askJobRefs(missing, "or") + "."
	}
	if len(found) == 0 {
		return miss
	}
	return "Found " + askJobRefs(found, "and") + ". " + miss
}

// askPreviewInstruction prefixes the typed text with the resolved job numbers
// so Mass Update preview works on exactly those jobs.
func askPreviewInstruction(ids []int64, message string) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = "#" + strconv.FormatInt(id, 10)
	}
	label := "Jobs "
	if len(ids) == 1 {
		label = "Job "
	}
	return label + strings.Join(parts, ", ") + ": " + askOneLine(message, aiToolsMaxTextChars)
}

// askRefList renders "#1, #2, #3" (at most max ids, then "and N more").
func askRefList(ids []int64, max int) string {
	shown := ids
	if max > 0 && len(ids) > max {
		shown = ids[:max]
	}
	parts := make([]string, len(shown))
	for i, id := range shown {
		parts[i] = "#" + strconv.FormatInt(id, 10)
	}
	out := strings.Join(parts, ", ")
	if len(shown) < len(ids) {
		out += " and " + strconv.Itoa(len(ids)-len(shown)) + " more"
	}
	return out
}

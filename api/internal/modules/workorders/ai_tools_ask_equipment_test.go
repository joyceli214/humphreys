package workorders

import (
	"reflect"
	"testing"
)

// Rule 9: a number with no '#' is a job number unless it is clearly something else.
func TestAskTypedJobIDsBareNumbers(t *testing.T) {
	for _, tc := range []struct {
		msg  string
		want []int64
	}{
		// Job numbers.
		{"31121", []int64{31121}},
		{"show 31121", []int64{31121}},
		{"what's the status of 31121", []int64{31121}},
		{"what's the status of 31121?", []int64{31121}},
		{"parts for 31121", []int64{31121}},
		{"check 31121 please", []int64{31121}},
		{"#31121", []int64{31121}},
		{"job 31121", []int64{31121}},
		{"31121 and 31122", []int64{31121, 31122}},
		// Not job numbers.
		{"$110", nil},
		{"110 dollars", nil},
		{"23.40", nil},
		{"$110, 1 hour", nil},
		{"110 for 1.5 hr", nil},
		{"2 x L7", nil},
		{"qty 3", nil},
		{"3 pcs", nil},
		{"1.5 hr", nil},
		{"1 hour", nil},
		{"request 5", nil},
		{"parts request 5", nil},
		{"PR 5", nil},
		{"approve 480", nil},
		{"Marantz 2270", nil},
		{"find Marantz 2270", nil},
		{"serial 123456", nil},
		{"model L-509", nil},
		{"any Technics SL-1200?", nil},
		{"invoice 88123", nil},
		{"call 604-555-1234", nil},
		{"6045551234", nil},
		{"jobs from 2025", nil},
		{"Nov 12", nil},
		{"12/11/2026", nil},
	} {
		got := askTypedJobIDs(tc.msg)
		if len(got) == 0 {
			got = nil
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("askTypedJobIDs(%q) = %v, want %v", tc.msg, got, tc.want)
		}
	}
}

func TestAskBareJobNumberLooksUpTheJob(t *testing.T) {
	for _, msg := range []string{"31351", "show 31351", "what's the status of 31351"} {
		t.Run(msg, func(t *testing.T) {
			llm, _, ask := skillSetup(t)
			llm.answer(askIntentUnknown)
			resp := ask(msg)
			if resp.Intent != askIntentCustomerJobs || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31351}) {
				t.Fatalf("resp = %+v", resp)
			}
		})
	}
}

func TestAskPendingLabourStaysLabourWithBareNumbers(t *testing.T) {
	llm, _, ask := skillSetup(t)
	llm.answer(askIntentAddLabour, 31351)
	ask("add labour to #31351")
	llm.answer(askIntentUnknown)
	p := ask("$110, 1 hour").LabourPreview
	if p == nil || p.ReferenceID != 31351 || p.Amount != 110 {
		t.Fatalf("preview = %+v", p)
	}
}

// Rule 10: search jobs by make, model and serial.
func TestAskEquipmentTyped(t *testing.T) {
	for _, tc := range []struct {
		msg  string
		want askEquipmentFilter
	}{
		{"serial 123456", askEquipmentFilter{Serial: "123456"}},
		{"s/n: AB-123", askEquipmentFilter{Serial: "AB-123"}},
		{"model L-509", askEquipmentFilter{Model: "L-509"}},
		{"model no. 2270", askEquipmentFilter{Model: "2270"}},
		{"make Luxman", askEquipmentFilter{Brand: "Luxman"}},
		{"brand Marantz model 2270", askEquipmentFilter{Brand: "Marantz", Model: "2270"}},
		{"what's the make and model on #31178", askEquipmentFilter{}},
		{"make it Finished", askEquipmentFilter{}},
		{"model of that job", askEquipmentFilter{}},
	} {
		if got := askEquipmentTyped(tc.msg); got != tc.want {
			t.Errorf("askEquipmentTyped(%q) = %+v, want %+v", tc.msg, got, tc.want)
		}
	}
}

func equipmentSetup(t *testing.T) (*askLLM, *memAskStore, *aiToolsStub, func(string) askInterpretResponse) {
	t.Helper()
	llm := newAskLLM(t)
	store := shopStore()
	stub := shopStub()
	stub.searchRows = []AISearchRow{
		{ReferenceID: 31351, CustomerName: "Ann Lee", BrandNames: []string{"Marantz"}, ModelNumber: "2270", SerialNumber: "123456", StatusName: "Received"},
		{ReferenceID: 31352, CustomerName: "Bo Chan", BrandNames: []string{"Marantz"}, ModelNumber: "2270", SerialNumber: "999", StatusName: "Finished"},
	}
	stub.searchTotal = 2
	router := skillRouter(t, store, stub, 1000)
	return llm, store, stub, func(msg string) askInterpretResponse { return askWith(t, router, skillPerms, msg) }
}

func TestAskEquipmentSearch(t *testing.T) {
	for _, tc := range []struct {
		msg   string
		model map[string]any // the model's answer (nil: unknown)
		want  askEquipmentFilter
	}{
		{"serial 123456", nil, askEquipmentFilter{Serial: "123456"}},
		{"model L-509", nil, askEquipmentFilter{Model: "L-509"}},
		{"make Luxman", nil, askEquipmentFilter{Brand: "Luxman"}},
		{"find Marantz 2270", map[string]any{"intent": askIntentSearchEquipment, "brand": "Marantz", "model_number": "2270"}, askEquipmentFilter{Brand: "Marantz", Model: "2270"}},
		{"jobs for Luxman", map[string]any{"intent": askIntentSearchEquipment, "brand": "Luxman"}, askEquipmentFilter{Brand: "Luxman"}},
		{"any Technics SL-1200?", map[string]any{"intent": askIntentSearchEquipment, "brand": "Technics", "model_number": "SL-1200"}, askEquipmentFilter{Brand: "Technics", Model: "SL-1200"}},
		// A model value that was not typed is dropped.
		{"find Marantz", map[string]any{"intent": askIntentSearchEquipment, "brand": "Marantz", "model_number": "2270"}, askEquipmentFilter{Brand: "Marantz"}},
	} {
		t.Run(tc.msg, func(t *testing.T) {
			llm, store, stub, ask := equipmentSetup(t)
			if tc.model == nil {
				llm.answer(askIntentUnknown)
			} else {
				llm.answerJSON(tc.model)
			}
			resp := ask(tc.msg)
			if resp.Intent != askIntentSearchEquipment || resp.EquipmentSearch == nil {
				t.Fatalf("resp = %+v", resp)
			}
			f := stub.lastSearch
			if f == nil || f.Brand != tc.want.Brand || f.Model != tc.want.Model || f.Serial != tc.want.Serial ||
				f.Limit != askMaxReferenceIDs || len(f.JobIDs) != 0 || f.Text != "" {
				t.Fatalf("filters = %+v", f)
			}
			s := resp.EquipmentSearch
			if s.Total != 2 || len(s.Rows) != 2 || s.Rows[0] != (askEquipmentRow{ReferenceID: 31351, StatusName: "Received", CustomerName: "Ann Lee", Brand: "Marantz", ModelNumber: "2270", SerialNumber: "123456"}) {
				t.Fatalf("search = %+v", s)
			}
			if resp.PreviewInstruction != "" || !reflect.DeepEqual(resp.ReferenceIDs, []int64{31351, 31352}) {
				t.Fatalf("resp = %+v", resp)
			}
			row, _ := store.row(askUserA)
			if !reflect.DeepEqual(row.ReferenceIDs, []int64{31351, 31352}) {
				t.Fatalf("context = %+v", row)
			}
		})
	}
}

func TestAskEquipmentSearchFollowUp(t *testing.T) {
	llm, _, _, ask := equipmentSetup(t)
	llm.answer(askIntentUnknown)
	ask("serial 123456")
	llm.answer(askIntentCustomerJobs)
	resp := ask("show those")
	if !reflect.DeepEqual(resp.ReferenceIDs, []int64{31351, 31352}) || !resp.ContextUsed {
		t.Fatalf("resp = %+v", resp)
	}
}

package workorders

import (
	"strings"
	"testing"
)

// Ask never works out labour money: it asks for the amount, remembers the
// question, and builds the preview from the numbers in the reply.

func TestAskLabourAsksForAmountAndUsesTheReply(t *testing.T) {
	for _, tc := range []struct {
		reply  string
		amount float64
		hours  float64 // 0: none
	}{
		{"$110, 1 hour", 110, 1},
		{"110 for 1.5 hr", 110, 1.5},
		{"just $80", 80, 0},
		{"$95", 95, 0},
		{"1.5 hours $165", 165, 1.5},
		{"110", 110, 0},
	} {
		t.Run(tc.reply, func(t *testing.T) {
			llm, store, ask := skillSetup(t)
			llm.answer(askIntentAddLabour, 31351)
			resp := ask("add labour to #31351")
			if resp.LabourPreview != nil || resp.Reply != "How much labour for #31351? You can add the hours too, e.g. “$110, 1 hour”." {
				t.Fatalf("resp = %+v", resp)
			}
			row, _ := store.row(askUserA)
			if row.Pending == nil || row.Pending.Kind != askPendingLabour || row.Pending.ReferenceID != 31351 {
				t.Fatalf("pending = %+v", row.Pending)
			}
			llm.answer(askIntentUnknown)
			p := ask(tc.reply).LabourPreview
			if p == nil || p.ReferenceID != 31351 || p.Amount != tc.amount || *p.Row.Operation.LabourTotal != tc.amount {
				t.Fatalf("preview = %+v", p)
			}
			if (tc.hours == 0) != (p.Hours == nil) || (p.Hours != nil && *p.Hours != tc.hours) {
				t.Fatalf("hours = %v", p.Hours)
			}
			if row, _ := store.row(askUserA); row.Pending != nil {
				t.Fatalf("pending kept after preview: %+v", row.Pending)
			}
		})
	}
}

func TestAskLabourPendingKeepsHoursAndAsksAgain(t *testing.T) {
	llm, store, ask := skillSetup(t)
	llm.answer(askIntentAddLabour, 31351)
	if resp := ask("add 1 hour labour to #31351"); resp.LabourPreview != nil || !strings.Contains(resp.Reply, "How much labour for #31351") {
		t.Fatalf("resp = %+v", resp)
	}
	// Still no money: ask again, hours kept.
	llm.answer(askIntentUnknown)
	if resp := ask("2 hours"); resp.LabourPreview != nil || !strings.Contains(resp.Reply, "How much labour for #31351") {
		t.Fatalf("resp = %+v", resp)
	}
	if row, _ := store.row(askUserA); row.Pending == nil || row.Pending.Hours == nil || *row.Pending.Hours != 2 {
		t.Fatalf("pending = %+v", row.Pending)
	}
	llm.answer(askIntentUnknown)
	if p := ask("$150").LabourPreview; p == nil || p.Amount != 150 || p.Hours == nil || *p.Hours != 2 {
		t.Fatalf("preview = %+v", p)
	}
}

func TestAskPendingDroppedByADifferentRequest(t *testing.T) {
	for _, msg := range []string{"what's the status of #31165?", "add labour to #31165", "complete job #31351", "show parts requests", "thanks"} {
		t.Run(msg, func(t *testing.T) {
			llm, store, ask := skillSetup(t)
			llm.answer(askIntentAddLabour, 31351)
			ask("add labour to #31351")
			llm.answer(askIntentUnknown)
			resp := ask(msg)
			if p := resp.LabourPreview; p != nil && p.ReferenceID == 31351 {
				t.Fatalf("pending answered by %q: %+v", msg, p)
			}
			row, _ := store.row(askUserA)
			if row.Pending != nil && row.Pending.ReferenceID == 31351 {
				t.Fatalf("pending kept: %+v", row.Pending)
			}
		})
	}
}

func TestAskPendingSurvivesTurnLimitAndNewConversationClearsIt(t *testing.T) {
	llm, store, ask := skillSetup(t)
	llm.answer(askIntentAddLabour, 31351)
	ask("add labour to #31351")
	row, _ := store.row(askUserA)
	if row.Pending == nil {
		t.Fatal("no pending")
	}
	// Even with the 12-turn window full, the pending question is kept.
	for len(row.Turns) < askMaxTurns+2 {
		row.Turns = appendAskTurn(row.Turns, "x", "y")
		if len(row.Turns) == askMaxTurns {
			break
		}
	}
	if len(row.Turns) != askMaxTurns || row.Pending == nil {
		t.Fatalf("row = %+v", row)
	}
	// A saved empty context (New conversation) has no pending question.
	if (askContext{ReferenceIDs: []int64{}, Topic: askTopicJobs}).Pending != nil {
		t.Fatal("empty context has a pending question")
	}
}

func TestAskRepairLogAsksForHours(t *testing.T) {
	llm, store, ask := skillSetup(t)
	llm.answer(askIntentAddRepairLog, 31352)
	resp := ask("Add a repair log to #31352: Final test OK")
	if resp.RepairLogPreview != nil || resp.Reply != "How many hours for this repair log on #31352?" {
		t.Fatalf("resp = %+v", resp)
	}
	if row, _ := store.row(askUserA); row.Pending == nil || row.Pending.Kind != askPendingRepairLog || row.Pending.Text != "Final test OK" {
		t.Fatalf("pending = %+v", row.Pending)
	}
	// The model's hours are not used when none were typed.
	llm.answerJSON(map[string]any{"intent": askIntentAddRepairLog, "reference_ids": []int64{31352}, "log_text": "Final test OK", "hours": 0.25})
	if resp := ask("Add a repair log to #31352: Final test OK"); resp.RepairLogPreview != nil {
		t.Fatalf("invented hours used: %+v", resp.RepairLogPreview)
	}
	llm.answer(askIntentUnknown)
	p := ask("1 hr").RepairLogPreview
	if p == nil || p.ReferenceID != 31352 || p.Details != "Final test OK" || p.HoursUsed != 1 {
		t.Fatalf("preview = %+v", p)
	}
}

func TestAskNewJobPointsToThePortal(t *testing.T) {
	for _, model := range []string{askIntentUnknown, "create_job"} {
		llm, store, ask := skillSetup(t)
		llm.answer(model)
		resp := ask("New job for Pat Example, 416-555-0199, receiver, no sound")
		if resp.Intent != askIntentUnknown || resp.Reply != askNewJobReply || resp.Link == nil || resp.Link.Href != "/work-orders/create?mode=new_job" {
			t.Fatalf("resp = %+v", resp)
		}
		row, _ := store.row(askUserA)
		for _, tr := range row.Turns {
			if strings.Contains(tr.User, "Pat") || strings.Contains(tr.User, "555") {
				t.Fatalf("customer details kept: %+v", tr)
			}
		}
	}
}

func TestAskPartsRequestCreatesOnlyTheRequest(t *testing.T) {
	for _, msg := range []string{"Create a parts request on #275: L6 x2 $3.50", "create a parts request for L7 on #275"} {
		llm, _, _, ask := finishSetup(t)
		llm.answer(askIntentCreatePartsRequest, 275)
		resp := ask(msg)
		if resp.Intent != askIntentCreatePartsRequest || resp.PartsCreatePreview == nil {
			t.Fatalf("%s: resp = %+v", msg, resp)
		}
		// No billing or line item change rides along.
		if resp.PreviewInstruction != "" || resp.LabourPreview != nil || resp.PartsPreview != nil || resp.InvoicePreview != nil || resp.CompleteJobPreview != nil {
			t.Fatalf("%s: extra action: %+v", msg, resp)
		}
	}
}

func TestAskLabourJobNumberIsNeverTheAmount(t *testing.T) {
	for _, msg := range []string{"Add labour to #30175 for 1 hour", "add labour to job 30175 for 1.5 hr"} {
		if got := askAmountIn(msg, false); got != nil {
			t.Fatalf("%q amount = %v, want none", msg, *got)
		}
	}
	if got := askAmountIn("Add labour to #30175: 110 for 1.5 hr", false); got == nil || *got != 110 {
		t.Fatalf("110 for 1.5 hr = %v", got)
	}
}

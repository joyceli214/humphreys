package workorders

import (
	"humphreys/api/internal/modules/catalog"
	"strings"
	"testing"
)

func TestAskInvoicePrefersApprovedAndKeepsPartNumber(t *testing.T) {
	llm, store, _, ask := finishSetup(t)
	store.partRows = []askPartsRow{partRow(1, 275, "Capacitor 1234", "approved", 0), partRow(2, 28800, "Capacitor 1234", "waiting_approval", 0)}
	llm.answer(askIntentUnknown)
	p := ask("Invoice 123 - mark ordered\nCapacitor 1234").InvoicePreview
	if p == nil || len(p.Lines) != 1 || p.Lines[0].Change == nil || p.Lines[0].Change.PartsPurchaseRequestID != 1 || p.Lines[0].Price != nil {
		t.Fatalf("preview=%+v", p)
	}
}

func TestAskInvoiceWithoutNumberOrHeaderKeepsEveryPart(t *testing.T) {
	llm, store, _, ask := finishSetup(t)
	store.partRows = []askPartsRow{partRow(1, 275, "Capacitor 1234", "approved", 0), partRow(2, 28800, "Drive belt", "approved", 0)}
	for _, msg := range []string{"Mark these parts ordered\nCapacitor 1234 $8.50\nDrive belt $4.50", "Capacitor 1234 $8.50\nDrive belt $4.50\nmark these ordered"} {
		llm.answer(askIntentUnknown)
		p := ask(msg).InvoicePreview
		if p == nil || p.InvoiceNumber != "" || len(p.Lines) != 2 {
			t.Fatalf("%q: preview=%+v", msg, p)
		}
		for i, want := range []struct {
			id    int64
			price float64
		}{{1, 8.5}, {2, 4.5}} {
			ch := p.Lines[i].Change
			if ch == nil || !ch.Valid || ch.PartsPurchaseRequestID != want.id || ch.NewPrice != want.price {
				t.Fatalf("%q: line=%+v", msg, p.Lines[i])
			}
		}
	}
}

func TestAskCreatePartsRejectsNegativePriceAndFractionalQuantity(t *testing.T) {
	llm, _, _, ask := finishSetup(t)
	llm.answer(askIntentCreatePartsRequest, 275)
	for _, msg := range []string{"create a parts request on #275: L6 x2 $-3.50", "create a parts request on #275: L6 x1.5 $3.50"} {
		if resp := ask(msg); resp.PartsCreatePreview != nil {
			t.Fatalf("%s: preview=%+v", msg, resp.PartsCreatePreview)
		}
	}
}

func TestAskCompleteJobFinishedFallbackPrecedesOtherFinishLabels(t *testing.T) {
	llm, _, cat, ask := finishSetup(t)
	cat.statuses = []catalog.LookupOption{{ID: 30, Label: "Finishing"}, {ID: 20, Label: "Finished"}}
	llm.answer(askIntentCompleteJob, 31352)
	p := ask("complete job #31352").CompleteJobPreview
	if p == nil || p.TargetStatusID != 20 {
		t.Fatalf("preview=%+v", p)
	}
}

func TestAskNewJobDetailsStayOutOfSummaryPrompt(t *testing.T) {
	llm, store, _, ask := finishSetup(t)
	llm.answer(askIntentUnknown)
	ask(newJobMsg)
	row, _ := store.row(askUserA)
	prompt := buildAskSummaryPrompt(row)
	for _, pii := range []string{"Pat Example", "416", "pat@", "Bramalea", "Brampton", "L6T"} {
		if strings.Contains(prompt, pii) {
			t.Fatalf("intake detail %q leaked into summary prompt", pii)
		}
	}
}

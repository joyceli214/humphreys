package workorders

import (
	"errors"
	"testing"
	"time"

	"humphreys/api/internal/domain"
)

func TestApplyCustomerEmailOverridesUsesSanitizedHTML(t *testing.T) {
	base := customerEmailMessage{To: "old@example.com", Subject: "Default", Body: "Default body"}
	msg, err := applyCustomerEmailOverrides(base, sendCustomerEmailRequest{
		Template: customerEmailJobStarted,
		To:       " new@example.com ",
		Subject:  "Job #1 started",
		Body:     "Hi plain",
		BodyHTML: `<p onclick="x()">Hi <a href="javascript:alert(1)">bad</a> <a href="https://example.com">ok</a></p>`,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if msg.To != "new@example.com" || msg.Subject != "Job #1 started" || msg.Body != "Hi plain" {
		t.Fatalf("unexpected overrides: %+v", msg)
	}
	if msg.BodyHTML != `<p>Hi <a>bad</a> <a href="https://example.com">ok</a></p>` {
		t.Fatalf("unexpected html: %s", msg.BodyHTML)
	}
}

func TestApplyCustomerEmailOverridesTextOnlyIsBackwardCompatible(t *testing.T) {
	base := customerEmailMessage{To: "old@example.com", Subject: "Default", Body: "Default body"}
	msg, err := applyCustomerEmailOverrides(base, sendCustomerEmailRequest{Template: customerEmailJobStarted, Body: "Edited", BodyHTML: "<p> </p>"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if msg.BodyHTML != "" || msg.Body != "Edited" || msg.To != "old@example.com" {
		t.Fatalf("unexpected message: %+v", msg)
	}
}

func TestApplyCustomerEmailOverridesRejectsBadAddress(t *testing.T) {
	_, err := applyCustomerEmailOverrides(customerEmailMessage{}, sendCustomerEmailRequest{To: "not an email"})
	if !errors.Is(err, ErrInvalidEmailFormat) {
		t.Fatalf("expected invalid email error, got %v", err)
	}
}

func TestWorkOrderPhotoSourcesIncludeRepairLogs(t *testing.T) {
	problem := "![a](https://x/a.jpg)"
	work := "done"
	date := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	sources := workOrderPhotoSources(domain.WorkOrderDetail{ProblemDescription: &problem, WorkDone: &work},
		[]domain.RepairLog{{Details: "log1", RepairDate: &date}, {Details: "log2"}})
	if len(sources) != 4 || sources[0].Markdown != problem || sources[2].Label != "Repair log Oct 22" || sources[3].Label != "Repair log" {
		t.Fatalf("unexpected sources: %+v", sources)
	}
}

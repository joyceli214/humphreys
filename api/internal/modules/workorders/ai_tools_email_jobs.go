package workorders

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"

	"humphreys/api/internal/domain"
)

// emailDraftMaxJobs bounds how many jobs one customer email may cover.
const emailDraftMaxJobs = 10

// emailDraftJobsError carries the HTTP status to answer with.
type emailDraftJobsError struct {
	status int
	msg    string
}

func (e *emailDraftJobsError) Error() string { return e.msg }

func badEmailJobs(status int, format string, args ...any) error {
	return &emailDraftJobsError{status: status, msg: fmt.Sprintf(format, args...)}
}

// emailDraftJobIDs merges the legacy single work_order_id with work_order_ids,
// dropping duplicates while keeping order, and enforces 1..emailDraftMaxJobs.
func emailDraftJobIDs(single int, many []int) ([]int, error) {
	raw := make([]int, 0, len(many)+1)
	if single != 0 {
		raw = append(raw, single)
	}
	raw = append(raw, many...)
	seen := make(map[int]bool, len(raw))
	ids := make([]int, 0, len(raw))
	for _, id := range raw {
		if id <= 0 {
			return nil, badEmailJobs(http.StatusBadRequest, "work order ids must be positive")
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, badEmailJobs(http.StatusBadRequest, "work_order_id or work_order_ids is required")
	}
	if len(ids) > emailDraftMaxJobs {
		return nil, badEmailJobs(http.StatusBadRequest, "an email can cover at most %d jobs", emailDraftMaxJobs)
	}
	return ids, nil
}

// loadEmailDraftJobs fetches every job and its repair logs and verifies they
// all belong to the same customer (one email per customer).
func (h *Handler) loadEmailDraftJobs(ctx context.Context, ids []int) ([]domain.WorkOrderDetail, [][]domain.RepairLog, error) {
	items := make([]domain.WorkOrderDetail, 0, len(ids))
	logs := make([][]domain.RepairLog, 0, len(ids))
	for _, id := range ids {
		item, err := h.service.GetWorkOrderDetail(ctx, id)
		if errors.Is(err, ErrWorkOrderNotFound) {
			return nil, nil, badEmailJobs(http.StatusNotFound, "work order %d not found", id)
		}
		if err != nil {
			return nil, nil, badEmailJobs(http.StatusInternalServerError, "failed to fetch work order")
		}
		repairLogs, err := h.service.ListRepairLogs(ctx, id)
		if err != nil {
			return nil, nil, badEmailJobs(http.StatusInternalServerError, "failed to fetch repair logs")
		}
		items = append(items, item)
		logs = append(logs, repairLogs)
	}
	if len(items) > 1 {
		first := items[0].Customer.CustomerID
		for _, item := range items {
			cid := item.Customer.CustomerID
			if first == nil || cid == nil || *cid != *first {
				return nil, nil, badEmailJobs(http.StatusBadRequest,
					"selected jobs belong to different customers; send one email per customer")
			}
		}
	}
	return items, logs, nil
}

// maskEmailHint turns "jane@gmail.com" into "j***@gmail.com". Anything that is
// not a plausible address yields "" so the UI shows "no email on file".
func maskEmailHint(raw string) string {
	email := strings.TrimSpace(raw)
	at := strings.LastIndex(email, "@")
	if at <= 0 || at == len(email)-1 {
		return ""
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return ""
	}
	return email[:1] + "***" + email[at:]
}

// buildMultiJobEmailDraftPrompt describes every picked job (by job number and
// equipment) with its status, line items and repair logs. It passes the
// customer's display name only — never their email or phone.
func buildMultiJobEmailDraftPrompt(draftType, notes string, items []domain.WorkOrderDetail, logs [][]domain.RepairLog) string {
	var b strings.Builder
	b.WriteString(emailDraftTypeGuidance(draftType))
	b.WriteString("\nDo not invent prices: only state amounts that appear in the line items or the extra notes.\n")
	if len(items) > 1 {
		b.WriteString(fmt.Sprintf("This one email covers %d jobs for the same customer. "+
			"Address each job clearly by its job number and equipment (e.g. \"Job #123 – Receiver\").\n", len(items)))
	}
	if len(items) > 0 {
		b.WriteString(fmt.Sprintf("\nCustomer name: %s\n", aiCustomerName(items[0])))
	}
	for i, item := range items {
		b.WriteString(fmt.Sprintf("\nJob #%d – %s\n", item.ReferenceID, emailEquipmentName(item)))
		b.WriteString(fmt.Sprintf("- Status: %s\n", stringValueOrDefault(item.StatusName, "-")))
		b.WriteString(fmt.Sprintf("- Problem: %s\n", markdownToEmailPlainText(item.ProblemDescription)))
		if workDone := markdownToEmailPlainText(item.WorkDone); workDone != "-" {
			b.WriteString(fmt.Sprintf("- Work done: %s\n", workDone))
		}
		if len(item.LineItems) > 0 {
			b.WriteString("- Line items:\n")
			for _, li := range item.LineItems {
				name := stringValueOrDefault(li.ItemName, "item")
				if li.UnitPrice != nil {
					b.WriteString(fmt.Sprintf("  - %s: %s\n", name, aiMoney(float64Value(li.UnitPrice))))
				} else {
					b.WriteString(fmt.Sprintf("  - %s (no price given)\n", name))
				}
			}
		}
		var repairLogs []domain.RepairLog
		if i < len(logs) {
			repairLogs = logs[i]
		}
		b.WriteString(fmt.Sprintf("- Recent repair logs: %s\n", summarizeRepairLogs(repairLogs)))
	}
	if notes != "" {
		b.WriteString("\nExtra notes from the shop (follow these):\n")
		b.WriteString(notes)
		b.WriteString("\n")
	}
	b.WriteString("\nWrite the subject and body now.\n")
	return b.String()
}

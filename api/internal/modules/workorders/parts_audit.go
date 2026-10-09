package workorders

import (
	"context"
	"math"
	"sort"
	"strconv"
	"time"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	PartsFlagApprovedWithoutReview     = "approved_without_review"
	PartsFlagPriceChangedAfterApproval = "price_changed_after_approval"
)

type PartsAuditEntry struct {
	ID                     int64     `json:"id"`
	PartsPurchaseRequestID int64     `json:"parts_purchase_request_id"`
	ReferenceID            int32     `json:"reference_id"`
	Action                 string    `json:"action"`
	Field                  *string   `json:"field"`
	OldValue               *string   `json:"old_value"`
	NewValue               *string   `json:"new_value"`
	ChangedByUserID        *string   `json:"changed_by_user_id"`
	ChangedByName          *string   `json:"changed_by_name"`
	ChangedAt              time.Time `json:"changed_at"`
	AfterApproval          bool      `json:"after_approval"`
}

type partsAuditRow struct {
	Action, Field string
	Old, New      *string
	AfterApproval bool
}

func priceString(v float64) string { return strconv.FormatFloat(math.Round(v*100)/100, 'f', 2, 64) }
func strPtr(s string) *string      { return &s }

// partsAuditValues snapshots every editable field, preserving NULL source URLs.
func partsAuditValues(item domain.PartsPurchaseRequest) []partsAuditRow {
	return []partsAuditRow{
		{Field: "status", New: strPtr(item.Status)},
		{Field: "total_price", New: strPtr(priceString(item.TotalPrice))},
		{Field: "quantity", New: strPtr(strconv.FormatInt(int64(item.Quantity), 10))},
		{Field: "item_name", New: strPtr(item.ItemName)},
		{Field: "source", New: strPtr(item.Source)},
		{Field: "source_url", New: item.SourceURL},
	}
}

func sameAuditValue(a, b *string) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

// diffPartsAudit records all editable fields. Price precedes status so a price
// edit alongside first approval is not treated as an edit after approval.
func diffPartsAudit(old, updated domain.PartsPurchaseRequest) []partsAuditRow {
	before, after := partsAuditValues(old), partsAuditValues(updated)
	rows := []partsAuditRow{}
	for _, i := range []int{1, 2, 3, 4, 5, 0} {
		if !sameAuditValue(before[i].New, after[i].New) {
			rows = append(rows, partsAuditRow{Action: "update", Field: after[i].Field, Old: before[i].New, New: after[i].New})
		}
	}
	return rows
}

func createPartsAuditRows(item domain.PartsPurchaseRequest) []partsAuditRow {
	rows := partsAuditValues(item)
	for i := range rows {
		rows[i].Action = "create"
	}
	return rows
}

func deletePartsAuditRows(item domain.PartsPurchaseRequest) []partsAuditRow {
	rows := partsAuditValues(item)
	for i := range rows {
		rows[i].Action, rows[i].Old, rows[i].New = "delete", rows[i].New, nil
	}
	return rows
}

// ComputePartsFlags derives persistent review flags from one request's audit entries.
// approved_without_review: request reached "approved" (via create or status change) without ever having been in waiting_approval before.
// A draft (including price edits while still draft) has no flags until approval.
// price_changed_after_approval: total_price changed after the request first became approved.
func ComputePartsFlags(entries []PartsAuditEntry) []string {
	entries = append([]PartsAuditEntry(nil), entries...)
	// IDs reflect writes made under the request's row lock. Transaction start
	// timestamps can disagree with that order when two edits contend for a lock.
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	flags := []string{}
	sawWaiting, approved, skipFlag, priceFlag := false, false, false, false
	for _, e := range entries {
		var status *string
		if e.Action == "create" && e.Field != nil && *e.Field == "status" {
			status = e.NewValue
		}
		if e.Action == "update" && e.Field != nil && *e.Field == "status" {
			if e.OldValue != nil && *e.OldValue == "waiting_approval" {
				sawWaiting = true
			}
			status = e.NewValue
		}
		if status != nil {
			if *status == "waiting_approval" {
				sawWaiting = true
			}
			if *status == "approved" {
				if !sawWaiting {
					skipFlag = true
				}
				approved = true
			}
		}
		if e.Action == "update" && e.Field != nil && *e.Field == "total_price" && (approved || e.AfterApproval) && e.OldValue != nil && e.NewValue != nil && *e.OldValue != *e.NewValue {
			priceFlag = true
		}
	}
	if skipFlag {
		flags = append(flags, PartsFlagApprovedWithoutReview)
	}
	if priceFlag {
		flags = append(flags, PartsFlagPriceChangedAfterApproval)
	}
	return flags
}

type auditExecer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// insertPartsAudit appends audit rows; actor name is snapshotted so history survives user changes.
func insertPartsAudit(ctx context.Context, db auditExecer, partsID int64, referenceID int, actorUserID string, rows []partsAuditRow) error {
	for _, row := range rows {
		var field *string
		if row.Field != "" {
			field = strPtr(row.Field)
		}
		if _, err := db.Exec(ctx, `INSERT INTO public.parts_purchase_request_audit(parts_purchase_request_id, reference_id, action, field, old_value, new_value, changed_by_user_id, changed_by_name, after_approval)
			VALUES($1,$2,$3,$4,$5,$6,$7::uuid,(SELECT full_name FROM public.users WHERE id = $7::uuid),$8)`,
			partsID, referenceID, row.Action, field, row.Old, row.New, actorUserID, row.AfterApproval); err != nil {
			return err
		}
	}
	return nil
}

func (r *storeRepository) PartsAuditForWorkOrder(ctx context.Context, referenceID int, partsID *int64) ([]PartsAuditEntry, error) {
	return queryPartsAudit(ctx, r.db, `reference_id=$1 AND ($2::bigint IS NULL OR parts_purchase_request_id=$2)`, referenceID, partsID)
}

type auditQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func queryPartsAudit(ctx context.Context, db auditQuerier, where string, args ...any) ([]PartsAuditEntry, error) {
	rows, err := db.Query(ctx, `SELECT id, parts_purchase_request_id, reference_id, action, field, old_value, new_value, changed_by_user_id::text, changed_by_name, changed_at, after_approval
		FROM public.parts_purchase_request_audit WHERE `+where+` ORDER BY id ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PartsAuditEntry{}
	for rows.Next() {
		var a PartsAuditEntry
		if err := rows.Scan(&a.ID, &a.PartsPurchaseRequestID, &a.ReferenceID, &a.Action, &a.Field, &a.OldValue, &a.NewValue, &a.ChangedByUserID, &a.ChangedByName, &a.ChangedAt, &a.AfterApproval); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func attachPartsAuditFlags(ctx context.Context, db auditQuerier, items []domain.PartsPurchaseRequest) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]int64, len(items))
	for i := range items {
		ids[i] = items[i].PartsPurchaseRequestID
	}
	entries, err := queryPartsAudit(ctx, db, `parts_purchase_request_id = ANY($1::bigint[])`, ids)
	if err != nil {
		return err
	}
	byID := make(map[int64][]PartsAuditEntry)
	for _, entry := range entries {
		byID[entry.PartsPurchaseRequestID] = append(byID[entry.PartsPurchaseRequestID], entry)
	}
	for i := range items {
		items[i].AuditFlags = ComputePartsFlags(byID[items[i].PartsPurchaseRequestID])
	}
	return nil
}

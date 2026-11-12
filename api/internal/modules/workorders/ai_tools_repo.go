package workorders

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// AIStatuses lists every work order status the mass-update tool may target,
// keyed by display name so the LLM resolves names it is allowed to use.
func (r *storeRepository) AIStatuses(ctx context.Context) ([]AIStatusOption, error) {
	rows, err := r.db.Query(ctx, `
		SELECT status_id::bigint, display_name, COALESCE(status_group, 'to_do')
		FROM public.work_order_statuses
		ORDER BY display_name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]AIStatusOption, 0)
	for rows.Next() {
		var s AIStatusOption
		if err := rows.Scan(&s.ID, &s.Name, &s.Group); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// AILocations lists the active storage locations available for mass updates.
func (r *storeRepository) AILocations(ctx context.Context) ([]AILocationOption, error) {
	rows, err := r.db.Query(ctx, `
		SELECT location_id::bigint, COALESCE(shelf, ''), COALESCE(floor, 0)
		FROM public.locations
		WHERE is_active = true
		ORDER BY shelf NULLS LAST, floor
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]AILocationOption, 0)
	for rows.Next() {
		var l AILocationOption
		if err := rows.Scan(&l.ID, &l.Shelf, &l.Floor); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// AIStaleCandidates returns non-stock jobs with the lightweight, non-sensitive
// fields needed to bucket idle work. The workday math and thresholding happen in
// the handler against these rows; this query only gathers raw activity data and
// never returns customer email or phone.
func (r *storeRepository) AIStaleCandidates(ctx context.Context) ([]AIStaleCandidate, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			wo.reference_id,
			NULLIF(BTRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS customer_name,
			i.item_name,
			COALESCE(st.display_name, 'Unknown') AS status_name,
			COALESCE(st.status_group, 'to_do') AS status_group,
			GREATEST(
				wo.status_updated_at,
				wo.updated_at,
				wo.created_at,
				(SELECT MAX(rl.created_at) FROM public.repair_logs rl WHERE rl.reference_id = wo.reference_id)
			) AS last_activity,
			wo.status_updated_at,
			COALESCE(
				(
					SELECT rl.details
					FROM public.repair_logs rl
					WHERE rl.reference_id = wo.reference_id
					ORDER BY rl.repair_date DESC NULLS LAST, rl.repair_log_id DESC
					LIMIT 1
				),
				''
			) AS repair_log,
			COALESCE(
				(
					SELECT string_agg(DISTINCT pr.status, ', ' ORDER BY pr.status)
					FROM public.parts_purchase_requests pr
					WHERE pr.reference_id = wo.reference_id
				),
				''
			) AS parts_status
		FROM public.work_orders wo
		LEFT JOIN public.work_order_statuses st ON st.status_id = wo.status_id
		LEFT JOIN public.customers c ON c.customer_id = wo.customer_id
		LEFT JOIN public.items i ON i.item_id = wo.item_id
		LEFT JOIN public.job_types jt ON jt.job_type_id = wo.job_type_id
		WHERE COALESCE(jt.display_name, '') NOT ILIKE '%stock%'
		ORDER BY last_activity ASC NULLS FIRST
		LIMIT 500
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]AIStaleCandidate, 0)
	for rows.Next() {
		var cand AIStaleCandidate
		var customerName, itemName *string
		if err := rows.Scan(
			&cand.ReferenceID,
			&customerName,
			&itemName,
			&cand.StatusName,
			&cand.StatusGroup,
			&cand.LastActivity,
			&cand.StatusChangeAt,
			&cand.RepairLog,
			&cand.PartsStatus,
		); err != nil {
			return nil, err
		}
		cand.CustomerName = strings.TrimSpace(stringOrEmpty(customerName))
		if cand.CustomerName == "" {
			cand.CustomerName = "Unknown"
		}
		cand.ItemName = strings.TrimSpace(stringOrEmpty(itemName))
		out = append(out, cand)
	}
	return out, rows.Err()
}

// sameUpdatedAt reports whether the locked row's updated_at still matches the
// preview's value (both NULL, or the same instant at microsecond precision).
func sameUpdatedAt(current, expected *time.Time) bool {
	if current == nil || expected == nil {
		return current == nil && expected == nil
	}
	return current.Truncate(time.Microsecond).Equal(expected.Truncate(time.Microsecond))
}

// ApplyMassUpdateJob applies one job's resolved operations inside a single
// transaction so a failure here rolls back only this job, never the others in
// the batch. Totals are recomputed when line items change and
// status_updated_at advances on a status-group change. It returns a
// human-readable description of each applied change.
//
// expectedUpdatedAt is the work order's updated_at as shown in the preview (nil
// when it was NULL). The row is locked first and, if it no longer matches, the
// job is rejected with ErrMassUpdateStale before anything is written.
func (r *storeRepository) ApplyMassUpdateJob(ctx context.Context, referenceID int, expectedUpdatedAt *time.Time, ops []massUpdateResolvedOp, userID string) ([]string, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock the row and read updated_at through the same scan path the preview
	// uses, then compare in Go. Comparing in SQL against a timestamptz
	// parameter is wrong for the legacy `timestamp without time zone` column:
	// Postgres converts it with the session TimeZone while the preview value
	// carried the wall clock labelled as UTC.
	var current *time.Time
	err = tx.QueryRow(ctx, `
		SELECT updated_at
		FROM public.work_orders
		WHERE reference_id = $1
		FOR UPDATE
	`, referenceID).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrWorkOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	if !sameUpdatedAt(current, expectedUpdatedAt) {
		return nil, ErrMassUpdateStale
	}

	applied := make([]string, 0, len(ops))
	lineItemsChanged := false

	for _, op := range ops {
		entry := massUpdateAuditEntry{ReferenceID: referenceID, Op: op.Op}
		switch op.Op {
		case massOpSetLabourTotal:
			if op.LabourTotal == nil {
				continue
			}
			var before *float64
			if err := tx.QueryRow(ctx, `SELECT labour_total::double precision FROM public.work_orders WHERE reference_id = $1 FOR UPDATE`, referenceID).Scan(&before); err != nil {
				return nil, err
			}
			after := round2(*op.LabourTotal)
			if _, err := tx.Exec(ctx, `UPDATE public.work_orders SET labour_total = $2, updated_at = now() WHERE reference_id = $1`, referenceID, after); err != nil {
				return nil, err
			}
			entry.Before = map[string]any{"labour_total": before}
			entry.After = map[string]any{"labour_total": after}
			applied = append(applied, fmt.Sprintf("Labour total set to %s", aiMoney(after)))

		case massOpSetLabourDiscount:
			oldType, oldValue, newValue, err := applyLabourDiscountTx(ctx, tx, referenceID, op.DiscountType, op.DiscountValue, userID)
			if err != nil {
				return nil, err
			}
			entry.Before = map[string]any{"type": oldType, "value": oldValue}
			entry.After = map[string]any{"type": op.DiscountType, "value": newValue}
			applied = append(applied, fmt.Sprintf("Labour discount set to %s", describeDiscount(op.DiscountType, op.DiscountValue)))

		case massOpSetLineItemPrice:
			if op.LineItemID == nil || op.UnitPrice == nil {
				continue
			}
			var quantity, oldLineTotal *string
			var oldPrice *float64
			err := tx.QueryRow(ctx, `SELECT quantity_text, unit_price::double precision, line_total_text FROM public.work_order_line_items WHERE reference_id = $1 AND line_item_id = $2 FOR UPDATE`, referenceID, *op.LineItemID).Scan(&quantity, &oldPrice, &oldLineTotal)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrLineItemNotFound
			}
			if err != nil {
				return nil, err
			}
			price := round2(*op.UnitPrice)
			// A non-numeric quantity keeps the existing line total, as the UI does.
			newLineTotal := massUpdateLineTotalText(price, quantity)
			if newLineTotal == nil {
				newLineTotal = oldLineTotal
			}
			if _, err := tx.Exec(ctx, `
				UPDATE public.work_order_line_items
				SET unit_price = $3, line_total_text = $4
				WHERE reference_id = $1 AND line_item_id = $2
			`, referenceID, *op.LineItemID, price, newLineTotal); err != nil {
				return nil, err
			}
			lineItemsChanged = true
			entry.Before = map[string]any{"line_item_id": *op.LineItemID, "unit_price": oldPrice, "line_total_text": oldLineTotal}
			entry.After = map[string]any{"line_item_id": *op.LineItemID, "unit_price": price, "line_total_text": newLineTotal}
			applied = append(applied, fmt.Sprintf("Line item #%d price set to %s", *op.LineItemID, aiMoney(price)))

		case massOpAddLineItem:
			name := strings.TrimSpace(stringValue(op.ItemName))
			var price *float64
			var lineTotal *string
			if op.UnitPrice != nil {
				p := round2(*op.UnitPrice)
				price = &p
				lineTotal = massUpdateLineTotalText(p, op.QuantityText)
			}
			var newID int64
			if err := tx.QueryRow(ctx, `
				INSERT INTO public.work_order_line_items(reference_id, item_name, unit_price, quantity_text, line_total_text)
				VALUES ($1, $2, $3, $4, $5)
				RETURNING line_item_id::bigint
			`, referenceID, name, price, nullableString(op.QuantityText), lineTotal).Scan(&newID); err != nil {
				return nil, err
			}
			lineItemsChanged = true
			entry.After = map[string]any{"line_item_id": newID, "item_name": name, "unit_price": price, "quantity_text": nullableString(op.QuantityText), "line_total_text": lineTotal}
			applied = append(applied, fmt.Sprintf("Added line item %q", name))

		case massOpRemoveLineItem:
			if op.LineItemID == nil {
				continue
			}
			var name, quantity, lineTotal *string
			var price *float64
			err := tx.QueryRow(ctx, `
				DELETE FROM public.work_order_line_items WHERE reference_id = $1 AND line_item_id = $2
				RETURNING item_name, unit_price::double precision, quantity_text, line_total_text
			`, referenceID, *op.LineItemID).Scan(&name, &price, &quantity, &lineTotal)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrLineItemNotFound
			}
			if err != nil {
				return nil, err
			}
			lineItemsChanged = true
			entry.Before = map[string]any{"line_item_id": *op.LineItemID, "item_name": name, "unit_price": price, "quantity_text": quantity, "line_total_text": lineTotal}
			applied = append(applied, fmt.Sprintf("Removed line item #%d", *op.LineItemID))

		case massOpSetStatus:
			if op.StatusID == nil {
				continue
			}
			var before *int64
			if err := tx.QueryRow(ctx, `SELECT status_id::bigint FROM public.work_orders WHERE reference_id = $1 FOR UPDATE`, referenceID).Scan(&before); err != nil {
				return nil, err
			}
			if _, err := tx.Exec(ctx, `
				UPDATE public.work_orders wo
				SET
					status_id = $2,
					status_updated_at = CASE
						WHEN (
							SELECT COALESCE(s.status_group, 'to_do')
							FROM public.work_order_statuses s
							WHERE s.status_id = wo.status_id
						) IS DISTINCT FROM (
							SELECT COALESCE(s.status_group, 'to_do')
							FROM public.work_order_statuses s
							WHERE s.status_id = $2
						) THEN now()
						ELSE status_updated_at
					END,
					updated_at = now()
				WHERE reference_id = $1
			`, referenceID, *op.StatusID); err != nil {
				return nil, err
			}
			entry.Before = map[string]any{"status_id": before}
			entry.After = map[string]any{"status_id": *op.StatusID}
			applied = append(applied, "Status updated")

		case massOpSetLocation:
			if op.LocationID == nil {
				continue
			}
			var before *int64
			if err := tx.QueryRow(ctx, `SELECT location_id::bigint FROM public.work_orders WHERE reference_id = $1 FOR UPDATE`, referenceID).Scan(&before); err != nil {
				return nil, err
			}
			var active bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.locations WHERE location_id = $1 AND is_active = true)`, *op.LocationID).Scan(&active); err != nil {
				return nil, err
			}
			if !active {
				return nil, ErrLocationNotFound
			}
			if _, err := tx.Exec(ctx, `UPDATE public.work_orders SET location_id = $2, updated_at = now() WHERE reference_id = $1`, referenceID, *op.LocationID); err != nil {
				return nil, err
			}
			entry.Before = map[string]any{"location_id": before}
			entry.After = map[string]any{"location_id": *op.LocationID}
			applied = append(applied, "Location updated")

		case massOpGenerateWorkDone:
			before, after, err := applyWorkDoneTx(ctx, tx, referenceID, op.WorkDoneText)
			if err != nil {
				return nil, err
			}
			entry.Before = before
			entry.After = after
			applied = append(applied, "Work Done updated")

		default:
			return nil, fmt.Errorf("unsupported operation %q", op.Op)
		}

		// Written in the same tx as the change, like the labour discount audit,
		// so an op is never applied without its audit row (or vice versa).
		if err := insertMassUpdateAuditTx(ctx, tx, userID, entry); err != nil {
			return nil, err
		}
	}

	if lineItemsChanged {
		if err := r.recalculatePartsTotalTx(ctx, tx, referenceID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return applied, nil
}

var decimalInputPattern = regexp.MustCompile(`^-?(?:\d+\.?\d*|\.\d+)$`)

// massUpdateLineTotalText mirrors the work order page's calculateLineSubtotalText
// (unit price x quantity, formatted with toFixed(2)) so recalculatePartsTotalTx,
// which sums line_total_text, sees AI price changes. A blank quantity counts as 1;
// a quantity the UI can't parse (e.g. "2 pcs") returns nil.
func massUpdateLineTotalText(unitPrice float64, quantityText *string) *string {
	qty := strings.TrimSpace(stringOrEmpty(quantityText))
	if qty == "" {
		qty = "1"
	}
	qty = strings.Replace(qty, ",", ".", 1)
	if !decimalInputPattern.MatchString(qty) {
		return nil
	}
	quantity, err := strconv.ParseFloat(qty, 64)
	if err != nil {
		return nil
	}
	out := strconv.FormatFloat(unitPrice*quantity, 'f', 2, 64)
	return &out
}

// applyLabourDiscountTx mirrors UpdateLabourDiscount's validation + audit write,
// scoped to the caller's transaction so a mass-update job stays atomic. It
// returns the pre-change type/value and the stored (rounded) new value.
func applyLabourDiscountTx(ctx context.Context, tx pgx.Tx, referenceID int, kind *string, value *float64, userID string) (*string, *float64, *float64, error) {
	var oldType *string
	var oldValue, labour *float64
	err := tx.QueryRow(ctx, `SELECT labour_discount_type, labour_discount_value::double precision, labour_total::double precision FROM public.work_orders WHERE reference_id=$1 FOR UPDATE`, referenceID).Scan(&oldType, &oldValue, &labour)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, nil, ErrWorkOrderNotFound
	}
	if err != nil {
		return nil, nil, nil, err
	}
	if err := ValidateLabourDiscount(kind, value, labour); err != nil {
		return nil, nil, nil, err
	}
	if kind != nil && value != nil {
		rounded := round2(*value)
		value = &rounded
	}
	if _, err := tx.Exec(ctx, `UPDATE public.work_orders SET labour_discount_type=$2, labour_discount_value=$3, updated_at=now() WHERE reference_id=$1`, referenceID, kind, value); err != nil {
		return nil, nil, nil, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO public.work_order_labour_discount_audit(reference_id,changed_by_user_id,old_type,old_value,new_type,new_value) VALUES($1,$2,$3,$4,$5,$6)`, referenceID, userID, oldType, oldValue, kind, value); err != nil {
		return nil, nil, nil, err
	}
	return oldType, oldValue, value, nil
}

// insertMassUpdateAuditTx appends one row to the existing generic audit_logs
// table (001_init) for an applied mass-update op. Every op, including the
// labour discount (which also keeps its dedicated audit table), lands here so
// the AI tool has one uniform trail of actor, job, op, before and after.
func insertMassUpdateAuditTx(ctx context.Context, tx pgx.Tx, userID string, entry massUpdateAuditEntry) error {
	metadata, err := massUpdateAuditMetadata(entry)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO public.audit_logs(actor_user_id, action, target_type, metadata_json)
		VALUES (NULLIF($1, '')::uuid, $2, 'work_order', $3::jsonb)
	`, userID, massUpdateAuditAction(entry.Op), string(metadata))
	return err
}

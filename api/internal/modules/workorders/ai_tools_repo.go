package workorders

import (
	"context"
	"errors"
	"fmt"
	"strings"

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

// ApplyMassUpdateJob applies one job's resolved operations inside a single
// transaction so a failure here rolls back only this job, never the others in
// the batch. Totals are recomputed when line items change and
// status_updated_at advances on a status-group change. It returns a
// human-readable description of each applied change.
func (r *storeRepository) ApplyMassUpdateJob(ctx context.Context, referenceID int, ops []massUpdateResolvedOp, userID string) ([]string, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.work_orders WHERE reference_id = $1)`, referenceID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrWorkOrderNotFound
	}

	applied := make([]string, 0, len(ops))
	lineItemsChanged := false

	for _, op := range ops {
		switch op.Op {
		case massOpSetLabourTotal:
			if op.LabourTotal == nil {
				continue
			}
			if _, err := tx.Exec(ctx, `UPDATE public.work_orders SET labour_total = $2, updated_at = now() WHERE reference_id = $1`, referenceID, round2(*op.LabourTotal)); err != nil {
				return nil, err
			}
			applied = append(applied, fmt.Sprintf("Labour total set to %s", aiMoney(round2(*op.LabourTotal))))

		case massOpSetLabourDiscount:
			if err := applyLabourDiscountTx(ctx, tx, referenceID, op.DiscountType, op.DiscountValue, userID); err != nil {
				return nil, err
			}
			applied = append(applied, fmt.Sprintf("Labour discount set to %s", describeDiscount(op.DiscountType, op.DiscountValue)))

		case massOpSetLineItemPrice:
			if op.LineItemID == nil || op.UnitPrice == nil {
				continue
			}
			cmd, err := tx.Exec(ctx, `UPDATE public.work_order_line_items SET unit_price = $3 WHERE reference_id = $1 AND line_item_id = $2`, referenceID, *op.LineItemID, round2(*op.UnitPrice))
			if err != nil {
				return nil, err
			}
			if cmd.RowsAffected() == 0 {
				return nil, ErrLineItemNotFound
			}
			lineItemsChanged = true
			applied = append(applied, fmt.Sprintf("Line item #%d price set to %s", *op.LineItemID, aiMoney(round2(*op.UnitPrice))))

		case massOpAddLineItem:
			name := strings.TrimSpace(stringValue(op.ItemName))
			var price any
			if op.UnitPrice != nil {
				price = round2(*op.UnitPrice)
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO public.work_order_line_items(reference_id, item_name, unit_price, quantity_text)
				VALUES ($1, $2, $3, $4)
			`, referenceID, name, price, nullableString(op.QuantityText)); err != nil {
				return nil, err
			}
			lineItemsChanged = true
			applied = append(applied, fmt.Sprintf("Added line item %q", name))

		case massOpRemoveLineItem:
			if op.LineItemID == nil {
				continue
			}
			cmd, err := tx.Exec(ctx, `DELETE FROM public.work_order_line_items WHERE reference_id = $1 AND line_item_id = $2`, referenceID, *op.LineItemID)
			if err != nil {
				return nil, err
			}
			if cmd.RowsAffected() == 0 {
				return nil, ErrLineItemNotFound
			}
			lineItemsChanged = true
			applied = append(applied, fmt.Sprintf("Removed line item #%d", *op.LineItemID))

		case massOpSetStatus:
			if op.StatusID == nil {
				continue
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
			applied = append(applied, "Status updated")

		case massOpSetLocation:
			if op.LocationID == nil {
				continue
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
			applied = append(applied, "Location updated")

		default:
			return nil, fmt.Errorf("unsupported operation %q", op.Op)
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

// applyLabourDiscountTx mirrors UpdateLabourDiscount's validation + audit write,
// scoped to the caller's transaction so a mass-update job stays atomic.
func applyLabourDiscountTx(ctx context.Context, tx pgx.Tx, referenceID int, kind *string, value *float64, userID string) error {
	var oldType *string
	var oldValue, labour *float64
	err := tx.QueryRow(ctx, `SELECT labour_discount_type, labour_discount_value::double precision, labour_total::double precision FROM public.work_orders WHERE reference_id=$1 FOR UPDATE`, referenceID).Scan(&oldType, &oldValue, &labour)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWorkOrderNotFound
	}
	if err != nil {
		return err
	}
	if err := ValidateLabourDiscount(kind, value, labour); err != nil {
		return err
	}
	if kind != nil && value != nil {
		rounded := round2(*value)
		value = &rounded
	}
	if _, err := tx.Exec(ctx, `UPDATE public.work_orders SET labour_discount_type=$2, labour_discount_value=$3, updated_at=now() WHERE reference_id=$1`, referenceID, kind, value); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO public.work_order_labour_discount_audit(reference_id,changed_by_user_id,old_type,old_value,new_type,new_value) VALUES($1,$2,$3,$4,$5,$6)`, referenceID, userID, oldType, oldValue, kind, value)
	return err
}

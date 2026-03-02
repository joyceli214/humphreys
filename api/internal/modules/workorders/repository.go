package workorders

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	ListWorkOrders(ctx context.Context, query string, page, pageSize int) ([]domain.WorkOrderListItem, error)
	GetWorkOrderDetail(ctx context.Context, referenceID int) (domain.WorkOrderDetail, error)
	UpdateStatus(ctx context.Context, referenceID int, statusID *int64) error
	UpdateEquipment(ctx context.Context, referenceID int, input EquipmentUpdateInput) error
	UpdateWorkNotes(ctx context.Context, referenceID int, input WorkNotesUpdateInput) error
	UpdateLineItems(ctx context.Context, referenceID int, lineItems []LineItemUpsertInput) error
	UpdateTotals(ctx context.Context, referenceID int, input TotalsUpdateInput) error
	UpdateCustomer(ctx context.Context, referenceID int, input CustomerUpdateInput) error
	ListAllPartsPurchaseRequests(ctx context.Context) ([]domain.PartsPurchaseRequest, error)
	ListRepairLogs(ctx context.Context, referenceID int) ([]domain.RepairLog, error)
	CreateRepairLog(ctx context.Context, referenceID int, repairDate *string, hoursUsed *float64, details, createdByUserID string) (domain.RepairLog, error)
	UpdateRepairLog(ctx context.Context, referenceID int, repairLogID int64, repairDate *string, hoursUsed *float64, details *string) (domain.RepairLog, error)
	DeleteRepairLog(ctx context.Context, referenceID int, repairLogID int64) error
	ListPartsPurchaseRequests(ctx context.Context, referenceID int) ([]domain.PartsPurchaseRequest, error)
	CreatePartsPurchaseRequest(ctx context.Context, referenceID int, input CreatePartsPurchaseRequestInput) (domain.PartsPurchaseRequest, error)
	UpdatePartsPurchaseRequest(ctx context.Context, referenceID int, partsPurchaseRequestID int64, input UpdatePartsPurchaseRequestInput) (domain.PartsPurchaseRequest, error)
	DeletePartsPurchaseRequest(ctx context.Context, referenceID int, partsPurchaseRequestID int64) error
}

type storeRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &storeRepository{db: db}
}

func (r *storeRepository) ListWorkOrders(ctx context.Context, query string, page, pageSize int) ([]domain.WorkOrderListItem, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	clauses := make([]string, 0)
	args := make([]any, 0)
	argPos := 1
	if query != "" {
		pattern := "%" + query + "%"
		clauses = append(clauses, fmt.Sprintf(`(
			wo.reference_id::text ILIKE $%d OR
			COALESCE(c.first_name, '') ILIKE $%d OR
			COALESCE(c.last_name, '') ILIKE $%d OR
			COALESCE(c.email, '') ILIKE $%d OR
			COALESCE(i.item_name, '') ILIKE $%d OR
			COALESCE(wo.model_number, '') ILIKE $%d OR
			COALESCE(wo.serial_number, '') ILIKE $%d
		)`, argPos, argPos, argPos, argPos, argPos, argPos, argPos))
		args = append(args, pattern)
		argPos++
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}

	args = append(args, pageSize, offset)
	querySQL := fmt.Sprintf(`
		SELECT
			wo.reference_id,
			wo.created_at,
			wo.updated_at,
			COALESCE(st.display_name, 'Unknown') AS status_name,
			COALESCE(jt.display_name, 'Unknown') AS job_type_name,
			NULLIF(BTRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS customer_name,
			c.email,
			i.item_name,
			COALESCE(
				(
					SELECT array_agg(b.brand_name ORDER BY b.brand_name)
					FROM unnest(wo.brand_ids) bid
					JOIN public.brands b ON b.brand_id = bid
				),
				ARRAY[]::TEXT[]
			) AS brand_names,
			wo.model_number,
			wo.serial_number,
			wo.labour_total::double precision
		FROM public.work_orders wo
		LEFT JOIN public.customers c ON c.customer_id = wo.customer_id
		LEFT JOIN public.items i ON i.item_id = wo.item_id
		LEFT JOIN public.work_order_statuses st ON st.status_id = wo.status_id
		LEFT JOIN public.job_types jt ON jt.job_type_id = wo.job_type_id
		%s
		ORDER BY wo.created_at DESC NULLS LAST, wo.reference_id DESC
		LIMIT $%d OFFSET $%d
	`, where, argPos, argPos+1)
	rows, err := r.db.Query(ctx, querySQL, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.WorkOrderListItem, 0)
	for rows.Next() {
		var item domain.WorkOrderListItem
		item.BrandNames = make([]string, 0)
		if err := rows.Scan(
			&item.ReferenceID,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.Status,
			&item.JobType,
			&item.CustomerName,
			&item.CustomerEmail,
			&item.ItemName,
			&item.BrandNames,
			&item.ModelNumber,
			&item.SerialNumber,
			&item.LabourTotal,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *storeRepository) GetWorkOrderDetail(ctx context.Context, referenceID int) (domain.WorkOrderDetail, error) {
	detail := domain.WorkOrderDetail{
		BrandIDs:           make([]int64, 0),
		BrandNames:         make([]string, 0),
		WorkerIDs:          make([]int64, 0),
		WorkerNames:        make([]string, 0),
		PaymentMethodIDs:   make([]int64, 0),
		PaymentMethodNames: make([]string, 0),
		LineItems:          make([]domain.WorkOrderLineItem, 0),
	}

	mainSQL := `
		SELECT
			wo.reference_id,
			wo.original_job_id,
			wo.created_at,
			wo.updated_at,
			wo.status_id,
			st.status_key,
			st.display_name,
			wo.status_updated_at,
			wo.job_type_id,
			jt.job_type_key,
			jt.display_name,
			c.customer_id,
			c.first_name,
			c.last_name,
			c.email,
			c.address_line_1,
			c.address_line_2,
			c.city,
			c.province,
			c.home_phone,
			c.work_phone,
			c.extension_text,
			wo.item_id,
			i.item_name,
			wo.brand_ids,
			COALESCE(
				(
					SELECT array_agg(DISTINCT b.brand_name ORDER BY b.brand_name)
					FROM unnest(wo.brand_ids) bid
					JOIN public.brands b ON b.brand_id = bid
				),
				ARRAY[]::TEXT[]
			),
			wo.model_number,
			wo.serial_number,
			wo.remote_control_qty,
			wo.cable_qty,
			wo.cord_qty,
			wo.dvd_vhs_qty,
			wo.album_cd_cassette_qty,
			wo.problem_description,
			COALESCE(wo.worker_ids::bigint[], ARRAY[]::bigint[]),
			COALESCE(
				(
					SELECT array_agg(DISTINCT w.worker_name ORDER BY w.worker_name)
					FROM unnest(wo.worker_ids) wid
					JOIN public.workers w ON w.worker_id = wid
				),
				ARRAY[]::TEXT[]
			),
			wo.work_done,
			COALESCE(wo.payment_method_ids[1:2], ARRAY[]::bigint[]),
			COALESCE(
				(
					SELECT array_agg(pm.display_name ORDER BY pm_idx.ord)
					FROM unnest(COALESCE(wo.payment_method_ids[1:2], ARRAY[]::bigint[])) WITH ORDINALITY AS pm_idx(payment_method_id, ord)
					JOIN public.payment_methods pm ON pm.payment_method_id = pm_idx.payment_method_id
				),
				ARRAY[]::TEXT[]
			),
			wo.parts_total::double precision,
			wo.delivery_total::double precision,
			wo.labour_total::double precision,
			wo.deposit::double precision
		FROM public.work_orders wo
		LEFT JOIN public.customers c ON c.customer_id = wo.customer_id
		LEFT JOIN public.items i ON i.item_id = wo.item_id
		LEFT JOIN public.work_order_statuses st ON st.status_id = wo.status_id
		LEFT JOIN public.job_types jt ON jt.job_type_id = wo.job_type_id
		WHERE wo.reference_id = $1
	`

	if err := r.db.QueryRow(ctx, mainSQL, referenceID).Scan(
		&detail.ReferenceID,
		&detail.OriginalJobID,
		&detail.CreatedAt,
		&detail.UpdatedAt,
		&detail.StatusID,
		&detail.StatusKey,
		&detail.StatusName,
		&detail.StatusUpdatedAt,
		&detail.JobTypeID,
		&detail.JobTypeKey,
		&detail.JobTypeName,
		&detail.Customer.CustomerID,
		&detail.Customer.FirstName,
		&detail.Customer.LastName,
		&detail.Customer.Email,
		&detail.Customer.AddressLine1,
		&detail.Customer.AddressLine2,
		&detail.Customer.City,
		&detail.Customer.Province,
		&detail.Customer.HomePhone,
		&detail.Customer.WorkPhone,
		&detail.Customer.Extension,
		&detail.ItemID,
		&detail.ItemName,
		&detail.BrandIDs,
		&detail.BrandNames,
		&detail.ModelNumber,
		&detail.SerialNumber,
		&detail.RemoteControlQty,
		&detail.CableQty,
		&detail.CordQty,
		&detail.DVDVHSQty,
		&detail.AlbumCDCassetteQty,
		&detail.ProblemDescription,
		&detail.WorkerIDs,
		&detail.WorkerNames,
		&detail.WorkDone,
		&detail.PaymentMethodIDs,
		&detail.PaymentMethodNames,
		&detail.PartsTotal,
		&detail.DeliveryTotal,
		&detail.LabourTotal,
		&detail.Deposit,
	); err != nil {
		return domain.WorkOrderDetail{}, err
	}

	lineItemsSQL := `
		SELECT line_item_id, item_name, unit_price::double precision, quantity_text, line_total_text
		FROM public.work_order_line_items
		WHERE reference_id = $1
		ORDER BY line_item_id
	`
	rows, err := r.db.Query(ctx, lineItemsSQL, referenceID)
	if err != nil {
		return domain.WorkOrderDetail{}, err
	}
	defer rows.Close()

	for rows.Next() {
		var lineItem domain.WorkOrderLineItem
		if err := rows.Scan(
			&lineItem.LineItemID,
			&lineItem.ItemName,
			&lineItem.UnitPrice,
			&lineItem.QuantityText,
			&lineItem.LineTotalText,
		); err != nil {
			return domain.WorkOrderDetail{}, err
		}
		detail.LineItems = append(detail.LineItems, lineItem)
	}
	if err := rows.Err(); err != nil {
		return domain.WorkOrderDetail{}, err
	}

	return detail, nil
}

func (r *storeRepository) UpdateEquipment(ctx context.Context, referenceID int, input EquipmentUpdateInput) error {
	cmd, err := r.db.Exec(ctx, `
		UPDATE public.work_orders
		SET
			status_id = $1,
			job_type_id = $2,
			item_id = $3,
			brand_ids = $4,
			model_number = $5,
			serial_number = $6,
			remote_control_qty = $7,
			cable_qty = $8,
			cord_qty = $9,
			dvd_vhs_qty = $10,
			album_cd_cassette_qty = $11,
			updated_at = now()
		WHERE reference_id = $12
	`,
		input.StatusID,
		input.JobTypeID,
		input.ItemID,
		input.BrandIDs,
		nullableString(input.ModelNumber),
		nullableString(input.SerialNumber),
		input.RemoteControlQty,
		input.CableQty,
		input.CordQty,
		input.DVDVHSQty,
		input.AlbumCDCassetteQty,
		referenceID,
	)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrWorkOrderNotFound
	}
	return nil
}

func (r *storeRepository) UpdateStatus(ctx context.Context, referenceID int, statusID *int64) error {
	cmd, err := r.db.Exec(ctx, `
		UPDATE public.work_orders
		SET
			status_id = $1,
			status_updated_at = CASE
				WHEN status_id IS DISTINCT FROM $1 THEN now()
				ELSE status_updated_at
			END,
			updated_at = now()
		WHERE reference_id = $2
	`,
		statusID,
		referenceID,
	)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrWorkOrderNotFound
	}
	return nil
}

func (r *storeRepository) UpdateWorkNotes(ctx context.Context, referenceID int, input WorkNotesUpdateInput) error {
	cmd, err := r.db.Exec(ctx, `
		UPDATE public.work_orders
		SET
			problem_description = $1,
			worker_ids = $2,
			work_done = $3,
			payment_method_ids = $4,
			updated_at = now()
		WHERE reference_id = $5
	`,
		nullableString(input.ProblemDescription),
		input.WorkerIDs,
		nullableString(input.WorkDone),
		input.PaymentMethodIDs,
		referenceID,
	)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrWorkOrderNotFound
	}
	return nil
}

func (r *storeRepository) UpdateLineItems(ctx context.Context, referenceID int, lineItems []LineItemUpsertInput) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM public.work_orders WHERE reference_id = $1)`, referenceID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrWorkOrderNotFound
	}

	rows, err := tx.Query(ctx, `SELECT line_item_id FROM public.work_order_line_items WHERE reference_id = $1`, referenceID)
	if err != nil {
		return err
	}
	existingIDs := make(map[int64]struct{})
	for rows.Next() {
		var id int64
		if scanErr := rows.Scan(&id); scanErr != nil {
			rows.Close()
			return scanErr
		}
		existingIDs[id] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	keptIDs := make(map[int64]struct{})
	for _, line := range lineItems {
		if line.LineItemID != nil {
			lineID := *line.LineItemID
			if _, ok := existingIDs[lineID]; !ok {
				return ErrLineItemNotFound
			}
			cmd, execErr := tx.Exec(ctx, `
				UPDATE public.work_order_line_items
				SET
					item_name = $1,
					unit_price = $2,
					quantity_text = $3,
					line_total_text = $4
				WHERE reference_id = $5 AND line_item_id = $6
			`,
				nullableString(line.ItemName),
				line.UnitPrice,
				nullableString(line.QuantityText),
				nullableString(line.LineTotalText),
				referenceID,
				lineID,
			)
			if execErr != nil {
				return execErr
			}
			if cmd.RowsAffected() == 0 {
				return ErrLineItemNotFound
			}
			keptIDs[lineID] = struct{}{}
			continue
		}

		var newID int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO public.work_order_line_items(reference_id, item_name, unit_price, quantity_text, line_total_text)
			VALUES($1, $2, $3, $4, $5)
			RETURNING line_item_id
		`,
			referenceID,
			nullableString(line.ItemName),
			line.UnitPrice,
			nullableString(line.QuantityText),
			nullableString(line.LineTotalText),
		).Scan(&newID); err != nil {
			return err
		}
		keptIDs[newID] = struct{}{}
	}

	if len(keptIDs) == 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM public.work_order_line_items WHERE reference_id = $1`, referenceID); err != nil {
			return err
		}
	} else {
		idList := make([]int64, 0, len(keptIDs))
		for id := range keptIDs {
			idList = append(idList, id)
		}
		sort.Slice(idList, func(i, j int) bool { return idList[i] < idList[j] })
		if _, err := tx.Exec(ctx, `DELETE FROM public.work_order_line_items WHERE reference_id = $1 AND NOT (line_item_id = ANY($2))`, referenceID, idList); err != nil {
			return err
		}
	}

	if err := r.recalculatePartsTotalTx(ctx, tx, referenceID); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}
	return nil
}

func (r *storeRepository) UpdateTotals(ctx context.Context, referenceID int, input TotalsUpdateInput) error {
	cmd, err := r.db.Exec(ctx, `
		UPDATE public.work_orders
		SET
			delivery_total = $1,
			labour_total = $2,
			deposit = $3,
			updated_at = now()
		WHERE reference_id = $4
	`,
		input.DeliveryTotal,
		input.LabourTotal,
		input.Deposit,
		referenceID,
	)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrWorkOrderNotFound
	}
	return nil
}

func (r *storeRepository) UpdateCustomer(ctx context.Context, referenceID int, input CustomerUpdateInput) error {
	cmd, err := r.db.Exec(ctx, `
		UPDATE public.customers c
		SET
			first_name = $1,
			last_name = $2,
			email = $3,
			address_line_1 = $4,
			address_line_2 = $5,
			city = $6,
			province = $7,
			home_phone = $8,
			work_phone = $9,
			extension_text = $10
		FROM public.work_orders wo
		WHERE wo.reference_id = $11
			AND wo.customer_id = c.customer_id
	`,
		nullableString(input.FirstName),
		nullableString(input.LastName),
		nullableString(input.Email),
		nullableString(input.AddressLine1),
		nullableString(input.AddressLine2),
		nullableString(input.City),
		nullableString(input.Province),
		nullableString(input.HomePhone),
		nullableString(input.WorkPhone),
		nullableString(input.Extension),
		referenceID,
	)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrWorkOrderNotFound
	}
	_, err = r.db.Exec(ctx, `
		UPDATE public.work_orders
		SET updated_at = now()
		WHERE reference_id = $1
	`, referenceID)
	return err
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func (r *storeRepository) recalculatePartsTotalTx(ctx context.Context, tx pgx.Tx, referenceID int) error {
	cmd, err := tx.Exec(ctx, `
		UPDATE public.work_orders wo
		SET
			parts_total = sums.parts_total,
			updated_at = now()
		FROM (
			SELECT
				COALESCE(
					SUM(
						CASE
							WHEN regexp_replace(COALESCE(li.line_total_text, ''), '[^0-9.\-]', '', 'g') ~ '^-?[0-9]+(\.[0-9]+)?$'
								THEN (regexp_replace(COALESCE(li.line_total_text, ''), '[^0-9.\-]', '', 'g'))::numeric
							ELSE 0::numeric
						END
					),
					0::numeric
				) AS parts_total
			FROM public.work_order_line_items li
			WHERE li.reference_id = $1
		) sums
		WHERE wo.reference_id = $1
	`, referenceID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrWorkOrderNotFound
	}
	return nil
}

func (r *storeRepository) ListRepairLogs(ctx context.Context, referenceID int) ([]domain.RepairLog, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			rl.repair_log_id,
			rl.reference_id,
			rl.repair_date,
			rl.hours_used::double precision,
			rl.details,
			rl.created_by_user_id::text,
			u.full_name,
			rl.created_at,
			rl.updated_at
		FROM public.repair_logs rl
		LEFT JOIN public.users u ON u.id = rl.created_by_user_id
		WHERE rl.reference_id = $1
		ORDER BY rl.repair_date DESC, rl.repair_log_id DESC
	`, referenceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.RepairLog, 0)
	for rows.Next() {
		var item domain.RepairLog
		if err := rows.Scan(
			&item.RepairLogID,
			&item.ReferenceID,
			&item.RepairDate,
			&item.HoursUsed,
			&item.Details,
			&item.CreatedByUserID,
			&item.CreatedByName,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *storeRepository) ListAllPartsPurchaseRequests(ctx context.Context) ([]domain.PartsPurchaseRequest, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			pr.parts_purchase_request_id,
			pr.reference_id,
			pr.source,
			pr.source_url,
			pr.status,
			pr.total_price::double precision,
			pr.item_name,
			pr.quantity,
			pr.created_by_user_id,
			u.full_name,
			pr.created_at,
			pr.updated_at
		FROM public.parts_purchase_requests pr
		LEFT JOIN public.users u ON u.id = pr.created_by_user_id
		ORDER BY pr.created_at DESC NULLS LAST, pr.parts_purchase_request_id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]domain.PartsPurchaseRequest, 0)
	for rows.Next() {
		var item domain.PartsPurchaseRequest
		if err := rows.Scan(
			&item.PartsPurchaseRequestID,
			&item.ReferenceID,
			&item.Source,
			&item.SourceURL,
			&item.Status,
			&item.TotalPrice,
			&item.ItemName,
			&item.Quantity,
			&item.CreatedByUserID,
			&item.CreatedByName,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *storeRepository) CreateRepairLog(ctx context.Context, referenceID int, repairDate *string, hoursUsed *float64, details, createdByUserID string) (domain.RepairLog, error) {
	var inserted domain.RepairLog
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.repair_logs(reference_id, repair_date, hours_used, details, created_by_user_id)
		VALUES(
			$1,
			COALESCE(NULLIF(BTRIM($2), '')::date, CURRENT_DATE),
			COALESCE($3::numeric, 0::numeric),
			BTRIM($4),
			$5::uuid
		)
		RETURNING
			repair_log_id,
			reference_id,
			repair_date,
			hours_used::double precision,
			details,
			created_by_user_id::text,
			created_at,
			updated_at
	`,
		referenceID,
		stringOrNil(repairDate),
		hoursUsed,
		details,
		createdByUserID,
	).Scan(
		&inserted.RepairLogID,
		&inserted.ReferenceID,
		&inserted.RepairDate,
		&inserted.HoursUsed,
		&inserted.Details,
		&inserted.CreatedByUserID,
		&inserted.CreatedAt,
		&inserted.UpdatedAt,
	)
	if err != nil {
		return domain.RepairLog{}, err
	}

	if err := r.db.QueryRow(ctx, `SELECT full_name FROM public.users WHERE id = $1::uuid`, createdByUserID).Scan(&inserted.CreatedByName); err != nil {
		return domain.RepairLog{}, err
	}
	return inserted, nil
}

func (r *storeRepository) UpdateRepairLog(ctx context.Context, referenceID int, repairLogID int64, repairDate *string, hoursUsed *float64, details *string) (domain.RepairLog, error) {
	var updated domain.RepairLog
	cmdErr := r.db.QueryRow(ctx, `
		UPDATE public.repair_logs
		SET
			repair_date = COALESCE(NULLIF(BTRIM($3), '')::date, repair_date),
			hours_used = COALESCE($4::numeric, hours_used),
			details = COALESCE(NULLIF(BTRIM($5), ''), details),
			updated_at = now()
		WHERE reference_id = $1 AND repair_log_id = $2
		RETURNING
			repair_log_id,
			reference_id,
			repair_date,
			hours_used::double precision,
			details,
			created_by_user_id::text,
			created_at,
			updated_at
	`,
		referenceID,
		repairLogID,
		stringOrNil(repairDate),
		hoursUsed,
		stringOrNil(details),
	).Scan(
		&updated.RepairLogID,
		&updated.ReferenceID,
		&updated.RepairDate,
		&updated.HoursUsed,
		&updated.Details,
		&updated.CreatedByUserID,
		&updated.CreatedAt,
		&updated.UpdatedAt,
	)
	if cmdErr != nil {
		if cmdErr == pgx.ErrNoRows {
			return domain.RepairLog{}, ErrRepairLogNotFound
		}
		return domain.RepairLog{}, cmdErr
	}
	if err := r.db.QueryRow(ctx, `SELECT full_name FROM public.users WHERE id = $1::uuid`, updated.CreatedByUserID).Scan(&updated.CreatedByName); err != nil {
		return domain.RepairLog{}, err
	}
	return updated, nil
}

func (r *storeRepository) DeleteRepairLog(ctx context.Context, referenceID int, repairLogID int64) error {
	cmd, err := r.db.Exec(ctx, `DELETE FROM public.repair_logs WHERE reference_id = $1 AND repair_log_id = $2`, referenceID, repairLogID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrRepairLogNotFound
	}
	return nil
}

func (r *storeRepository) ListPartsPurchaseRequests(ctx context.Context, referenceID int) ([]domain.PartsPurchaseRequest, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			ppr.parts_purchase_request_id,
			ppr.reference_id,
			ppr.source,
			ppr.source_url,
			ppr.status,
			ppr.total_price::double precision,
			ppr.item_name,
			ppr.quantity,
			ppr.created_by_user_id::text,
			u.full_name,
			ppr.created_at,
			ppr.updated_at
		FROM public.parts_purchase_requests ppr
		LEFT JOIN public.users u ON u.id = ppr.created_by_user_id
		WHERE ppr.reference_id = $1
		ORDER BY ppr.created_at DESC, ppr.parts_purchase_request_id DESC
	`, referenceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.PartsPurchaseRequest, 0)
	for rows.Next() {
		var item domain.PartsPurchaseRequest
		if err := rows.Scan(
			&item.PartsPurchaseRequestID,
			&item.ReferenceID,
			&item.Source,
			&item.SourceURL,
			&item.Status,
			&item.TotalPrice,
			&item.ItemName,
			&item.Quantity,
			&item.CreatedByUserID,
			&item.CreatedByName,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r *storeRepository) CreatePartsPurchaseRequest(ctx context.Context, referenceID int, input CreatePartsPurchaseRequestInput) (domain.PartsPurchaseRequest, error) {
	var inserted domain.PartsPurchaseRequest
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.parts_purchase_requests(
			reference_id,
			source,
			source_url,
			status,
			total_price,
			item_name,
			quantity,
			created_by_user_id
		)
		VALUES(
			$1,
			$2,
			NULLIF(BTRIM($3), ''),
			COALESCE(NULLIF(BTRIM($4), ''), 'draft'),
			$5,
			BTRIM($6),
			$7,
			$8::uuid
		)
		RETURNING
			parts_purchase_request_id,
			reference_id,
			source,
			source_url,
			status,
			total_price::double precision,
			item_name,
			quantity,
			created_by_user_id::text,
			created_at,
			updated_at
	`,
		referenceID,
		input.Source,
		stringOrNil(input.SourceURL),
		stringOrNil(input.Status),
		input.TotalPrice,
		input.ItemName,
		input.Quantity,
		input.CreatedByUserID,
	).Scan(
		&inserted.PartsPurchaseRequestID,
		&inserted.ReferenceID,
		&inserted.Source,
		&inserted.SourceURL,
		&inserted.Status,
		&inserted.TotalPrice,
		&inserted.ItemName,
		&inserted.Quantity,
		&inserted.CreatedByUserID,
		&inserted.CreatedAt,
		&inserted.UpdatedAt,
	)
	if err != nil {
		return domain.PartsPurchaseRequest{}, err
	}

	if err := r.db.QueryRow(ctx, `SELECT full_name FROM public.users WHERE id = $1::uuid`, input.CreatedByUserID).Scan(&inserted.CreatedByName); err != nil {
		return domain.PartsPurchaseRequest{}, err
	}
	return inserted, nil
}

func (r *storeRepository) UpdatePartsPurchaseRequest(ctx context.Context, referenceID int, partsPurchaseRequestID int64, input UpdatePartsPurchaseRequestInput) (domain.PartsPurchaseRequest, error) {
	var updated domain.PartsPurchaseRequest
	cmdErr := r.db.QueryRow(ctx, `
		UPDATE public.parts_purchase_requests
		SET
			source = $3,
			source_url = NULLIF(BTRIM($4), ''),
			status = $5,
			total_price = $6,
			item_name = BTRIM($7),
			quantity = $8,
			updated_at = now()
		WHERE reference_id = $1 AND parts_purchase_request_id = $2
		RETURNING
			parts_purchase_request_id,
			reference_id,
			source,
			source_url,
			status,
			total_price::double precision,
			item_name,
			quantity,
			created_by_user_id::text,
			created_at,
			updated_at
	`,
		referenceID,
		partsPurchaseRequestID,
		input.Source,
		stringOrNil(input.SourceURL),
		input.Status,
		input.TotalPrice,
		input.ItemName,
		input.Quantity,
	).Scan(
		&updated.PartsPurchaseRequestID,
		&updated.ReferenceID,
		&updated.Source,
		&updated.SourceURL,
		&updated.Status,
		&updated.TotalPrice,
		&updated.ItemName,
		&updated.Quantity,
		&updated.CreatedByUserID,
		&updated.CreatedAt,
		&updated.UpdatedAt,
	)
	if cmdErr != nil {
		if cmdErr == pgx.ErrNoRows {
			return domain.PartsPurchaseRequest{}, ErrPartsPurchaseRequestNotFound
		}
		return domain.PartsPurchaseRequest{}, cmdErr
	}
	if err := r.db.QueryRow(ctx, `SELECT full_name FROM public.users WHERE id = $1::uuid`, updated.CreatedByUserID).Scan(&updated.CreatedByName); err != nil {
		return domain.PartsPurchaseRequest{}, err
	}
	return updated, nil
}

func (r *storeRepository) DeletePartsPurchaseRequest(ctx context.Context, referenceID int, partsPurchaseRequestID int64) error {
	cmd, err := r.db.Exec(ctx, `DELETE FROM public.parts_purchase_requests WHERE reference_id = $1 AND parts_purchase_request_id = $2`, referenceID, partsPurchaseRequestID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrPartsPurchaseRequestNotFound
	}
	return nil
}

func stringOrNil(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

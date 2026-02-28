package workorders

import (
	"context"
	"fmt"
	"strings"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	ListWorkOrders(ctx context.Context, query string, page, pageSize int) ([]domain.WorkOrderListItem, error)
	GetWorkOrderDetail(ctx context.Context, referenceID int) (domain.WorkOrderDetail, error)
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
		BrandNames:         make([]string, 0),
		WorkerNames:        make([]string, 0),
		PaymentMethodNames: make([]string, 0),
		LineItems:          make([]domain.WorkOrderLineItem, 0),
	}

	mainSQL := `
		SELECT
			wo.reference_id,
			wo.original_job_id,
			wo.created_at,
			wo.updated_at,
			st.status_key,
			st.display_name,
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
			wo.album_cd_cassette_qty,
			wo.problem_description,
			COALESCE(
				(
					SELECT array_agg(DISTINCT w.worker_name ORDER BY w.worker_name)
					FROM unnest(wo.worker_ids) wid
					JOIN public.workers w ON w.worker_id = wid
				),
				ARRAY[]::TEXT[]
			),
			wo.work_done,
			COALESCE(
				(
					SELECT array_agg(DISTINCT pm.display_name ORDER BY pm.display_name)
					FROM unnest(wo.payment_method_ids) pmid
					JOIN public.payment_methods pm ON pm.payment_method_id = pmid
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
		&detail.StatusKey,
		&detail.StatusName,
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
		&detail.BrandNames,
		&detail.ModelNumber,
		&detail.SerialNumber,
		&detail.RemoteControlQty,
		&detail.CableQty,
		&detail.CordQty,
		&detail.AlbumCDCassetteQty,
		&detail.ProblemDescription,
		&detail.WorkerNames,
		&detail.WorkDone,
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

package workorders

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	ListWorkOrders(ctx context.Context, query string, filters WorkOrderListFilters, includeSensitive bool, page, pageSize int) ([]domain.WorkOrderListItem, error)
	GetWorkOrderDetail(ctx context.Context, referenceID int) (domain.WorkOrderDetail, error)
	ListCustomers(ctx context.Context, query string) ([]CustomerLookupOption, error)
	CreateWorkOrder(ctx context.Context, input CreateWorkOrderInput) (domain.WorkOrderDetail, error)
	DeleteWorkOrder(ctx context.Context, referenceID int) error
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
	GetDashboardData(ctx context.Context, input DashboardQueryInput) (domain.DashboardData, error)
}

type storeRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &storeRepository{db: db}
}

func (r *storeRepository) ListWorkOrders(ctx context.Context, query string, filters WorkOrderListFilters, includeSensitive bool, page, pageSize int) ([]domain.WorkOrderListItem, error) {
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
	normalizedQuery := strings.TrimSpace(strings.Join(strings.Fields(query), " "))
	if normalizedQuery != "" {
		pattern := "%" + normalizedQuery + "%"
		brandIDs := make([]int64, 0)
		if err := r.db.QueryRow(ctx, `SELECT COALESCE(array_agg(brand_id), ARRAY[]::bigint[]) FROM public.brands WHERE brand_name ILIKE $1`, pattern).Scan(&brandIDs); err != nil {
			return nil, err
		}
		digits := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, normalizedQuery)
		phonePattern := "%" + digits + "%"
		searchTerms := []string{
			fmt.Sprintf("wo.reference_id::text ILIKE $%d", argPos),
			fmt.Sprintf(`EXISTS (
				SELECT 1
				FROM public.locations loc
				WHERE loc.location_id = wo.location_id
				  AND (
						loc.location_id::text ILIKE $%d OR
						COALESCE(loc.shelf, '') ILIKE $%d OR
						loc.floor::text ILIKE $%d
				  )
				)`, argPos, argPos, argPos),
			fmt.Sprintf("COALESCE(wo.model_number, '') ILIKE $%d", argPos),
			fmt.Sprintf("COALESCE(wo.serial_number, '') ILIKE $%d", argPos),
		}
		searchTerms = append(searchTerms, fmt.Sprintf(`EXISTS (
			SELECT 1
			FROM public.customers c
			WHERE
				c.customer_id = wo.customer_id AND (
					COALESCE(c.first_name, '') ILIKE $%d OR
					COALESCE(c.last_name, '') ILIKE $%d OR
					COALESCE(c.full_name_search, '') ILIKE $%d
				)
		)`, argPos, argPos, argPos))
		if includeSensitive {
			searchTerms = append(searchTerms, fmt.Sprintf(`EXISTS (
				SELECT 1
				FROM public.customers c
				WHERE
					c.customer_id = wo.customer_id AND (
						COALESCE(c.first_name, '') ILIKE $%d OR
						COALESCE(c.last_name, '') ILIKE $%d OR
						COALESCE(c.full_name_search, '') ILIKE $%d OR
						COALESCE(c.email, '') ILIKE $%d OR
						COALESCE(c.home_phone, '') ILIKE $%d OR
						COALESCE(c.work_phone, '') ILIKE $%d
					)
			)`, argPos, argPos, argPos, argPos, argPos, argPos))
		}
		args = append(args, pattern)
		argPos++
		if len(brandIDs) > 0 {
			searchTerms = append(searchTerms, fmt.Sprintf("COALESCE(wo.brand_ids, ARRAY[]::bigint[]) && $%d::bigint[]", argPos))
			args = append(args, brandIDs)
			argPos++
		}
		if includeSensitive && digits != "" {
			searchTerms = append(searchTerms, fmt.Sprintf(`EXISTS (
				SELECT 1
				FROM public.customers c
				WHERE
					c.customer_id = wo.customer_id AND (
						regexp_replace(COALESCE(c.home_phone, ''), '[^0-9]', '', 'g') ILIKE $%d OR
						regexp_replace(COALESCE(c.work_phone, ''), '[^0-9]', '', 'g') ILIKE $%d
					)
			)`, argPos, argPos))
			args = append(args, phonePattern)
			argPos++
		}
		clauses = append(clauses, "("+strings.Join(searchTerms, " OR ")+")")
	}

	if filters.CustomerID != nil && *filters.CustomerID > 0 {
		clauses = append(clauses, fmt.Sprintf("wo.customer_id = $%d", argPos))
		args = append(args, *filters.CustomerID)
		argPos++
	}
	if filters.StatusID != nil && *filters.StatusID > 0 {
		clauses = append(clauses, fmt.Sprintf("wo.status_id = $%d", argPos))
		args = append(args, *filters.StatusID)
		argPos++
	}
	if filters.JobTypeID != nil && *filters.JobTypeID > 0 {
		clauses = append(clauses, fmt.Sprintf("wo.job_type_id = $%d", argPos))
		args = append(args, *filters.JobTypeID)
		argPos++
	}
	if filters.ItemID != nil && *filters.ItemID > 0 {
		clauses = append(clauses, fmt.Sprintf("wo.item_id = $%d", argPos))
		args = append(args, *filters.ItemID)
		argPos++
	}
	if filters.CreatedFrom != nil && strings.TrimSpace(*filters.CreatedFrom) != "" {
		clauses = append(clauses, fmt.Sprintf("wo.created_at::date >= $%d::date", argPos))
		args = append(args, strings.TrimSpace(*filters.CreatedFrom))
		argPos++
	}
	if filters.CreatedTo != nil && strings.TrimSpace(*filters.CreatedTo) != "" {
		clauses = append(clauses, fmt.Sprintf("wo.created_at::date <= $%d::date", argPos))
		args = append(args, strings.TrimSpace(*filters.CreatedTo))
		argPos++
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}

	args = append(args, pageSize, offset)
	customerNameSelect := "c.full_name_search AS customer_name"
	customerEmailSelect := "c.email"
	customerJoin := "LEFT JOIN public.customers c ON c.customer_id = wo.customer_id"
	if !includeSensitive {
		customerEmailSelect = "NULL::text AS email"
	}
	querySQL := fmt.Sprintf(`
		WITH paged_work_orders AS (
			SELECT
				wo.reference_id,
				wo.created_at
			FROM public.work_orders wo
			%s
			ORDER BY wo.created_at DESC NULLS LAST, wo.reference_id DESC
			LIMIT $%d OFFSET $%d
		)
		SELECT
			wo.reference_id,
			wo.created_at,
			wo.updated_at,
			COALESCE(st.display_name, 'Unknown') AS status_name,
			COALESCE(jt.display_name, 'Unknown') AS job_type_name,
			wo.location_id,
			loc.location_code,
			loc.shelf,
			loc.floor,
			%s,
			%s,
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
		FROM paged_work_orders p
		JOIN public.work_orders wo ON wo.reference_id = p.reference_id
		%s
		LEFT JOIN public.locations loc ON loc.location_id = wo.location_id
		LEFT JOIN public.items i ON i.item_id = wo.item_id
		LEFT JOIN public.work_order_statuses st ON st.status_id = wo.status_id
		LEFT JOIN public.job_types jt ON jt.job_type_id = wo.job_type_id
		ORDER BY p.created_at DESC NULLS LAST, p.reference_id DESC
	`, where, argPos, argPos+1, customerNameSelect, customerEmailSelect, customerJoin)
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
			&item.LocationID,
			&item.LocationCode,
			&item.LocationShelf,
			&item.LocationFloor,
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
			wo.location_id,
			loc.location_code,
			loc.shelf,
			loc.floor,
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
		LEFT JOIN public.locations loc ON loc.location_id = wo.location_id
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
		&detail.LocationID,
		&detail.LocationCode,
		&detail.LocationShelf,
		&detail.LocationFloor,
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

func (r *storeRepository) ListCustomers(ctx context.Context, query string) ([]CustomerLookupOption, error) {
	trimmedQuery := strings.TrimSpace(query)
	if trimmedQuery == "" {
		return []CustomerLookupOption{}, nil
	}
	normalizedQuery := strings.Join(strings.Fields(trimmedQuery), " ")
	if normalizedQuery == "" {
		return []CustomerLookupOption{}, nil
	}
	args := make([]any, 0, 2)
	where := ""
	if normalizedQuery != "" {
		isEmailLike := strings.Contains(normalizedQuery, "@")
		phoneDigits := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, normalizedQuery)
		hasLetters := false
		for _, r := range normalizedQuery {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
				hasLetters = true
				break
			}
		}
		useDigitPhoneSearch := phoneDigits != "" && !isEmailLike && !hasLetters

		if isEmailLike {
			where = `
		WHERE COALESCE(c.email, '') ILIKE $1::text
		`
			args = append(args, "%"+normalizedQuery+"%")
		} else {
			where = `
		WHERE (
			COALESCE(c.first_name, '') ILIKE $1::text OR
			COALESCE(c.last_name, '') ILIKE $1::text OR
			(CONCAT_WS(' ', COALESCE(c.first_name, ''), COALESCE(c.last_name, ''))) ILIKE $1::text OR
			(regexp_replace(CONCAT_WS(' ', COALESCE(c.first_name, ''), COALESCE(c.last_name, '')), '\s+', ' ', 'g')) ILIKE $1::text OR
			COALESCE(c.email, '') ILIKE $1::text OR
			COALESCE(c.home_phone, '') ILIKE $1::text OR
			COALESCE(c.work_phone, '') ILIKE $1::text
		)
		`
			args = append(args, "%"+normalizedQuery+"%")
			if useDigitPhoneSearch {
				where = `
		WHERE (
			COALESCE(c.first_name, '') ILIKE $1::text OR
			COALESCE(c.last_name, '') ILIKE $1::text OR
			(CONCAT_WS(' ', COALESCE(c.first_name, ''), COALESCE(c.last_name, ''))) ILIKE $1::text OR
			(regexp_replace(CONCAT_WS(' ', COALESCE(c.first_name, ''), COALESCE(c.last_name, '')), '\s+', ' ', 'g')) ILIKE $1::text OR
			COALESCE(c.email, '') ILIKE $1::text OR
			COALESCE(c.home_phone, '') ILIKE $1::text OR
			COALESCE(c.work_phone, '') ILIKE $1::text OR
			regexp_replace(COALESCE(c.home_phone, ''), '[^0-9]', '', 'g') LIKE $2::text OR
			regexp_replace(COALESCE(c.work_phone, ''), '[^0-9]', '', 'g') LIKE $2::text
		)
		`
				args = append(args, "%"+phoneDigits+"%")
			}
		}
	}

	rows, err := r.db.Query(ctx, `
		SELECT
			c.customer_id::bigint,
			NULLIF(BTRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS full_name,
			c.first_name,
			c.last_name,
			NULLIF(BTRIM(c.email), '') AS email,
			NULLIF(BTRIM(c.home_phone), '') AS home_phone,
			NULLIF(BTRIM(c.work_phone), '') AS work_phone,
			NULLIF(BTRIM(c.extension_text), '') AS extension_text,
			NULLIF(BTRIM(c.address_line_1), '') AS address_line_1,
			NULLIF(BTRIM(c.address_line_2), '') AS address_line_2,
			NULLIF(BTRIM(c.city), '') AS city,
			NULLIF(BTRIM(c.province), '') AS province
		FROM public.customers c
	`+where+`
		ORDER BY full_name NULLS LAST, c.customer_id DESC
		LIMIT 20
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]CustomerLookupOption, 0)
	for rows.Next() {
		var id int64
		var name *string
		var firstName *string
		var lastName *string
		var email *string
		var homePhone *string
		var workPhone *string
		var extension *string
		var addressLine1 *string
		var addressLine2 *string
		var city *string
		var province *string
		if err := rows.Scan(
			&id,
			&name,
			&firstName,
			&lastName,
			&email,
			&homePhone,
			&workPhone,
			&extension,
			&addressLine1,
			&addressLine2,
			&city,
			&province,
		); err != nil {
			return nil, err
		}
		nameText := strings.TrimSpace(stringOrEmpty(name))
		emailText := strings.TrimSpace(stringOrEmpty(email))
		phone := strings.TrimSpace(stringOrEmpty(homePhone))
		if phone == "" {
			phone = strings.TrimSpace(stringOrEmpty(workPhone))
		}
		label := nameText
		if label == "" {
			label = fmt.Sprintf("Customer #%d", id)
		}
		if phone != "" {
			label = fmt.Sprintf("%s (%s)", label, phone)
		}
		if emailText != "" {
			label = fmt.Sprintf("%s - %s", label, emailText)
		}
		out = append(out, CustomerLookupOption{
			ID:           id,
			Label:        label,
			FirstName:    firstName,
			LastName:     lastName,
			Email:        email,
			HomePhone:    homePhone,
			WorkPhone:    workPhone,
			Extension:    extension,
			AddressLine1: addressLine1,
			AddressLine2: addressLine2,
			City:         city,
			Province:     province,
		})
	}
	return out, rows.Err()
}

func (r *storeRepository) CreateWorkOrder(ctx context.Context, input CreateWorkOrderInput) (domain.WorkOrderDetail, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return domain.WorkOrderDetail{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(895401)`); err != nil {
		return domain.WorkOrderDetail{}, err
	}

	var customerID *int64
	if input.CustomerID != nil {
		customerID = input.CustomerID
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.customers WHERE customer_id = $1)`, *customerID).Scan(&exists); err != nil {
			return domain.WorkOrderDetail{}, err
		}
		if !exists {
			return domain.WorkOrderDetail{}, ErrCustomerNotFound
		}
		if input.CustomerUpdates != nil {
			firstName, lastName := splitCustomerName(input.CustomerUpdates.Name)
			if _, err := tx.Exec(ctx, `
				UPDATE public.customers
				SET
					first_name = COALESCE($1::text, first_name),
					last_name = COALESCE($2::text, last_name),
					email = COALESCE($3::text, email),
					home_phone = COALESCE($4::text, home_phone),
					work_phone = COALESCE($5::text, work_phone),
					extension_text = COALESCE($6::text, extension_text),
					address_line_1 = COALESCE($7::text, address_line_1),
					address_line_2 = COALESCE($8::text, address_line_2),
					city = COALESCE($9::text, city),
					province = COALESCE($10::text, province)
				WHERE customer_id = $11
			`,
				nullableString(&firstName),
				nullableString(&lastName),
				nullableString(input.CustomerUpdates.Email),
				nullableString(input.CustomerUpdates.HomePhone),
				nullableString(input.CustomerUpdates.WorkPhone),
				nullableString(input.CustomerUpdates.Extension),
				nullableString(input.CustomerUpdates.AddressLine1),
				nullableString(input.CustomerUpdates.AddressLine2),
				nullableString(input.CustomerUpdates.City),
				nullableString(input.CustomerUpdates.Province),
				*customerID,
			); err != nil {
				return domain.WorkOrderDetail{}, err
			}
		}
	} else if input.NewCustomer != nil {
		firstName, lastName := splitCustomerName(input.NewCustomer.Name)
		var newCustomerID int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO public.customers(
				first_name,
				last_name,
				email,
				home_phone,
				work_phone,
				extension_text,
				address_line_1,
				address_line_2,
				city,
				province
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			RETURNING customer_id
		`,
			nullableString(&firstName),
			nullableString(&lastName),
			nullableString(input.NewCustomer.Email),
			nullableString(input.NewCustomer.HomePhone),
			nullableString(input.NewCustomer.WorkPhone),
			nullableString(input.NewCustomer.Extension),
			nullableString(input.NewCustomer.AddressLine1),
			nullableString(input.NewCustomer.AddressLine2),
			nullableString(input.NewCustomer.City),
			nullableString(input.NewCustomer.Province),
		).Scan(&newCustomerID); err != nil {
			return domain.WorkOrderDetail{}, err
		}
		customerID = &newCustomerID
	}

	var depositPaymentMethodIDs []int64
	if input.DepositPaymentMethodID != nil && *input.DepositPaymentMethodID > 0 {
		var paymentMethodExists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.payment_methods WHERE payment_method_id = $1 AND is_active = true)`, *input.DepositPaymentMethodID).Scan(&paymentMethodExists); err != nil {
			return domain.WorkOrderDetail{}, err
		}
		if !paymentMethodExists {
			return domain.WorkOrderDetail{}, ErrPaymentMethodNotFound
		}
		depositPaymentMethodIDs = append(depositPaymentMethodIDs, *input.DepositPaymentMethodID)
	}

	if input.LocationID != nil {
		if *input.LocationID <= 0 {
			return domain.WorkOrderDetail{}, ErrLocationNotFound
		}
		var locationExists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.locations WHERE location_id = $1 AND is_active = true)`, *input.LocationID).Scan(&locationExists); err != nil {
			return domain.WorkOrderDetail{}, err
		}
		if !locationExists {
			return domain.WorkOrderDetail{}, ErrLocationNotFound
		}
	}

	var statusID *int64
	var preferredStatusID int64
	statusErr := tx.QueryRow(ctx, `
		SELECT status_id::bigint
		FROM public.work_order_statuses
		ORDER BY
			CASE
				WHEN LOWER(status_key) = 'received' OR LOWER(display_name) = 'received' THEN 0
				ELSE 1
			END,
			status_id
		LIMIT 1
	`).Scan(&preferredStatusID)
	if statusErr == nil {
		statusID = &preferredStatusID
	} else if !errors.Is(statusErr, pgx.ErrNoRows) {
		return domain.WorkOrderDetail{}, statusErr
	}

	jobTypeID, err := resolveJobTypeIDForCreationMode(ctx, tx, input.CreationMode)
	if err != nil {
		return domain.WorkOrderDetail{}, err
	}

	var referenceID int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(reference_id), 0) + 1 FROM public.work_orders`).Scan(&referenceID); err != nil {
		return domain.WorkOrderDetail{}, err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO public.work_orders(
			reference_id,
			customer_id,
			status_id,
			job_type_id,
			location_id,
			item_id,
			remote_control_qty,
			cable_qty,
			cord_qty,
			dvd_vhs_qty,
			album_cd_cassette_qty,
			payment_method_ids,
			deposit,
			brand_ids,
			worker_ids,
			model_number,
			serial_number,
			created_at,
			updated_at,
			status_updated_at
		)
		VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
			COALESCE($12::bigint[], ARRAY[]::bigint[]),
			$13,
			COALESCE($14::bigint[], ARRAY[]::bigint[]),
			COALESCE($15::integer[], ARRAY[]::integer[]),
			$16,
			$17,
			now(), now(), now()
		)
	`,
		referenceID,
		customerID,
		statusID,
		jobTypeID,
		input.LocationID,
		input.ItemID,
		input.RemoteControlQty,
		input.CableQty,
		input.CordQty,
		input.DVDVHSQty,
		input.AlbumCDCassetteQty,
		depositPaymentMethodIDs,
		input.Deposit,
		input.BrandIDs,
		[]int32{},
		nullableString(input.ModelNumber),
		nullableString(input.SerialNumber),
	); err != nil {
		return domain.WorkOrderDetail{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.WorkOrderDetail{}, err
	}

	return r.GetWorkOrderDetail(ctx, referenceID)
}

func (r *storeRepository) UpdateEquipment(ctx context.Context, referenceID int, input EquipmentUpdateInput) error {
	if input.LocationID != nil {
		if *input.LocationID <= 0 {
			return ErrLocationNotFound
		}
		var locationExists bool
		if err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.locations WHERE location_id = $1 AND is_active = true)`, *input.LocationID).Scan(&locationExists); err != nil {
			return err
		}
		if !locationExists {
			return ErrLocationNotFound
		}
	}

	cmd, err := r.db.Exec(ctx, `
		UPDATE public.work_orders
		SET
			status_id = $1,
			job_type_id = $2,
			location_id = $3,
			item_id = $4,
			brand_ids = $5,
			model_number = $6,
			serial_number = $7,
			remote_control_qty = $8,
			cable_qty = $9,
			cord_qty = $10,
			dvd_vhs_qty = $11,
			album_cd_cassette_qty = $12,
			updated_at = now()
		WHERE reference_id = $13
	`,
		input.StatusID,
		input.JobTypeID,
		input.LocationID,
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
		if line.LineItemID != nil && *line.LineItemID > 0 {
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

func splitCustomerName(name string) (string, string) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", ""
	}
	parts := strings.Fields(trimmed)
	if len(parts) == 1 {
		return parts[0], ""
	}
	firstName := parts[0]
	lastName := strings.Join(parts[1:], " ")
	return firstName, lastName
}

func resolveJobTypeIDForCreationMode(ctx context.Context, tx pgx.Tx, mode string) (*int64, error) {
	normalizedMode := strings.TrimSpace(strings.ToLower(mode))
	if normalizedMode == "" {
		normalizedMode = "new_job"
	}

	if normalizedMode == "stock" {
		var stockJobTypeID int64
		err := tx.QueryRow(ctx, `
			SELECT job_type_id::bigint
			FROM public.job_types
			WHERE
				LOWER(job_type_key) = 'stock'
				OR REPLACE(LOWER(display_name), ' ', '_') = 'stock'
				OR LOWER(display_name) = 'stock'
			ORDER BY job_type_id
			LIMIT 1
		`).Scan(&stockJobTypeID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrStockJobTypeNotFound
			}
			return nil, err
		}
		return &stockJobTypeID, nil
	}

	var newJobTypeID int64
	err := tx.QueryRow(ctx, `
		SELECT job_type_id::bigint
		FROM public.job_types
		WHERE
			LOWER(job_type_key) IN ('new_job', 'newjob', 'new-job', 'new')
			OR REPLACE(LOWER(display_name), ' ', '_') IN ('new_job', 'newjob', 'new-job', 'new')
			OR LOWER(display_name) IN ('new job', 'new-job', 'new')
		ORDER BY job_type_id
		LIMIT 1
	`).Scan(&newJobTypeID)
	if err == nil {
		return &newJobTypeID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	// Fallback: pick any non-stock job type so "new job" creation is never left undefined.
	err = tx.QueryRow(ctx, `
		SELECT job_type_id::bigint
		FROM public.job_types
		WHERE
			LOWER(job_type_key) <> 'stock'
			AND REPLACE(LOWER(display_name), ' ', '_') <> 'stock'
			AND LOWER(display_name) <> 'stock'
		ORDER BY job_type_id
		LIMIT 1
	`).Scan(&newJobTypeID)
	if err == nil {
		return &newJobTypeID, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return nil, err
}

func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
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

func (r *storeRepository) GetDashboardData(ctx context.Context, input DashboardQueryInput) (domain.DashboardData, error) {
	readyPage := input.ReadyPage
	if readyPage < 1 {
		readyPage = 1
	}
	readyPageSize := input.ReadyPageSize
	if readyPageSize < 1 || readyPageSize > 100 {
		readyPageSize = 10
	}
	overduePage := input.OverduePage
	if overduePage < 1 {
		overduePage = 1
	}
	overduePageSize := input.OverduePageSize
	if overduePageSize < 1 || overduePageSize > 100 {
		overduePageSize = 10
	}

	readyOffset := (readyPage - 1) * readyPageSize
	overdueOffset := (overduePage - 1) * overduePageSize

	out := domain.DashboardData{
		ReadyItems:       make([]domain.DashboardWorkOrderItem, 0),
		OverdueItems:     make([]domain.DashboardOverdueItem, 0),
		PartsReviewItems: make([]domain.DashboardPartsReviewItem, 0),
		ActivityItems:    make([]domain.DashboardActivityItem, 0),
	}

	baseFilter := `
		FROM public.work_orders wo
		LEFT JOIN public.work_order_statuses st ON st.status_id = wo.status_id
		LEFT JOIN public.job_types jt ON jt.job_type_id = wo.job_type_id
		LEFT JOIN public.customers c ON c.customer_id = wo.customer_id
		LEFT JOIN public.items i ON i.item_id = wo.item_id
		WHERE COALESCE(wo.status_updated_at, wo.updated_at, wo.created_at) >= $1::date
		  AND COALESCE(jt.display_name, '') NOT ILIKE '%stock%'
	`

	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) `+baseFilter+` AND COALESCE(st.display_name, '') ILIKE '%finished%'`, input.RangeStart).Scan(&out.ReadyTotal); err != nil {
		return domain.DashboardData{}, err
	}

	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) `+baseFilter+` AND COALESCE(st.display_name, '') ILIKE '%finished%' AND wo.status_updated_at IS NOT NULL AND (now() - wo.status_updated_at) > interval '14 days'`, input.RangeStart).Scan(&out.OverdueTotal); err != nil {
		return domain.DashboardData{}, err
	}

	readyRows, err := r.db.Query(ctx, `
		SELECT
			wo.reference_id,
			c.full_name_search AS customer_name,
			i.item_name,
			COALESCE(st.display_name, 'Unknown') AS status_name,
			COALESCE(wo.status_updated_at, wo.updated_at, wo.created_at) AS status_updated_at
		`+baseFilter+`
		  AND COALESCE(st.display_name, '') ILIKE '%finished%'
		ORDER BY COALESCE(wo.status_updated_at, wo.updated_at, wo.created_at) DESC, wo.reference_id DESC
		LIMIT $2 OFFSET $3
	`, input.RangeStart, readyPageSize, readyOffset)
	if err != nil {
		return domain.DashboardData{}, err
	}
	defer readyRows.Close()
	for readyRows.Next() {
		var item domain.DashboardWorkOrderItem
		if err := readyRows.Scan(&item.ReferenceID, &item.CustomerName, &item.ItemName, &item.Status, &item.StatusUpdatedAt); err != nil {
			return domain.DashboardData{}, err
		}
		out.ReadyItems = append(out.ReadyItems, item)
	}
	if err := readyRows.Err(); err != nil {
		return domain.DashboardData{}, err
	}

	overdueRows, err := r.db.Query(ctx, `
		SELECT
			wo.reference_id,
			c.full_name_search AS customer_name,
			i.item_name,
			FLOOR(EXTRACT(EPOCH FROM (now() - wo.status_updated_at)) / 86400)::int AS late_days,
			wo.status_updated_at AS status_updated_at
		`+baseFilter+`
		  AND COALESCE(st.display_name, '') ILIKE '%finished%'
		  AND wo.status_updated_at IS NOT NULL
		  AND (now() - wo.status_updated_at) > interval '14 days'
		ORDER BY wo.status_updated_at DESC, wo.reference_id DESC
		LIMIT $2 OFFSET $3
	`, input.RangeStart, overduePageSize, overdueOffset)
	if err != nil {
		return domain.DashboardData{}, err
	}
	defer overdueRows.Close()
	for overdueRows.Next() {
		var item domain.DashboardOverdueItem
		if err := overdueRows.Scan(&item.ReferenceID, &item.CustomerName, &item.ItemName, &item.LateDays, &item.StatusUpdatedAt); err != nil {
			return domain.DashboardData{}, err
		}
		out.OverdueItems = append(out.OverdueItems, item)
	}
	if err := overdueRows.Err(); err != nil {
		return domain.DashboardData{}, err
	}

	if input.IncludeParts {
		rows, err := r.db.Query(ctx, `
			SELECT
				ppr.parts_purchase_request_id,
				ppr.reference_id,
				ppr.item_name,
				ppr.total_price::double precision,
				ppr.created_at
			FROM public.parts_purchase_requests ppr
			WHERE ppr.status = 'waiting_approval'
			  AND ppr.created_at >= $1::date
			ORDER BY ppr.created_at DESC, ppr.parts_purchase_request_id DESC
			LIMIT 5
		`, input.RangeStart)
		if err != nil {
			return domain.DashboardData{}, err
		}
		defer rows.Close()
		for rows.Next() {
			var item domain.DashboardPartsReviewItem
			if err := rows.Scan(&item.PartsPurchaseRequestID, &item.ReferenceID, &item.ItemName, &item.TotalPrice, &item.CreatedAt); err != nil {
				return domain.DashboardData{}, err
			}
			out.PartsReviewItems = append(out.PartsReviewItems, item)
		}
		if err := rows.Err(); err != nil {
			return domain.DashboardData{}, err
		}
	}

	if input.IncludeActivity {
		rows, err := r.db.Query(ctx, `
			WITH candidate_logs AS (
				SELECT
					rl.created_by_user_id::text AS person_id,
					COALESCE(u.full_name, 'Unknown') AS person_name,
					rl.reference_id,
					rl.details,
					COALESCE(rl.updated_at, rl.created_at, rl.repair_date::timestamp) AS logged_at
				FROM public.repair_logs rl
				JOIN public.work_orders wo ON wo.reference_id = rl.reference_id
				LEFT JOIN public.users u ON u.id = rl.created_by_user_id
				LEFT JOIN public.job_types jt ON jt.job_type_id = wo.job_type_id
				WHERE COALESCE(jt.display_name, '') NOT ILIKE '%stock%'
				  AND COALESCE(rl.updated_at, rl.created_at, rl.repair_date::timestamp) >= $1::date
			),
			latest_per_person AS (
				SELECT DISTINCT ON (person_id)
					person_id,
					person_name,
					reference_id,
					details,
					logged_at
				FROM candidate_logs
				ORDER BY person_id, logged_at DESC
			)
			SELECT person_id, person_name, reference_id, details, logged_at
			FROM latest_per_person
			ORDER BY logged_at DESC
			LIMIT 6
		`, input.RangeStart)
		if err != nil {
			return domain.DashboardData{}, err
		}
		defer rows.Close()
		for rows.Next() {
			var item domain.DashboardActivityItem
			if err := rows.Scan(&item.PersonID, &item.PersonName, &item.ReferenceID, &item.Details, &item.LoggedAt); err != nil {
				return domain.DashboardData{}, err
			}
			out.ActivityItems = append(out.ActivityItems, item)
		}
		if err := rows.Err(); err != nil {
			return domain.DashboardData{}, err
		}
	}

	return out, nil
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

func (r *storeRepository) DeleteWorkOrder(ctx context.Context, referenceID int) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	// Clean up known dependent rows first in case FK cascades are not consistently configured.
	if _, err := tx.Exec(ctx, `DELETE FROM public.work_order_line_items WHERE reference_id = $1`, referenceID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM public.repair_logs WHERE reference_id = $1`, referenceID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM public.parts_purchase_requests WHERE reference_id = $1`, referenceID); err != nil {
		return err
	}

	cmd, err := tx.Exec(ctx, `DELETE FROM public.work_orders WHERE reference_id = $1`, referenceID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrWorkOrderNotFound
	}

	return tx.Commit(ctx)
}

func stringOrNil(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

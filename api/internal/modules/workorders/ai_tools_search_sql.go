package workorders

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// aiSearchCustomerNameSQL renders the customer's display name (first + last,
// falling back to the search name). Contact fields are never selected.
const aiSearchCustomerNameSQL = `COALESCE(
	NULLIF(BTRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
	NULLIF(BTRIM(c.full_name_search), ''),
	'Unknown'
)`

// aiSearchBrandMatchSQL matches a brand-name pattern against the job's brands.
// %s is the placeholder for the ILIKE pattern.
const aiSearchBrandMatchSQL = `EXISTS (
	SELECT 1
	FROM unnest(COALESCE(wo.brand_ids, ARRAY[]::bigint[])) bid
	JOIN public.brands b ON b.brand_id = bid
	WHERE b.brand_name ILIKE %s
)`

// aiSearchRepeatSQL keeps jobs whose normalized column value appears on at
// least N jobs. %[1]s is a fixed column name from this file (never user input);
// %[2]s is the placeholder for N.
const aiSearchRepeatSQL = `NULLIF(BTRIM(wo.%[1]s), '') IS NOT NULL AND UPPER(BTRIM(wo.%[1]s)) IN (
	SELECT UPPER(BTRIM(x.%[1]s))
	FROM public.work_orders x
	WHERE NULLIF(BTRIM(x.%[1]s), '') IS NOT NULL
	GROUP BY 1
	HAVING COUNT(*) >= %[2]s
)`

// sqlArgs collects bind arguments and hands back their $n placeholders, so
// every user-supplied value is passed to PostgreSQL as a parameter.
type sqlArgs struct{ args []any }

func (a *sqlArgs) add(v any) string {
	a.args = append(a.args, v)
	return "$" + strconv.Itoa(len(a.args))
}

// likeContains builds an ILIKE "contains" pattern with %, _ and \ escaped so
// they match literally (PostgreSQL's default LIKE escape is backslash).
func likeContains(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(s) + "%"
}

// buildAISearchSQL turns validated filters into a single parameterized query.
// The SQL text is assembled only from constants in this file; every filter
// value goes into the returned args slice.
func buildAISearchSQL(f aiResolvedSearchFilters) (string, []any) {
	a := &sqlArgs{}
	clauses := make([]string, 0)

	if f.Text != "" {
		p := a.add(likeContains(f.Text))
		clauses = append(clauses, "("+strings.Join([]string{
			"wo.reference_id::text ILIKE " + p,
			"(" + aiSearchCustomerNameSQL + ") ILIKE " + p,
			"COALESCE(c.full_name_search, '') ILIKE " + p,
			"COALESCE(i.item_name, '') ILIKE " + p,
			"COALESCE(wo.model_number, '') ILIKE " + p,
			"COALESCE(wo.serial_number, '') ILIKE " + p,
			fmt.Sprintf(aiSearchBrandMatchSQL, p),
		}, " OR ")+")")
	}
	if f.CustomerName != "" {
		p := a.add(likeContains(f.CustomerName))
		clauses = append(clauses, fmt.Sprintf("((%s) ILIKE %s OR COALESCE(c.full_name_search, '') ILIKE %s)", aiSearchCustomerNameSQL, p, p))
	}
	if f.Model != "" {
		clauses = append(clauses, "COALESCE(wo.model_number, '') ILIKE "+a.add(likeContains(f.Model)))
	}
	if f.Serial != "" {
		clauses = append(clauses, "COALESCE(wo.serial_number, '') ILIKE "+a.add(likeContains(f.Serial)))
	}
	if f.Brand != "" {
		clauses = append(clauses, fmt.Sprintf(aiSearchBrandMatchSQL, a.add(likeContains(f.Brand))))
	}
	if f.Equipment != "" {
		clauses = append(clauses, "COALESCE(i.item_name, '') ILIKE "+a.add(likeContains(f.Equipment)))
	}
	if len(f.StatusIDs) > 0 {
		clauses = append(clauses, "wo.status_id = ANY("+a.add(f.StatusIDs)+"::bigint[])")
	}
	switch f.Warranty {
	case aiWarrantyOnly:
		clauses = append(clauses, "("+aiWarrantyPredicate+")")
	case aiWarrantyExclude:
		clauses = append(clauses, "NOT ("+aiWarrantyPredicate+")")
	}
	if f.MinUnits > 0 {
		clauses = append(clauses, `wo.customer_id IN (
			SELECT x.customer_id FROM public.work_orders x
			WHERE x.customer_id IS NOT NULL
			GROUP BY x.customer_id
			HAVING COUNT(*) >= `+a.add(f.MinUnits)+`
		)`)
	}
	if f.MinModelJobs > 0 {
		clauses = append(clauses, fmt.Sprintf(aiSearchRepeatSQL, "model_number", a.add(f.MinModelJobs)))
	}
	if f.MinSerialJobs > 0 {
		clauses = append(clauses, fmt.Sprintf(aiSearchRepeatSQL, "serial_number", a.add(f.MinSerialJobs)))
	}
	if f.CreatedFrom != "" {
		clauses = append(clauses, "wo.created_at::date >= "+a.add(f.CreatedFrom)+"::date")
	}
	if f.CreatedTo != "" {
		clauses = append(clauses, "wo.created_at::date <= "+a.add(f.CreatedTo)+"::date")
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, "\n\t\t  AND ")
	}

	// "Show original job and its warranty follow-ups together": widen the
	// matched set with each match's original job and its follow-up jobs.
	matched := `SELECT reference_id FROM base`
	if f.IncludeLinked {
		matched = `SELECT reference_id FROM base
			UNION
			SELECT w.reference_id
			FROM public.work_orders w
			JOIN base m ON w.original_job_id = m.reference_id OR w.reference_id = m.original_job_id`
	}

	order := "wo.created_at DESC NULLS LAST, wo.reference_id DESC"
	switch f.GroupBy {
	case aiGroupCustomer:
		order = "customer_name, wo.customer_id NULLS LAST, " + order
	case aiGroupModel:
		order = "NULLIF(UPPER(BTRIM(wo.model_number)), '') NULLS LAST, " + order
	case aiGroupSerial:
		order = "NULLIF(UPPER(BTRIM(wo.serial_number)), '') NULLS LAST, " + order
	}

	limit := a.add(f.Limit)
	offset := a.add(f.Offset)

	query := fmt.Sprintf(`
		WITH base AS (
			SELECT wo.reference_id, wo.original_job_id
			FROM public.work_orders wo
			LEFT JOIN public.customers c ON c.customer_id = wo.customer_id
			LEFT JOIN public.items i ON i.item_id = wo.item_id
			LEFT JOIN public.job_types jt ON jt.job_type_id = wo.job_type_id
			%s
		),
		matched AS (
			%s
		)
		SELECT
			wo.reference_id,
			wo.customer_id::bigint,
			%s AS customer_name,
			COALESCE(i.item_name, '') AS equipment_name,
			COALESCE(
				(
					SELECT array_agg(b.brand_name ORDER BY b.brand_name)
					FROM unnest(wo.brand_ids) bid
					JOIN public.brands b ON b.brand_id = bid
				),
				ARRAY[]::TEXT[]
			) AS brand_names,
			COALESCE(wo.model_number, ''),
			COALESCE(wo.serial_number, ''),
			COALESCE(st.display_name, 'Unknown'),
			COALESCE(st.status_group, 'to_do'),
			wo.created_at,
			(%s) AS is_warranty,
			wo.original_job_id,
			COALESCE(
				(
					SELECT array_agg(w.reference_id ORDER BY w.reference_id)
					FROM public.work_orders w
					WHERE w.original_job_id = wo.reference_id
				),
				ARRAY[]::integer[]
			) AS warranty_job_ids,
			CASE WHEN wo.customer_id IS NULL THEN 0 ELSE (
				SELECT COUNT(*) FROM public.work_orders cw WHERE cw.customer_id = wo.customer_id
			) END::int AS customer_job_count,
			COUNT(*) OVER ()::int AS total
		FROM matched m
		JOIN public.work_orders wo ON wo.reference_id = m.reference_id
		LEFT JOIN public.customers c ON c.customer_id = wo.customer_id
		LEFT JOIN public.items i ON i.item_id = wo.item_id
		LEFT JOIN public.work_order_statuses st ON st.status_id = wo.status_id
		LEFT JOIN public.job_types jt ON jt.job_type_id = wo.job_type_id
		ORDER BY %s
		LIMIT %s OFFSET %s
	`, where, matched, aiSearchCustomerNameSQL, aiWarrantyPredicate, order, limit, offset)
	return query, a.args
}

// aiSearchTimeout bounds an Advanced Search query both server-side (statement
// timeout) and client-side (context deadline) so a pathological filter
// combination cannot tie up a connection.
const (
	aiSearchTimeout          = 10 * time.Second
	aiSearchStatementTimeout = "SET LOCAL statement_timeout = '10s'"
)

// aiSearchDB is the subset of the pool AISearch needs (fakeable in tests).
type aiSearchDB interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// AISearch executes validated Advanced Search filters. It returns the page of
// rows plus the total number of matching jobs (0 when the page is empty).
func (r *storeRepository) AISearch(ctx context.Context, f aiResolvedSearchFilters) ([]AISearchRow, int, error) {
	return runAISearch(ctx, r.db, f)
}

// runAISearch runs the search read-only in its own transaction with a local
// statement timeout, under a context deadline of the same length.
func runAISearch(ctx context.Context, db aiSearchDB, f aiResolvedSearchFilters) ([]AISearchRow, int, error) {
	ctx, cancel := context.WithTimeout(ctx, aiSearchTimeout)
	defer cancel()

	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, 0, err
	}
	// Read-only: always roll back; nothing to commit.
	defer func() { _ = tx.Rollback(context.Background()) }()

	if _, err := tx.Exec(ctx, aiSearchStatementTimeout); err != nil {
		return nil, 0, err
	}

	query, args := buildAISearchSQL(f)
	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]AISearchRow, 0)
	total := 0
	for rows.Next() {
		row := AISearchRow{BrandNames: []string{}, WarrantyJobIDs: []int32{}}
		if err := rows.Scan(
			&row.ReferenceID,
			&row.CustomerID,
			&row.CustomerName,
			&row.EquipmentName,
			&row.BrandNames,
			&row.ModelNumber,
			&row.SerialNumber,
			&row.StatusName,
			&row.StatusGroup,
			&row.CreatedAt,
			&row.IsWarranty,
			&row.OriginalJobID,
			&row.WarrantyJobIDs,
			&row.CustomerJobCount,
			&total,
		); err != nil {
			return nil, 0, err
		}
		out = append(out, row)
	}
	return out, total, rows.Err()
}

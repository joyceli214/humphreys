package catalog

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strings"

	"humphreys/api/internal/domain"

	"github.com/jackc/pgx/v5/pgxpool"
)

type LookupOption struct {
	ID    int64  `json:"id"`
	Label string `json:"label"`
}

type Repository interface {
	ListResources(ctx context.Context) ([]domain.Resource, error)
	ListPermissions(ctx context.Context) ([]domain.Permission, error)
	ListWorkOrderStatuses(ctx context.Context, query string) ([]LookupOption, error)
	ListJobTypes(ctx context.Context, query string) ([]LookupOption, error)
	ListItems(ctx context.Context, query string) ([]LookupOption, error)
	ListBrands(ctx context.Context, query string) ([]LookupOption, error)
	ListWorkers(ctx context.Context, query string) ([]LookupOption, error)
	ListPaymentMethods(ctx context.Context, query string) ([]LookupOption, error)
	CreateWorkOrderStatus(ctx context.Context, label string) (LookupOption, error)
	CreateJobType(ctx context.Context, label string) (LookupOption, error)
	CreateItem(ctx context.Context, label string) (LookupOption, error)
	CreateBrand(ctx context.Context, label string) (LookupOption, error)
	CreateWorker(ctx context.Context, label string) (LookupOption, error)
	CreatePaymentMethod(ctx context.Context, label string) (LookupOption, error)
}

type storeRepository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) Repository {
	return &storeRepository{db: db}
}

func (r *storeRepository) ListResources(ctx context.Context) ([]domain.Resource, error) {
	rows, err := r.db.Query(ctx, `SELECT id, name, description FROM resources ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Resource, 0)
	for rows.Next() {
		var resource domain.Resource
		if err := rows.Scan(&resource.ID, &resource.Name, &resource.Description); err != nil {
			return nil, err
		}
		out = append(out, resource)
	}
	return out, rows.Err()
}

func (r *storeRepository) ListPermissions(ctx context.Context) ([]domain.Permission, error) {
	rows, err := r.db.Query(ctx, `
		SELECT p.id, p.code, res.name, p.action
		FROM permissions p
		JOIN resources res ON res.id = p.resource_id
		ORDER BY p.code
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]domain.Permission, 0)
	for rows.Next() {
		var permission domain.Permission
		if err := rows.Scan(&permission.ID, &permission.Code, &permission.Resource, &permission.Action); err != nil {
			return nil, err
		}
		out = append(out, permission)
	}
	return out, rows.Err()
}

func (r *storeRepository) ListWorkOrderStatuses(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT status_id, display_name FROM public.work_order_statuses`, "display_name", query)
}

func (r *storeRepository) ListJobTypes(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT job_type_id, display_name FROM public.job_types`, "display_name", query)
}

func (r *storeRepository) ListItems(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT item_id, item_name FROM public.items WHERE is_active = true`, "item_name", query)
}

func (r *storeRepository) ListBrands(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT brand_id, brand_name FROM public.brands WHERE is_active = true`, "brand_name", query)
}

func (r *storeRepository) ListWorkers(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT worker_id::bigint, worker_name FROM public.workers`, "worker_name", query)
}

func (r *storeRepository) ListPaymentMethods(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT payment_method_id::bigint, display_name FROM public.payment_methods WHERE is_active = true`, "display_name", query)
}

func (r *storeRepository) CreateWorkOrderStatus(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	key := slugify(value)
	if key == "" {
		key = "status"
	}
	key = ensureUniqueKeyWithHash(key, value)

	var option LookupOption
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.work_order_statuses(status_key, display_name)
		VALUES($1, $2)
		RETURNING status_id::bigint, display_name
	`, key, value).Scan(&option.ID, &option.Label)
	return option, err
}

func (r *storeRepository) CreateJobType(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	key := slugify(value)
	if key == "" {
		key = "job_type"
	}
	key = ensureUniqueKeyWithHash(key, value)

	var option LookupOption
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.job_types(job_type_key, display_name)
		VALUES($1, $2)
		RETURNING job_type_id::bigint, display_name
	`, key, value).Scan(&option.ID, &option.Label)
	return option, err
}

func (r *storeRepository) CreateItem(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	var option LookupOption
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.items(item_name, is_active)
		VALUES($1, true)
		RETURNING item_id::bigint, item_name
	`, value).Scan(&option.ID, &option.Label)
	return option, err
}

func (r *storeRepository) CreateBrand(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	var option LookupOption
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.brands(brand_name, is_active)
		VALUES($1, true)
		RETURNING brand_id::bigint, brand_name
	`, value).Scan(&option.ID, &option.Label)
	return option, err
}

func (r *storeRepository) CreateWorker(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	var option LookupOption
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.workers(worker_name)
		VALUES($1)
		RETURNING worker_id::bigint, worker_name
	`, value).Scan(&option.ID, &option.Label)
	return option, err
}

func (r *storeRepository) CreatePaymentMethod(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	key := slugify(value)
	if key == "" {
		key = "payment_method"
	}
	key = ensureUniqueKeyWithHash(key, value)

	var option LookupOption
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.payment_methods(payment_method_key, display_name, is_active)
		VALUES($1, $2, true)
		RETURNING payment_method_id::bigint, display_name
	`, key, value).Scan(&option.ID, &option.Label)
	return option, err
}

func (r *storeRepository) listLookup(ctx context.Context, baseSQL, labelCol, query string) ([]LookupOption, error) {
	sql := fmt.Sprintf("%s ORDER BY %s", baseSQL, labelCol)
	args := []any{}
	trimmedQuery := strings.TrimSpace(query)
	if trimmedQuery != "" {
		normalizedBase := strings.Join(strings.Fields(strings.ToLower(baseSQL)), " ")
		if strings.Contains(normalizedBase, " where ") {
			sql = fmt.Sprintf("%s AND %s ILIKE $1 ORDER BY %s", baseSQL, labelCol, labelCol)
		} else {
			sql = fmt.Sprintf("%s WHERE %s ILIKE $1 ORDER BY %s", baseSQL, labelCol, labelCol)
		}
		args = append(args, "%"+trimmedQuery+"%")
	}

	rows, err := r.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]LookupOption, 0)
	for rows.Next() {
		var option LookupOption
		if err := rows.Scan(&option.ID, &option.Label); err != nil {
			return nil, err
		}
		out = append(out, option)
	}
	return out, rows.Err()
}

func slugify(value string) string {
	lower := strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	prevDash := false
	for _, r := range lower {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevDash = false
			continue
		}
		if !prevDash {
			b.WriteRune('_')
			prevDash = true
		}
	}
	out := strings.Trim(b.String(), "_")
	return out
}

func ensureUniqueKeyWithHash(base, source string) string {
	sum := sha1.Sum([]byte(source))
	return fmt.Sprintf("%s_%s", base, hex.EncodeToString(sum[:3]))
}

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

type ManagedLookupOption struct {
	ID       int64  `json:"id"`
	Label    string `json:"label"`
	IsActive bool   `json:"is_active"`
}

type DropdownManagementEntry struct {
	Key      string                `json:"key"`
	Label    string                `json:"label"`
	IsFrozen bool                  `json:"is_frozen"`
	Options  []ManagedLookupOption `json:"options"`
}

const (
	DropdownKeyWorkOrderStatuses = "work_order_statuses"
	DropdownKeyJobTypes          = "job_types"
	DropdownKeyItems             = "items"
	DropdownKeyBrands            = "brands"
	DropdownKeyWorkers           = "workers"
	DropdownKeyPaymentMethods    = "payment_methods"
	DropdownKeyLocations         = "locations"
	DropdownKeyPartsItemPresets  = "parts_item_presets"
)

type dropdownSpec struct {
	Key      string
	Label    string
	Table    string
	IDColumn string
	LabelSQL string
}

var managedDropdownSpecs = []dropdownSpec{
	{
		Key:      DropdownKeyWorkOrderStatuses,
		Label:    "Work Order Statuses",
		Table:    "work_order_statuses",
		IDColumn: "status_id",
		LabelSQL: "display_name",
	},
	{
		Key:      DropdownKeyJobTypes,
		Label:    "Job Types",
		Table:    "job_types",
		IDColumn: "job_type_id",
		LabelSQL: "display_name",
	},
	{
		Key:      DropdownKeyItems,
		Label:    "Items",
		Table:    "items",
		IDColumn: "item_id",
		LabelSQL: "item_name",
	},
	{
		Key:      DropdownKeyBrands,
		Label:    "Brands",
		Table:    "brands",
		IDColumn: "brand_id",
		LabelSQL: "brand_name",
	},
	{
		Key:      DropdownKeyWorkers,
		Label:    "Workers",
		Table:    "workers",
		IDColumn: "worker_id",
		LabelSQL: "worker_name",
	},
	{
		Key:      DropdownKeyPaymentMethods,
		Label:    "Payment Methods",
		Table:    "payment_methods",
		IDColumn: "payment_method_id",
		LabelSQL: "display_name",
	},
	{
		Key:      DropdownKeyLocations,
		Label:    "Locations",
		Table:    "locations",
		IDColumn: "location_id",
		LabelSQL: `CASE
			WHEN floor = 0 THEN shelf || '-FLOOR'
			ELSE shelf || '-' || floor::text
		END`,
	},
	{
		Key:      DropdownKeyPartsItemPresets,
		Label:    "Parts Item Presets",
		Table:    "parts_item_presets",
		IDColumn: "parts_item_preset_id",
		LabelSQL: "preset_name",
	},
}

type Repository interface {
	ListResources(ctx context.Context) ([]domain.Resource, error)
	ListPermissions(ctx context.Context) ([]domain.Permission, error)
	ListDropdownManagement(ctx context.Context) ([]DropdownManagementEntry, error)
	SetDropdownFrozen(ctx context.Context, dropdownKey string, frozen bool) error
	SetDropdownOptionActive(ctx context.Context, dropdownKey string, optionID int64, active bool) error
	IsDropdownFrozen(ctx context.Context, dropdownKey string) (bool, error)
	ListWorkOrderStatuses(ctx context.Context, query string) ([]LookupOption, error)
	ListJobTypes(ctx context.Context, query string) ([]LookupOption, error)
	ListItems(ctx context.Context, query string) ([]LookupOption, error)
	ListBrands(ctx context.Context, query string) ([]LookupOption, error)
	ListWorkers(ctx context.Context, query string) ([]LookupOption, error)
	ListPaymentMethods(ctx context.Context, query string) ([]LookupOption, error)
	ListLocations(ctx context.Context, query string) ([]LookupOption, error)
	ListPartsItemPresets(ctx context.Context, query string) ([]LookupOption, error)
	CreateWorkOrderStatus(ctx context.Context, label string) (LookupOption, error)
	CreateJobType(ctx context.Context, label string) (LookupOption, error)
	CreateItem(ctx context.Context, label string) (LookupOption, error)
	CreateBrand(ctx context.Context, label string) (LookupOption, error)
	CreateWorker(ctx context.Context, label string) (LookupOption, error)
	CreatePaymentMethod(ctx context.Context, label string) (LookupOption, error)
	CreateLocation(ctx context.Context, shelf string, floor int32) (LookupOption, error)
	CreatePartsItemPreset(ctx context.Context, label string) (LookupOption, error)
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
	return r.listLookup(ctx, `SELECT status_id, display_name FROM public.work_order_statuses WHERE is_active = true`, "display_name", query)
}

func (r *storeRepository) ListJobTypes(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT job_type_id, display_name FROM public.job_types WHERE is_active = true`, "display_name", query)
}

func (r *storeRepository) ListItems(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT item_id, item_name FROM public.items WHERE is_active = true`, "item_name", query)
}

func (r *storeRepository) ListBrands(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT brand_id, brand_name FROM public.brands WHERE is_active = true`, "brand_name", query)
}

func (r *storeRepository) ListWorkers(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT worker_id::bigint, worker_name FROM public.workers WHERE is_active = true`, "worker_name", query)
}

func (r *storeRepository) ListPaymentMethods(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT payment_method_id::bigint, display_name FROM public.payment_methods WHERE is_active = true`, "display_name", query)
}

func (r *storeRepository) ListLocations(ctx context.Context, query string) ([]LookupOption, error) {
	trimmed := strings.TrimSpace(query)
	args := make([]any, 0, 3)
	sql := `
		SELECT location_id::bigint, shelf, floor
		FROM public.locations
		WHERE is_active = true
	`
	if trimmed != "" {
		argPos := 1
		args = append(args, "%"+trimmed+"%")
		sql += `
			AND (
				shelf ILIKE $1 OR
				floor::text ILIKE $1 OR
				location_id::text ILIKE $1
		`
		argPos++
		if shelf, floor, ok := parseLocationSearch(trimmed); ok {
			sql += fmt.Sprintf(`
				OR (
					LOWER(BTRIM(shelf)) = $%d
					AND floor = $%d
				)
			`, argPos, argPos+1)
			args = append(args, strings.ToLower(strings.TrimSpace(shelf)), floor)
		}
		sql += `
			)
		`
	}
	sql += ` ORDER BY floor ASC, shelf ASC, location_id ASC`

	rows, err := r.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]LookupOption, 0)
	for rows.Next() {
		var id int64
		var shelf string
		var floor int32
		if err := rows.Scan(&id, &shelf, &floor); err != nil {
			return nil, err
		}
		out = append(out, LookupOption{
			ID:    id,
			Label: fmt.Sprintf("%s-%s", shelf, formatFloorLabel(floor)),
		})
	}
	return out, rows.Err()
}

func (r *storeRepository) ListPartsItemPresets(ctx context.Context, query string) ([]LookupOption, error) {
	return r.listLookup(ctx, `SELECT parts_item_preset_id::bigint, preset_name FROM public.parts_item_presets WHERE is_active = true`, "preset_name", query)
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
		INSERT INTO public.work_order_statuses(status_key, display_name, is_active)
		VALUES($1, $2, true)
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
		INSERT INTO public.job_types(job_type_key, display_name, is_active)
		VALUES($1, $2, true)
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
		INSERT INTO public.workers(worker_name, is_active)
		VALUES($1, true)
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

func (r *storeRepository) CreateLocation(ctx context.Context, shelf string, floor int32) (LookupOption, error) {
	value := strings.TrimSpace(shelf)
	codeBase := slugify(value)
	if codeBase == "" {
		codeBase = "shelf"
	}
	locationCode := fmt.Sprintf("loc_%d_%s", floor, codeBase)
	var option LookupOption
	var createdShelf string
	var createdFloor int32
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.locations(location_code, shelf, floor, is_active)
		VALUES($1, $2, $3, true)
		RETURNING location_id::bigint, shelf, floor
	`, locationCode, value, floor).Scan(&option.ID, &createdShelf, &createdFloor)
	if err != nil {
		return option, err
	}
	option.Label = fmt.Sprintf("%s-%s", createdShelf, formatFloorLabel(createdFloor))
	return option, err
}

func (r *storeRepository) CreatePartsItemPreset(ctx context.Context, label string) (LookupOption, error) {
	value := strings.TrimSpace(label)
	var option LookupOption
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.parts_item_presets(preset_name, is_active)
		VALUES($1, true)
		RETURNING parts_item_preset_id::bigint, preset_name
	`, value).Scan(&option.ID, &option.Label)
	return option, err
}

func (r *storeRepository) ListDropdownManagement(ctx context.Context) ([]DropdownManagementEntry, error) {
	out := make([]DropdownManagementEntry, 0, len(managedDropdownSpecs))
	for _, spec := range managedDropdownSpecs {
		var isFrozen bool
		if err := r.db.QueryRow(ctx, `
			SELECT COALESCE(
				(SELECT is_frozen FROM public.dropdown_management_settings WHERE dropdown_key = $1),
				false
			)
		`, spec.Key).Scan(&isFrozen); err != nil {
			return nil, err
		}

		rows, err := r.db.Query(ctx, fmt.Sprintf(`
			SELECT %s::bigint, %s, is_active
			FROM public.%s
			ORDER BY %s ASC, %s ASC
		`, spec.IDColumn, spec.LabelSQL, spec.Table, spec.LabelSQL, spec.IDColumn))
		if err != nil {
			return nil, err
		}

		options := make([]ManagedLookupOption, 0)
		for rows.Next() {
			var option ManagedLookupOption
			if err := rows.Scan(&option.ID, &option.Label, &option.IsActive); err != nil {
				rows.Close()
				return nil, err
			}
			options = append(options, option)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()

		out = append(out, DropdownManagementEntry{
			Key:      spec.Key,
			Label:    spec.Label,
			IsFrozen: isFrozen,
			Options:  options,
		})
	}
	return out, nil
}

func (r *storeRepository) SetDropdownFrozen(ctx context.Context, dropdownKey string, frozen bool) error {
	if _, ok := getDropdownSpec(dropdownKey); !ok {
		return ErrUnknownDropdownKey
	}

	_, err := r.db.Exec(ctx, `
		INSERT INTO public.dropdown_management_settings(dropdown_key, is_frozen, updated_at)
		VALUES($1, $2, now())
		ON CONFLICT (dropdown_key)
		DO UPDATE SET
			is_frozen = EXCLUDED.is_frozen,
			updated_at = now()
	`, dropdownKey, frozen)
	return err
}

func (r *storeRepository) SetDropdownOptionActive(ctx context.Context, dropdownKey string, optionID int64, active bool) error {
	spec, ok := getDropdownSpec(dropdownKey)
	if !ok {
		return ErrUnknownDropdownKey
	}

	sql := fmt.Sprintf(`
		UPDATE public.%s
		SET is_active = $1
		WHERE %s = $2
	`, spec.Table, spec.IDColumn)
	cmd, err := r.db.Exec(ctx, sql, active, optionID)
	if err != nil {
		return err
	}
	if cmd.RowsAffected() == 0 {
		return ErrDropdownOptionNotFound
	}
	return nil
}

func (r *storeRepository) IsDropdownFrozen(ctx context.Context, dropdownKey string) (bool, error) {
	if _, ok := getDropdownSpec(dropdownKey); !ok {
		return false, ErrUnknownDropdownKey
	}

	var frozen bool
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(
			(SELECT is_frozen FROM public.dropdown_management_settings WHERE dropdown_key = $1),
			false
		)
	`, dropdownKey).Scan(&frozen)
	return frozen, err
}

func getDropdownSpec(key string) (dropdownSpec, bool) {
	for _, spec := range managedDropdownSpecs {
		if spec.Key == key {
			return spec, true
		}
	}
	return dropdownSpec{}, false
}

func formatFloorLabel(floor int32) string {
	if floor == 0 {
		return "FLOOR"
	}
	return fmt.Sprintf("%d", floor)
}

func parseLocationSearch(raw string) (string, int32, bool) {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return "", 0, false
	}
	if strings.HasSuffix(value, "floor") {
		shelf := strings.TrimSpace(strings.TrimSuffix(value, "floor"))
		shelf = strings.Trim(shelf, "-_ ")
		if shelf == "" {
			return "", 0, false
		}
		return shelf, 0, true
	}

	lastDigit := -1
	for i := len(value) - 1; i >= 0; i-- {
		ch := value[i]
		if ch >= '0' && ch <= '9' {
			lastDigit = i
			continue
		}
		if lastDigit != -1 {
			break
		}
	}
	if lastDigit == -1 {
		return "", 0, false
	}
	firstDigit := lastDigit
	for i := lastDigit; i >= 0; i-- {
		ch := value[i]
		if ch >= '0' && ch <= '9' {
			firstDigit = i
			continue
		}
		break
	}
	suffix := value[firstDigit : lastDigit+1]
	shelf := strings.TrimSpace(value[:firstDigit])
	shelf = strings.Trim(shelf, "-_ ")
	if shelf == "" {
		return "", 0, false
	}
	var floor int32
	if _, err := fmt.Sscanf(suffix, "%d", &floor); err != nil {
		return "", 0, false
	}
	return shelf, floor, true
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

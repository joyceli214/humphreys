package catalog

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (r *storeRepository) ListCities(ctx context.Context, province, query string) ([]LookupOption, error) {
	// Escape user input so SQL LIKE metacharacters are searched literally.
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.TrimSpace(query))
	rows, err := r.db.Query(ctx, `
		SELECT id, name
		FROM public.cities
		WHERE lower(province) = lower($1) AND name ILIKE $2
		ORDER BY (name ILIKE $3) DESC, lower(name), name, id
	`, strings.TrimSpace(province), "%"+escaped+"%", escaped+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	options := make([]LookupOption, 0)
	for rows.Next() {
		var option LookupOption
		if err := rows.Scan(&option.ID, &option.Label); err != nil {
			return nil, err
		}
		options = append(options, option)
	}
	return options, rows.Err()
}

func (r *storeRepository) CreateCity(ctx context.Context, province, name string) (LookupOption, error) {
	province = strings.TrimSpace(province)
	name = strings.TrimSpace(name)
	var option LookupOption
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.cities(province, name)
		VALUES (COALESCE((SELECT province FROM public.cities WHERE lower(province) = lower($1) LIMIT 1), $1), $2)
		ON CONFLICT DO NOTHING
		RETURNING id, name
	`, province, name).Scan(&option.ID, &option.Label)
	if errors.Is(err, pgx.ErrNoRows) {
		// A separate statement sees a concurrent insert after ON CONFLICT waits.
		err = r.db.QueryRow(ctx, `
			SELECT id, name FROM public.cities
			WHERE lower(province) = lower($1) AND lower(name) = lower($2)
		`, province, name).Scan(&option.ID, &option.Label)
	}
	return option, err
}

package userpreferences

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Get(ctx context.Context, userID string, key string) (json.RawMessage, bool, error) {
	var value []byte
	err := r.db.QueryRow(
		ctx,
		`SELECT preference_value FROM public.user_preferences WHERE user_id = $1::uuid AND preference_key = $2`,
		userID,
		key,
	).Scan(&value)
	if err == pgx.ErrNoRows {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return json.RawMessage(value), true, nil
}

func (r *Repository) Upsert(ctx context.Context, userID string, key string, value json.RawMessage) (json.RawMessage, error) {
	var saved []byte
	err := r.db.QueryRow(
		ctx,
		`
		INSERT INTO public.user_preferences (user_id, preference_key, preference_value)
		VALUES ($1::uuid, $2, $3::jsonb)
		ON CONFLICT (user_id, preference_key)
		DO UPDATE SET preference_value = EXCLUDED.preference_value, updated_at = now()
		RETURNING preference_value
		`,
		userID,
		key,
		string(value),
	).Scan(&saved)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(saved), nil
}

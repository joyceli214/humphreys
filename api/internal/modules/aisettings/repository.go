package aisettings

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	keyOpenRouterAPIKey       = "openrouter_api_key"
	keyOpenRouterModel        = "openrouter_model"
	keyWorkOrderSummaryPrompt = "work_order_summary_prompt"
	keyWorkDonePrompt         = "work_done_prompt"
)

type Settings struct {
	OpenRouterAPIKey       string    `json:"-"`
	HasOpenRouterAPIKey    bool      `json:"has_openrouter_api_key"`
	OpenRouterModel        string    `json:"openrouter_model"`
	WorkOrderSummaryPrompt string    `json:"work_order_summary_prompt"`
	WorkDonePrompt         string    `json:"work_done_prompt"`
	UpdatedAt              time.Time `json:"updated_at"`
}

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) Get(ctx context.Context) (Settings, error) {
	rows, err := r.db.Query(ctx, `
		SELECT setting_key, setting_value, updated_at
		FROM public.ai_settings
		WHERE setting_key = ANY($1)
	`, []string{
		keyOpenRouterAPIKey,
		keyOpenRouterModel,
		keyWorkOrderSummaryPrompt,
		keyWorkDonePrompt,
	})
	if err != nil {
		return Settings{}, err
	}
	defer rows.Close()

	item := Settings{}
	for rows.Next() {
		var key string
		var value string
		var updatedAt time.Time
		if err := rows.Scan(&key, &value, &updatedAt); err != nil {
			return Settings{}, err
		}
		if updatedAt.After(item.UpdatedAt) {
			item.UpdatedAt = updatedAt
		}
		switch key {
		case keyOpenRouterAPIKey:
			item.OpenRouterAPIKey = value
		case keyOpenRouterModel:
			item.OpenRouterModel = value
		case keyWorkOrderSummaryPrompt:
			item.WorkOrderSummaryPrompt = value
		case keyWorkDonePrompt:
			item.WorkDonePrompt = value
		}
	}
	if err := rows.Err(); err != nil {
		return Settings{}, err
	}
	item.HasOpenRouterAPIKey = item.OpenRouterAPIKey != ""
	return item, nil
}

func (r *Repository) UpsertDefaults(ctx context.Context, model, summaryPrompt, workDonePrompt string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.ai_settings (setting_key, setting_value)
		VALUES
			($1, $2),
			($3, $4),
			($5, $6)
		ON CONFLICT (setting_key) DO NOTHING
	`,
		keyOpenRouterModel, model,
		keyWorkOrderSummaryPrompt, summaryPrompt,
		keyWorkDonePrompt, workDonePrompt,
	)
	return err
}

func (r *Repository) Update(ctx context.Context, item Settings, updateKey bool) (Settings, error) {
	batch := [][]string{
		{keyOpenRouterModel, item.OpenRouterModel},
		{keyWorkOrderSummaryPrompt, item.WorkOrderSummaryPrompt},
		{keyWorkDonePrompt, item.WorkDonePrompt},
	}
	if updateKey {
		batch = append(batch, []string{keyOpenRouterAPIKey, item.OpenRouterAPIKey})
	}

	for _, entry := range batch {
		if _, err := r.db.Exec(ctx, `
			INSERT INTO public.ai_settings (setting_key, setting_value, updated_at)
			VALUES ($1, $2, now())
			ON CONFLICT (setting_key) DO UPDATE
			SET setting_value = EXCLUDED.setting_value,
			    updated_at = now()
		`, entry[0], entry[1]); err != nil {
			return Settings{}, err
		}
	}
	return r.Get(ctx)
}

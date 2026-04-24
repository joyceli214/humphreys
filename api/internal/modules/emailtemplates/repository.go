package emailtemplates

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Template struct {
	Key             string    `json:"key"`
	Label           string    `json:"label"`
	SubjectTemplate string    `json:"subject_template"`
	BodyTemplate    string    `json:"body_template"`
	UpdatedAt       time.Time `json:"updated_at"`
}

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

func (r *Repository) List(ctx context.Context) ([]Template, error) {
	rows, err := r.db.Query(ctx, `
		SELECT template_key, label, subject_template, body_template, updated_at
		FROM public.email_templates
		ORDER BY CASE template_key WHEN 'job_started' THEN 1 WHEN 'job_completed' THEN 2 ELSE 99 END, label
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Template{}
	for rows.Next() {
		var item Template
		if err := rows.Scan(&item.Key, &item.Label, &item.SubjectTemplate, &item.BodyTemplate, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repository) Update(ctx context.Context, key, subject, body string) (Template, error) {
	var item Template
	err := r.db.QueryRow(ctx, `
		UPDATE public.email_templates
		SET subject_template = $2, body_template = $3, updated_at = now()
		WHERE template_key = $1
		RETURNING template_key, label, subject_template, body_template, updated_at
	`, key, subject, body).Scan(&item.Key, &item.Label, &item.SubjectTemplate, &item.BodyTemplate, &item.UpdatedAt)
	if err == pgx.ErrNoRows {
		return Template{}, ErrUnknownTemplate
	}
	return item, err
}

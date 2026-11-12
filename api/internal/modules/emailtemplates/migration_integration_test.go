package emailtemplates

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EMAIL_TEMPLATES_TEST_DATABASE_URL (or ASK_CONTEXT_TEST_DATABASE_URL) names an
// administrative connection. Each run creates and drops its own database.
func emailTemplatesTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("EMAIL_TEMPLATES_TEST_DATABASE_URL")
	if url == "" {
		url = os.Getenv("ASK_CONTEXT_TEST_DATABASE_URL")
	}
	if url == "" {
		t.Skip("set EMAIL_TEMPLATES_TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = admin.Close(ctx) })
	database := "email_templates_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{database}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP DATABASE "+pgx.Identifier{database}.Sanitize()); err != nil {
			t.Error(err)
		}
	})
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = database
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	for _, file := range []string{"029_email_templates.sql", "044_email_templates_kinds.sql", "044_email_templates_kinds.sql"} { // twice: idempotent
		if _, err := db.Exec(ctx, readMigration(t, file)); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
	}
	return db
}

func TestMigration044Postgres(t *testing.T) {
	db := emailTemplatesTestDB(t)
	ctx := context.Background()
	repo := NewRepository(db)

	items, err := repo.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, item := range items {
		got = append(got, item.Kind+":"+item.Key+":"+item.Label)
	}
	want := "customer:job_started:Job Started Email,customer:job_completed:Job Completed Email," +
		"supplier:supplier_parts_inquiry:Parts inquiry,supplier:supplier_order_followup:Order follow-up," +
		"shop:shop_approval:Ask for approval,shop:shop_update:Ask for an update"
	if strings.Join(got, ",") != want {
		t.Fatalf("list = %v", got)
	}
	if !strings.Contains(items[0].BodyTemplate, "We have started work on your {{equipment_name}}.") {
		t.Error("job_started body changed")
	}

	if _, err := db.Exec(ctx, `INSERT INTO public.email_templates (template_key, label, subject_template, body_template) VALUES ('custom', 'x', 'x', 'x')`); err == nil {
		t.Error("constraint must reject unknown keys")
	}
	if _, err := db.Exec(ctx, `UPDATE public.email_templates SET kind = 'other' WHERE template_key = 'shop_update'`); err == nil {
		t.Error("constraint must reject unknown kinds")
	}

	s := NewService(repo)
	saved, err := s.Update(ctx, "shop_update", "Please update", "Hi,\n\n{{job_cards}}\n\nThanks")
	if err != nil {
		t.Fatal(err)
	}
	if saved.Kind != KindShop || saved.SubjectTemplate != "Please update" {
		t.Fatalf("saved = %+v", saved)
	}
}

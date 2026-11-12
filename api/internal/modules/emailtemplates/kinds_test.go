package emailtemplates

import (
	"context"
	"errors"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func readMigration(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile("../../../migrations/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestMigration044KeysMatchKnownTemplates(t *testing.T) {
	sql := readMigration(t, "044_email_templates_kinds.sql")
	check := regexp.MustCompile(`(?s)chk_email_templates_template_key CHECK \(template_key IN \((.*?)\)\)`).FindStringSubmatch(sql)
	if check == nil {
		t.Fatal("044 must re-add chk_email_templates_template_key")
	}
	keys := regexp.MustCompile(`'([a-z_]+)'`).FindAllStringSubmatch(check[1], -1)
	got := []string{}
	for _, k := range keys {
		got = append(got, k[1])
	}
	want := []string{}
	for key := range templateKinds {
		want = append(want, key)
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("constraint keys %v, Go keys %v", got, want)
	}
	for _, idempotent := range []string{"ADD COLUMN IF NOT EXISTS kind", "DROP CONSTRAINT IF EXISTS chk_email_templates_template_key", "ON CONFLICT (template_key) DO NOTHING"} {
		if !strings.Contains(sql, idempotent) {
			t.Errorf("044 must contain %q", idempotent)
		}
	}
	insert := sql[strings.Index(sql, "INSERT INTO"):]
	if strings.Contains(sql, "UPDATE public.email_templates") || strings.Contains(insert, "'job_started'") || strings.Contains(insert, "'job_completed'") {
		t.Error("044 must not modify the live customer templates")
	}
	for _, banned := range []string{"HE-2207", "555", "example.test", "dave@", "justin@"} {
		if strings.Contains(sql, banned) {
			t.Errorf("044 must not ship preview example data %q", banned)
		}
	}
}

func TestMigration044DefaultBodiesPassValidation(t *testing.T) {
	sql := readMigration(t, "044_email_templates_kinds.sql")
	rows := regexp.MustCompile(`(?s)\(\s*'([a-z_]+)',\s*'([a-z]+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\s*\)`).FindAllStringSubmatch(sql, -1)
	if len(rows) != 4 {
		t.Fatalf("expected 4 inserted templates, got %d", len(rows))
	}
	for _, row := range rows {
		key, kind, body := row[1], row[2], row[5]
		if templateKinds[key] != kind {
			t.Errorf("%s: kind %q, Go says %q", key, kind, templateKinds[key])
		}
		if err := validateTemplateBody(kind, body); err != nil {
			t.Errorf("%s default body: %v", key, err)
		}
	}
}

func TestValidateTemplateBodyJobCards(t *testing.T) {
	cases := []struct {
		kind, body string
		ok         bool
	}{
		{"supplier", "Hi,\n\n{{job_cards}}\n\nThanks", true},
		{"shop", "Hi,\n\n{{ job\\_cards }}\n\nThanks", true}, // MDXEditor escapes underscores
		{"shop", "Hi, no slot", false},
		{"supplier", "{{job_cards}}\n\n{{job_cards}}", false},
		{"customer", "Hi {{customer_name}}", true},
		{"customer", "Hi\n\n{{job_cards}}", false},
	}
	for _, c := range cases {
		err := validateTemplateBody(c.kind, c.body)
		if c.ok && err != nil {
			t.Errorf("%s %q: unexpected %v", c.kind, c.body, err)
		}
		if !c.ok && !errors.Is(err, ErrJobCardsSlot) {
			t.Errorf("%s %q: want ErrJobCardsSlot, got %v", c.kind, c.body, err)
		}
	}
}

func TestServiceUpdateRejectsBadSlotBeforeTouchingDB(t *testing.T) {
	s := NewService(nil) // nil repo: must fail validation first
	ctx := context.Background()
	if _, err := s.Update(ctx, "shop_approval", "Subject", "No slot here"); !errors.Is(err, ErrJobCardsSlot) {
		t.Fatalf("want ErrJobCardsSlot, got %v", err)
	}
	if _, err := s.Update(ctx, "job_started", "Subject", "Hi\n{{job_cards}}"); !errors.Is(err, ErrJobCardsSlot) {
		t.Fatalf("customer body with slot: want ErrJobCardsSlot, got %v", err)
	}
	if _, err := s.Update(ctx, "nope", "Subject", "Body"); !errors.Is(err, ErrUnknownTemplate) {
		t.Fatalf("unknown key: want ErrUnknownTemplate, got %v", err)
	}
}

func TestRenderTestTemplateStringNewTokens(t *testing.T) {
	rendered := renderTestTemplateString("Jobs {{job_numbers}} (Acct {{account_number}}) {{recipient_name}} {{supplier_name}}\n\n{{job\\_cards}}")
	if strings.Contains(rendered, "{{") {
		t.Fatalf("expected all tokens rendered, got %q", rendered)
	}
	for _, want := range []string{"#1001, #1002", "Test Recipient", "Test Supplier", "Job #1001 · Sample item"} {
		if !strings.Contains(rendered, want) {
			t.Errorf("missing %q in %q", want, rendered)
		}
	}
	if strings.Contains(rendered, "HE-2207") {
		t.Error("must not use the preview example account")
	}
}

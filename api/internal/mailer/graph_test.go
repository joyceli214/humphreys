package mailer

import (
	"strings"
	"testing"
)

func TestMarkdownToEmailHTMLPreservesTelLinks(t *testing.T) {
	html := markdownToEmailHTML("Call [4162680598](tel:+14162680598)")

	if !strings.Contains(html, `<a href="tel:+14162680598">4162680598</a>`) {
		t.Fatalf("expected tel link anchor, got %s", html)
	}
}

func TestMarkdownToEmailHTMLPreservesMailtoLinks(t *testing.T) {
	html := markdownToEmailHTML("Email [service@example.com](mailto:service@example.com)")

	if !strings.Contains(html, `<a href="mailto:service@example.com">service@example.com</a>`) {
		t.Fatalf("expected mailto link anchor, got %s", html)
	}
}

func TestMarkdownToEmailHTMLPreservesLinksWithUnderscores(t *testing.T) {
	html := markdownToEmailHTML("Open [portal](https://example.com/customer_lookup?id=123)")

	if !strings.Contains(html, `<a href="https://example.com/customer_lookup?id=123">portal</a>`) {
		t.Fatalf("expected URL with underscore to survive, got %s", html)
	}
}

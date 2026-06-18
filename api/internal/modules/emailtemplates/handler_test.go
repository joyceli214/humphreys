package emailtemplates

import (
	"strings"
	"testing"
)

func TestRenderTestTemplateStringHandlesMarkdownEscapedVariables(t *testing.T) {
	rendered := renderTestTemplateString(`Hi {{customer\_name}}, job {{reference\\_id}}`)

	if strings.Contains(rendered, "{{") {
		t.Fatalf("expected all variables to render, got %q", rendered)
	}
	if !strings.Contains(rendered, "Test Customer") || !strings.Contains(rendered, "12345") {
		t.Fatalf("expected dummy values, got %q", rendered)
	}
}

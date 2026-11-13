package workorders

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const (
	// emailRewriteMaxBody caps the email body sent for an AI rewrite. Larger
	// than aiToolsMaxTextChars because supplier emails carry a parts table.
	// Mirrored in web/src/lib/ai-tools/limits.ts (EMAIL_REWRITE_BODY_MAX).
	emailRewriteMaxBody    = 6000
	emailRewriteMaxSubject = 300
)

// emailRewriteActions is the whitelist of pen-menu actions.
var emailRewriteActions = map[string]bool{
	"fix_grammar": true,
	"more_detail": true,
	"shorter":     true,
	"friendlier":  true,
}

var emailRewriteInstructions = map[string]string{
	"fix_grammar": "Fix grammar, spelling and punctuation only. Keep the wording and length otherwise the same.",
	"more_detail": "Make it a little more detailed and clear, using only facts already in the email.",
	"shorter":     "Make it shorter and simpler. Keep every fact, table row and blank.",
	"friendlier":  "Make the tone a little warmer and friendlier. Keep every fact, table row and blank.",
}

type emailRewriteRequest struct {
	Action  string `json:"action"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

type emailRewriteResponse struct {
	Body  string `json:"body"`
	Model string `json:"model"`
}

// emailBlankPattern matches a single-brace blank like {Qty} or {Part for #12}.
// Double-brace template variables ({{name}}) are not blanks.
var emailBlankPattern = regexp.MustCompile(`\{[^{}\n]{1,60}\}`)

// emailBlankTokens counts the single-brace blank tokens in s.
func emailBlankTokens(s string) map[string]int {
	out := make(map[string]int)
	for _, loc := range emailBlankPattern.FindAllStringIndex(s, -1) {
		if loc[0] > 0 && s[loc[0]-1] == '{' {
			continue
		}
		if loc[1] < len(s) && s[loc[1]] == '}' {
			continue
		}
		out[s[loc[0]:loc[1]]]++
	}
	return out
}

// sameBlankTokens reports whether a and b contain exactly the same blanks.
func sameBlankTokens(a, b string) bool {
	ta, tb := emailBlankTokens(a), emailBlankTokens(b)
	if len(ta) != len(tb) {
		return false
	}
	for k, v := range ta {
		if tb[k] != v {
			return false
		}
	}
	return true
}

// EmailRewrite runs one pen-menu action over a draft body. Only runs when the
// user asks. The reply is rejected (422) unless every {blank} survives.
func (h *Handler) EmailRewrite(c *gin.Context) {
	var req emailRewriteRequest
	if !bindAIToolsJSON(c, &req) {
		return
	}
	action := strings.TrimSpace(req.Action)
	if !emailRewriteActions[action] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown action"})
		return
	}
	body := strings.TrimSpace(req.Body)
	if body == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "body is required"})
		return
	}
	if utf8.RuneCountInString(body) > emailRewriteMaxBody {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("body is too long (max %d characters)", emailRewriteMaxBody)})
		return
	}
	subject := strings.TrimSpace(req.Subject)
	if utf8.RuneCountInString(subject) > emailRewriteMaxSubject {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("subject is too long (max %d characters)", emailRewriteMaxSubject)})
		return
	}
	settings, err := h.getAISettings(c)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI settings"})
		return
	}
	if !settings.HasOpenRouterAPIKey && strings.TrimSpace(settings.OpenRouterAPIKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI is not configured. Add an OpenRouter API key in AI Settings."})
		return
	}
	prompt := "Action: " + emailRewriteInstructions[action] + "\n\nSubject: " + subject + "\n\nBody:\n" + body + "\n"
	text, model, err := h.generateOpenRouterTextOnce(c, settings, emailRewriteSystemPrompt(), prompt, 2000)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": aiErrorMessage(err)})
		return
	}
	var out struct {
		Body string `json:"body"`
	}
	if err := parseStrictLLMJSON(text, &out); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	rewritten := strings.TrimSpace(out.Body)
	if rewritten == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "AI returned an empty email; try again"})
		return
	}
	if utf8.RuneCountInString(rewritten) > emailRewriteMaxBody {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "AI made the email too long; try again"})
		return
	}
	if !sameBlankTokens(body, rewritten) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "AI changed the blanks; try again"})
		return
	}
	c.JSON(http.StatusOK, emailRewriteResponse{Body: rewritten, Model: model})
}

func emailRewriteSystemPrompt() string {
	return "You rewrite a repair-shop email written by the shop owner, following one action. " +
		"Respond with STRICT JSON only (no prose, no markdown) of the form {\"body\":\"...\"}. " +
		"Rules: keep every placeholder in curly braces such as {Name}, {Qty} or {Part for #12} exactly as written, the same number of times. " +
		"Do not invent prices, dates, part numbers, names, phone numbers or promises that are not already in the email. " +
		"Keep job numbers, amounts and any plain-text table rows (lines with |) unchanged. " +
		"Keep the sign-off. Use short, clear sentences."
}

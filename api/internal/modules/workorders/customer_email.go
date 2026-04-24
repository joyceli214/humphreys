package workorders

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"

	"humphreys/api/internal/domain"
)

const (
	customerEmailJobStarted   = "job_started"
	customerEmailJobCompleted = "job_completed"
)

var ErrEmailNotConfigured = errors.New("customer email sending is not configured")

type graphEmailClient struct {
	tenantID     string
	clientID     string
	clientSecret string
	senderEmail  string
	httpClient   *http.Client
}

type customerEmailMessage struct {
	To      string
	Subject string
	Body    string
}

func newGraphEmailClientFromEnv(httpClient *http.Client) *graphEmailClient {
	return &graphEmailClient{
		tenantID:     strings.TrimSpace(os.Getenv("MICROSOFT_TENANT_ID")),
		clientID:     strings.TrimSpace(os.Getenv("MICROSOFT_CLIENT_ID")),
		clientSecret: strings.TrimSpace(os.Getenv("MICROSOFT_CLIENT_SECRET")),
		senderEmail:  strings.TrimSpace(os.Getenv("MICROSOFT_SENDER_EMAIL")),
		httpClient:   httpClient,
	}
}

func (c *graphEmailClient) configured() bool {
	return c != nil && c.tenantID != "" && c.clientID != "" && c.clientSecret != "" && c.senderEmail != ""
}

func (c *graphEmailClient) Send(ctx context.Context, msg customerEmailMessage) error {
	if !c.configured() {
		return ErrEmailNotConfigured
	}

	token, err := c.accessToken(ctx)
	if err != nil {
		return err
	}

	payload := map[string]any{
		"message": map[string]any{
			"subject": msg.Subject,
			"body": map[string]string{
				"contentType": "Text",
				"content":     msg.Body,
			},
			"toRecipients": []map[string]any{
				{
					"emailAddress": map[string]string{
						"address": msg.To,
					},
				},
			},
		},
		"saveToSentItems": true,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	endpoint := fmt.Sprintf("https://graph.microsoft.com/v1.0/users/%s/sendMail", url.PathEscape(c.senderEmail))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusAccepted {
		return nil
	}

	responseBody, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
	return fmt.Errorf("microsoft graph sendMail failed: %s: %s", res.Status, strings.TrimSpace(string(responseBody)))
}

func (c *graphEmailClient) accessToken(ctx context.Context) (string, error) {
	form := url.Values{}
	form.Set("client_id", c.clientID)
	form.Set("client_secret", c.clientSecret)
	form.Set("scope", "https://graph.microsoft.com/.default")
	form.Set("grant_type", "client_credentials")

	endpoint := fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/token", url.PathEscape(c.tenantID))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	var tokenResponse struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&tokenResponse); err != nil {
		return "", err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("microsoft token request failed: %s: %s", tokenResponse.Error, tokenResponse.Description)
	}
	if tokenResponse.AccessToken == "" {
		return "", errors.New("microsoft token response did not include an access token")
	}
	return tokenResponse.AccessToken, nil
}

func buildCustomerEmailMessage(item domain.WorkOrderDetail, template string) (customerEmailMessage, error) {
	email := strings.TrimSpace(stringValue(item.Customer.Email))
	if email == "" {
		return customerEmailMessage{}, errors.New("customer email missing")
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return customerEmailMessage{}, ErrInvalidEmailFormat
	}

	customerName := emailCustomerName(item)
	equipmentName := emailEquipmentName(item)
	details := emailJobDetails(item)

	switch template {
	case customerEmailJobStarted:
		return customerEmailMessage{
			To:      email,
			Subject: fmt.Sprintf("Job #%d started - %s", item.ReferenceID, equipmentName),
			Body: strings.Join([]string{
				fmt.Sprintf("Hi %s,", customerName),
				"",
				fmt.Sprintf("We have started work on your %s.", equipmentName),
				"",
				"Job details:",
				details,
				"",
				"We will contact you if we need approval for parts or additional work.",
				"",
				"Thank you,",
				"Humphreys Electronics",
			}, "\n"),
		}, nil
	case customerEmailJobCompleted:
		return customerEmailMessage{
			To:      email,
			Subject: fmt.Sprintf("Job #%d completed - %s", item.ReferenceID, equipmentName),
			Body: strings.Join([]string{
				fmt.Sprintf("Hi %s,", customerName),
				"",
				fmt.Sprintf("Your repair job for %s is complete.", equipmentName),
				"",
				"Job details:",
				details,
				"",
				"Please contact us if you have any questions or would like to arrange pickup or delivery.",
				"",
				"Thank you,",
				"Humphreys Electronics",
			}, "\n"),
		}, nil
	default:
		return customerEmailMessage{}, errors.New("template must be job_started or job_completed")
	}
}

func emailCustomerName(item domain.WorkOrderDetail) string {
	name := strings.TrimSpace(strings.Join([]string{stringValue(item.Customer.FirstName), stringValue(item.Customer.LastName)}, " "))
	if name == "" {
		return "there"
	}
	return name
}

func emailEquipmentName(item domain.WorkOrderDetail) string {
	parts := []string{
		strings.TrimSpace(strings.Join(item.BrandNames, " ")),
		strings.TrimSpace(stringValue(item.ItemName)),
		strings.TrimSpace(stringValue(item.ModelNumber)),
	}
	nonEmpty := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			nonEmpty = append(nonEmpty, part)
		}
	}
	if len(nonEmpty) == 0 {
		return "your item"
	}
	return strings.Join(nonEmpty, " ")
}

func emailJobDetails(item domain.WorkOrderDetail) string {
	details := []string{
		fmt.Sprintf("Job ID: %d", item.ReferenceID),
		fmt.Sprintf("Item: %s", emailEquipmentName(item)),
		fmt.Sprintf("Status: %s", stringValueOrDefault(item.StatusName, "-")),
		fmt.Sprintf("Serial: %s", stringValueOrDefault(item.SerialNumber, "-")),
		fmt.Sprintf("Problem: %s", markdownToEmailPlainText(item.ProblemDescription)),
	}

	workDone := markdownToEmailPlainText(item.WorkDone)
	if workDone != "-" {
		details = append(details, fmt.Sprintf("Work done: %s", workDone))
	}

	if item.PartsTotal != nil || item.DeliveryTotal != nil || item.LabourTotal != nil {
		total := float64Value(item.PartsTotal) + float64Value(item.DeliveryTotal) + float64Value(item.LabourTotal)
		details = append(details, fmt.Sprintf("Estimated total before deposit: %s", formatEmailCurrency(total*1.13)))
	}

	if item.Deposit > 0 {
		details = append(details, fmt.Sprintf("Deposit: %s", formatEmailCurrency(item.Deposit)))
	}

	return strings.Join(details, "\n")
}

var (
	escapedLineBreakPattern     = regexp.MustCompile(`\\r\\n|\\n|\\r`)
	hexEntityPattern            = regexp.MustCompile(`&#x([0-9a-fA-F]+);`)
	decimalEntityPattern        = regexp.MustCompile(`&#([0-9]+);`)
	markdownImagePattern        = regexp.MustCompile(`!\[([^\]]*)\]\(([^)]+)\)`)
	markdownLinkPattern         = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
	inlineCodePattern           = regexp.MustCompile("`([^`]+)`")
	boldStarPattern             = regexp.MustCompile(`\*\*([^*]+)\*\*`)
	boldUnderscorePattern       = regexp.MustCompile(`__([^_]+)__`)
	italicStarPattern           = regexp.MustCompile(`\*([^*]+)\*`)
	italicUnderscorePattern     = regexp.MustCompile(`_([^_]+)_`)
	strikethroughPattern        = regexp.MustCompile(`~~([^~]+)~~`)
	escapedMarkdownCharPattern  = regexp.MustCompile(`\\([\\` + "`" + `*_{}\[\]()#+\-.!>])`)
	htmlTagPattern              = regexp.MustCompile(`<[^>]+>`)
	headingPattern              = regexp.MustCompile(`^\s{0,3}#{1,6}\s+`)
	blockquotePattern           = regexp.MustCompile(`^\s{0,3}>\s?`)
	unorderedListPattern        = regexp.MustCompile(`^\s{0,3}[-*+]\s+`)
	orderedListPattern          = regexp.MustCompile(`^\s{0,3}(\d+)\.\s+`)
	tableStartPattern           = regexp.MustCompile(`^\s{0,3}\|`)
	tableEndPattern             = regexp.MustCompile(`\|\s*$`)
	tableSeparatorPattern       = regexp.MustCompile(`\s*\|\s*`)
	fencedCodeBlockStartPattern = regexp.MustCompile(`^\s*` + "```")
)

func markdownToEmailPlainText(value *string) string {
	if value == nil {
		return "-"
	}
	normalized := normalizeEmailMarkdownInput(*value)
	if normalized == "" {
		return "-"
	}

	lines := strings.Split(normalized, "\n")
	output := make([]string, 0, len(lines))
	inFence := false
	for _, rawLine := range lines {
		line := strings.TrimRight(rawLine, " \t")
		if fencedCodeBlockStartPattern.MatchString(line) {
			inFence = !inFence
			continue
		}
		if inFence {
			output = append(output, line)
			continue
		}
		if isEmailMarkdownHorizontalRule(line) {
			output = append(output, "")
			continue
		}

		cleaned := headingPattern.ReplaceAllString(line, "")
		cleaned = blockquotePattern.ReplaceAllString(cleaned, "")
		cleaned = unorderedListPattern.ReplaceAllString(cleaned, "• ")
		cleaned = orderedListPattern.ReplaceAllString(cleaned, "$1. ")
		cleaned = tableStartPattern.ReplaceAllString(cleaned, "")
		cleaned = tableEndPattern.ReplaceAllString(cleaned, "")
		cleaned = tableSeparatorPattern.ReplaceAllString(cleaned, " | ")
		cleaned = stripInlineEmailMarkdown(cleaned)
		cleaned = htmlTagPattern.ReplaceAllString(cleaned, "")
		cleaned = decodeEmailHTMLEntities(cleaned)
		output = append(output, cleaned)
	}

	compact := strings.TrimSpace(compactEmailBlankLines(strings.Join(output, "\n")))
	if compact == "" {
		return "-"
	}
	return compact
}

func isEmailMarkdownHorizontalRule(value string) bool {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) < 3 {
		return false
	}
	first := trimmed[0]
	if first != '-' && first != '*' && first != '_' {
		return false
	}
	for i := 1; i < len(trimmed); i++ {
		if trimmed[i] != first {
			return false
		}
	}
	return true
}

func normalizeEmailMarkdownInput(value string) string {
	raw := strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\r", "\n")
	if !strings.Contains(raw, "\n") && escapedLineBreakPattern.MatchString(raw) {
		raw = strings.ReplaceAll(raw, `\r\n`, "\n")
		raw = strings.ReplaceAll(raw, `\n`, "\n")
		raw = strings.ReplaceAll(raw, `\r`, "\n")
		raw = strings.ReplaceAll(raw, `\t`, "\t")
	}
	return strings.TrimSpace(decodeEmailHTMLEntities(decodeEmailHTMLEntities(raw)))
}

func stripInlineEmailMarkdown(value string) string {
	out := markdownImagePattern.ReplaceAllString(value, "$1 ($2)")
	out = markdownLinkPattern.ReplaceAllString(out, "$1 ($2)")
	out = inlineCodePattern.ReplaceAllString(out, "$1")
	out = boldStarPattern.ReplaceAllString(out, "$1")
	out = boldUnderscorePattern.ReplaceAllString(out, "$1")
	out = italicStarPattern.ReplaceAllString(out, "$1")
	out = italicUnderscorePattern.ReplaceAllString(out, "$1")
	out = strikethroughPattern.ReplaceAllString(out, "$1")
	out = escapedMarkdownCharPattern.ReplaceAllString(out, "$1")
	return out
}

func decodeEmailHTMLEntities(value string) string {
	out := hexEntityPattern.ReplaceAllStringFunc(value, func(match string) string {
		parts := hexEntityPattern.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		codepoint, err := strconv.ParseInt(parts[1], 16, 32)
		if err != nil {
			return match
		}
		return string(rune(codepoint))
	})
	out = decimalEntityPattern.ReplaceAllStringFunc(out, func(match string) string {
		parts := decimalEntityPattern.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		codepoint, err := strconv.ParseInt(parts[1], 10, 32)
		if err != nil {
			return match
		}
		return string(rune(codepoint))
	})
	replacements := map[string]string{
		"&nbsp;": " ",
		"&quot;": `"`,
		"&#39;":  "'",
		"&lt;":   "<",
		"&gt;":   ">",
		"&amp;":  "&",
	}
	for old, replacement := range replacements {
		out = strings.ReplaceAll(out, old, replacement)
		out = strings.ReplaceAll(out, strings.ToUpper(old), replacement)
	}
	return out
}

func compactEmailBlankLines(value string) string {
	for strings.Contains(value, "\n\n\n") {
		value = strings.ReplaceAll(value, "\n\n\n", "\n\n")
	}
	return value
}

func formatEmailCurrency(value float64) string {
	return fmt.Sprintf("$%.2f CAD", value)
}

func float64Value(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func stringValueOrDefault(value *string, fallback string) string {
	trimmed := strings.TrimSpace(stringValue(value))
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

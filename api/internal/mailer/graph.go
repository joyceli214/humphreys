package mailer

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

var ErrNotConfigured = errors.New("email sending is not configured")

type Message struct {
	To      string
	Subject string
	Body    string
}

type GraphClient struct {
	tenantID     string
	clientID     string
	clientSecret string
	senderEmail  string
	httpClient   *http.Client
}

func NewGraphClientFromEnv(httpClient *http.Client) *GraphClient {
	return &GraphClient{
		tenantID:     strings.TrimSpace(os.Getenv("MICROSOFT_TENANT_ID")),
		clientID:     strings.TrimSpace(os.Getenv("MICROSOFT_CLIENT_ID")),
		clientSecret: strings.TrimSpace(os.Getenv("MICROSOFT_CLIENT_SECRET")),
		senderEmail:  strings.TrimSpace(os.Getenv("MICROSOFT_SENDER_EMAIL")),
		httpClient:   httpClient,
	}
}

func (c *GraphClient) configured() bool {
	return c != nil && c.tenantID != "" && c.clientID != "" && c.clientSecret != "" && c.senderEmail != ""
}

func (c *GraphClient) Send(ctx context.Context, msg Message) error {
	if !c.configured() {
		return ErrNotConfigured
	}

	token, err := c.accessToken(ctx)
	if err != nil {
		return err
	}

	payload := map[string]any{
		"message": map[string]any{
			"subject": msg.Subject,
			"body": map[string]string{
				"contentType": "HTML",
				"content":     markdownToEmailHTML(msg.Body),
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

func (c *GraphClient) accessToken(ctx context.Context) (string, error) {
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

func markdownToEmailHTML(value string) string {
	normalized := normalizeEmailMarkdownInput(value)
	if normalized == "" {
		return ""
	}

	lines := strings.Split(normalized, "\n")
	blocks := make([]string, 0, len(lines))
	paragraph := make([]string, 0, 4)
	listItems := make([]string, 0, 4)

	flushParagraph := func() {
		if len(paragraph) == 0 {
			return
		}
		blocks = append(blocks, "<p>"+formatInlineEmailMarkdown(strings.Join(paragraph, "\n"))+"</p>")
		paragraph = paragraph[:0]
	}
	flushList := func() {
		if len(listItems) == 0 {
			return
		}
		blocks = append(blocks, "<ul>"+strings.Join(listItems, "")+"</ul>")
		listItems = listItems[:0]
	}

	for _, rawLine := range lines {
		line := strings.TrimRight(rawLine, " \t")
		if strings.TrimSpace(line) == "" {
			flushParagraph()
			flushList()
			continue
		}

		if match := unorderedListPattern.FindStringIndex(line); match != nil && match[0] == 0 {
			flushParagraph()
			item := unorderedListPattern.ReplaceAllString(line, "")
			listItems = append(listItems, "<li>"+formatInlineEmailMarkdown(item)+"</li>")
			continue
		}
		if match := orderedListPattern.FindStringIndex(line); match != nil && match[0] == 0 {
			flushParagraph()
			item := orderedListPattern.ReplaceAllString(line, "")
			listItems = append(listItems, "<li>"+formatInlineEmailMarkdown(item)+"</li>")
			continue
		}

		flushList()
		paragraph = append(paragraph, line)
	}

	flushParagraph()
	flushList()

	if len(blocks) == 0 {
		return ""
	}
	return strings.Join(blocks, "\n")
}

func formatInlineEmailMarkdown(value string) string {
	links := make([]string, 0, 4)
	value = markdownLinkPattern.ReplaceAllStringFunc(value, func(match string) string {
		parts := markdownLinkPattern.FindStringSubmatch(match)
		if len(parts) != 3 {
			return match
		}
		href := strings.TrimSpace(parts[2])
		if !isSafeEmailHref(href) {
			return parts[1]
		}
		placeholder := fmt.Sprintf("\x00LINK%d\x00", len(links))
		links = append(links, fmt.Sprintf(`<a href="%s">%s</a>`, html.EscapeString(href), html.EscapeString(parts[1])))
		return placeholder
	})

	escaped := html.EscapeString(value)
	escaped = inlineCodePattern.ReplaceAllString(escaped, "<code>$1</code>")
	escaped = boldStarPattern.ReplaceAllString(escaped, "<strong>$1</strong>")
	escaped = boldUnderscorePattern.ReplaceAllString(escaped, "<strong>$1</strong>")
	escaped = italicStarPattern.ReplaceAllString(escaped, "<em>$1</em>")
	escaped = italicUnderscorePattern.ReplaceAllString(escaped, "<em>$1</em>")
	escaped = strings.ReplaceAll(escaped, "\n", "<br>")
	escaped = escapedMarkdownCharPattern.ReplaceAllString(escaped, "$1")
	for index, link := range links {
		escaped = strings.ReplaceAll(escaped, fmt.Sprintf("\x00LINK%d\x00", index), link)
	}
	return escaped
}

func isSafeEmailHref(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https", "mailto", "tel":
		return true
	default:
		return false
	}
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

func decodeEmailHTMLEntities(value string) string {
	out := hexEntityPattern.ReplaceAllStringFunc(value, func(match string) string {
		parts := hexEntityPattern.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		code, err := strconv.ParseInt(parts[1], 16, 32)
		if err != nil {
			return match
		}
		return string(rune(code))
	})
	out = decimalEntityPattern.ReplaceAllStringFunc(out, func(match string) string {
		parts := decimalEntityPattern.FindStringSubmatch(match)
		if len(parts) != 2 {
			return match
		}
		code, err := strconv.ParseInt(parts[1], 10, 32)
		if err != nil {
			return match
		}
		return string(rune(code))
	})
	replacer := strings.NewReplacer(
		"&nbsp;", " ",
		"&quot;", `"`,
		"&#39;", "'",
		"&lt;", "<",
		"&gt;", ">",
		"&amp;", "&",
	)
	return replacer.Replace(out)
}

var (
	escapedLineBreakPattern    = regexp.MustCompile(`\\r\\n|\\n|\\r`)
	hexEntityPattern           = regexp.MustCompile(`&#x([0-9a-fA-F]+);`)
	decimalEntityPattern       = regexp.MustCompile(`&#([0-9]+);`)
	markdownLinkPattern        = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
	inlineCodePattern          = regexp.MustCompile("`([^`]+)`")
	boldStarPattern            = regexp.MustCompile(`\*\*([^*]+)\*\*`)
	boldUnderscorePattern      = regexp.MustCompile(`__([^_]+)__`)
	italicStarPattern          = regexp.MustCompile(`\*([^*]+)\*`)
	italicUnderscorePattern    = regexp.MustCompile(`_([^_]+)_`)
	escapedMarkdownCharPattern = regexp.MustCompile(`\\([\\` + "`" + `*_{}\[\]()#+\-.!>])`)
	unorderedListPattern       = regexp.MustCompile(`^\s{0,3}[-*+]\s+`)
	orderedListPattern         = regexp.MustCompile(`^\s{0,3}(\d+)\.\s+`)
)

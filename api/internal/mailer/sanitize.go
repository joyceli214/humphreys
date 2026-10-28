package mailer

import (
	"html"
	"regexp"
	"strings"

	xhtml "golang.org/x/net/html"
)

// allowedEmailTags is the formatting the customer email composer can produce.
var allowedEmailTags = map[string]bool{
	"p": true, "br": true, "strong": true, "b": true, "em": true, "i": true, "u": true,
	"ul": true, "ol": true, "li": true, "a": true, "hr": true,
}

var voidEmailTags = map[string]bool{"br": true, "hr": true}

// droppedContentTags are removed together with everything inside them.
var droppedContentTags = map[string]bool{
	"script": true, "style": true, "iframe": true, "object": true, "embed": true,
	"noscript": true, "template": true, "head": true, "title": true, "svg": true, "math": true,
}

// SanitizeEmailHTML keeps only simple email formatting (p, br, strong, em, u,
// lists, hr and links with http/https/mailto/tel hrefs). Every other tag is
// dropped but its text is kept; attributes other than a safe href are removed.
func SanitizeEmailHTML(input string) string {
	tokenizer := xhtml.NewTokenizer(strings.NewReader(input))
	var out strings.Builder
	skipDepth := 0
	for {
		tokenType := tokenizer.Next()
		switch tokenType {
		case xhtml.ErrorToken:
			return strings.TrimSpace(out.String())
		case xhtml.TextToken:
			if skipDepth == 0 {
				out.WriteString(html.EscapeString(string(tokenizer.Text())))
			}
		case xhtml.StartTagToken, xhtml.SelfClosingTagToken:
			token := tokenizer.Token()
			tag := strings.ToLower(token.Data)
			if droppedContentTags[tag] {
				if tokenType == xhtml.StartTagToken {
					skipDepth++
				}
				continue
			}
			if skipDepth > 0 || !allowedEmailTags[tag] {
				continue
			}
			if tag == "a" {
				href := ""
				for _, attr := range token.Attr {
					if strings.EqualFold(attr.Key, "href") {
						candidate := strings.TrimSpace(attr.Val)
						if isSafeEmailHref(candidate) {
							href = candidate
						}
					}
				}
				if href == "" {
					out.WriteString("<a>")
				} else {
					out.WriteString(`<a href="` + html.EscapeString(href) + `">`)
				}
				continue
			}
			out.WriteString("<" + tag + ">")
		case xhtml.EndTagToken:
			token := tokenizer.Token()
			tag := strings.ToLower(token.Data)
			if droppedContentTags[tag] {
				if skipDepth > 0 {
					skipDepth--
				}
				continue
			}
			if skipDepth > 0 || !allowedEmailTags[tag] || voidEmailTags[tag] {
				continue
			}
			out.WriteString("</" + tag + ">")
		}
	}
}

var htmlTagStripPattern = regexp.MustCompile(`<[^>]*>`)

// emailHTMLHasText reports whether sanitized HTML contains any visible text.
func emailHTMLHasText(value string) bool {
	text := htmlTagStripPattern.ReplaceAllString(value, "")
	text = strings.ReplaceAll(html.UnescapeString(text), "\u00a0", " ")
	return strings.TrimSpace(text) != ""
}

// HasVisibleText reports whether the HTML has any text once tags are removed.
func HasVisibleText(value string) bool {
	return emailHTMLHasText(SanitizeEmailHTML(value))
}

// wrapEmailHTML adds a light, email-client-safe wrapper with inline styles.
func wrapEmailHTML(content string) string {
	styled := strings.NewReplacer(
		"<p>", `<p style="margin:0 0 12px 0;">`,
		"<ul>", `<ul style="margin:0 0 12px 0;padding-left:24px;">`,
		"<ol>", `<ol style="margin:0 0 12px 0;padding-left:24px;">`,
		"<hr>", `<hr style="border:0;border-top:1px solid #dddddd;margin:16px 0;">`,
	).Replace(content)
	return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2933;">` + styled + `</div>`
}

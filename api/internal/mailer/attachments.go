package mailer

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const (
	graphBaseURL = "https://graph.microsoft.com/v1.0"
	// Graph accepts file attachments under 3 MB in a single POST; larger files
	// need an upload session. Stay a little under the documented limit.
	inlineAttachmentMaxBytes = 2_500_000
	// Upload-session chunks must be multiples of 320 KiB and at most 4 MiB.
	uploadChunkBytes = 320 * 1024 * 9
)

// sendWithAttachments creates a draft, attaches each file (single POST for
// small files, an upload session for large ones), then sends the draft. If
// anything fails after the draft exists, the draft is deleted.
func (c *GraphClient) sendWithAttachments(ctx context.Context, token string, msg Message) (err error) {
	userPath := graphBaseURL + "/users/" + url.PathEscape(c.senderEmail)

	var draft struct {
		ID string `json:"id"`
	}
	if err := c.graphJSON(ctx, token, http.MethodPost, userPath+"/messages", graphMessage(msg), http.StatusCreated, &draft); err != nil {
		return fmt.Errorf("create draft: %w", err)
	}
	if strings.TrimSpace(draft.ID) == "" {
		return fmt.Errorf("create draft: microsoft graph returned no message id")
	}
	messagePath := userPath + "/messages/" + url.PathEscape(draft.ID)
	defer func() {
		if err != nil {
			_ = c.graphJSON(context.WithoutCancel(ctx), token, http.MethodDelete, messagePath, nil, http.StatusNoContent, nil)
		}
	}()

	for _, attachment := range msg.Attachments {
		if len(attachment.Data) <= inlineAttachmentMaxBytes {
			body := map[string]any{
				"@odata.type":  "#microsoft.graph.fileAttachment",
				"name":         attachment.Name,
				"contentType":  attachment.ContentType,
				"contentBytes": base64.StdEncoding.EncodeToString(attachment.Data),
			}
			if err := c.graphJSON(ctx, token, http.MethodPost, messagePath+"/attachments", body, http.StatusCreated, nil); err != nil {
				return fmt.Errorf("attach %s: %w", attachment.Name, err)
			}
			continue
		}
		if err := c.uploadLargeAttachment(ctx, token, messagePath, attachment); err != nil {
			return fmt.Errorf("attach %s: %w", attachment.Name, err)
		}
	}

	if err := c.graphJSON(ctx, token, http.MethodPost, messagePath+"/send", nil, http.StatusAccepted, nil); err != nil {
		return fmt.Errorf("send draft: %w", err)
	}
	return nil
}

func (c *GraphClient) uploadLargeAttachment(ctx context.Context, token, messagePath string, attachment Attachment) error {
	var session struct {
		UploadURL string `json:"uploadUrl"`
	}
	body := map[string]any{
		"AttachmentItem": map[string]any{
			"attachmentType": "file",
			"name":           attachment.Name,
			"size":           len(attachment.Data),
			"contentType":    attachment.ContentType,
		},
	}
	if err := c.graphJSON(ctx, token, http.MethodPost, messagePath+"/attachments/createUploadSession", body, http.StatusCreated, &session); err != nil {
		return fmt.Errorf("create upload session: %w", err)
	}
	if !isMicrosoftUploadURL(session.UploadURL) {
		return fmt.Errorf("unexpected upload url host")
	}

	total := len(attachment.Data)
	for start := 0; start < total; start += uploadChunkBytes {
		end := min(start+uploadChunkBytes, total)
		req, err := http.NewRequestWithContext(ctx, http.MethodPut, session.UploadURL, bytes.NewReader(attachment.Data[start:end]))
		if err != nil {
			return err
		}
		// The upload URL carries its own auth token; Graph rejects an Authorization header here.
		req.ContentLength = int64(end - start)
		req.Header.Set("Content-Type", "application/octet-stream")
		req.Header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end-1, total))
		res, err := c.httpClient.Do(req)
		if err != nil {
			return err
		}
		responseBody, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		res.Body.Close()
		if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
			return fmt.Errorf("upload chunk failed: %s: %s", res.Status, strings.TrimSpace(string(responseBody)))
		}
	}
	return nil
}

// isMicrosoftUploadURL only allows upload sessions on Microsoft hosts over HTTPS.
func isMicrosoftUploadURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	for _, suffix := range []string{".office.com", ".office365.com", ".microsoft.com"} {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func (c *GraphClient) graphJSON(ctx context.Context, token, method, endpoint string, payload any, wantStatus int, out any) error {
	var reader io.Reader
	if payload != nil {
		body, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != wantStatus && !(wantStatus == http.StatusCreated && res.StatusCode == http.StatusOK) {
		responseBody, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return fmt.Errorf("microsoft graph %s failed: %s: %s", method, res.Status, strings.TrimSpace(string(responseBody)))
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(out)
	}
	return nil
}

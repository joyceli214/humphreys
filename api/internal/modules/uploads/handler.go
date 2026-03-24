package uploads

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"humphreys/api/internal/config"
	"humphreys/api/internal/middleware"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	maxImageUploadBytes  int64         = 10 * 1024 * 1024
	tempPrefix                         = "markdown-temp/"
	permPrefix                         = "markdown/"
	tempCleanupInterval time.Duration = 1 * time.Hour
	tempRetentionTTL    time.Duration = 24 * time.Hour
)

var markdownImageURLPattern = regexp.MustCompile(`!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img[^>]*\s+src=["']([^"']+)["'][^>]*>`)

type Handler struct {
	httpClient      *http.Client
	endpoint        string
	accessKeyID     string
	secretAccessKey string
	region          string
	bucket          string
	useSSL          bool
	publicBaseURL   string
	enabled         bool
}

type deleteMarkdownImageRequest struct {
	URL string `json:"url"`
}

type listBucketResult struct {
	XMLName               xml.Name           `xml:"ListBucketResult"`
	IsTruncated           bool               `xml:"IsTruncated"`
	NextContinuationToken string             `xml:"NextContinuationToken"`
	Contents              []listBucketObject `xml:"Contents"`
}

type listBucketObject struct {
	Key          string `xml:"Key"`
	LastModified string `xml:"LastModified"`
}

func New(cfg config.Config) *Handler {
	handler := &Handler{
		httpClient:      &http.Client{Timeout: 30 * time.Second},
		accessKeyID:     strings.TrimSpace(cfg.S3AccessKeyID),
		secretAccessKey: strings.TrimSpace(cfg.S3SecretAccessKey),
		region:          strings.TrimSpace(cfg.S3Region),
		bucket:          strings.TrimSpace(cfg.S3Bucket),
		useSSL:          cfg.S3UseSSL,
		publicBaseURL:   strings.TrimSpace(cfg.S3PublicBaseURL),
	}
	if handler.region == "" {
		handler.region = "us-east-1"
	}

	if strings.TrimSpace(cfg.S3Endpoint) == "" ||
		handler.accessKeyID == "" ||
		handler.secretAccessKey == "" ||
		handler.bucket == "" {
		return handler
	}

	endpoint, secure, err := normalizeEndpoint(cfg.S3Endpoint, cfg.S3UseSSL)
	if err != nil {
		return handler
	}
	handler.endpoint = endpoint
	handler.useSSL = secure
	handler.enabled = true

	go handler.startTempCleanupLoop()
	return handler
}

func (h *Handler) UploadMarkdownImage(c *gin.Context) {
	if !h.enabled {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "image uploads are not configured"})
		return
	}
	claims, ok := middleware.Claims(c)
	if !ok || strings.TrimSpace(claims.UserID) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing auth context"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing file"})
		return
	}
	if fileHeader.Size <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "empty file"})
		return
	}
	if fileHeader.Size > maxImageUploadBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "image is too large (max 10MB)"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read file"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxImageUploadBytes+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read file"})
		return
	}
	if int64(len(data)) > maxImageUploadBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "image is too large (max 10MB)"})
		return
	}

	detectedContentType := strings.ToLower(strings.TrimSpace(http.DetectContentType(data)))
	declaredContentType := strings.ToLower(strings.TrimSpace(fileHeader.Header.Get("Content-Type")))
	filenameExt := strings.ToLower(strings.TrimSpace(filepath.Ext(fileHeader.Filename)))

	contentType := resolveImageContentType(detectedContentType, declaredContentType, filenameExt)
	if contentType == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only image files are supported"})
		return
	}

	ext := extensionFromContentType(contentType)
	if ext == "" {
		ext = normalizedImageExtension(filenameExt)
		if ext == "" {
			ext = ".bin"
		}
	}

	userID := strings.TrimSpace(claims.UserID)
	key := fmt.Sprintf("%s%s/%s%s", tempPrefix, userID, uuid.NewString(), ext)
	if err := h.putObject(c.Request.Context(), key, contentType, data); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to upload image"})
		return
	}

	tempPreviewURL, err := h.presignedGetURLForKey(key, 12*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate image url"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"url": tempPreviewURL})
}

func (h *Handler) DeleteMarkdownImage(c *gin.Context) {
	if !h.enabled {
		c.Status(http.StatusNoContent)
		return
	}
	claims, ok := middleware.Claims(c)
	if !ok || strings.TrimSpace(claims.UserID) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing auth context"})
		return
	}

	var req deleteMarkdownImageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid payload"})
		return
	}
	if err := h.DeleteTempImageByURL(c.Request.Context(), req.URL, claims.UserID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) PromoteTempImagesInMarkdown(ctx context.Context, markdown string, referenceID int, userID string) (string, error) {
	if !h.enabled {
		return markdown, nil
	}
	trimmedUserID := strings.TrimSpace(userID)
	if trimmedUserID == "" || strings.TrimSpace(markdown) == "" {
		return markdown, nil
	}

	result := markdown
	seen := make(map[string]struct{})
	imageURLs := extractImageURLs(markdown)
	for _, imageURL := range imageURLs {
		if _, ok := seen[imageURL]; ok {
			continue
		}
		seen[imageURL] = struct{}{}

		sourceKey, ok := h.keyForManagedURL(imageURL)
		if !ok || !strings.HasPrefix(sourceKey, tempPrefix+trimmedUserID+"/") {
			continue
		}

		ext := strings.ToLower(filepath.Ext(sourceKey))
		if ext == "" {
			ext = ".bin"
		}
		destKey := fmt.Sprintf("%s%d/%s%s", permPrefix, referenceID, uuid.NewString(), ext)
		if err := h.copyObject(ctx, sourceKey, destKey); err != nil {
			return markdown, err
		}
		_ = h.deleteObject(ctx, sourceKey)
		result = strings.ReplaceAll(result, imageURL, h.publicURLForKey(destKey))
	}

	return result, nil
}

func (h *Handler) DeleteRemovedManagedImages(ctx context.Context, previousMarkdown, nextMarkdown string) {
	if !h.enabled {
		return
	}
	oldKeys := h.managedKeySet(previousMarkdown)
	newKeys := h.managedKeySet(nextMarkdown)
	for key := range oldKeys {
		if _, keep := newKeys[key]; keep {
			continue
		}
		_ = h.deleteObject(ctx, key)
	}
}

func (h *Handler) DeleteManagedImagesInMarkdown(ctx context.Context, markdown string) {
	if !h.enabled {
		return
	}
	for imageURL := range h.managedURLSet(markdown) {
		if key, ok := h.keyForManagedURL(imageURL); ok {
			_ = h.deleteObject(ctx, key)
		}
	}
}

func (h *Handler) DeleteTempImageByURL(ctx context.Context, rawURL, userID string) error {
	if !h.enabled {
		return nil
	}
	key, ok := h.keyForManagedURL(rawURL)
	if !ok {
		return errors.New("image is not managed by uploads service")
	}
	userPrefix := tempPrefix + strings.TrimSpace(userID) + "/"
	if !strings.HasPrefix(key, userPrefix) {
		return errors.New("can only delete your own temporary images")
	}
	return h.deleteObject(ctx, key)
}

func (h *Handler) RewriteMarkdownImageURLsToPresigned(ctx context.Context, markdown string, expires time.Duration) (string, error) {
	if !h.enabled || strings.TrimSpace(markdown) == "" {
		return markdown, nil
	}

	result := markdown
	seen := make(map[string]struct{})
	for _, imageURL := range extractImageURLs(markdown) {
		if _, ok := seen[imageURL]; ok {
			continue
		}
		seen[imageURL] = struct{}{}

		key, ok := h.keyForManagedURL(imageURL)
		if !ok {
			continue
		}

		signedURL, err := h.presignedGetURLForKey(key, expires)
		if err != nil {
			return markdown, err
		}
		result = strings.ReplaceAll(result, imageURL, signedURL)
	}

	return result, nil
}

func (h *Handler) managedURLSet(markdown string) map[string]struct{} {
	set := make(map[string]struct{})
	for _, imageURL := range extractImageURLs(markdown) {
		if _, ok := h.keyForManagedURL(imageURL); ok {
			set[imageURL] = struct{}{}
		}
	}
	return set
}

func (h *Handler) managedKeySet(markdown string) map[string]struct{} {
	set := make(map[string]struct{})
	for _, imageURL := range extractImageURLs(markdown) {
		key, ok := h.keyForManagedURL(imageURL)
		if !ok {
			continue
		}
		set[key] = struct{}{}
	}
	return set
}

func (h *Handler) NormalizeMarkdownImageURLsForStorage(markdown string) string {
	if !h.enabled || strings.TrimSpace(markdown) == "" {
		return markdown
	}
	result := markdown
	seen := make(map[string]struct{})
	for _, imageURL := range extractImageURLs(markdown) {
		if _, ok := seen[imageURL]; ok {
			continue
		}
		seen[imageURL] = struct{}{}
		key, ok := h.keyForManagedURL(imageURL)
		if !ok {
			continue
		}
		result = strings.ReplaceAll(result, imageURL, h.publicURLForKey(key))
	}
	return result
}

func extractImageURLs(markdown string) []string {
	if strings.TrimSpace(markdown) == "" {
		return nil
	}
	matches := markdownImageURLPattern.FindAllStringSubmatch(markdown, -1)
	urls := make([]string, 0, len(matches))
	for _, match := range matches {
		var imageURL string
		if len(match) > 1 && match[1] != "" {
			imageURL = strings.Trim(match[1], "<>")
		} else if len(match) > 2 && match[2] != "" {
			imageURL = strings.TrimSpace(match[2])
		}
		if imageURL != "" {
			urls = append(urls, imageURL)
		}
	}
	return urls
}

func (h *Handler) keyForManagedURL(rawURL string) (string, bool) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u == nil {
		return "", false
	}
	key, ok := h.keyFromURLPath(u.Path)
	if ok {
		return key, true
	}
	if h.publicBaseURL == "" {
		return "", false
	}
	base, err := url.Parse(strings.TrimRight(h.publicBaseURL, "/"))
	if err != nil || base == nil {
		return "", false
	}
	if !strings.EqualFold(base.Host, u.Host) {
		return "", false
	}
	basePath := strings.Trim(strings.TrimSpace(base.Path), "/")
	targetPath := strings.Trim(strings.TrimSpace(u.Path), "/")
	if basePath == "" {
		return targetPath, targetPath != ""
	}
	if !strings.HasPrefix(targetPath, basePath+"/") {
		return "", false
	}
	key = strings.TrimPrefix(targetPath, basePath+"/")
	return key, key != ""
}

func (h *Handler) keyFromURLPath(path string) (string, bool) {
	trimmed := strings.Trim(path, "/")
	prefix := strings.Trim(h.bucket, "/") + "/"
	if !strings.HasPrefix(trimmed, prefix) {
		return "", false
	}
	key := strings.TrimPrefix(trimmed, prefix)
	if key == "" {
		return "", false
	}
	return key, true
}

func (h *Handler) startTempCleanupLoop() {
	ticker := time.NewTicker(tempCleanupInterval)
	defer ticker.Stop()
	for range ticker.C {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		_ = h.cleanupStaleTempImages(ctx)
		cancel()
	}
}

func (h *Handler) cleanupStaleTempImages(ctx context.Context) error {
	objects, err := h.listObjects(ctx, tempPrefix)
	if err != nil {
		return err
	}
	cutoff := time.Now().UTC().Add(-tempRetentionTTL)
	for _, obj := range objects {
		lastModified, err := time.Parse(time.RFC3339, strings.TrimSpace(obj.LastModified))
		if err != nil {
			continue
		}
		if lastModified.Before(cutoff) {
			_ = h.deleteObject(ctx, obj.Key)
		}
	}
	return nil
}

func (h *Handler) listObjects(ctx context.Context, prefix string) ([]listBucketObject, error) {
	objects := make([]listBucketObject, 0)
	continuationToken := ""
	for {
		query := url.Values{}
		query.Set("list-type", "2")
		query.Set("prefix", prefix)
		if continuationToken != "" {
			query.Set("continuation-token", continuationToken)
		}

		req, err := h.buildSignedRequest(ctx, http.MethodGet, "/"+h.bucket, query, nil, "")
		if err != nil {
			return nil, err
		}
		res, err := h.httpClient.Do(req)
		if err != nil {
			return nil, err
		}
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4*1024*1024))
		res.Body.Close()
		if res.StatusCode < 200 || res.StatusCode >= 300 {
			return nil, fmt.Errorf("s3 list failed: status=%d body=%q", res.StatusCode, string(body))
		}

		var parsed listBucketResult
		if err := xml.Unmarshal(body, &parsed); err != nil {
			return nil, err
		}
		objects = append(objects, parsed.Contents...)
		if !parsed.IsTruncated || strings.TrimSpace(parsed.NextContinuationToken) == "" {
			break
		}
		continuationToken = strings.TrimSpace(parsed.NextContinuationToken)
	}
	return objects, nil
}

func (h *Handler) copyObject(ctx context.Context, sourceKey, destinationKey string) error {
	data, contentType, err := h.getObject(ctx, sourceKey)
	if err != nil {
		return err
	}
	return h.putObject(ctx, destinationKey, contentType, data)
}

func (h *Handler) getObject(ctx context.Context, key string) ([]byte, string, error) {
	canonicalURI := "/" + h.bucket + "/" + escapeObjectKey(key)
	req, err := h.buildSignedRequest(ctx, http.MethodGet, canonicalURI, nil, nil, "")
	if err != nil {
		return nil, "", err
	}
	res, err := h.httpClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return nil, "", fmt.Errorf("s3 get failed: status=%d body=%q", res.StatusCode, string(body))
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxImageUploadBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > maxImageUploadBytes {
		return nil, "", fmt.Errorf("s3 object too large")
	}
	contentType := strings.TrimSpace(res.Header.Get("Content-Type"))
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	return data, contentType, nil
}

func (h *Handler) putObject(ctx context.Context, key, contentType string, data []byte) error {
	canonicalURI := "/" + h.bucket + "/" + escapeObjectKey(key)
	req, err := h.buildSignedRequest(ctx, http.MethodPut, canonicalURI, nil, data, contentType)
	if err != nil {
		return err
	}
	res, err := h.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
	return fmt.Errorf("s3 put failed: status=%d body=%q", res.StatusCode, string(body))
}

func (h *Handler) deleteObject(ctx context.Context, key string) error {
	canonicalURI := "/" + h.bucket + "/" + escapeObjectKey(key)
	req, err := h.buildSignedRequest(ctx, http.MethodDelete, canonicalURI, nil, nil, "")
	if err != nil {
		return err
	}
	res, err := h.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return nil
	}
	if res.StatusCode == http.StatusNotFound {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
	return fmt.Errorf("s3 delete failed: status=%d body=%q", res.StatusCode, string(body))
}

func (h *Handler) buildSignedRequest(
	ctx context.Context,
	method string,
	canonicalURI string,
	query url.Values,
	body []byte,
	contentType string,
) (*http.Request, error) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	canonicalQuery := ""
	if query != nil {
		canonicalQuery = query.Encode()
	}

	payloadHash := sha256Hex(body)
	host := h.endpoint
	canonicalHeaders := "host:" + host + "\n" + "x-amz-content-sha256:" + payloadHash + "\n" + "x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := method + "\n" + canonicalURI + "\n" + canonicalQuery + "\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash

	credentialScope := dateStamp + "/" + h.region + "/s3/aws4_request"
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + credentialScope + "\n" + sha256Hex([]byte(canonicalRequest))
	signature := h.signAWSV4(dateStamp, stringToSign)

	scheme := "https"
	if !h.useSSL {
		scheme = "http"
	}
	requestURL := scheme + "://" + host + canonicalURI
	if canonicalQuery != "" {
		requestURL += "?" + canonicalQuery
	}

	req, err := http.NewRequestWithContext(ctx, method, requestURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate)
	if len(body) > 0 {
		req.Header.Set("Content-Length", strconv.Itoa(len(body)))
		if strings.TrimSpace(contentType) != "" {
			req.Header.Set("Content-Type", contentType)
		}
	}
	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		h.accessKeyID,
		credentialScope,
		signedHeaders,
		signature,
	))
	return req, nil
}

func (h *Handler) signAWSV4(dateStamp, stringToSign string) string {
	kDate := hmacSHA256([]byte("AWS4"+h.secretAccessKey), dateStamp)
	kRegion := hmacSHA256(kDate, h.region)
	kService := hmacSHA256(kRegion, "s3")
	kSigning := hmacSHA256(kService, "aws4_request")
	return hex.EncodeToString(hmacSHA256(kSigning, stringToSign))
}

func (h *Handler) presignedGetURLForKey(key string, expires time.Duration) (string, error) {
	if expires <= 0 {
		expires = 15 * time.Minute
	}
	maxExpiry := 7 * 24 * time.Hour
	if expires > maxExpiry {
		expires = maxExpiry
	}

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	credentialScope := dateStamp + "/" + h.region + "/s3/aws4_request"
	expiresSeconds := int(expires.Seconds())

	canonicalURI := "/" + h.bucket + "/" + escapeObjectKey(key)
	query := url.Values{}
	query.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	query.Set("X-Amz-Credential", h.accessKeyID+"/"+credentialScope)
	query.Set("X-Amz-Date", amzDate)
	query.Set("X-Amz-Expires", strconv.Itoa(expiresSeconds))
	query.Set("X-Amz-SignedHeaders", "host")
	canonicalQuery := query.Encode()

	host := h.endpoint
	canonicalHeaders := "host:" + host + "\n"
	canonicalRequest := "GET\n" + canonicalURI + "\n" + canonicalQuery + "\n" + canonicalHeaders + "\n" + "host" + "\n" + "UNSIGNED-PAYLOAD"
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + credentialScope + "\n" + sha256Hex([]byte(canonicalRequest))
	signature := h.signAWSV4(dateStamp, stringToSign)

	query.Set("X-Amz-Signature", signature)

	scheme := "https"
	if !h.useSSL {
		scheme = "http"
	}
	return scheme + "://" + host + canonicalURI + "?" + query.Encode(), nil
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func escapeObjectKey(key string) string {
	return strings.ReplaceAll(url.PathEscape(key), "%2F", "/")
}

func (h *Handler) publicURLForKey(key string) string {
	escapedKey := escapeObjectKey(key)
	if h.publicBaseURL != "" {
		return strings.TrimRight(h.publicBaseURL, "/") + "/" + escapedKey
	}
	scheme := "https"
	if !h.useSSL {
		scheme = "http"
	}
	return fmt.Sprintf("%s://%s/%s/%s", scheme, h.endpoint, h.bucket, escapedKey)
}

func normalizeEndpoint(raw string, defaultSecure bool) (string, bool, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", defaultSecure, fmt.Errorf("missing endpoint")
	}
	if strings.Contains(value, "://") {
		parsed, err := url.Parse(value)
		if err != nil {
			return "", defaultSecure, err
		}
		if parsed.Host == "" {
			return "", defaultSecure, fmt.Errorf("invalid endpoint")
		}
		secure := parsed.Scheme == "https"
		return parsed.Host, secure, nil
	}
	return value, defaultSecure, nil
}

func extensionFromContentType(contentType string) string {
	if strings.TrimSpace(contentType) == "" {
		return ""
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.TrimSpace(strings.ToLower(contentType))
	}
	switch mediaType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/svg+xml":
		return ".svg"
	case "image/bmp":
		return ".bmp"
	case "image/tiff":
		return ".tif"
	case "image/avif":
		return ".avif"
	case "image/heic":
		return ".heic"
	case "image/heif":
		return ".heif"
	default:
		return ""
	}
}

func resolveImageContentType(detectedContentType, declaredContentType, filenameExt string) string {
	if strings.HasPrefix(detectedContentType, "image/") {
		return detectedContentType
	}
	if strings.HasPrefix(declaredContentType, "image/") {
		return declaredContentType
	}
	return contentTypeFromExtension(filenameExt)
}

func contentTypeFromExtension(filenameExt string) string {
	switch normalizedImageExtension(filenameExt) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".bmp":
		return "image/bmp"
	case ".tif", ".tiff":
		return "image/tiff"
	case ".avif":
		return "image/avif"
	case ".heic":
		return "image/heic"
	case ".heif":
		return "image/heif"
	default:
		return ""
	}
}

func normalizedImageExtension(filenameExt string) string {
	ext := strings.ToLower(strings.TrimSpace(filenameExt))
	switch ext {
	case ".jpeg":
		return ".jpg"
	case ".tiff":
		return ".tif"
	case ".jpg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tif", ".avif", ".heic", ".heif":
		return ext
	default:
		return ""
	}
}

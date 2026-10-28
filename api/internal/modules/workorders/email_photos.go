package workorders

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"humphreys/api/internal/domain"
	"humphreys/api/internal/emailphotos"
	"humphreys/api/internal/mailer"

	"github.com/gin-gonic/gin"
)

type emailPhotoResponse struct {
	ID            string `json:"id"`
	URL           string `json:"url"`
	Name          string `json:"name"`
	Source        string `json:"source"`
	OriginalBytes int    `json:"original_bytes"`
	SendBytes     int    `json:"send_bytes"`
	OriginalType  string `json:"original_type"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
	Supported     bool   `json:"supported"`
	Reason        string `json:"reason,omitempty"`
}

type emailPhotosResponse struct {
	Items         []emailPhotoResponse `json:"items"`
	MaxPhotos     int                  `json:"max_photos"`
	MaxTotalBytes int                  `json:"max_total_bytes"`
}

// workOrderPhotoSources lists the stored (unsigned) text blocks of a work order
// that can contain photos: problem description, work done and repair logs.
func workOrderPhotoSources(item domain.WorkOrderDetail, logs []domain.RepairLog) []emailphotos.Source {
	sources := []emailphotos.Source{
		{Label: "Problem", Markdown: stringValue(item.ProblemDescription)},
		{Label: "Work done", Markdown: stringValue(item.WorkDone)},
	}
	for _, log := range logs {
		label := "Repair log"
		if log.RepairDate != nil {
			label = "Repair log " + log.RepairDate.Format("Jan 2")
		}
		sources = append(sources, emailphotos.Source{Label: label, Markdown: log.Details})
	}
	return sources
}

func (h *Handler) workOrderPhotos(ctx context.Context, item domain.WorkOrderDetail) ([]emailphotos.Photo, error) {
	if h.emailPhotos == nil {
		return nil, nil
	}
	logs, err := h.service.ListRepairLogs(ctx, int(item.ReferenceID))
	if err != nil {
		return nil, err
	}
	return emailphotos.Collect(h.emailPhotos.Store(), workOrderPhotoSources(item, logs)), nil
}

// ListEmailPhotos returns the work order's photos with the size each one will
// have once shrunk for email, so the dialog can show a live total.
func (h *Handler) ListEmailPhotos(c *gin.Context) {
	referenceID, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference_id"})
		return
	}
	item, err := h.service.GetWorkOrderDetail(c.Request.Context(), referenceID)
	if errors.Is(err, ErrWorkOrderNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "work order not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch work order"})
		return
	}
	photos, err := h.workOrderPhotos(c.Request.Context(), item)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load photos"})
		return
	}
	response := emailPhotosResponse{Items: []emailPhotoResponse{}, MaxPhotos: emailphotos.MaxPhotos, MaxTotalBytes: emailphotos.MaxTotalBytes}
	if len(photos) > 0 {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
		defer cancel()
		for _, info := range h.emailPhotos.List(ctx, photos) {
			response.Items = append(response.Items, emailPhotoResponse{
				ID: info.ID, URL: info.URL, Name: info.Name, Source: info.Source,
				OriginalBytes: info.OriginalBytes, SendBytes: info.SendBytes, OriginalType: info.OriginalType,
				Width: info.Width, Height: info.Height, Supported: info.Supported, Reason: info.Reason,
			})
		}
	}
	c.JSON(http.StatusOK, response)
}

// customerEmailAttachments validates the selected photo ids against the work
// order's own photos and returns them shrunk, ready to attach. The client never
// supplies URLs, so nothing outside the job's stored photos can be fetched.
func (h *Handler) customerEmailAttachments(ctx context.Context, item domain.WorkOrderDetail, ids []string) ([]mailer.Attachment, int, error) {
	if h.emailPhotos == nil {
		return nil, http.StatusBadRequest, emailphotos.ErrStorageDisabled
	}
	photos, err := h.workOrderPhotos(ctx, item)
	if err != nil {
		return nil, http.StatusInternalServerError, errors.New("failed to load photos")
	}
	attachments, err := h.emailPhotos.Resolve(ctx, photos, ids, fmt.Sprintf("job-%d", item.ReferenceID))
	if err != nil {
		switch {
		case errors.Is(err, emailphotos.ErrPhotoNotOnJob), errors.Is(err, emailphotos.ErrTooManyPhotos),
			errors.Is(err, emailphotos.ErrPhotosTooLarge), errors.Is(err, emailphotos.ErrUnsupported),
			errors.Is(err, emailphotos.ErrStorageDisabled):
			return nil, http.StatusBadRequest, err
		default:
			return nil, http.StatusBadGateway, errors.New("failed to prepare photos")
		}
	}
	out := make([]mailer.Attachment, 0, len(attachments))
	for _, attachment := range attachments {
		out = append(out, mailer.Attachment{Name: attachment.Name, ContentType: attachment.ContentType, Data: attachment.Data})
	}
	return out, http.StatusOK, nil
}

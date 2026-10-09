package workorders

import (
	"context"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"humphreys/api/internal/middleware"
	"math"
	"net/http"
	"strconv"
	"time"
)

var ErrInvalidLabourDiscount = errors.New("invalid labour discount: percent must be 0–100; amount must be between zero and the saved labour total")

// ErrLabourRequiredForAmountDiscount wraps ErrInvalidLabourDiscount so callers keep the same 400 handling.
var ErrLabourRequiredForAmountDiscount = fmt.Errorf("%w: enter and save the Labour amount before adding a $ discount", ErrInvalidLabourDiscount)

func ValidateLabourDiscount(kind *string, value, labour *float64) error {
	if kind == nil {
		return nil
	}
	if value == nil || math.IsNaN(*value) || math.IsInf(*value, 0) || *value < 0 || *value > 9999999999.99 {
		return ErrInvalidLabourDiscount
	}
	switch *kind {
	case "percent":
		if *value > 100 {
			return ErrInvalidLabourDiscount
		}
	case "amount":
		if labour == nil {
			return ErrLabourRequiredForAmountDiscount
		}
		if *value > *labour {
			return ErrInvalidLabourDiscount
		}
	default:
		return ErrInvalidLabourDiscount
	}
	return nil
}

type LabourDiscountAudit struct {
	ID              int64     `json:"id"`
	ChangedByUserID string    `json:"changed_by_user_id"`
	ChangedByName   string    `json:"changed_by_name"`
	ChangedAt       time.Time `json:"changed_at"`
	OldType         *string   `json:"old_type"`
	OldValue        *float64  `json:"old_value"`
	NewType         *string   `json:"new_type"`
	NewValue        *float64  `json:"new_value"`
}

func (r *storeRepository) UpdateLabourDiscount(ctx context.Context, id int, kind *string, value *float64, userID string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var oldType *string
	var oldValue, labour *float64
	err = tx.QueryRow(ctx, `SELECT labour_discount_type, labour_discount_value::double precision, labour_total::double precision FROM public.work_orders WHERE reference_id=$1 FOR UPDATE`, id).Scan(&oldType, &oldValue, &labour)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWorkOrderNotFound
	}
	if err != nil {
		return err
	}
	if err = ValidateLabourDiscount(kind, value, labour); err != nil {
		return err
	}
	if kind == nil {
		value = nil
	} else {
		rounded := round2(*value)
		value = &rounded
	}
	if (kind == nil && oldType == nil) || (kind != nil && oldType != nil && *kind == *oldType && oldValue != nil && *value == *oldValue) {
		return tx.Commit(ctx)
	}
	_, err = tx.Exec(ctx, `UPDATE public.work_orders SET labour_discount_type=$2, labour_discount_value=$3, updated_at=now() WHERE reference_id=$1`, id, kind, value)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO public.work_order_labour_discount_audit(reference_id,changed_by_user_id,old_type,old_value,new_type,new_value) VALUES($1,$2,$3,$4,$5,$6)`, id, userID, oldType, oldValue, kind, value)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (r *storeRepository) LabourDiscountHistory(ctx context.Context, id int) ([]LabourDiscountAudit, error) {
	var exists bool
	if err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.work_orders WHERE reference_id=$1)`, id).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrWorkOrderNotFound
	}
	rows, err := r.db.Query(ctx, `SELECT a.id,a.changed_by_user_id::text,u.full_name,a.changed_at,a.old_type,a.old_value::double precision,a.new_type,a.new_value::double precision FROM public.work_order_labour_discount_audit a JOIN public.users u ON u.id=a.changed_by_user_id WHERE a.reference_id=$1 ORDER BY a.changed_at DESC,a.id DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []LabourDiscountAudit{}
	for rows.Next() {
		var a LabourDiscountAudit
		if err := rows.Scan(&a.ID, &a.ChangedByUserID, &a.ChangedByName, &a.ChangedAt, &a.OldType, &a.OldValue, &a.NewType, &a.NewValue); err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}
func discountError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	message := "failed to access labour discount"
	if errors.Is(err, ErrInvalidLabourDiscount) {
		status = http.StatusBadRequest
		message = err.Error()
	}
	if errors.Is(err, ErrWorkOrderNotFound) {
		status = http.StatusNotFound
		message = err.Error()
	}
	c.JSON(status, gin.H{"error": message})
}
func (h *Handler) UpdateLabourDiscount(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid reference_id"})
		return
	}
	var req struct {
		Type  *string  `json:"type"`
		Value *float64 `json:"value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": "invalid payload"})
		return
	}
	claims, ok := middleware.Claims(c)
	if !ok || claims.UserID == "" {
		c.JSON(401, gin.H{"error": "missing auth context"})
		return
	}
	if err := h.service.repo.UpdateLabourDiscount(c.Request.Context(), id, req.Type, req.Value, claims.UserID); err != nil {
		discountError(c, err)
		return
	}
	item, err := h.service.GetWorkOrderDetail(c.Request.Context(), id)
	if err != nil {
		discountError(c, err)
		return
	}
	h.signWorkOrderDetailMarkdown(c.Request.Context(), &item)
	c.JSON(200, item)
}
func (h *Handler) LabourDiscountHistory(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("reference_id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid reference_id"})
		return
	}
	history, err := h.service.repo.LabourDiscountHistory(c.Request.Context(), id)
	if err != nil {
		discountError(c, err)
		return
	}
	c.JSON(200, history)
}

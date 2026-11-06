package workorders

import (
	"context"

	"humphreys/api/internal/domain"
)

// dashboardStatusCounts counts non-stock jobs per status using the same range
// filter as the other dashboard blocks. Every active status is listed (count 0
// when empty) so the user can focus on it; inactive statuses only appear while
// jobs still sit in them.
func (r *storeRepository) dashboardStatusCounts(ctx context.Context, rangeStart string) ([]domain.DashboardStatusCount, error) {
	rows, err := r.db.Query(ctx, `
		SELECT st.status_id, st.display_name, COALESCE(st.status_group, 'to_do'), COUNT(x.reference_id)
		FROM public.work_order_statuses st
		LEFT JOIN (
			SELECT wo.reference_id, wo.status_id
			FROM public.work_orders wo
			LEFT JOIN public.job_types jt ON jt.job_type_id = wo.job_type_id
			WHERE COALESCE(wo.status_updated_at, wo.updated_at, wo.created_at) >= $1::date
			  AND COALESCE(jt.display_name, '') NOT ILIKE '%stock%'
		) x ON x.status_id = st.status_id
		GROUP BY st.status_id, st.display_name, st.status_group, st.is_active, st.is_pinned
		HAVING st.is_active OR COUNT(x.reference_id) > 0
		ORDER BY st.is_pinned DESC, LOWER(st.display_name), st.status_id
	`, rangeStart)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.DashboardStatusCount, 0)
	for rows.Next() {
		var item domain.DashboardStatusCount
		if err := rows.Scan(&item.StatusID, &item.Status, &item.StatusGroup, &item.Count); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

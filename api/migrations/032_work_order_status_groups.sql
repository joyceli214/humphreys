ALTER TABLE public.work_order_statuses
  ADD COLUMN IF NOT EXISTS status_group TEXT;

UPDATE public.work_order_statuses
SET status_group = CASE
  WHEN LOWER(COALESCE(status_key, '')) IN ('done', 'completed', 'complete', 'finished', 'closed', 'picked_up', 'delivered')
    OR LOWER(COALESCE(display_name, '')) LIKE '%done%'
    OR LOWER(COALESCE(display_name, '')) LIKE '%complete%'
    OR LOWER(COALESCE(display_name, '')) LIKE '%finish%'
    OR LOWER(COALESCE(display_name, '')) LIKE '%closed%'
    OR LOWER(COALESCE(display_name, '')) LIKE '%picked up%'
    OR LOWER(COALESCE(display_name, '')) LIKE '%deliver%'
  THEN 'completed'
  WHEN LOWER(COALESCE(status_key, '')) IN ('in_progress', 'in-progress', 'progress', 'diagnosing', 'repairing', 'waiting_parts', 'ordered_parts')
    OR LOWER(COALESCE(display_name, '')) LIKE '%in progress%'
    OR LOWER(COALESCE(display_name, '')) LIKE '%diagnos%'
    OR LOWER(COALESCE(display_name, '')) LIKE '%repair%'
    OR LOWER(COALESCE(display_name, '')) LIKE '%waiting%'
    OR LOWER(COALESCE(display_name, '')) LIKE '%parts%'
  THEN 'in_progress'
  ELSE 'to_do'
END
WHERE status_group IS NULL OR BTRIM(status_group) = '';

ALTER TABLE public.work_order_statuses
  ALTER COLUMN status_group SET DEFAULT 'to_do';

UPDATE public.work_order_statuses
SET status_group = 'to_do'
WHERE status_group IS NULL OR BTRIM(status_group) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_work_order_statuses_status_group'
      AND conrelid = 'public.work_order_statuses'::regclass
  ) THEN
    ALTER TABLE public.work_order_statuses
      ADD CONSTRAINT chk_work_order_statuses_status_group
      CHECK (status_group IN ('to_do', 'in_progress', 'completed'));
  END IF;
END $$;


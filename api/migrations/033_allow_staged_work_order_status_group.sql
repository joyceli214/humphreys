ALTER TABLE public.work_order_statuses
  DROP CONSTRAINT IF EXISTS chk_work_order_statuses_status_group;

ALTER TABLE public.work_order_statuses
  ADD CONSTRAINT chk_work_order_statuses_status_group
  CHECK (status_group IN ('to_do', 'in_progress', 'staged', 'completed'));

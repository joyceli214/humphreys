ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS other_remarks TEXT;

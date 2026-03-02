ALTER TABLE public.repair_logs
  ADD COLUMN IF NOT EXISTS hours_used NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (hours_used >= 0);

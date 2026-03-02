ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS dvd_vhs_qty INTEGER NOT NULL DEFAULT 0 CHECK (dvd_vhs_qty >= 0);

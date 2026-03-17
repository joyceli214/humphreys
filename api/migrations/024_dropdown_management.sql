ALTER TABLE public.work_order_statuses
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.job_types
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public.dropdown_management_settings (
  dropdown_key TEXT PRIMARY KEY,
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_dropdown_management_dropdown_key CHECK (
    dropdown_key IN (
      'work_order_statuses',
      'job_types',
      'items',
      'brands',
      'workers',
      'payment_methods',
      'locations'
    )
  )
);

INSERT INTO public.dropdown_management_settings (dropdown_key, is_frozen)
VALUES
  ('work_order_statuses', FALSE),
  ('job_types', FALSE),
  ('items', FALSE),
  ('brands', FALSE),
  ('workers', FALSE),
  ('payment_methods', FALSE),
  ('locations', FALSE)
ON CONFLICT (dropdown_key) DO NOTHING;

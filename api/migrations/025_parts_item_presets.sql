CREATE TABLE IF NOT EXISTS public.parts_item_presets (
  parts_item_preset_id BIGSERIAL PRIMARY KEY,
  preset_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_parts_item_presets_name UNIQUE (preset_name)
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_dropdown_management_dropdown_key'
      AND conrelid = 'public.dropdown_management_settings'::regclass
  ) THEN
    ALTER TABLE public.dropdown_management_settings DROP CONSTRAINT chk_dropdown_management_dropdown_key;
  END IF;
END $$;

ALTER TABLE public.dropdown_management_settings
  ADD CONSTRAINT chk_dropdown_management_dropdown_key CHECK (
    dropdown_key IN (
      'work_order_statuses',
      'job_types',
      'items',
      'brands',
      'workers',
      'payment_methods',
      'locations',
      'parts_item_presets'
    )
  );

INSERT INTO public.dropdown_management_settings (dropdown_key, is_frozen)
VALUES ('parts_item_presets', FALSE)
ON CONFLICT (dropdown_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.locations (
  location_id BIGSERIAL PRIMARY KEY,
  location_code TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_location_code_lower
  ON public.locations (LOWER(BTRIM(location_code)));

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS location_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_work_orders_location'
  ) THEN
    ALTER TABLE public.work_orders
      ADD CONSTRAINT fk_work_orders_location
      FOREIGN KEY (location_id)
      REFERENCES public.locations(location_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_orders_location_id
  ON public.work_orders (location_id);

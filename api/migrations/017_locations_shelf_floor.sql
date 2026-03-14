ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS shelf TEXT,
  ADD COLUMN IF NOT EXISTS floor INTEGER;

UPDATE public.locations
SET shelf = COALESCE(NULLIF(BTRIM(shelf), ''), BTRIM(location_code))
WHERE shelf IS NULL OR BTRIM(shelf) = '';

UPDATE public.locations
SET floor = COALESCE(floor, 0)
WHERE floor IS NULL;

ALTER TABLE public.locations
  ALTER COLUMN shelf SET NOT NULL,
  ALTER COLUMN floor SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_locations_floor_non_negative'
  ) THEN
    ALTER TABLE public.locations
      ADD CONSTRAINT chk_locations_floor_non_negative CHECK (floor >= 0);
  END IF;
END $$;

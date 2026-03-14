CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_floor_shelf_ci
  ON public.locations (floor, LOWER(BTRIM(shelf)));

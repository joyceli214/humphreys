-- Locate the status CHECK by its column, including legacy/imported constraint names.
DO $$
DECLARE status_check record;
BEGIN
  FOR status_check IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
    WHERE con.conrelid = 'public.parts_purchase_requests'::regclass
      AND con.contype = 'c' AND att.attname = 'status'
  LOOP
    EXECUTE format('ALTER TABLE public.parts_purchase_requests DROP CONSTRAINT %I', status_check.conname);
  END LOOP;
END $$;

ALTER TABLE public.parts_purchase_requests
  ADD CONSTRAINT parts_purchase_requests_status_check
    CHECK (status IN ('draft', 'waiting_approval', 'approved', 'ordered', 'arrived', 'used', 'cancelled')),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrived_at timestamptz,
  ADD COLUMN IF NOT EXISTS used_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Preserve the last known timestamps for rows created before the workflow rollout.
UPDATE public.parts_purchase_requests
SET ordered_at = COALESCE(ordered_at, updated_at)
WHERE status IN ('ordered', 'used') AND ordered_at IS NULL;
UPDATE public.parts_purchase_requests
SET used_at = COALESCE(used_at, updated_at)
WHERE status = 'used' AND used_at IS NULL;

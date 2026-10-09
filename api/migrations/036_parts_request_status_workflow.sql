ALTER TABLE public.parts_purchase_requests
  DROP CONSTRAINT IF EXISTS parts_purchase_requests_status_check;

ALTER TABLE public.parts_purchase_requests
  ADD CONSTRAINT parts_purchase_requests_status_check
    CHECK (status IN ('draft', 'waiting_approval', 'approved', 'ordered', 'arrived', 'used', 'cancelled')),
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN ordered_at timestamptz,
  ADD COLUMN arrived_at timestamptz,
  ADD COLUMN used_at timestamptz,
  ADD COLUMN cancelled_at timestamptz;

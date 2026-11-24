-- Amount actually paid for a parts purchase request. Separate from total_price
-- (the estimate); never derived from it. NULL until someone records it.
ALTER TABLE public.parts_purchase_requests
  ADD COLUMN IF NOT EXISTS actual_paid_total NUMERIC(12,2) NULL CHECK (actual_paid_total >= 0);

-- Let the append-only audit log record changes to it. The inline CHECK from 038
-- has the default name parts_purchase_request_audit_field_check (no IF EXISTS: fail loudly if not).
ALTER TABLE public.parts_purchase_request_audit
  DROP CONSTRAINT parts_purchase_request_audit_field_check;
ALTER TABLE public.parts_purchase_request_audit
  ADD CONSTRAINT parts_purchase_request_audit_field_check
  CHECK (field IN ('status', 'total_price', 'quantity', 'item_name', 'source', 'source_url', 'actual_paid_total'));

-- Append-only audit log for parts purchase requests (create, status, price, delete).
-- No FK to parts_purchase_requests / work_orders so history survives deletes.
CREATE TABLE public.parts_purchase_request_audit (
 id BIGSERIAL PRIMARY KEY,
 parts_purchase_request_id BIGINT NOT NULL,
 reference_id INT NOT NULL,
 action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
 field TEXT NOT NULL CHECK (field IN ('status', 'total_price')),
 old_value TEXT NULL,
 new_value TEXT NULL,
 changed_by_user_id UUID NOT NULL,
 changed_by_name TEXT NOT NULL,
 -- Recorded from the locked pre-update request, including requests predating this log.
 after_approval BOOLEAN NOT NULL DEFAULT false,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON public.parts_purchase_request_audit(reference_id, changed_at);
CREATE INDEX ON public.parts_purchase_request_audit(parts_purchase_request_id, changed_at);

CREATE OR REPLACE FUNCTION public.parts_purchase_request_audit_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'parts_purchase_request_audit is append-only (% not allowed)', TG_OP;
END;
$$;
CREATE TRIGGER parts_purchase_request_audit_no_update_delete
 BEFORE UPDATE OR DELETE ON public.parts_purchase_request_audit
 FOR EACH STATEMENT EXECUTE FUNCTION public.parts_purchase_request_audit_append_only();
CREATE TRIGGER parts_purchase_request_audit_no_truncate
 BEFORE TRUNCATE ON public.parts_purchase_request_audit
 FOR EACH STATEMENT EXECUTE FUNCTION public.parts_purchase_request_audit_append_only();

ALTER TABLE public.work_orders
 ADD COLUMN labour_discount_type TEXT NULL CHECK (labour_discount_type IN ('percent', 'amount')),
 ADD COLUMN labour_discount_value NUMERIC(12,2) NULL CHECK (labour_discount_value >= 0),
 ADD CONSTRAINT labour_discount_pair CHECK ((labour_discount_type IS NULL) = (labour_discount_value IS NULL)),
 ADD CONSTRAINT labour_discount_percent CHECK (labour_discount_type <> 'percent' OR labour_discount_value <= 100);
CREATE TABLE public.work_order_labour_discount_audit (
 id BIGSERIAL PRIMARY KEY,
 reference_id INT NOT NULL REFERENCES public.work_orders(reference_id),
 changed_by_user_id UUID NOT NULL REFERENCES public.users(id),
 changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 old_type TEXT, old_value NUMERIC(12,2), new_type TEXT, new_value NUMERIC(12,2)
);
CREATE INDEX ON public.work_order_labour_discount_audit(reference_id, changed_at);

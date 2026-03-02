CREATE TABLE IF NOT EXISTS public.repair_logs (
  repair_log_id BIGSERIAL PRIMARY KEY,
  reference_id INTEGER NOT NULL,
  repair_date DATE NOT NULL DEFAULT CURRENT_DATE,
  details TEXT NOT NULL CHECK (BTRIM(details) <> ''),
  created_by_user_id UUID NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repair_logs_reference_id
  ON public.repair_logs(reference_id);

CREATE INDEX IF NOT EXISTS idx_repair_logs_created_by
  ON public.repair_logs(created_by_user_id);

CREATE TABLE IF NOT EXISTS public.parts_purchase_requests (
  parts_purchase_request_id BIGSERIAL PRIMARY KEY,
  reference_id INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('online', 'supplier')),
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'waiting_approval', 'ordered', 'used')),
  total_price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_price >= 0),
  item_name TEXT NOT NULL CHECK (BTRIM(item_name) <> ''),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_by_user_id UUID NOT NULL
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parts_purchase_requests_reference_id
  ON public.parts_purchase_requests(reference_id);

CREATE INDEX IF NOT EXISTS idx_parts_purchase_requests_created_by
  ON public.parts_purchase_requests(created_by_user_id);

DO $$
BEGIN
  IF to_regclass('public.work_orders') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN pg_attribute att
         ON att.attrelid = con.conrelid
        AND att.attnum = con.conkey[1]
       WHERE nsp.nspname = 'public'
         AND rel.relname = 'work_orders'
         AND con.contype IN ('p', 'u')
         AND array_length(con.conkey, 1) = 1
         AND att.attname = 'reference_id'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'fk_repair_logs_reference_id_work_orders'
         AND conrelid = 'public.repair_logs'::regclass
     ) THEN
    ALTER TABLE public.repair_logs
      ADD CONSTRAINT fk_repair_logs_reference_id_work_orders
      FOREIGN KEY (reference_id)
      REFERENCES public.work_orders(reference_id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.work_orders') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       JOIN pg_attribute att
         ON att.attrelid = con.conrelid
        AND att.attnum = con.conkey[1]
       WHERE nsp.nspname = 'public'
         AND rel.relname = 'work_orders'
         AND con.contype IN ('p', 'u')
         AND array_length(con.conkey, 1) = 1
         AND att.attname = 'reference_id'
     )
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'fk_parts_purchase_requests_reference_id_work_orders'
         AND conrelid = 'public.parts_purchase_requests'::regclass
     ) THEN
    ALTER TABLE public.parts_purchase_requests
      ADD CONSTRAINT fk_parts_purchase_requests_reference_id_work_orders
      FOREIGN KEY (reference_id)
      REFERENCES public.work_orders(reference_id)
      ON DELETE CASCADE;
  END IF;
END $$;

INSERT INTO resources (name, description)
VALUES
  ('repair_logs', 'Repair log entries linked to work orders'),
  ('parts_purchase_requests', 'Parts purchasing requests linked to work orders')
ON CONFLICT (name) DO NOTHING;

WITH target_resources AS (
  SELECT id, name
  FROM resources
  WHERE name IN ('repair_logs', 'parts_purchase_requests')
), actions AS (
  SELECT unnest(ARRAY['create','read','update','delete','assign']) AS action
)
INSERT INTO permissions (resource_id, action, code)
SELECT tr.id, a.action, tr.name || ':' || a.action
FROM target_resources tr
CROSS JOIN actions a
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON TRUE
WHERE r.name = 'owner'
  AND (
    p.code LIKE 'repair_logs:%'
    OR p.code LIKE 'parts_purchase_requests:%'
  )
ON CONFLICT DO NOTHING;

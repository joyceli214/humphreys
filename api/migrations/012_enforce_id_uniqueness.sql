-- Ensure ID columns stay unique across core tables.
-- 1) Remove duplicate rows by ID (keeps first row per ID).
-- 2) Add primary key constraints if missing.
-- 3) Sync sequences to MAX(id) to avoid future collisions.

BEGIN;

-- Deduplicate by ID where accidental duplicate IDs may exist.
DELETE FROM public.brands t
USING (
  SELECT ctid
  FROM (
    SELECT ctid, ROW_NUMBER() OVER (PARTITION BY brand_id ORDER BY ctid) AS rn
    FROM public.brands
  ) x
  WHERE x.rn > 1
) d
WHERE t.ctid = d.ctid;

DELETE FROM public.items t
USING (
  SELECT ctid
  FROM (
    SELECT ctid, ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY ctid) AS rn
    FROM public.items
  ) x
  WHERE x.rn > 1
) d
WHERE t.ctid = d.ctid;

DELETE FROM public.workers t
USING (
  SELECT ctid
  FROM (
    SELECT ctid, ROW_NUMBER() OVER (PARTITION BY worker_id ORDER BY ctid) AS rn
    FROM public.workers
  ) x
  WHERE x.rn > 1
) d
WHERE t.ctid = d.ctid;

DELETE FROM public.payment_methods t
USING (
  SELECT ctid
  FROM (
    SELECT ctid, ROW_NUMBER() OVER (PARTITION BY payment_method_id ORDER BY ctid) AS rn
    FROM public.payment_methods
  ) x
  WHERE x.rn > 1
) d
WHERE t.ctid = d.ctid;

DELETE FROM public.job_types t
USING (
  SELECT ctid
  FROM (
    SELECT ctid, ROW_NUMBER() OVER (PARTITION BY job_type_id ORDER BY ctid) AS rn
    FROM public.job_types
  ) x
  WHERE x.rn > 1
) d
WHERE t.ctid = d.ctid;

DELETE FROM public.work_order_statuses t
USING (
  SELECT ctid
  FROM (
    SELECT ctid, ROW_NUMBER() OVER (PARTITION BY status_id ORDER BY ctid) AS rn
    FROM public.work_order_statuses
  ) x
  WHERE x.rn > 1
) d
WHERE t.ctid = d.ctid;

DELETE FROM public.customers t
USING (
  SELECT ctid
  FROM (
    SELECT ctid, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY ctid) AS rn
    FROM public.customers
  ) x
  WHERE x.rn > 1
) d
WHERE t.ctid = d.ctid;

DELETE FROM public.work_order_line_items t
USING (
  SELECT ctid
  FROM (
    SELECT ctid, ROW_NUMBER() OVER (PARTITION BY line_item_id ORDER BY ctid) AS rn
    FROM public.work_order_line_items
  ) x
  WHERE x.rn > 1
) d
WHERE t.ctid = d.ctid;

DELETE FROM public.migration_runs t
USING (
  SELECT ctid
  FROM (
    SELECT ctid, ROW_NUMBER() OVER (PARTITION BY migration_run_id ORDER BY ctid) AS rn
    FROM public.migration_runs
  ) x
  WHERE x.rn > 1
) d
WHERE t.ctid = d.ctid;

-- Enforce NOT NULL on ID columns before PK creation.
ALTER TABLE public.brands ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE public.items ALTER COLUMN item_id SET NOT NULL;
ALTER TABLE public.workers ALTER COLUMN worker_id SET NOT NULL;
ALTER TABLE public.payment_methods ALTER COLUMN payment_method_id SET NOT NULL;
ALTER TABLE public.job_types ALTER COLUMN job_type_id SET NOT NULL;
ALTER TABLE public.work_order_statuses ALTER COLUMN status_id SET NOT NULL;
ALTER TABLE public.customers ALTER COLUMN customer_id SET NOT NULL;
ALTER TABLE public.work_order_line_items ALTER COLUMN line_item_id SET NOT NULL;
ALTER TABLE public.migration_runs ALTER COLUMN migration_run_id SET NOT NULL;

-- Add PK constraints if absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_pkey' AND conrelid = 'public.brands'::regclass) THEN
    ALTER TABLE public.brands ADD CONSTRAINT brands_pkey PRIMARY KEY (brand_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_pkey' AND conrelid = 'public.items'::regclass) THEN
    ALTER TABLE public.items ADD CONSTRAINT items_pkey PRIMARY KEY (item_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workers_pkey' AND conrelid = 'public.workers'::regclass) THEN
    ALTER TABLE public.workers ADD CONSTRAINT workers_pkey PRIMARY KEY (worker_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_methods_pkey' AND conrelid = 'public.payment_methods'::regclass) THEN
    ALTER TABLE public.payment_methods ADD CONSTRAINT payment_methods_pkey PRIMARY KEY (payment_method_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_types_pkey' AND conrelid = 'public.job_types'::regclass) THEN
    ALTER TABLE public.job_types ADD CONSTRAINT job_types_pkey PRIMARY KEY (job_type_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_statuses_pkey' AND conrelid = 'public.work_order_statuses'::regclass) THEN
    ALTER TABLE public.work_order_statuses ADD CONSTRAINT work_order_statuses_pkey PRIMARY KEY (status_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_pkey' AND conrelid = 'public.customers'::regclass) THEN
    ALTER TABLE public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (customer_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_order_line_items_pkey' AND conrelid = 'public.work_order_line_items'::regclass) THEN
    ALTER TABLE public.work_order_line_items ADD CONSTRAINT work_order_line_items_pkey PRIMARY KEY (line_item_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'migration_runs_pkey' AND conrelid = 'public.migration_runs'::regclass) THEN
    ALTER TABLE public.migration_runs ADD CONSTRAINT migration_runs_pkey PRIMARY KEY (migration_run_id);
  END IF;
END $$;

-- Ensure sequences continue from current max IDs.
SELECT setval(
  pg_get_serial_sequence('public.brands', 'brand_id'),
  COALESCE((SELECT MAX(brand_id) FROM public.brands), 1),
  true
);

SELECT setval(
  pg_get_serial_sequence('public.items', 'item_id'),
  COALESCE((SELECT MAX(item_id) FROM public.items), 1),
  true
);

SELECT setval(
  pg_get_serial_sequence('public.workers', 'worker_id'),
  COALESCE((SELECT MAX(worker_id) FROM public.workers), 1),
  true
);

SELECT setval(
  pg_get_serial_sequence('public.payment_methods', 'payment_method_id'),
  COALESCE((SELECT MAX(payment_method_id) FROM public.payment_methods), 1),
  true
);

SELECT setval(
  pg_get_serial_sequence('public.job_types', 'job_type_id'),
  COALESCE((SELECT MAX(job_type_id) FROM public.job_types), 1),
  true
);

SELECT setval(
  pg_get_serial_sequence('public.work_order_statuses', 'status_id'),
  COALESCE((SELECT MAX(status_id) FROM public.work_order_statuses), 1),
  true
);

SELECT setval(
  pg_get_serial_sequence('public.customers', 'customer_id'),
  COALESCE((SELECT MAX(customer_id) FROM public.customers), 1),
  true
);

SELECT setval(
  pg_get_serial_sequence('public.work_order_line_items', 'line_item_id'),
  COALESCE((SELECT MAX(line_item_id) FROM public.work_order_line_items), 1),
  true
);

SELECT setval(
  pg_get_serial_sequence('public.migration_runs', 'migration_run_id'),
  COALESCE((SELECT MAX(migration_run_id) FROM public.migration_runs), 1),
  true
);

COMMIT;

-- Humphreys DB cleanup + migration script
-- Goal:
-- 1) Keep legacy tables untouched.
-- 2) Build/maintain cleaned tables in humphreys_clean.
-- 3) Keep reruns safe during migration period.

BEGIN;

CREATE SCHEMA IF NOT EXISTS humphreys_clean;

CREATE OR REPLACE FUNCTION humphreys_clean.to_markdown(input_text TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  WITH cleaned AS (
    SELECT NULLIF(
      BTRIM(
        regexp_replace(
          regexp_replace(COALESCE(input_text, ''), E'\\r\\n?', E'\n', 'g'),
          E'[\\t ]+',
          ' ',
          'g'
        )
      ),
      ''
    ) AS txt
  ), parts AS (
    SELECT
      NULLIF(BTRIM(p.part), '') AS part,
      p.ord
    FROM cleaned c
    CROSS JOIN LATERAL unnest(
      regexp_split_to_array(
        regexp_replace(c.txt, E'\\n{2,}', E'\n', 'g'),
        E'\\n|;'
      )
    ) WITH ORDINALITY AS p(part, ord)
    WHERE c.txt IS NOT NULL
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM parts WHERE part IS NOT NULL)
    THEN '- ' || string_agg(part, E'\n- ' ORDER BY ord)
    ELSE NULL
  END
  FROM parts
  WHERE part IS NOT NULL;
$$;

-- Drop deprecated/unused tables.
DROP TABLE IF EXISTS humphreys_clean.referral_source_catalog;
DROP TABLE IF EXISTS "known from";
DROP TABLE IF EXISTS humphreys_clean.stock_items;
DROP TABLE IF EXISTS humphreys_clean.global_references;

CREATE TABLE IF NOT EXISTS humphreys_clean.migration_runs (
  migration_run_id BIGSERIAL PRIMARY KEY,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT NOT NULL DEFAULT 'load from legacy tables'
);

CREATE TABLE IF NOT EXISTS humphreys_clean.workers (
  worker_id BIGSERIAL PRIMARY KEY,
  worker_name TEXT NOT NULL UNIQUE
);

TRUNCATE TABLE humphreys_clean.workers RESTART IDENTITY;

INSERT INTO humphreys_clean.workers (worker_id, worker_name)
VALUES
  (1, 'Dave'),
  (2, 'Conor'),
  (3, 'Justin'),
  (4, 'Gord'),
  (5, 'Greg'),
  (6, 'George'),
  (7, 'Nadav'),
  (8, 'Percy'),
  (9, 'Ray'),
  (10, 'Nishu'),
  (11, 'Tom');

SELECT setval(
  pg_get_serial_sequence('humphreys_clean.workers', 'worker_id'),
  (SELECT COALESCE(MAX(worker_id), 1) FROM humphreys_clean.workers),
  true
);

CREATE TABLE IF NOT EXISTS humphreys_clean.job_types (
  job_type_id BIGSERIAL PRIMARY KEY,
  job_type_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL UNIQUE
);

INSERT INTO humphreys_clean.job_types (job_type_id, job_type_key, display_name)
VALUES
  (1, 'stock', 'Stock'),
  (2, 'repair', 'Repair'),
  (3, 'warranty', 'Warranty')
ON CONFLICT (job_type_id) DO UPDATE
SET job_type_key = EXCLUDED.job_type_key,
    display_name = EXCLUDED.display_name;

SELECT setval(
  pg_get_serial_sequence('humphreys_clean.job_types', 'job_type_id'),
  (SELECT COALESCE(MAX(job_type_id), 1) FROM humphreys_clean.job_types),
  true
);

CREATE TABLE IF NOT EXISTS humphreys_clean.work_order_statuses (
  status_id BIGSERIAL PRIMARY KEY,
  status_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL UNIQUE
);

INSERT INTO humphreys_clean.work_order_statuses (status_id, status_key, display_name)
VALUES
  (1, 'received', 'Received'),
  (2, 'finished', 'Finished'),
  (3, 'picked_up', 'Picked Up')
ON CONFLICT (status_id) DO UPDATE
SET status_key = EXCLUDED.status_key,
    display_name = EXCLUDED.display_name;

SELECT setval(
  pg_get_serial_sequence('humphreys_clean.work_order_statuses', 'status_id'),
  (SELECT COALESCE(MAX(status_id), 1) FROM humphreys_clean.work_order_statuses),
  true
);

CREATE TABLE IF NOT EXISTS humphreys_clean.work_orders (
  reference_id INTEGER NOT NULL,
  customer_id BIGINT,
  original_job_id INTEGER,
  job_type_id BIGINT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  status_id BIGINT,
  item_id BIGINT,
  brand_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  model_number TEXT,
  serial_number TEXT,
  remote_control_qty INTEGER NOT NULL DEFAULT 0,
  cable_qty INTEGER NOT NULL DEFAULT 0,
  cord_qty INTEGER NOT NULL DEFAULT 0,
  album_cd_cassette_qty INTEGER NOT NULL DEFAULT 0,
  problem_description TEXT,
  worker_ids INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  work_done TEXT,
  payment_method_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[],
  parts_total NUMERIC(12,2),
  delivery_total NUMERIC(12,2),
  labour_total NUMERIC(12,2),
  deposit NUMERIC(12,2) NOT NULL DEFAULT 0,
  source_hash TEXT NOT NULL,
  source_loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS humphreys_clean.customers (
  customer_id BIGSERIAL PRIMARY KEY,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  province TEXT,
  home_phone TEXT,
  work_phone TEXT,
  extension_text TEXT,
  source_loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Compatibility: move legacy/superseded columns into new shape where needed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='humphreys_clean' AND table_name='work_orders' AND column_name='legacy_work_order_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='humphreys_clean' AND table_name='work_orders' AND column_name='reference_id'
  ) THEN
    ALTER TABLE humphreys_clean.work_orders RENAME COLUMN legacy_work_order_id TO reference_id;
  END IF;
END $$;

ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS original_job_id INTEGER;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS customer_id BIGINT;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS job_type_id BIGINT;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS status_id BIGINT;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS item_id BIGINT;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS brand_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[];
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS remote_control_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS cable_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS cord_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS album_cd_cassette_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS worker_ids INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS work_done TEXT;
ALTER TABLE humphreys_clean.work_orders ADD COLUMN IF NOT EXISTS deposit NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE humphreys_clean.customers ADD COLUMN IF NOT EXISTS address_line_1 TEXT;
ALTER TABLE humphreys_clean.customers ADD COLUMN IF NOT EXISTS address_line_2 TEXT;
ALTER TABLE humphreys_clean.customers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE humphreys_clean.customers ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE humphreys_clean.customers ADD COLUMN IF NOT EXISTS home_phone TEXT;
ALTER TABLE humphreys_clean.customers ADD COLUMN IF NOT EXISTS work_phone TEXT;
ALTER TABLE humphreys_clean.customers ADD COLUMN IF NOT EXISTS extension_text TEXT;
ALTER TABLE humphreys_clean.customers ALTER COLUMN email DROP NOT NULL;
ALTER TABLE humphreys_clean.customers ALTER COLUMN home_phone DROP NOT NULL;
ALTER TABLE humphreys_clean.customers ALTER COLUMN work_phone DROP NOT NULL;
ALTER TABLE humphreys_clean.customers DROP COLUMN IF EXISTS phone;
ALTER TABLE humphreys_clean.customers DROP COLUMN IF EXISTS email_norm;
ALTER TABLE humphreys_clean.customers DROP COLUMN IF EXISTS phone_norm;
ALTER TABLE humphreys_clean.customers DROP COLUMN IF EXISTS source_reference_id;
DROP INDEX IF EXISTS humphreys_clean.uq_customers_email_phone_norm;
DROP INDEX IF EXISTS humphreys_clean.uq_customers_email_home_or_work;
CREATE INDEX IF NOT EXISTS idx_customers_email_home_or_work
  ON humphreys_clean.customers (email, COALESCE(home_phone, work_phone));

-- Migrate old work_orders.job_type into job_type_id (if the legacy column still exists).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='humphreys_clean' AND table_name='work_orders' AND column_name='job_type'
  ) THEN
    UPDATE humphreys_clean.work_orders
    SET job_type_id = CASE
      WHEN lower(coalesce(job_type::text,''))='stock' THEN 1
      WHEN lower(coalesce(job_type::text,''))='warranty' THEN 3
      ELSE 2
    END
    WHERE job_type_id IS NULL;

    ALTER TABLE humphreys_clean.work_orders DROP COLUMN job_type;
  END IF;
END $$;

-- Deposit is sourced from legacy "Customer Information"."Note" during the main upsert.

DO $$
DECLARE
  pk_name TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='humphreys_clean' AND table_name='work_orders' AND column_name='work_order_id'
  ) THEN
    SELECT conname INTO pk_name
    FROM pg_constraint
    WHERE conrelid='humphreys_clean.work_orders'::regclass
      AND contype='p'
    LIMIT 1;

    IF pk_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE humphreys_clean.work_orders DROP CONSTRAINT %I', pk_name);
    END IF;

    ALTER TABLE humphreys_clean.work_orders DROP COLUMN work_order_id;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid='humphreys_clean.work_orders'::regclass
      AND contype='p'
  ) THEN
    ALTER TABLE humphreys_clean.work_orders
      ADD CONSTRAINT work_orders_pkey PRIMARY KEY (reference_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname='fk_work_orders_job_type_id'
      AND conrelid='humphreys_clean.work_orders'::regclass
  ) THEN
    ALTER TABLE humphreys_clean.work_orders
      ADD CONSTRAINT fk_work_orders_job_type_id
      FOREIGN KEY (job_type_id)
      REFERENCES humphreys_clean.job_types(job_type_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname='fk_work_orders_status_id'
      AND conrelid='humphreys_clean.work_orders'::regclass
  ) THEN
    ALTER TABLE humphreys_clean.work_orders
      ADD CONSTRAINT fk_work_orders_status_id
      FOREIGN KEY (status_id)
      REFERENCES humphreys_clean.work_order_statuses(status_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname='fk_work_orders_customer_id'
      AND conrelid='humphreys_clean.work_orders'::regclass
  ) THEN
    ALTER TABLE humphreys_clean.work_orders
      ADD CONSTRAINT fk_work_orders_customer_id
      FOREIGN KEY (customer_id)
      REFERENCES humphreys_clean.customers(customer_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname='fk_work_orders_original_job_id'
      AND conrelid='humphreys_clean.work_orders'::regclass
  ) THEN
    ALTER TABLE humphreys_clean.work_orders
      ADD CONSTRAINT fk_work_orders_original_job_id
      FOREIGN KEY (original_job_id)
      REFERENCES humphreys_clean.work_orders(reference_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS humphreys_clean.idx_work_orders_received_at;
CREATE INDEX IF NOT EXISTS idx_work_orders_created_at
  ON humphreys_clean.work_orders (created_at);
CREATE INDEX IF NOT EXISTS idx_work_orders_customer_id
  ON humphreys_clean.work_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_original_job_id
  ON humphreys_clean.work_orders (original_job_id);

-- Drop columns that are no longer part of target model.
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS storage_location;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS includes_battery;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS estimate_notes;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS work_notes;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS subtotal;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS gst;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS pst;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS total;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS total_payable;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS customer_deposit;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS includes_remote_control;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS includes_battery_charger;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS includes_cord;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS included_media;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS technician_name;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS technician_codes;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS additional_details;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS internal_note;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS payment_method_text;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS first_name;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS last_name;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS address_line_1;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS address_line_2;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS city;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS province;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS email;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS home_phone;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS work_phone;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS extension_text;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS received_at;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS finished_at;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS picked_up_at;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS status;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS item_name;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS brand_name;

DO $$
BEGIN
  IF to_regclass('humphreys_clean.item_catalog') IS NOT NULL
     AND to_regclass('humphreys_clean.items') IS NULL THEN
    ALTER TABLE humphreys_clean.item_catalog RENAME TO items;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS humphreys_clean.items (
  item_id BIGSERIAL PRIMARY KEY,
  item_name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  source_loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE humphreys_clean.items
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname='fk_work_orders_item_id'
      AND conrelid='humphreys_clean.work_orders'::regclass
  ) THEN
    ALTER TABLE humphreys_clean.work_orders
      ADD CONSTRAINT fk_work_orders_item_id
      FOREIGN KEY (item_id)
      REFERENCES humphreys_clean.items(item_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_orders_item_id
  ON humphreys_clean.work_orders (item_id);

DO $$
BEGIN
  IF to_regclass('humphreys_clean.brand_catalog') IS NOT NULL
     AND to_regclass('humphreys_clean.brands') IS NULL THEN
    ALTER TABLE humphreys_clean.brand_catalog RENAME TO brands;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS humphreys_clean.brands (
  brand_id BIGSERIAL PRIMARY KEY,
  brand_name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  source_loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE humphreys_clean.brands
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF to_regclass('humphreys_clean.payment_method_catalog') IS NOT NULL
     AND to_regclass('humphreys_clean.payment_methods') IS NULL THEN
    ALTER TABLE humphreys_clean.payment_method_catalog RENAME TO payment_methods;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS humphreys_clean.payment_methods (
  payment_method_id BIGSERIAL PRIMARY KEY,
  payment_method_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  source_loaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE humphreys_clean.payment_methods
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE humphreys_clean.work_orders
  ADD COLUMN IF NOT EXISTS payment_method_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[];

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname='fk_work_orders_payment_method_id'
      AND conrelid='humphreys_clean.work_orders'::regclass
  ) THEN
    ALTER TABLE humphreys_clean.work_orders
      DROP CONSTRAINT fk_work_orders_payment_method_id;
  END IF;
END $$;

ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS payment_method_id;
ALTER TABLE humphreys_clean.work_orders DROP COLUMN IF EXISTS item_ids;

CREATE TABLE IF NOT EXISTS humphreys_clean.work_order_line_items (
  line_item_id BIGSERIAL PRIMARY KEY,
  reference_id INTEGER NOT NULL,
  item_name TEXT,
  unit_price NUMERIC(12,2),
  quantity_text TEXT,
  line_total_text TEXT,
  source_loaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_line_items_work_order
    FOREIGN KEY (reference_id)
    REFERENCES humphreys_clean.work_orders(reference_id)
    ON DELETE CASCADE
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='humphreys_clean' AND table_name='work_order_line_items' AND column_name='legacy_work_order_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='humphreys_clean' AND table_name='work_order_line_items' AND column_name='reference_id'
  ) THEN
    ALTER TABLE humphreys_clean.work_order_line_items
      RENAME COLUMN legacy_work_order_id TO reference_id;
  END IF;
END $$;

DROP INDEX IF EXISTS humphreys_clean.idx_line_items_legacy_work_order_id;
CREATE INDEX IF NOT EXISTS idx_line_items_reference_id
  ON humphreys_clean.work_order_line_items (reference_id);

WITH src AS (
  SELECT
    ci."CustomerID"::INTEGER AS reference_id,
    NULL::INTEGER AS original_job_id,
    CASE
      WHEN REGEXP_REPLACE(
        LOWER(BTRIM(COALESCE(ci."FirstName", '') || ' ' || COALESCE(ci."LastName", ''))),
        '\\s+',
        ' ',
        'g'
      ) LIKE '%humphreys%'
      AND REGEXP_REPLACE(
        LOWER(BTRIM(COALESCE(ci."FirstName", '') || ' ' || COALESCE(ci."LastName", ''))),
        '\\s+',
        ' ',
        'g'
      ) !~ '(^| )mr\\.?( |$)'
      AND REGEXP_REPLACE(
        LOWER(BTRIM(COALESCE(ci."FirstName", '') || ' ' || COALESCE(ci."LastName", ''))),
        '\\s+',
        ' ',
        'g'
      ) !~ '(^| )mrs\\.?( |$)'
      THEN 1
      ELSE 2
    END::BIGINT AS job_type_id,
    CASE
      WHEN ci."Date Received" IS NOT NULL
       AND EXTRACT(YEAR FROM ci."Date Received") BETWEEN 1990 AND EXTRACT(YEAR FROM CURRENT_DATE) + 1
      THEN ci."Date Received"
      ELSE NULL
    END AS received_at,
    CASE
      WHEN ci."Date Finished" IS NOT NULL
       AND EXTRACT(YEAR FROM ci."Date Finished") BETWEEN 1990 AND EXTRACT(YEAR FROM CURRENT_DATE) + 1
      THEN ci."Date Finished"
      ELSE NULL
    END AS finished_at,
    CASE
      WHEN ci."Date Picked-up" IS NOT NULL
       AND EXTRACT(YEAR FROM ci."Date Picked-up") BETWEEN 1990 AND EXTRACT(YEAR FROM CURRENT_DATE) + 1
      THEN ci."Date Picked-up"
      ELSE NULL
    END AS picked_up_at,
    NULLIF(BTRIM(ci."FirstName"), '') AS first_name,
    NULLIF(BTRIM(ci."LastName"), '') AS last_name,
    NULLIF(BTRIM(ci."Address"), '') AS address_line_1,
    NULLIF(BTRIM(ci."Apartment or Suite"), '') AS address_line_2,
    NULLIF(BTRIM(ci."City"), '') AS city,
    NULLIF(BTRIM(ci."Province"), '') AS province,
    lower(
      NULLIF(
        (
          regexp_match(
            COALESCE(ci."E-mail", ''),
            '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})'
          )
        )[1],
        ''
      )
    ) AS email,
    NULLIF(BTRIM(ci."Home Phone"), '') AS home_phone,
    NULLIF(BTRIM(ci."Work Phone"), '') AS work_phone,
    NULLIF(BTRIM(ci."Extension"::TEXT), '') AS extension_text,
    NULLIF(BTRIM(ci."Item"), '') AS item_name,
    NULLIF(BTRIM(ci."Brand"), '') AS brand_name,
    NULLIF(BTRIM(ci."Model Number"), '') AS model_number,
    NULLIF(BTRIM(ci."Serial Number"), '') AS serial_number,
    CASE
      WHEN regexp_match(COALESCE(ci."Remote Control", ''), '[0-9]+') IS NOT NULL
        THEN LEAST(2147483647, ((regexp_match(COALESCE(ci."Remote Control", ''), '[0-9]+'))[1])::INTEGER)
      WHEN NULLIF(BTRIM(ci."Remote Control"), '') IS NOT NULL THEN 1
      ELSE 0
    END AS remote_control_qty,
    CASE
      WHEN regexp_match(COALESCE(ci."Battery charger", ''), '[0-9]+') IS NOT NULL
        THEN LEAST(2147483647, ((regexp_match(COALESCE(ci."Battery charger", ''), '[0-9]+'))[1])::INTEGER)
      WHEN NULLIF(BTRIM(ci."Battery charger"), '') IS NOT NULL THEN 1
      ELSE 0
    END AS cable_qty,
    CASE
      WHEN regexp_match(COALESCE(ci."Cord", ''), '[0-9]+') IS NOT NULL
        THEN LEAST(2147483647, ((regexp_match(COALESCE(ci."Cord", ''), '[0-9]+'))[1])::INTEGER)
      WHEN NULLIF(BTRIM(ci."Cord"), '') IS NOT NULL THEN 1
      ELSE 0
    END AS cord_qty,
    CASE
      WHEN regexp_match(COALESCE(ci."Albums/DVD/CDs", ''), '[0-9]+') IS NOT NULL
        THEN LEAST(2147483647, ((regexp_match(COALESCE(ci."Albums/DVD/CDs", ''), '[0-9]+'))[1])::INTEGER)
      WHEN NULLIF(BTRIM(ci."Albums/DVD/CDs"), '') IS NOT NULL THEN 1
      ELSE 0
    END AS album_cd_cassette_qty,
    humphreys_clean.to_markdown(ci."Problem") AS problem_description,
    ARRAY(
      SELECT wid
      FROM (
        SELECT DISTINCT w.worker_id::INTEGER AS wid
      FROM regexp_split_to_table(COALESCE(ci."Technician", ''), '/') tok(raw_part)
      CROSS JOIN LATERAL (
        SELECT lower(regexp_replace(BTRIM(tok.raw_part), '[^a-z]', '', 'g')) AS token
      ) t
      JOIN humphreys_clean.workers w
        ON w.worker_name = CASE
          WHEN t.token IN ('c', 'conor') THEN 'Conor'
          WHEN t.token IN ('j', 'justin') THEN 'Justin'
          WHEN t.token IN ('d', 'dave') THEN 'Dave'
          WHEN t.token IN ('gord') THEN 'Gord'
          WHEN t.token IN ('gr', 'greg') THEN 'Greg'
          WHEN t.token IN ('g', 'george') THEN 'George'
          WHEN t.token IN ('n', 'nadav') THEN 'Nadav'
          WHEN t.token IN ('p', 'percy') THEN 'Percy'
          WHEN t.token IN ('r', 'ray') THEN 'Ray'
          WHEN t.token IN ('ni', 'nishu') THEN 'Nishu'
          WHEN t.token IN ('t', 'tom') THEN 'Tom'
          ELSE NULL
        END
      ) mapped_workers
      ORDER BY wid
    ) AS worker_ids,
    humphreys_clean.to_markdown(ci."Details") AS work_done,
    ci."Parts Total"::NUMERIC(12,2) AS parts_total,
    ci."Delivery"::NUMERIC(12,2) AS delivery_total,
    ci."Labour Total"::NUMERIC(12,2) AS labour_total,
    COALESCE(
      ci."Deposit"::NUMERIC(12,2),
      CASE
        WHEN regexp_match(COALESCE(ci."Note", ''), '[-+]?[0-9]*\\.?[0-9]+') IS NOT NULL
        THEN LEAST(
          9999999999.99::numeric,
          GREATEST(
            -9999999999.99::numeric,
            NULLIF(
              regexp_replace(
                ((regexp_match(COALESCE(ci."Note", ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]),
                '[^0-9.+-]',
                '',
                'g'
              ),
              ''
            )::numeric
          )
        )::NUMERIC(12,2)
      END,
      0
    ) AS deposit,
    md5(concat_ws('|',
      ci."CustomerID"::TEXT,
      COALESCE(ci."Date Received"::TEXT, ''),
      COALESCE(ci."Date Finished"::TEXT, ''),
      COALESCE(ci."Date Picked-up"::TEXT, ''),
      COALESCE(ci."FirstName", ''),
      COALESCE(ci."LastName", ''),
      COALESCE(ci."Address", ''),
      COALESCE(ci."Apartment or Suite", ''),
      COALESCE(ci."City", ''),
      COALESCE(ci."Province", ''),
      COALESCE(ci."E-mail", ''),
      COALESCE(ci."Home Phone", ''),
      COALESCE(ci."Work Phone", ''),
      COALESCE(ci."Extension"::TEXT, ''),
      COALESCE(ci."Item", ''),
      COALESCE(ci."Brand", ''),
      COALESCE(ci."Model Number", ''),
      COALESCE(ci."Serial Number", ''),
      COALESCE(ci."Remote Control", ''),
      COALESCE(ci."Battery charger", ''),
      COALESCE(ci."Cord", ''),
      COALESCE(ci."Albums/DVD/CDs", ''),
      COALESCE(ci."Problem", ''),
      COALESCE(ci."Technician", ''),
      COALESCE(ci."Details", ''),
      COALESCE(ci."Payment Method", ''),
      COALESCE(ci."Parts Total"::TEXT, ''),
      COALESCE(ci."Delivery"::TEXT, ''),
      COALESCE(ci."Labour Total"::TEXT, ''),
      COALESCE(ci."Deposit"::TEXT, ''),
      COALESCE(ci."Note", '')
    )) AS source_hash
  FROM "Customer Information" ci
)
INSERT INTO humphreys_clean.work_orders (
  reference_id,
  original_job_id,
  job_type_id,
  created_at,
  updated_at,
  status_id,
  item_id,
  brand_ids,
  model_number,
  serial_number,
  remote_control_qty,
  cable_qty,
  cord_qty,
  album_cd_cassette_qty,
  problem_description,
  worker_ids,
  work_done,
  payment_method_ids,
  parts_total,
  delivery_total,
  labour_total,
  deposit,
  source_hash
)
SELECT
  reference_id,
  original_job_id,
  job_type_id,
  received_at AS created_at,
  COALESCE(
    CASE
      WHEN (
        SELECT MAX(dt)
        FROM (VALUES (received_at), (finished_at), (picked_up_at)) AS all_dates(dt)
      )::DATE > CURRENT_DATE
      THEN received_at
      ELSE (
        SELECT MAX(dt)
        FROM (VALUES (received_at), (finished_at), (picked_up_at)) AS all_dates(dt)
      )
    END,
    received_at
  ) AS updated_at,
  CASE
    WHEN picked_up_at IS NOT NULL THEN 3
    WHEN finished_at IS NOT NULL THEN 2
    ELSE 1
  END::BIGINT AS status_id,
  NULL::BIGINT AS item_id,
  ARRAY[]::BIGINT[] AS brand_ids,
  model_number,
  serial_number,
  remote_control_qty,
  cable_qty,
  cord_qty,
  album_cd_cassette_qty,
  problem_description,
  worker_ids,
  work_done,
  ARRAY[]::BIGINT[] AS payment_method_ids,
  parts_total,
  delivery_total,
  labour_total,
  deposit,
  source_hash
FROM src
ON CONFLICT (reference_id) DO UPDATE
SET
  job_type_id = CASE
    WHEN humphreys_clean.work_orders.original_job_id IS NOT NULL
      OR humphreys_clean.work_orders.job_type_id = 3
    THEN 3
    ELSE EXCLUDED.job_type_id
  END,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  status_id = EXCLUDED.status_id,
  item_id = EXCLUDED.item_id,
  brand_ids = EXCLUDED.brand_ids,
  model_number = EXCLUDED.model_number,
  serial_number = EXCLUDED.serial_number,
  remote_control_qty = EXCLUDED.remote_control_qty,
  cable_qty = EXCLUDED.cable_qty,
  cord_qty = EXCLUDED.cord_qty,
  album_cd_cassette_qty = EXCLUDED.album_cd_cassette_qty,
  problem_description = EXCLUDED.problem_description,
  worker_ids = EXCLUDED.worker_ids,
  work_done = EXCLUDED.work_done,
  payment_method_ids = EXCLUDED.payment_method_ids,
  parts_total = EXCLUDED.parts_total,
  delivery_total = EXCLUDED.delivery_total,
  labour_total = EXCLUDED.labour_total,
  deposit = EXCLUDED.deposit,
  source_hash = EXCLUDED.source_hash,
  source_loaded_at = now()
WHERE humphreys_clean.work_orders.source_hash IS DISTINCT FROM EXCLUDED.source_hash;

UPDATE humphreys_clean.work_orders wo
SET
  problem_description = humphreys_clean.to_markdown(ci."Problem"),
  work_done = humphreys_clean.to_markdown(ci."Details")
FROM "Customer Information" ci
WHERE wo.reference_id = ci."CustomerID"::INTEGER
  AND (
    wo.problem_description IS DISTINCT FROM humphreys_clean.to_markdown(ci."Problem")
    OR wo.work_done IS DISTINCT FROM humphreys_clean.to_markdown(ci."Details")
  );

UPDATE humphreys_clean.work_orders
SET customer_id = NULL;

DELETE FROM humphreys_clean.customers;

WITH customer_source AS (
  SELECT
    lower(
      NULLIF(
        (
          regexp_match(
            COALESCE(ci."E-mail", ''),
            '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})'
          )
        )[1],
        ''
      )
    ) AS email,
    NULLIF(regexp_replace(NULLIF(BTRIM(ci."Home Phone"), ''), '[^0-9]', '', 'g'), '') AS home_phone,
    NULLIF(regexp_replace(NULLIF(BTRIM(ci."Work Phone"), ''), '[^0-9]', '', 'g'), '') AS work_phone,
    NULLIF(BTRIM(ci."FirstName"), '') AS first_name,
    NULLIF(BTRIM(ci."LastName"), '') AS last_name,
    NULLIF(BTRIM(ci."Address"), '') AS address_line_1,
    NULLIF(BTRIM(ci."Apartment or Suite"), '') AS address_line_2,
    NULLIF(BTRIM(ci."City"), '') AS city,
    NULLIF(BTRIM(ci."Province"), '') AS province,
    NULLIF(BTRIM(ci."Extension"::TEXT), '') AS extension_text
  FROM "Customer Information" ci
), grouped_customers AS (
  SELECT DISTINCT ON (email, phone_key)
    email,
    first_name,
    last_name,
    address_line_1,
    address_line_2,
    city,
    province,
    home_phone,
    work_phone,
    extension_text,
    phone_key
  FROM (
    SELECT
      cs.*,
      COALESCE(cs.home_phone, cs.work_phone) AS phone_key
    FROM customer_source cs
  ) x
  ORDER BY email, phone_key, LENGTH(COALESCE(first_name, '') || COALESCE(last_name, '')) DESC
)
INSERT INTO humphreys_clean.customers (
  email,
  first_name,
  last_name,
  address_line_1,
  address_line_2,
  city,
  province,
  home_phone,
  work_phone,
  extension_text
)
SELECT
  email,
  first_name,
  last_name,
  address_line_1,
  address_line_2,
  city,
  province,
  home_phone,
  work_phone,
  extension_text
FROM grouped_customers;

WITH work_order_contacts AS (
  SELECT
    wo.reference_id,
    lower(
      NULLIF(
        (
          regexp_match(
            COALESCE(ci."E-mail", ''),
            '([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})'
          )
        )[1],
        ''
      )
    ) AS email,
    COALESCE(
      NULLIF(regexp_replace(NULLIF(BTRIM(ci."Home Phone"), ''), '[^0-9]', '', 'g'), ''),
      NULLIF(regexp_replace(NULLIF(BTRIM(ci."Work Phone"), ''), '[^0-9]', '', 'g'), '')
    ) AS phone_key
  FROM humphreys_clean.work_orders wo
  JOIN "Customer Information" ci
    ON ci."CustomerID" = wo.reference_id
), customer_keys AS (
  SELECT
    MIN(c.customer_id) AS customer_id,
    COALESCE(c.email, '') AS email_key,
    COALESCE(COALESCE(c.home_phone, c.work_phone), '') AS phone_key
  FROM humphreys_clean.customers c
  GROUP BY COALESCE(c.email, ''), COALESCE(COALESCE(c.home_phone, c.work_phone), '')
), matched AS (
  SELECT
    woc.reference_id,
    ck.customer_id
  FROM work_order_contacts woc
  JOIN customer_keys ck
    ON ck.email_key = COALESCE(woc.email, '')
   AND ck.phone_key = COALESCE(woc.phone_key, '')
)
UPDATE humphreys_clean.work_orders wo
SET customer_id = m.customer_id
FROM matched m
WHERE wo.reference_id = m.reference_id;

-- Backfill missing created_at using nearest reference_id with a known created_at.
WITH nearest_created AS (
  SELECT
    wo.reference_id,
    n.created_at AS nearest_created_at
  FROM humphreys_clean.work_orders wo
  JOIN LATERAL (
    SELECT wo2.created_at
    FROM humphreys_clean.work_orders wo2
    WHERE wo2.created_at IS NOT NULL
    ORDER BY abs(wo2.reference_id - wo.reference_id), wo2.reference_id
    LIMIT 1
  ) n ON TRUE
  WHERE wo.created_at IS NULL
)
UPDATE humphreys_clean.work_orders wo
SET created_at = nc.nearest_created_at
FROM nearest_created nc
WHERE wo.reference_id = nc.reference_id
  AND nc.nearest_created_at IS NOT NULL;

UPDATE humphreys_clean.work_orders wo
SET updated_at = COALESCE(wo.updated_at, wo.created_at)
WHERE wo.updated_at IS NULL;

UPDATE humphreys_clean.work_orders wo
SET updated_at = wo.created_at
WHERE wo.updated_at::DATE > CURRENT_DATE;

UPDATE humphreys_clean.work_orders wo
SET status_id = CASE
  WHEN wo.status_id IS NOT NULL THEN wo.status_id
  WHEN wo.updated_at IS NOT NULL AND wo.created_at IS NOT NULL AND wo.updated_at > wo.created_at THEN 2
  ELSE 1
END;

TRUNCATE TABLE humphreys_clean.brands RESTART IDENTITY;

INSERT INTO humphreys_clean.brands (brand_name, is_active)
WITH public_brand_preferred AS (
  SELECT DISTINCT ON (brand_ci)
    brand_ci,
    brand_name
  FROM (
    SELECT
      lower(BTRIM(b."Brand")) AS brand_ci,
      BTRIM(b."Brand") AS brand_name
    FROM brand b
    WHERE NULLIF(BTRIM(b."Brand"), '') IS NOT NULL
  ) p
  ORDER BY brand_ci, LENGTH(brand_name) DESC, brand_name
), active_brand_names AS (
  SELECT brand_ci
  FROM public_brand_preferred
), raw_brand AS (
  SELECT NULLIF(BTRIM(tok.raw_part), '') AS brand_token
  FROM "Customer Information" ci
  CROSS JOIN LATERAL regexp_split_to_table(COALESCE(ci."Brand", ''), '/') tok(raw_part)
  UNION ALL
  SELECT brand_name AS brand_token FROM public_brand_preferred
), deduped AS (
  SELECT DISTINCT ON (brand_ci)
    brand_token AS inferred_name,
    brand_ci
  FROM (
    SELECT
      brand_token,
      lower(BTRIM(brand_token)) AS brand_ci
    FROM raw_brand
    WHERE brand_token IS NOT NULL
  ) s
  WHERE brand_ci <> ''
  ORDER BY brand_ci, LENGTH(brand_token) DESC, brand_token
)
SELECT
  COALESCE(pbp.brand_name, d.inferred_name) AS brand_name,
  (d.brand_ci IN (SELECT brand_ci FROM active_brand_names)) AS is_active
FROM deduped d
LEFT JOIN public_brand_preferred pbp
  ON pbp.brand_ci = d.brand_ci;

UPDATE humphreys_clean.work_orders
SET item_id = NULL;

DELETE FROM humphreys_clean.items;
SELECT setval(
  pg_get_serial_sequence('humphreys_clean.items', 'item_id'),
  1,
  false
);

INSERT INTO humphreys_clean.items (item_name, is_active)
WITH public_item_preferred AS (
  SELECT DISTINCT ON (item_ci)
    item_ci,
    item_name
  FROM (
    SELECT
      lower(BTRIM(i."ProductName")) AS item_ci,
      BTRIM(i."ProductName") AS item_name
    FROM public.items i
    WHERE NULLIF(BTRIM(i."ProductName"), '') IS NOT NULL
  ) p
  ORDER BY item_ci, LENGTH(item_name) DESC, item_name
), active_item_names AS (
  SELECT item_ci
  FROM public_item_preferred
), raw_item AS (
  SELECT NULLIF(BTRIM(tok.raw_part), '') AS item_token
  FROM "Customer Information" ci
  CROSS JOIN LATERAL regexp_split_to_table(COALESCE(ci."Item", ''), '/') tok(raw_part)
  UNION ALL
  SELECT item_name AS item_token FROM public_item_preferred
), deduped AS (
  SELECT DISTINCT ON (item_ci)
    item_token AS inferred_name,
    item_ci
  FROM (
    SELECT
      item_token,
      lower(BTRIM(item_token)) AS item_ci
    FROM raw_item
    WHERE item_token IS NOT NULL
  ) s
  WHERE item_ci <> ''
  ORDER BY item_ci, LENGTH(item_token) DESC, item_token
)
SELECT
  COALESCE(pip.item_name, d.inferred_name) AS item_name,
  (d.item_ci IN (SELECT item_ci FROM active_item_names)) AS is_active
FROM deduped d
LEFT JOIN public_item_preferred pip
  ON pip.item_ci = d.item_ci;

UPDATE humphreys_clean.work_orders wo
SET item_id = im.item_id
FROM (
  WITH item_keys AS (
    SELECT
      MIN(i.item_id) AS item_id,
      lower(BTRIM(i.item_name)) AS item_ci
    FROM humphreys_clean.items i
    GROUP BY lower(BTRIM(i.item_name))
  )
  SELECT
    ci."CustomerID"::INTEGER AS reference_id,
    (
      SELECT ik.item_id
      FROM unnest(regexp_split_to_array(COALESCE(ci."Item", ''), '/')) WITH ORDINALITY tok(raw_part, ord)
      CROSS JOIN LATERAL (
        SELECT NULLIF(BTRIM(tok.raw_part), '') AS item_token
      ) t
      JOIN item_keys ik
        ON ik.item_ci = lower(BTRIM(COALESCE(t.item_token, '')))
      ORDER BY tok.ord
      LIMIT 1
    ) AS item_id
  FROM "Customer Information" ci
) im
WHERE wo.reference_id = im.reference_id;

UPDATE humphreys_clean.work_orders wo
SET brand_ids = COALESCE(bm.brand_ids, ARRAY[]::BIGINT[])
FROM (
  WITH brand_keys AS (
    SELECT
      MIN(b.brand_id) AS brand_id,
      lower(BTRIM(b.brand_name)) AS brand_ci
    FROM humphreys_clean.brands b
    GROUP BY lower(BTRIM(b.brand_name))
  )
  SELECT
    ci."CustomerID"::INTEGER AS reference_id,
    ARRAY(
      SELECT DISTINCT bk.brand_id
      FROM regexp_split_to_table(COALESCE(ci."Brand", ''), '/') tok(raw_part)
      CROSS JOIN LATERAL (
        SELECT NULLIF(BTRIM(tok.raw_part), '') AS brand_token
      ) t
      JOIN brand_keys bk
        ON bk.brand_ci = lower(BTRIM(COALESCE(t.brand_token, '')))
      ORDER BY bk.brand_id
    ) AS brand_ids
  FROM "Customer Information" ci
) bm
WHERE wo.reference_id = bm.reference_id;

INSERT INTO humphreys_clean.payment_methods (payment_method_key, display_name, is_active)
WITH raw_pm AS (
  SELECT NULLIF(BTRIM(pm."Payment Method"), '') AS pm_name FROM "Payment Method" pm
  UNION ALL
  SELECT NULLIF(BTRIM(ci."Payment Method"), '') AS pm_name FROM "Customer Information" ci
), split_pm AS (
  SELECT NULLIF(BTRIM(tok.raw_part), '') AS token
  FROM raw_pm
  CROSS JOIN LATERAL regexp_split_to_table(COALESCE(pm_name, ''), '/') tok(raw_part)
), normalized AS (
  SELECT
    CASE
      WHEN compact = 'cash' THEN 'cash'
      WHEN compact IN ('etransfer', 'emailtransfer', 'emailmoneytransfer', 'interacetransfer', 'interacemailtransfer') THEN 'etransfer'
      WHEN compact IN ('mastercard', 'mc') THEN 'mastercard'
      WHEN compact = 'visa' THEN 'visa'
      WHEN compact = 'debit' THEN 'debit'
      WHEN compact IN ('cheque', 'check') THEN 'cheque'
      WHEN compact IN ('nopayment', 'none', 'na', 'nopay') THEN 'no_payment'
      ELSE NULLIF(BTRIM(REGEXP_REPLACE(LOWER(token), '[^a-z0-9]+', '_', 'g'), '_'), '')
    END AS payment_method_key,
    token AS display_name,
    compact
  FROM (
    SELECT
      token,
      regexp_replace(lower(COALESCE(token, '')), '[^a-z0-9]+', '', 'g') AS compact
    FROM split_pm
    WHERE token IS NOT NULL
  ) s
), deduped AS (
  SELECT DISTINCT ON (payment_method_key)
    payment_method_key,
    CASE
      WHEN payment_method_key = 'cash' THEN 'Cash'
      WHEN payment_method_key = 'etransfer' THEN 'Etransfer'
      WHEN payment_method_key = 'mastercard' THEN 'Mastercard'
      WHEN payment_method_key = 'visa' THEN 'Visa'
      WHEN payment_method_key = 'debit' THEN 'Debit'
      WHEN payment_method_key = 'cheque' THEN 'Cheque'
      WHEN payment_method_key = 'no_payment' THEN 'No Payment'
      ELSE display_name
    END AS display_name,
    (payment_method_key IN ('cash', 'etransfer', 'mastercard', 'visa', 'debit', 'cheque', 'no_payment')) AS is_active
  FROM normalized
  WHERE payment_method_key IS NOT NULL
  ORDER BY payment_method_key, LENGTH(display_name) DESC, display_name
)
SELECT payment_method_key, display_name, is_active
FROM deduped
ON CONFLICT (payment_method_key) DO UPDATE
SET display_name = EXCLUDED.display_name,
    is_active = EXCLUDED.is_active,
    source_loaded_at = now();

UPDATE humphreys_clean.work_orders wo
SET payment_method_ids = COALESCE(pm_map.payment_method_ids, ARRAY[]::BIGINT[])
FROM (
  SELECT
    ci."CustomerID"::INTEGER AS reference_id,
    ARRAY(
      SELECT DISTINCT pm.payment_method_id
      FROM regexp_split_to_table(COALESCE(ci."Payment Method", ''), '/') tok(raw_part)
      CROSS JOIN LATERAL (
        SELECT NULLIF(BTRIM(tok.raw_part), '') AS token
      ) t
      CROSS JOIN LATERAL (
        SELECT
          regexp_replace(lower(COALESCE(t.token, '')), '[^a-z0-9]+', '', 'g') AS compact,
          NULLIF(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(t.token, '')), '[^a-z0-9]+', '_', 'g'), '_'), '') AS fallback_key
      ) n
      JOIN humphreys_clean.payment_methods pm
        ON pm.payment_method_key = CASE
          WHEN n.compact = 'cash' THEN 'cash'
          WHEN n.compact IN ('etransfer', 'emailtransfer', 'emailmoneytransfer', 'interacetransfer', 'interacemailtransfer') THEN 'etransfer'
          WHEN n.compact IN ('mastercard', 'mc') THEN 'mastercard'
          WHEN n.compact = 'visa' THEN 'visa'
          WHEN n.compact = 'debit' THEN 'debit'
          WHEN n.compact IN ('cheque', 'check') THEN 'cheque'
          WHEN n.compact IN ('nopayment', 'none', 'na', 'nopay') THEN 'no_payment'
          ELSE n.fallback_key
        END
      ORDER BY pm.payment_method_id
    ) AS payment_method_ids
  FROM "Customer Information" ci
) pm_map
WHERE wo.reference_id = pm_map.reference_id;

UPDATE humphreys_clean.work_orders wo
SET worker_ids = x.worker_ids
FROM (
  SELECT
    ci."CustomerID"::INTEGER AS reference_id,
    ARRAY(
      SELECT wid
      FROM (
        SELECT DISTINCT w.worker_id::INTEGER AS wid
        FROM regexp_split_to_table(COALESCE(ci."Technician", ''), '/') tok(raw_part)
        CROSS JOIN LATERAL (
          SELECT lower(regexp_replace(BTRIM(tok.raw_part), '[^a-z]', '', 'g')) AS token
        ) t
        JOIN humphreys_clean.workers w
          ON w.worker_name = CASE
            WHEN t.token IN ('c', 'conor') THEN 'Conor'
            WHEN t.token IN ('j', 'justin') THEN 'Justin'
            WHEN t.token IN ('d', 'dave') THEN 'Dave'
            WHEN t.token IN ('gord') THEN 'Gord'
            WHEN t.token IN ('gr', 'greg') THEN 'Greg'
            WHEN t.token IN ('g', 'george') THEN 'George'
            WHEN t.token IN ('n', 'nadav') THEN 'Nadav'
            WHEN t.token IN ('p', 'percy') THEN 'Percy'
            WHEN t.token IN ('r', 'ray') THEN 'Ray'
            WHEN t.token IN ('ni', 'nishu') THEN 'Nishu'
            WHEN t.token IN ('t', 'tom') THEN 'Tom'
            ELSE NULL
          END
      ) mapped_workers
      ORDER BY wid
    ) AS worker_ids
  FROM "Customer Information" ci
) x
WHERE wo.reference_id = x.reference_id;

TRUNCATE TABLE humphreys_clean.work_order_line_items;

INSERT INTO humphreys_clean.work_order_line_items (
  reference_id,
  item_name,
  unit_price,
  quantity_text,
  line_total_text
)
SELECT
  wod."CustomerID"::INTEGER AS reference_id,
  NULLIF(BTRIM(wod."Item"), '') AS item_name,
  wod."Price"::NUMERIC(12,2) AS unit_price,
  NULLIF(BTRIM(wod."Quantity"), '') AS quantity_text,
  NULLIF(BTRIM(wod."Total"), '') AS line_total_text
FROM "Work Order Details" wod
JOIN humphreys_clean.work_orders wo
  ON wo.reference_id = wod."CustomerID";

INSERT INTO humphreys_clean.migration_runs (notes)
VALUES ('loaded work_orders + line_items + workers + catalogs with job_type/warranty and mapped worker_ids/item_id');

COMMIT;

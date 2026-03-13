CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF to_regclass('public.customers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_customers_first_name_trgm ON public.customers USING gin (first_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_customers_last_name_trgm ON public.customers USING gin (last_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_customers_email_trgm ON public.customers USING gin (email gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_customers_home_phone_trgm ON public.customers USING gin (home_phone gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_customers_work_phone_trgm ON public.customers USING gin (work_phone gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_customers_full_name_trgm
      ON public.customers USING gin ((COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) gin_trgm_ops);
  END IF;

  IF to_regclass('public.items') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_items_name_trgm ON public.items USING gin (item_name gin_trgm_ops);
  END IF;

  IF to_regclass('public.brands') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_brands_name_trgm ON public.brands USING gin (brand_name gin_trgm_ops);
  END IF;

  IF to_regclass('public.work_order_statuses') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_work_order_statuses_name_trgm ON public.work_order_statuses USING gin (display_name gin_trgm_ops);
  END IF;

  IF to_regclass('public.job_types') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_job_types_name_trgm ON public.job_types USING gin (display_name gin_trgm_ops);
  END IF;

  IF to_regclass('public.work_orders') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_work_orders_model_number_trgm ON public.work_orders USING gin (model_number gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_work_orders_serial_number_trgm ON public.work_orders USING gin (serial_number gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_work_orders_reference_id_trgm ON public.work_orders USING gin ((reference_id::text) gin_trgm_ops);
  END IF;
END $$;

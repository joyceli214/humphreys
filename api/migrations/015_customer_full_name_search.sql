CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF to_regclass('public.customers') IS NULL THEN
    RAISE NOTICE 'Skipping customer full_name_search migration: public.customers does not exist.';
    RETURN;
  END IF;
END $$;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS full_name_search TEXT;

UPDATE public.customers
SET full_name_search = NULLIF(BTRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '')
WHERE full_name_search IS DISTINCT FROM NULLIF(BTRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), '');

CREATE OR REPLACE FUNCTION public.sync_customer_full_name_search()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.full_name_search := NULLIF(BTRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_customer_full_name_search ON public.customers;

CREATE TRIGGER trg_sync_customer_full_name_search
BEFORE INSERT OR UPDATE OF first_name, last_name
ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.sync_customer_full_name_search();

CREATE INDEX IF NOT EXISTS idx_customers_full_name_search_trgm
  ON public.customers USING gin (full_name_search gin_trgm_ops);

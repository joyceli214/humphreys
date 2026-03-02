DO $$
BEGIN
  IF to_regclass('public.work_orders') IS NULL THEN
    RETURN;
  END IF;

  -- Skip when a single-column PK/UNIQUE already exists on reference_id.
  IF EXISTS (
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
  ) THEN
    RETURN;
  END IF;

  -- Block migration with a helpful message if duplicates are present.
  IF EXISTS (
    SELECT 1
    FROM public.work_orders
    GROUP BY reference_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce UNIQUE(work_orders.reference_id): duplicate reference_id values exist';
  END IF;

  ALTER TABLE public.work_orders
    ADD CONSTRAINT uq_work_orders_reference_id UNIQUE (reference_id);
END $$;

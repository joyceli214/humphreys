DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Make every source_hash column nullable.
  FOR rec IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'source_hash'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN source_hash DROP NOT NULL',
      rec.table_schema,
      rec.table_name
    );
  END LOOP;

  -- Ensure every source_loaded_at column defaults to now().
  FOR rec IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'source_loaded_at'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ALTER COLUMN source_loaded_at SET DEFAULT now()',
      rec.table_schema,
      rec.table_name
    );
  END LOOP;
END $$;

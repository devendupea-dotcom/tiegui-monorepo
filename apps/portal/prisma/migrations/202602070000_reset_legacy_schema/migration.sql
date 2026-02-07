-- Reset legacy portal schema objects while preserving _prisma_migrations.
-- This prepares the database for the HQ v1.5 foundation migrations.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  ) LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE;', r.tablename);
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e'
  ) LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE;', r.typname);
  END LOOP;
END $$;

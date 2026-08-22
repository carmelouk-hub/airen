-- B44-FX-014 / Foundation PostgreSQL runtime role bootstrap
-- Group roles only. Login principals and credential material are provisioned by the deployment operator.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airen_app') THEN
    CREATE ROLE airen_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'airen_auth') THEN
    CREATE ROLE airen_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;

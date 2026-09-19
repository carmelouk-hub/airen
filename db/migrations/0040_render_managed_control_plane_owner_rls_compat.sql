-- Gate153 / Render-managed PostgreSQL control-plane owner RLS compatibility
-- Replaces the global BYPASSRLS requirement with explicit command-scoped policies
-- only on FORCE-RLS tables where airen_control_plane_owner already has the
-- corresponding SQL privilege. Policies do not grant table privileges.
BEGIN;

DO $$
DECLARE
  v_owner record;
  v_table record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls
    INTO STRICT v_owner
  FROM pg_catalog.pg_roles
  WHERE rolname = 'airen_control_plane_owner';

  IF v_owner.rolcanlogin
     OR v_owner.rolsuper
     OR v_owner.rolcreatedb
     OR v_owner.rolcreaterole
     OR v_owner.rolinherit
     OR v_owner.rolbypassrls THEN
    RAISE EXCEPTION 'airen_control_plane_owner role attributes are unsafe for managed PostgreSQL';
  END IF;

  FOR v_table IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, c.oid AS table_oid
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p')
      AND c.relrowsecurity
      AND c.relforcerowsecurity
      AND n.nspname NOT IN ('pg_catalog','information_schema')
    ORDER BY n.nspname, c.relname
  LOOP
    IF has_table_privilege('airen_control_plane_owner', v_table.table_oid, 'SELECT')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy p
         WHERE p.polrelid = v_table.table_oid AND p.polname = 'airen_cp_owner_select'
       ) THEN
      EXECUTE format(
        'CREATE POLICY airen_cp_owner_select ON %I.%I FOR SELECT TO airen_control_plane_owner USING (true)',
        v_table.schema_name, v_table.table_name
      );
    END IF;

    IF has_table_privilege('airen_control_plane_owner', v_table.table_oid, 'INSERT')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy p
         WHERE p.polrelid = v_table.table_oid AND p.polname = 'airen_cp_owner_insert'
       ) THEN
      EXECUTE format(
        'CREATE POLICY airen_cp_owner_insert ON %I.%I FOR INSERT TO airen_control_plane_owner WITH CHECK (true)',
        v_table.schema_name, v_table.table_name
      );
    END IF;

    IF has_table_privilege('airen_control_plane_owner', v_table.table_oid, 'UPDATE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy p
         WHERE p.polrelid = v_table.table_oid AND p.polname = 'airen_cp_owner_update'
       ) THEN
      EXECUTE format(
        'CREATE POLICY airen_cp_owner_update ON %I.%I FOR UPDATE TO airen_control_plane_owner USING (true) WITH CHECK (true)',
        v_table.schema_name, v_table.table_name
      );
    END IF;

    IF has_table_privilege('airen_control_plane_owner', v_table.table_oid, 'DELETE')
       AND NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_policy p
         WHERE p.polrelid = v_table.table_oid AND p.polname = 'airen_cp_owner_delete'
       ) THEN
      EXECUTE format(
        'CREATE POLICY airen_cp_owner_delete ON %I.%I FOR DELETE TO airen_control_plane_owner USING (true)',
        v_table.schema_name, v_table.table_name
      );
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT format('%I.%I:%s', n.nspname, c.relname, required.command)
    INTO v_missing
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL (
    VALUES
      ('SELECT','airen_cp_owner_select'),
      ('INSERT','airen_cp_owner_insert'),
      ('UPDATE','airen_cp_owner_update'),
      ('DELETE','airen_cp_owner_delete')
  ) AS required(command, policy_name)
  WHERE c.relkind IN ('r','p')
    AND c.relrowsecurity
    AND c.relforcerowsecurity
    AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND has_table_privilege('airen_control_plane_owner', c.oid, required.command)
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy p
      WHERE p.polrelid = c.oid
        AND p.polname = required.policy_name
    )
  ORDER BY n.nspname, c.relname, required.command
  LIMIT 1;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'managed control-plane owner RLS policy missing: %', v_missing;
  END IF;
END
$$;

COMMIT;

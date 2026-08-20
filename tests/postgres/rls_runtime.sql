\set ON_ERROR_STOP on

-- Synthetic fixture only. No Corte production data.
INSERT INTO platform.tenants (id, slug, name) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','alpha','Alpha Synthetic'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','beta','Beta Synthetic');
INSERT INTO platform.locations (id, tenant_id, slug, name, timezone, is_primary) VALUES
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','main','Alpha Main','Europe/Rome',true),
('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','main','Beta Main','Europe/Rome',true);
INSERT INTO platform.tenant_domains (id, tenant_id, location_id, hostname, status, verification_state) VALUES
('aaaaaaaa-2000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','alpha.example.test','active','verified'),
('bbbbbbbb-2000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','beta.example.test','active','verified');
INSERT INTO identity.identities (id, display_name, primary_email) VALUES
('aaaaaaaa-0000-4000-8000-000000000001','Alice Synthetic','alice@example.test'),
('bbbbbbbb-0000-4000-8000-000000000001','Bob Synthetic','bob@example.test');
INSERT INTO authz.tenant_memberships (id, tenant_id, identity_id, role_key) VALUES
('aaaaaaaa-1000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-0000-4000-8000-000000000001','owner'),
('bbbbbbbb-1000-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-0000-4000-8000-000000000001','owner');
INSERT INTO authz.location_memberships (id, tenant_id, tenant_membership_id, location_id, role_key) VALUES
('aaaaaaaa-1100-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','manager'),
('bbbbbbbb-1100-4000-8000-000000000001','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-1000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','manager');

SET ROLE airen_app;
SET airen.identity_id = 'aaaaaaaa-0000-4000-8000-000000000001';
SET airen.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
SET airen.location_id = '11111111-1111-4111-8111-111111111111';
SET airen.correlation_id = 'b44-fx-009-rls-test';

DO $$ DECLARE c integer; BEGIN
  SELECT count(*) INTO c FROM platform.tenants;
  IF c <> 1 THEN RAISE EXCEPTION 'RLS tenants expected 1 visible row, got %', c; END IF;
  SELECT count(*) INTO c FROM platform.tenants WHERE id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  IF c <> 0 THEN RAISE EXCEPTION 'RLS cross-tenant SELECT leak on tenants'; END IF;
  SELECT count(*) INTO c FROM platform.locations WHERE tenant_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  IF c <> 0 THEN RAISE EXCEPTION 'RLS cross-tenant SELECT leak on locations'; END IF;
  SELECT count(*) INTO c FROM platform.tenant_domains;
  IF c <> 1 THEN RAISE EXCEPTION 'RLS domains expected 1 visible row, got %', c; END IF;
  SELECT count(*) INTO c FROM authz.tenant_memberships;
  IF c <> 1 THEN RAISE EXCEPTION 'RLS memberships expected 1 visible row, got %', c; END IF;
  SELECT count(*) INTO c FROM authz.location_memberships;
  IF c <> 1 THEN RAISE EXCEPTION 'RLS location memberships expected 1 visible row, got %', c; END IF;
END $$;

INSERT INTO platform.locations (id, tenant_id, slug, name, timezone)
VALUES ('11111111-1111-4111-8111-111111111112','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','second','Alpha Second','Europe/Rome');

DO $$ BEGIN
  BEGIN
    INSERT INTO platform.locations (id, tenant_id, slug, name, timezone)
    VALUES ('22222222-2222-4222-8222-222222222223','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','probe','Beta Probe','Europe/Rome');
    RAISE EXCEPTION 'RLS_FAILURE: cross-tenant location INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

INSERT INTO audit.audit_events (tenant_id, location_id, actor_identity_id, actor_kind, action_key, correlation_id, outcome)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','aaaaaaaa-0000-4000-8000-000000000001','user','test.allowed','b44-fx-009-rls-test','success');
DO $$ BEGIN
  BEGIN
    INSERT INTO audit.audit_events (tenant_id, location_id, actor_identity_id, actor_kind, action_key, correlation_id, outcome)
    VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','aaaaaaaa-0000-4000-8000-000000000001','user','test.denied','b44-fx-009-rls-test','success');
    RAISE EXCEPTION 'RLS_FAILURE: cross-tenant audit INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

INSERT INTO events.outbox_events (tenant_id, location_id, event_type, aggregate_type, aggregate_id, payload, correlation_id)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','test.allowed','Synthetic','one','{}','b44-fx-009-rls-test');
DO $$ BEGIN
  BEGIN
    INSERT INTO events.outbox_events (tenant_id, location_id, event_type, aggregate_type, aggregate_id, payload, correlation_id)
    VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','test.denied','Synthetic','two','{}','b44-fx-009-rls-test');
    RAISE EXCEPTION 'RLS_FAILURE: cross-tenant outbox INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
SET ROLE airen_app;
RESET airen.identity_id;
RESET airen.tenant_id;
RESET airen.location_id;
RESET airen.correlation_id;
DO $$ DECLARE c integer; BEGIN
  SELECT count(*) INTO c FROM platform.tenants;
  IF c <> 0 THEN RAISE EXCEPTION 'RLS without trusted context must expose zero tenants, got %', c; END IF;
END $$;
RESET ROLE;

SELECT 'B44-FX-009 PostgreSQL RLS runtime tests PASS' AS result;

import { Pool, type PoolClient } from "pg";
import { AppError } from "../packages/shared-contracts/src/index.ts";

type EnvironmentInput = Readonly<Record<string, string | undefined>>;

type SeedResult = Readonly<{
  applied: boolean;
  tenantId: string;
  locationId: string;
  identityId: string;
  providerKey: string;
  providerSubject: string;
  hostname: string;
  entitlementKey: string;
}>;

export const RBL01D_BASE44 = Object.freeze({
  tenantId: "51000000-0000-4000-8000-000000000001",
  tenantSlug: "rbl01d-base44",
  tenantName: "RISTOAIREN Base44 RBL-01D",
  locationId: "51000000-0000-4000-8000-000000000011",
  locationSlug: "main",
  locationName: "RBL-01D Main",
  domainId: "51000000-0000-4000-8000-000000000021",
  identityId: "53000000-0000-4000-8000-000000000001",
  membershipId: "54000000-0000-4000-8000-000000000001",
  locationMembershipId: "55000000-0000-4000-8000-000000000001",
  providerKey: "base44-rbl01c2",
  providerSubject: "6a9034a15aadd6259d2d88e4",
  hostname: "ristoairen-booking-rbl01c2-20260827.onrender.com",
  entitlementKey: "rbl01c2.booking.external",
  roleKey: "manager"
});

const BOOKING_PERMISSIONS = Object.freeze([
  ["booking.read", "Read bookings", "normal"],
  ["booking.create", "Create bookings", "normal"],
  ["booking.update", "Update bookings", "normal"],
  ["booking.status.update", "Transition booking status", "high"]
] as const);

function enabled(environment: EnvironmentInput): boolean {
  const raw = environment.RBL01D_BASE44_SEED_ENABLED?.trim().toLowerCase();
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;
  throw new AppError("RUNTIME_CONFIGURATION_INVALID", "RBL01D_BASE44_SEED_ENABLED must be true or false", { field: "RBL01D_BASE44_SEED_ENABLED" });
}

async function assertDomainOwnership(client: PoolClient): Promise<string | null> {
  const existing = await client.query<{ id: string; tenant_id: string }>(
    "SELECT id,tenant_id FROM platform.tenant_domains WHERE lower(hostname)=lower($1) FOR UPDATE",
    [RBL01D_BASE44.hostname]
  );
  if (!existing.rowCount) return null;
  const row = existing.rows[0];
  if (row.tenant_id !== RBL01D_BASE44.tenantId) {
    throw new AppError("CONFLICT", "RBL-01D hostname is already owned by another tenant", { hostname: RBL01D_BASE44.hostname });
  }
  return row.id;
}

async function assertProviderSubjectOwnership(client: PoolClient): Promise<void> {
  const existing = await client.query<{ identity_id: string }>(
    "SELECT identity_id FROM identity.provider_subject_links WHERE provider_key=$1 AND provider_subject=$2 FOR UPDATE",
    [RBL01D_BASE44.providerKey, RBL01D_BASE44.providerSubject]
  );
  if (existing.rowCount && existing.rows[0].identity_id !== RBL01D_BASE44.identityId) {
    throw new AppError("CONFLICT", "RBL-01D Base44 provider subject is already linked to another Identity", {
      providerKey: RBL01D_BASE44.providerKey,
      providerSubject: RBL01D_BASE44.providerSubject
    });
  }
}

export async function seedRbl01dBase44BookingTopology(
  connectionString: string,
  environment: EnvironmentInput = process.env
): Promise<SeedResult> {
  if (!enabled(environment)) {
    process.stdout.write(`${JSON.stringify({ event: "rbl01d.base44.seed.skip", reason: "disabled" })}\n`);
    return Object.freeze({ applied: false, ...RBL01D_BASE44 });
  }
  if (environment.NODE_ENV?.trim() !== "test") {
    throw new AppError("RUNTIME_CONFIGURATION_INVALID", "RBL-01D Base44 seed is restricted to NODE_ENV=test", { field: "NODE_ENV" });
  }

  const pool = new Pool({ connectionString, max: 1, application_name: "rbl01d-base44-seed" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('rbl01d-base44-booking-seed'))");

      await client.query(
        `INSERT INTO platform.tenants(id,slug,name,status,locale,timezone,currency)
         VALUES($1,$2,$3,'active','it-IT','Europe/Rome','EUR')
         ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,status='active',locale=EXCLUDED.locale,timezone=EXCLUDED.timezone,currency=EXCLUDED.currency,updated_at=now()`,
        [RBL01D_BASE44.tenantId, RBL01D_BASE44.tenantSlug, RBL01D_BASE44.tenantName]
      );

      await client.query(
        `INSERT INTO platform.locations(id,tenant_id,slug,name,status,timezone,is_primary)
         VALUES($1,$2,$3,$4,'active','Europe/Rome',true)
         ON CONFLICT(id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id,slug=EXCLUDED.slug,name=EXCLUDED.name,status='active',timezone=EXCLUDED.timezone,is_primary=true,updated_at=now()`,
        [RBL01D_BASE44.locationId, RBL01D_BASE44.tenantId, RBL01D_BASE44.locationSlug, RBL01D_BASE44.locationName]
      );

      await client.query(
        `INSERT INTO identity.identities(id,display_name,status)
         VALUES($1,'Base44 RISTOAIREN RBL-01D','active')
         ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name,status='active',updated_at=now()`,
        [RBL01D_BASE44.identityId]
      );

      await assertProviderSubjectOwnership(client);
      await client.query(
        `INSERT INTO identity.provider_subject_links(identity_id,provider_key,provider_subject)
         VALUES($1,$2,$3)
         ON CONFLICT(provider_key,provider_subject) DO NOTHING`,
        [RBL01D_BASE44.identityId, RBL01D_BASE44.providerKey, RBL01D_BASE44.providerSubject]
      );

      for (const [permissionKey, description, sensitivity] of BOOKING_PERMISSIONS) {
        await client.query(
          `INSERT INTO authz.permission_registry(permission_key,description,sensitivity)
           VALUES($1,$2,$3)
           ON CONFLICT(permission_key) DO UPDATE SET description=EXCLUDED.description,sensitivity=EXCLUDED.sensitivity`,
          [permissionKey, description, sensitivity]
        );
        await client.query(
          `INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
           VALUES('location',$1,$2,'allow')
           ON CONFLICT(scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'`,
          [RBL01D_BASE44.roleKey, permissionKey]
        );
      }

      const membership = await client.query<{ id: string }>(
        `INSERT INTO authz.tenant_memberships(id,tenant_id,identity_id,role_key,status)
         VALUES($1,$2,$3,$4,'active')
         ON CONFLICT(tenant_id,identity_id) DO UPDATE SET role_key=EXCLUDED.role_key,status='active',updated_at=now()
         RETURNING id`,
        [RBL01D_BASE44.membershipId, RBL01D_BASE44.tenantId, RBL01D_BASE44.identityId, RBL01D_BASE44.roleKey]
      );
      const membershipId = membership.rows[0].id;

      await client.query(
        `INSERT INTO authz.location_memberships(id,tenant_id,tenant_membership_id,location_id,role_key,status)
         VALUES($1,$2,$3,$4,$5,'active')
         ON CONFLICT(tenant_membership_id,location_id) DO UPDATE SET role_key=EXCLUDED.role_key,status='active'`,
        [RBL01D_BASE44.locationMembershipId, RBL01D_BASE44.tenantId, membershipId, RBL01D_BASE44.locationId, RBL01D_BASE44.roleKey]
      );

      await client.query(
        `INSERT INTO billing.entitlement_catalog(entitlement_key,description,status)
         VALUES($1,'RBL-01D Base44 external Booking integration','active')
         ON CONFLICT(entitlement_key) DO UPDATE SET description=EXCLUDED.description,status='active',retired_at=NULL,updated_at=now()`,
        [RBL01D_BASE44.entitlementKey]
      );
      await client.query(
        `INSERT INTO billing.tenant_entitlements(tenant_id,entitlement_key,source_kind,source_ref,enabled,valid_from,config)
         VALUES($1,$2,'rbl01d_test','base44_non_production_bridge',true,now(),'{}'::jsonb)
         ON CONFLICT(tenant_id,entitlement_key) DO UPDATE SET source_kind=EXCLUDED.source_kind,source_ref=EXCLUDED.source_ref,enabled=true,valid_from=COALESCE(billing.tenant_entitlements.valid_from,EXCLUDED.valid_from),valid_until=NULL,config='{}'::jsonb,revoked_at=NULL,expired_at=NULL,updated_at=now()`,
        [RBL01D_BASE44.tenantId, RBL01D_BASE44.entitlementKey]
      );

      const existingDomainId = await assertDomainOwnership(client);
      if (existingDomainId) {
        await client.query(
          `UPDATE platform.tenant_domains
           SET location_id=$1,status='active',verification_state='verified',updated_at=now()
           WHERE id=$2 AND tenant_id=$3`,
          [RBL01D_BASE44.locationId, existingDomainId, RBL01D_BASE44.tenantId]
        );
      } else {
        await client.query(
          `INSERT INTO platform.tenant_domains(id,tenant_id,location_id,hostname,status,verification_state)
           VALUES($1,$2,$3,$4,'active','verified')`,
          [RBL01D_BASE44.domainId, RBL01D_BASE44.tenantId, RBL01D_BASE44.locationId, RBL01D_BASE44.hostname]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }

  process.stdout.write(`${JSON.stringify({
    event: "rbl01d.base44.seed.applied",
    tenantId: RBL01D_BASE44.tenantId,
    locationId: RBL01D_BASE44.locationId,
    identityId: RBL01D_BASE44.identityId,
    providerKey: RBL01D_BASE44.providerKey,
    hostname: RBL01D_BASE44.hostname,
    entitlementKey: RBL01D_BASE44.entitlementKey
  })}\n`);
  return Object.freeze({ applied: true, ...RBL01D_BASE44 });
}

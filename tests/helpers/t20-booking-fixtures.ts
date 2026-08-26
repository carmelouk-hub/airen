import type { Pool } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";

export const T20 = Object.freeze({
  tenantA: "10000000-0000-4000-8000-000000000001",
  locationA1: "10000000-0000-4000-8000-000000000011",
  locationA2: "10000000-0000-4000-8000-000000000012",
  tenantB: "20000000-0000-4000-8000-000000000001",
  locationB1: "20000000-0000-4000-8000-000000000011",
  managerA: "30000000-0000-4000-8000-000000000001",
  responsabileA: "30000000-0000-4000-8000-000000000002",
  managerB: "30000000-0000-4000-8000-000000000003"
});

export async function seedT20BookingTopology(pool: Pool): Promise<void> {
  await pool.query(`INSERT INTO platform.tenants(id,slug,name) VALUES
    ($1,'t20-a','T20 Tenant A'),($2,'t20-b','T20 Tenant B') ON CONFLICT (id) DO NOTHING`, [T20.tenantA,T20.tenantB]);
  await pool.query(`INSERT INTO platform.locations(id,tenant_id,slug,name,timezone,is_primary) VALUES
    ($1,$2,'a1','A1','Europe/Rome',true),($3,$2,'a2','A2','Europe/Rome',false),($4,$5,'b1','B1','Europe/Rome',true)
    ON CONFLICT (tenant_id,slug) DO NOTHING`, [T20.locationA1,T20.tenantA,T20.locationA2,T20.locationB1,T20.tenantB]);
  await pool.query(`INSERT INTO identity.identities(id,display_name) VALUES
    ($1,'T20 Manager A'),($2,'T20 Responsabile A'),($3,'T20 Manager B') ON CONFLICT (id) DO NOTHING`, [T20.managerA,T20.responsabileA,T20.managerB]);

  await pool.query(`INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES
    ('booking.read','Read bookings','normal'),('booking.create','Create bookings','normal'),('booking.update','Update bookings','normal'),('booking.status.update','Transition booking status','high')
    ON CONFLICT (permission_key) DO NOTHING`);
  for (const [role, permission] of [
    ['manager','booking.read'],['manager','booking.create'],['manager','booking.update'],['manager','booking.status.update'],
    ['responsabile','booking.read'],['responsabile','booking.status.update']
  ] as const) {
    await pool.query(`INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
      VALUES ('location',$1,$2,'allow') ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'`, [role,permission]);
  }

  const memberships = [
    ['40000000-0000-4000-8000-000000000001',T20.tenantA,T20.managerA,'manager',T20.locationA1,'manager'],
    ['40000000-0000-4000-8000-000000000002',T20.tenantA,T20.responsabileA,'responsabile',T20.locationA1,'responsabile'],
    ['40000000-0000-4000-8000-000000000003',T20.tenantB,T20.managerB,'manager',T20.locationB1,'manager']
  ] as const;
  for (const [membershipId,tenantId,identityId,tenantRole,locationId,locationRole] of memberships) {
    await pool.query(`INSERT INTO authz.tenant_memberships(id,tenant_id,identity_id,role_key,status)
      VALUES ($1,$2,$3,$4,'active') ON CONFLICT (tenant_id,identity_id) DO UPDATE SET status='active',role_key=EXCLUDED.role_key`, [membershipId,tenantId,identityId,tenantRole]);
    await pool.query(`INSERT INTO authz.location_memberships(tenant_id,tenant_membership_id,location_id,role_key,status)
      VALUES ($1,$2,$3,$4,'active') ON CONFLICT (tenant_membership_id,location_id) DO UPDATE SET status='active',role_key=EXCLUDED.role_key`, [tenantId,membershipId,locationId,locationRole]);
  }
}

export function securityContext(input: { actorIdentityId: string; tenantId: string; locationId: string; permissions: readonly string[]; role?: string; correlationId?: string }): SecurityContext {
  return Object.freeze({
    correlationId: input.correlationId ?? `t20-${crypto.randomUUID()}`,
    actorIdentityId: input.actorIdentityId,
    platformRoles: [], platformPermissions: [],
    tenantId: input.tenantId, locationId: input.locationId,
    tenantRole: input.role, locationRole: input.role,
    permissions: input.permissions, entitlements: []
  });
}

export async function cleanupT20BookingData(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM events.outbox_events WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM audit.audit_events WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM foundation_idempotency_keys WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
  await pool.query(`DELETE FROM risto_bookings WHERE tenant_id IN ($1,$2)`, [T20.tenantA,T20.tenantB]);
}

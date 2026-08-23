import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { SecurityContext, UUID } from "../../shared-contracts/src/index.ts";
import type { TenantRepository, LocationRepository, TenantDomainRepository, Tenant, Location, TenantDomain } from "../../tenant/src/index.ts";
import type { LocationMutationTransaction } from "../../tenant/src/commands/create-location.ts";
import type { MembershipRepository, RolePermissionResolver, TenantMembership, LocationMembership } from "../../authorization/src/index.ts";
import type { EntitlementRepository } from "../../entitlements/src/index.ts";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import type { DomainEvent } from "../../shared-contracts/src/index.ts";
import type { AuthenticationIdentityDirectory, AuthenticationIdentityRecord } from "../../identity/src/index.ts";

function oneOrNull<T extends QueryResultRow>(rows: T[]): T | null { return rows[0] ?? null; }
function assertRoleIdentifier(role: string): string { if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier"); return role; }

export class PostgresFoundationReadStore implements TenantDomainRepository, MembershipRepository, RolePermissionResolver, EntitlementRepository {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }
  async findTenantById(id: UUID): Promise<Tenant | null> { const r=await this.pool.query("SELECT id, slug, name, status FROM platform.tenants WHERE id=$1",[id]); return oneOrNull(r.rows) as Tenant | null; }
  async findBySlug(slug: string): Promise<Tenant | null> { const r=await this.pool.query("SELECT id, slug, name, status FROM platform.tenants WHERE slug=$1",[slug]); return oneOrNull(r.rows) as Tenant | null; }
  async findLocationById(id: UUID): Promise<Location | null> { const r=await this.pool.query("SELECT id, tenant_id AS \"tenantId\", slug, name, status FROM platform.locations WHERE id=$1",[id]); return oneOrNull(r.rows) as Location | null; }
  async findPrimaryForTenant(tenantId: UUID): Promise<Location | null> { const r=await this.pool.query("SELECT id, tenant_id AS \"tenantId\", slug, name, status FROM platform.locations WHERE tenant_id=$1 AND is_primary=true",[tenantId]); return oneOrNull(r.rows) as Location | null; }
  async findActiveByHostname(hostname: string): Promise<TenantDomain | null> { const r=await this.pool.query("SELECT id, tenant_id AS \"tenantId\", location_id AS \"locationId\", hostname, status FROM platform.tenant_domains WHERE hostname=$1 AND status='active'",[hostname]); return oneOrNull(r.rows) as TenantDomain | null; }
  async findTenantMembership(tenantId: UUID, identityId: UUID): Promise<TenantMembership | null> { const r=await this.pool.query("SELECT id, tenant_id AS \"tenantId\", identity_id AS \"identityId\", role_key AS \"roleKey\", status FROM authz.tenant_memberships WHERE tenant_id=$1 AND identity_id=$2",[tenantId,identityId]); return oneOrNull(r.rows) as TenantMembership | null; }
  async findLocationMembership(tenantMembershipId: UUID, locationId: UUID): Promise<LocationMembership | null> { const r=await this.pool.query("SELECT id, tenant_membership_id AS \"tenantMembershipId\", tenant_id AS \"tenantId\", location_id AS \"locationId\", role_key AS \"roleKey\", status FROM authz.location_memberships WHERE tenant_membership_id=$1 AND location_id=$2",[tenantMembershipId,locationId]); return oneOrNull(r.rows) as LocationMembership | null; }
  async platformPermissions(platformRoles: readonly string[]): Promise<readonly string[]> { if (!platformRoles.length) return []; const r=await this.pool.query("SELECT DISTINCT permission_key FROM authz.role_permission_grants WHERE scope_kind='platform' AND role_key = ANY($1::text[]) AND effect='allow'",[platformRoles]); return r.rows.map((x)=>String(x.permission_key)); }
  async tenantPermissions(roleKey: string): Promise<readonly string[]> { const r=await this.pool.query("SELECT permission_key FROM authz.role_permission_grants WHERE scope_kind='tenant' AND role_key=$1 AND effect='allow'",[roleKey]); return r.rows.map((x)=>String(x.permission_key)); }
  async locationPermissions(roleKey: string): Promise<readonly string[]> { const r=await this.pool.query("SELECT permission_key FROM authz.role_permission_grants WHERE scope_kind='location' AND role_key=$1 AND effect='allow'",[roleKey]); return r.rows.map((x)=>String(x.permission_key)); }
  async enabledForTenant(tenantId: UUID): Promise<readonly string[]> { const r=await this.pool.query("SELECT e.entitlement_key FROM billing.tenant_entitlements e JOIN billing.entitlement_catalog c ON c.entitlement_key=e.entitlement_key JOIN platform.tenants t ON t.id=e.tenant_id WHERE e.tenant_id=$1 AND t.status=\'active\' AND c.status=\'active\' AND e.enabled=true AND COALESCE(e.valid_from,\'-infinity\'::timestamptz) <= now() AND (e.valid_until IS NULL OR e.valid_until > now()) ORDER BY e.entitlement_key",[tenantId]); return r.rows.map((x)=>String(x.entitlement_key)); }
}

export class PostgresAuthenticationIdentityDirectory implements AuthenticationIdentityDirectory {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_auth") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async resolveProviderIdentity(providerKey: string, providerSubject: string): Promise<AuthenticationIdentityRecord | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      const r = await client.query(
        "SELECT identity_id AS \"identityId\", identity_status AS status, platform_roles AS \"platformRoles\" FROM security.resolve_authentication_identity($1,$2)",
        [providerKey, providerSubject]
      );
      await client.query("COMMIT");
      const row = oneOrNull(r.rows) as { identityId: UUID; status: string; platformRoles: string[] } | null;
      return row ? { identityId: row.identityId, status: row.status, platformRoles: row.platformRoles ?? [] } : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresTenantRepositoryAdapter implements TenantRepository {
  private readonly store: PostgresFoundationReadStore;
  constructor(store: PostgresFoundationReadStore) { this.store = store; }
  findById(id: UUID): Promise<Tenant | null> { return this.store.findTenantById(id); }
  findBySlug(slug: string): Promise<Tenant | null> { return this.store.findBySlug(slug); }
}
export class PostgresLocationRepositoryAdapter implements LocationRepository {
  private readonly store: PostgresFoundationReadStore;
  constructor(store: PostgresFoundationReadStore) { this.store = store; }
  findById(id: UUID): Promise<Location | null> { return this.store.findLocationById(id); }
  findPrimaryForTenant(tenantId: UUID): Promise<Location | null> { return this.store.findPrimaryForTenant(tenantId); }
}

class PostgresLocationTransaction implements LocationMutationTransaction {
  private readonly client: PoolClient;
  constructor(client: PoolClient) { this.client = client; }
  async insertLocation(input: { tenantId: UUID; slug: string; name: string; timezone: string }): Promise<Location> {
    const r=await this.client.query("INSERT INTO platform.locations (tenant_id, slug, name, timezone) VALUES ($1,$2,$3,$4) RETURNING id, tenant_id AS \"tenantId\", slug, name, status",[input.tenantId,input.slug,input.name,input.timezone]);
    return r.rows[0] as Location;
  }
  async audit(record: AuditRecord): Promise<void> { await this.client.query("INSERT INTO audit.audit_events (tenant_id, location_id, actor_identity_id, actor_kind, action_key, resource_type, resource_id, correlation_id, outcome, metadata) VALUES ($1,$2,$3,'user',$4,$5,$6,$7,$8,$9::jsonb)",[record.tenantId,record.locationId,record.actorIdentityId,record.actionKey,record.resourceType??null,record.resourceId??null,record.correlationId,record.outcome,JSON.stringify(record.metadata??{})]); }
  async outbox(event: DomainEvent & { tenantId: string; locationId: string; correlationId: string }): Promise<void> { await this.client.query("INSERT INTO events.outbox_events (tenant_id, location_id, event_type, aggregate_type, aggregate_id, payload_version, payload, correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",[event.tenantId,event.locationId,event.eventType,event.aggregateType,event.aggregateId,event.payloadVersion,JSON.stringify(event.payload),event.correlationId]); }
}

export class PostgresLocationUnitOfWork implements UnitOfWork<LocationMutationTransaction> {
  private readonly pool: Pool;
  private readonly assumeRole?: string;
  constructor(pool: Pool, assumeRole?: string) { this.pool = pool; this.assumeRole = assumeRole; }
  async transaction<T>(fn: (tx: LocationMutationTransaction) => Promise<T>, context?: SecurityContext): Promise<T> {
    if (!context) throw new Error("SecurityContext is required for PostgreSQL mutations");
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (this.assumeRole) await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query("SELECT set_config('airen.identity_id',$1,true), set_config('airen.tenant_id',$2,true), set_config('airen.location_id',$3,true), set_config('airen.correlation_id',$4,true)",[context.actorIdentityId,context.tenantId,context.locationId,context.correlationId]);
      const result=await fn(new PostgresLocationTransaction(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}

export function createPostgresPool(connectionString: string): Pool { return new Pool({ connectionString, max: 5 }); }

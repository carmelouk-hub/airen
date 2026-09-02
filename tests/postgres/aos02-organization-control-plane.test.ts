import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { AppError, type PlatformSecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { provisionTenant } from "../../packages/tenant/src/commands/provision-tenant.ts";
import { PostgresTenantProvisioningUnitOfWork } from "../../packages/persistence-postgres/src/tenant-provisioning.ts";
import { PostgresFoundationReadStore } from "../../packages/persistence-postgres/src/index.ts";
import {
  PostgresOrganizationContextRepository,
  PostgresOrganizationControlPlaneUnitOfWork
} from "../../packages/persistence-postgres/src/organization-control-plane.ts";
import {
  bindTenantToOrganization,
  provisionOrganization,
  resolveOrganizationTenantContext
} from "../../packages/platform-core/src/organization-control-plane.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");
const ACTOR = "a0220000-0000-4000-8000-000000000001";
const PEER = "a0220000-0000-4000-8000-000000000002";
const RUNTIME_ROLE = "aos02_runtime";

function runtimeUrl(base: string, user: string, password: string): string {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  return url.toString();
}

function context(): PlatformSecurityContext {
  return {
    scopeKind: "platform",
    correlationId: "aos02-pg-runtime",
    actorIdentityId: ACTOR,
    platformRoles: ["aos02_admin"],
    platformPermissions: ["platform.organizations.provision", "platform.organizations.bind_tenant", "platform.tenants.provision"]
  };
}

function appErrorCode(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

test("AOS-02 Organization control plane preserves Tenant/Domain isolation while adding Organization context", async () => {
  const admin = new Pool({ connectionString: DATABASE_URL });
  const password = randomBytes(24).toString("hex");
  await admin.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
  await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  await admin.query(`GRANT airen_app, airen_control_plane TO ${RUNTIME_ROLE}`);
  await admin.query(
    `INSERT INTO identity.identities(id, display_name, primary_email, status)
     VALUES ($1,'AOS02 Admin','aos02-admin@example.test','active'),($2,'AOS02 Peer','aos02-peer@example.test','active')
     ON CONFLICT (id) DO UPDATE SET status='active'`,
    [ACTOR, PEER]
  );
  await admin.query(
    `INSERT INTO authz.platform_role_assignments(identity_id, role_key, status)
     VALUES ($1,'aos02_admin','active') ON CONFLICT(identity_id,role_key) DO UPDATE SET status='active'`,
    [ACTOR]
  );
  await admin.query(
    `INSERT INTO authz.role_permission_grants(scope_kind, role_key, permission_key, effect)
     VALUES
       ('platform','aos02_admin','platform.organizations.provision','allow'),
       ('platform','aos02_admin','platform.organizations.bind_tenant','allow'),
       ('platform','aos02_admin','platform.tenants.provision','allow')
     ON CONFLICT(scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'`
  );

  const runtime = new Pool({ connectionString: runtimeUrl(DATABASE_URL, RUNTIME_ROLE, password) });
  const organizationUow = new PostgresOrganizationControlPlaneUnitOfWork(runtime);
  const tenantUow = new PostgresTenantProvisioningUnitOfWork(runtime);
  const platform = context();

  try {
    const org = await provisionOrganization(
      { idempotencyKey: "aos02-org-runtime-001", slug: "aos02-group", name: "AOS02 Group", legalName: "AOS02 Group Srl" },
      { context: platform, unitOfWork: organizationUow }
    );
    assert.equal(org.replayed, false);
    const replay = await provisionOrganization(
      { idempotencyKey: "aos02-org-runtime-001", slug: "aos02-group", name: "AOS02 Group", legalName: "AOS02 Group Srl" },
      { context: platform, unitOfWork: organizationUow }
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.organization.id, org.organization.id);

    const tenant = await provisionTenant(
      { idempotencyKey: "aos02-tenant-runtime-001", slug: "aos02-tenant", name: "AOS02 Tenant", timezone: "Europe/Rome", primaryLocation: { slug: "main", name: "Main" } },
      { context: platform, unitOfWork: tenantUow }
    );
    assert.notEqual(org.organization.id, tenant.tenant.id);

    const binding = await bindTenantToOrganization(
      { idempotencyKey: "aos02-bind-runtime-001", organizationId: org.organization.id, tenantId: tenant.tenant.id },
      { context: platform, unitOfWork: organizationUow }
    );
    assert.equal(binding.replayed, false);
    const bindingReplay = await bindTenantToOrganization(
      { idempotencyKey: "aos02-bind-runtime-001", organizationId: org.organization.id, tenantId: tenant.tenant.id },
      { context: platform, unitOfWork: organizationUow }
    );
    assert.equal(bindingReplay.replayed, true);

    const secondOrg = await provisionOrganization(
      { idempotencyKey: "aos02-org-runtime-002", slug: "aos02-other-group", name: "AOS02 Other Group" },
      { context: platform, unitOfWork: organizationUow }
    );
    await assert.rejects(
      () => bindTenantToOrganization(
        { idempotencyKey: "aos02-bind-runtime-002", organizationId: secondOrg.organization.id, tenantId: tenant.tenant.id },
        { context: platform, unitOfWork: organizationUow }
      ),
      appErrorCode("CONFLICT")
    );

    const directClient = await runtime.connect();
    try {
      await directClient.query("BEGIN");
      await directClient.query("SET LOCAL ROLE airen_control_plane");
      await assert.rejects(
        () => directClient.query("INSERT INTO platform.organizations(slug,name) VALUES ('forbidden-direct','Forbidden')"),
        (error: unknown) => (error as { code?: string }).code === "42501"
      );
      await directClient.query("ROLLBACK");
    } finally {
      directClient.release();
    }

    const organizationRepository = new PostgresOrganizationContextRepository(runtime);
    const resolvedOrganization = await organizationRepository.findActiveOrganizationForTenant(tenant.tenant.id);
    assert.equal(resolvedOrganization?.id, org.organization.id);
    const resolvedMembership = await organizationRepository.findActiveMembership(org.organization.id, ACTOR);
    assert.equal(resolvedMembership?.id, org.initialMembershipId);

    const foundation = new PostgresFoundationReadStore(runtime);
    const scoped = await foundation.forTrustedRequestScope({
      actorIdentityId: ACTOR,
      tenantId: tenant.tenant.id,
      locationId: tenant.primaryLocation.id,
      correlationId: "aos02-context-resolution"
    });
    try {
      const resolvedContext = await resolveOrganizationTenantContext(
        { identityId: ACTOR, tenantId: tenant.tenant.id },
        { organizations: organizationRepository, memberships: scoped.memberships }
      );
      assert.equal(resolvedContext.organization.id, org.organization.id);
      assert.equal(resolvedContext.tenantMembership.id, tenant.tenantMembershipId);
    } finally {
      await scoped.release();
    }

    await admin.query(
      `INSERT INTO authz.tenant_memberships(tenant_id, identity_id, role_key, status)
       VALUES ($1,$2,'viewer','active') ON CONFLICT(tenant_id,identity_id) DO UPDATE SET status='active'`,
      [tenant.tenant.id, PEER]
    );
    assert.equal(await organizationRepository.findActiveMembership(org.organization.id, PEER), null);

    await admin.query(
      `INSERT INTO platform.tenant_domains(tenant_id, location_id, hostname, status, verification_state)
       VALUES ($1,$2,'aos02.example.test','active','verified')
       ON CONFLICT DO NOTHING`,
      [tenant.tenant.id, tenant.primaryLocation.id]
    );
    const domainClient = await runtime.connect();
    try {
      await domainClient.query("BEGIN");
      await domainClient.query("SET LOCAL ROLE airen_app");
      await domainClient.query("SELECT set_config('airen.identity_id',$1,true)", [PEER]);
      const route = await domainClient.query("SELECT tenant_id_out FROM security.resolve_active_tenant_domain_route($1)", ["aos02.example.test"]);
      assert.equal(String(route.rows[0]?.tenant_id_out), tenant.tenant.id);
      const membership = await domainClient.query("SELECT * FROM security.resolve_active_organization_membership($1,$2)", [org.organization.id, PEER]);
      assert.equal(membership.rowCount, 0);
      await domainClient.query("ROLLBACK");
    } finally {
      domainClient.release();
    }
  } finally {
    await runtime.end();
    await admin.end();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildPlatformSecurityContext } from "../../packages/authorization/src/index.ts";
import { assignPlatformRole, getPlatformPrincipalAdmin, listPlatformPrincipalsAdmin, listPlatformRolesAdmin, reactivatePlatformRole, revokePlatformRole, suspendPlatformRole } from "../../packages/authorization/src/platform-role-admin.ts";
import { PostgresAuthenticationIdentityDirectory, PostgresFoundationReadStore, createPostgresPool } from "../../packages/persistence-postgres/src/index.ts";
import { PostgresPlatformRoleAdminStore } from "../../packages/persistence-postgres/src/platform-role-control-plane.ts";
import { AppError } from "../../packages/shared-contracts/src/index.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = createPostgresPool(connectionString);
const reads = new PostgresFoundationReadStore(pool);
const store = new PostgresPlatformRoleAdminStore(pool);
const authDirectory = new PostgresAuthenticationIdentityDirectory(pool);

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const BOB = "bbbbbbbb-0000-4000-8000-000000000001";
const CHARLIE = "cccccccc-0000-4000-8000-000000000001";
const DANA = "dddddddd-0000-4000-8000-000000000001";
const EVE = "eeeeeeee-0000-4000-8000-000000000001";

async function seed() {
  await pool.query("INSERT INTO identity.identities(id,display_name,primary_email,status) VALUES ($1,'Charlie Platform Fixture','charlie-platform@example.test','active'),($2,'Dana Platform Fixture','dana-platform@example.test','active'),($3,'Eve Inactive Fixture','eve-platform@example.test','suspended') ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name,primary_email=EXCLUDED.primary_email,status=EXCLUDED.status",[CHARLIE,DANA,EVE]);
  await pool.query("INSERT INTO identity.provider_subject_links(identity_id,provider_key,provider_subject) VALUES ($1,'r3d-test','charlie'),($2,'r3d-test','bob'),($3,'r3d-test','dana') ON CONFLICT (provider_key,provider_subject) DO UPDATE SET identity_id=EXCLUDED.identity_id",[CHARLIE,BOB,DANA]);

  for (const permission of ["platform.principals.read","platform.roles.read","platform.roles.assign","platform.roles.suspend","platform.roles.reactivate","platform.roles.revoke"]) {
    await pool.query("INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES ($1,$1,'critical') ON CONFLICT DO NOTHING",[permission]);
    await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('platform','platform_admin',$1,'allow') ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'",[permission]);
  }
  await pool.query("INSERT INTO authz.permission_registry(permission_key,description,sensitivity) VALUES ('platform.fixture.observe','Synthetic platform fixture permission','normal') ON CONFLICT DO NOTHING");
  await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('platform','platform_operator','platform.fixture.observe','allow') ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'");
  await pool.query("INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect) VALUES ('platform','platform_role_delegator','platform.roles.assign','allow') ON CONFLICT (scope_kind,role_key,permission_key) DO UPDATE SET effect='allow'");
  await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_admin','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active',updated_at=now()",[ALICE]);
  await pool.query("INSERT INTO authz.platform_role_assignments(identity_id,role_key,status) VALUES ($1,'platform_role_delegator','active') ON CONFLICT (identity_id,role_key) DO UPDATE SET status='active',updated_at=now()",[DANA]);
  await pool.query("UPDATE authz.platform_protected_roles SET minimum_active_assignments=1,updated_at=now() WHERE role_key='platform_admin'");
}

test.before(seed);
test.after(async()=>{ await pool.end(); });

async function aliceContext(correlationId: string) {
  return buildPlatformSecurityContext({ principal:{identityId:ALICE,providerKey:"synthetic",providerSubject:"alice-platform",platformRoles:["platform_admin"]}, roles:reads, correlationId });
}

async function bobAdminContext(correlationId: string) {
  const resolved = await authDirectory.resolveProviderIdentity("r3d-test","bob");
  assert.ok(resolved);
  return buildPlatformSecurityContext({ principal:{identityId:BOB,providerKey:"r3d-test",providerSubject:"bob",platformRoles:resolved.platformRoles}, roles:reads, correlationId });
}

async function charlieRoles() {
  const resolved = await authDirectory.resolveProviderIdentity("r3d-test","charlie");
  assert.ok(resolved);
  return resolved.platformRoles;
}

test("R3-D platform role lifecycle enforces protected-role and anti-self-escalation authority",async()=>{
  const alice = await aliceContext("r3d-alice");

  const assigned = await assignPlatformRole({idempotencyKey:"r3d-assign-operator-v1",targetIdentityId:CHARLIE,roleKey:"platform_operator"},{context:{...alice,correlationId:"r3d-assign-operator"},unitOfWork:store});
  assert.equal(assigned.assignment.status,"active");
  assert.equal(assigned.assignment.identityId,CHARLIE);
  assert.ok((await charlieRoles()).includes("platform_operator"));

  const replay = await assignPlatformRole({idempotencyKey:"r3d-assign-operator-v1",targetIdentityId:CHARLIE,roleKey:"platform_operator"},{context:{...alice,correlationId:"r3d-assign-operator-replay"},unitOfWork:store});
  assert.equal(replay.replayed,true);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE correlation_id='r3d-assign-operator-replay'")).rows[0].c),0);
  await assert.rejects(()=>assignPlatformRole({idempotencyKey:"r3d-assign-operator-v1",targetIdentityId:BOB,roleKey:"platform_operator"},{context:{...alice,correlationId:"r3d-idempotency-conflict"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="IDEMPOTENCY_CONFLICT");

  await assert.rejects(()=>assignPlatformRole({idempotencyKey:"r3d-undefined-role-v1",targetIdentityId:BOB,roleKey:"undefined_platform_role"},{context:{...alice,correlationId:"r3d-undefined-role"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="NOT_FOUND");
  await assert.rejects(()=>assignPlatformRole({idempotencyKey:"r3d-inactive-target-v1",targetIdentityId:EVE,roleKey:"platform_operator"},{context:{...alice,correlationId:"r3d-inactive-target"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  await assert.rejects(()=>assignPlatformRole({idempotencyKey:"r3d-self-assign-v1",targetIdentityId:ALICE,roleKey:"platform_operator"},{context:{...alice,correlationId:"r3d-self-assign"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");

  const principal = await getPlatformPrincipalAdmin(CHARLIE,{context:{...alice,correlationId:"r3d-principal-detail"},queries:store});
  assert.equal(principal?.identityId,CHARLIE);
  assert.ok(principal?.roleAssignments.some((a)=>a.roleKey==="platform_operator"&&a.status==="active"));
  const principalList = await listPlatformPrincipalsAdmin({activeRoleKey:"platform_operator",limit:100},{context:{...alice,correlationId:"r3d-principal-list"},queries:store});
  assert.ok(principalList.some((p)=>p.identityId===CHARLIE));
  const roleList = await listPlatformRolesAdmin({limit:100},{context:{...alice,correlationId:"r3d-role-list"},queries:store});
  const platformAdminRole = roleList.find((r)=>r.roleKey==="platform_admin");
  assert.ok(platformAdminRole);
  assert.equal(platformAdminRole.protected,true);
  assert.equal(platformAdminRole.minimumActiveAssignments,1);
  assert.ok(platformAdminRole.permissionKeys.includes("platform.roles.assign"));

  const suspended = await suspendPlatformRole({idempotencyKey:"r3d-suspend-operator-v1",targetIdentityId:CHARLIE,roleKey:"platform_operator",reasonCode:"security.review"},{context:{...alice,correlationId:"r3d-suspend-operator"},unitOfWork:store});
  assert.equal(suspended.assignment.status,"suspended");
  assert.ok(!(await charlieRoles()).includes("platform_operator"));
  const reactivated = await reactivatePlatformRole({idempotencyKey:"r3d-reactivate-operator-v1",targetIdentityId:CHARLIE,roleKey:"platform_operator"},{context:{...alice,correlationId:"r3d-reactivate-operator"},unitOfWork:store});
  assert.equal(reactivated.assignment.status,"active");
  assert.ok((await charlieRoles()).includes("platform_operator"));
  const revoked = await revokePlatformRole({idempotencyKey:"r3d-revoke-operator-v1",targetIdentityId:CHARLIE,roleKey:"platform_operator",reasonCode:"security.revoked"},{context:{...alice,correlationId:"r3d-revoke-operator"},unitOfWork:store});
  assert.equal(revoked.assignment.status,"revoked");
  assert.ok(!(await charlieRoles()).includes("platform_operator"));
  const regranted = await assignPlatformRole({idempotencyKey:"r3d-regrant-operator-v1",targetIdentityId:CHARLIE,roleKey:"platform_operator",reasonCode:"security.regranted"},{context:{...alice,correlationId:"r3d-regrant-operator"},unitOfWork:store});
  assert.equal(regranted.assignment.status,"active");
  assert.ok((await charlieRoles()).includes("platform_operator"));

  const beforeRollbackTransitions = Number((await pool.query("SELECT count(*)::int AS c FROM authz.platform_role_assignment_transitions WHERE identity_id=$1 AND role_key='platform_operator'",[CHARLIE])).rows[0].c);
  await pool.query("CREATE OR REPLACE FUNCTION public.r3d_force_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.correlation_id='r3d-rollback' THEN RAISE EXCEPTION 'R3D_FORCED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$");
  await pool.query("CREATE TRIGGER r3d_force_audit_failure BEFORE INSERT ON audit.audit_events FOR EACH ROW EXECUTE FUNCTION public.r3d_force_audit_failure()");
  try {
    await assert.rejects(()=>suspendPlatformRole({idempotencyKey:"r3d-rollback-suspend-v1",targetIdentityId:CHARLIE,roleKey:"platform_operator",reasonCode:"security.rollback_probe"},{context:{...alice,correlationId:"r3d-rollback"},unitOfWork:store}));
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS r3d_force_audit_failure ON audit.audit_events");
    await pool.query("DROP FUNCTION IF EXISTS public.r3d_force_audit_failure()");
  }
  assert.equal(String((await pool.query("SELECT status FROM authz.platform_role_assignments WHERE identity_id=$1 AND role_key='platform_operator'",[CHARLIE])).rows[0].status),"active");
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM authz.platform_role_lifecycle_idempotency WHERE idempotency_key='r3d-rollback-suspend-v1'")).rows[0].c),0);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM authz.platform_role_assignment_transitions WHERE identity_id=$1 AND role_key='platform_operator'",[CHARLIE])).rows[0].c),beforeRollbackTransitions);
  assert.equal(Number((await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE correlation_id='r3d-rollback'")).rows[0].c),0);

  const bobAdmin = await assignPlatformRole({idempotencyKey:"r3d-assign-bob-admin-v1",targetIdentityId:BOB,roleKey:"platform_admin",reasonCode:"governance.peer_admin"},{context:{...alice,correlationId:"r3d-assign-bob-admin"},unitOfWork:store});
  assert.equal(bobAdmin.assignment.status,"active");
  assert.ok((await authDirectory.resolveProviderIdentity("r3d-test","bob"))?.platformRoles.includes("platform_admin"));

  const danaPrincipal = await authDirectory.resolveProviderIdentity("r3d-test","dana");
  assert.ok(danaPrincipal);
  const dana = await buildPlatformSecurityContext({principal:{identityId:DANA,providerKey:"r3d-test",providerSubject:"dana",platformRoles:danaPrincipal.platformRoles},roles:reads,correlationId:"r3d-dana"});
  assert.ok(dana.platformPermissions.includes("platform.roles.assign"));
  await assert.rejects(()=>assignPlatformRole({idempotencyKey:"r3d-dana-admin-escalation-v1",targetIdentityId:CHARLIE,roleKey:"platform_admin"},{context:{...dana,correlationId:"r3d-dana-admin-escalation"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");

  await assert.rejects(()=>suspendPlatformRole({idempotencyKey:"r3d-self-suspend-admin-v1",targetIdentityId:ALICE,roleKey:"platform_admin",reasonCode:"invalid.self_suspend"},{context:{...alice,correlationId:"r3d-self-suspend-admin"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");

  await pool.query("UPDATE authz.platform_protected_roles SET minimum_active_assignments=2,updated_at=now() WHERE role_key='platform_admin'");
  await assert.rejects(()=>suspendPlatformRole({idempotencyKey:"r3d-min-admin-block-v1",targetIdentityId:BOB,roleKey:"platform_admin",reasonCode:"governance.minimum_probe"},{context:{...alice,correlationId:"r3d-min-admin-block"},unitOfWork:store}),(e:unknown)=>e instanceof AppError&&e.code==="CONFLICT");
  await pool.query("UPDATE authz.platform_protected_roles SET minimum_active_assignments=1,updated_at=now() WHERE role_key='platform_admin'");

  const bobSuspended = await suspendPlatformRole({idempotencyKey:"r3d-suspend-bob-admin-v1",targetIdentityId:BOB,roleKey:"platform_admin",reasonCode:"governance.peer_suspend"},{context:{...alice,correlationId:"r3d-suspend-bob-admin"},unitOfWork:store});
  assert.equal(bobSuspended.assignment.status,"suspended");
  assert.ok(!(await authDirectory.resolveProviderIdentity("r3d-test","bob"))?.platformRoles.includes("platform_admin"));
  const bobReactivated = await reactivatePlatformRole({idempotencyKey:"r3d-reactivate-bob-admin-v1",targetIdentityId:BOB,roleKey:"platform_admin",reasonCode:"governance.peer_reactivate"},{context:{...alice,correlationId:"r3d-reactivate-bob-admin"},unitOfWork:store});
  assert.equal(bobReactivated.assignment.status,"active");
  assert.ok((await authDirectory.resolveProviderIdentity("r3d-test","bob"))?.platformRoles.includes("platform_admin"));
  const bobRevoked = await revokePlatformRole({idempotencyKey:"r3d-revoke-bob-admin-v1",targetIdentityId:BOB,roleKey:"platform_admin",reasonCode:"governance.peer_revoke"},{context:{...alice,correlationId:"r3d-revoke-bob-admin"},unitOfWork:store});
  assert.equal(bobRevoked.assignment.status,"revoked");
  assert.ok(!(await authDirectory.resolveProviderIdentity("r3d-test","bob"))?.platformRoles.includes("platform_admin"));
  const bobRegranted = await assignPlatformRole({idempotencyKey:"r3d-regrant-bob-admin-v1",targetIdentityId:BOB,roleKey:"platform_admin",reasonCode:"governance.peer_regrant"},{context:{...alice,correlationId:"r3d-regrant-bob-admin"},unitOfWork:store});
  assert.equal(bobRegranted.assignment.status,"active");
  const bobContext = await bobAdminContext("r3d-bob-query");
  assert.ok(bobContext.platformPermissions.includes("platform.roles.read"));

  const noPlatform = await buildPlatformSecurityContext({principal:{identityId:EVE,providerKey:"synthetic",providerSubject:"eve",platformRoles:[]},roles:reads,correlationId:"r3d-no-platform"});
  await assert.rejects(()=>listPlatformRolesAdmin({limit:10},{context:noPlatform,queries:store}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");
  await assert.rejects(()=>getPlatformPrincipalAdmin(CHARLIE,{context:noPlatform,queries:store}),(e:unknown)=>e instanceof AppError&&e.code==="PERMISSION_DENIED");

  const direct = await pool.connect();
  try {
    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_control_plane");
    await direct.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.correlation_id','r3d-db-dana-denied',true)",[DANA]);
    await assert.rejects(()=>direct.query("SELECT * FROM security.platform_mutate_role_assignment('suspend','r3d-db-dana-denied-v1',$1,'platform_operator','security.denied')",[CHARLIE]),(e:unknown)=>(e as {code?:string}).code==="42501");
    await direct.query("ROLLBACK");

    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_control_plane");
    await assert.rejects(()=>direct.query("UPDATE authz.platform_role_assignments SET status='revoked' WHERE identity_id=$1 AND role_key='platform_operator'",[CHARLIE]),(e:unknown)=>(e as {code?:string}).code==="42501");
    await direct.query("ROLLBACK");

    await direct.query("BEGIN");
    await direct.query("SET LOCAL ROLE airen_app");
    await assert.rejects(()=>direct.query("SELECT * FROM security.platform_mutate_role_assignment('suspend','r3d-app-denied-v1',$1,'platform_operator','security.denied')",[CHARLIE]),(e:unknown)=>(e as {code?:string}).code==="42501");
    await direct.query("ROLLBACK");
  } finally { direct.release(); }

  assert.ok(Number((await pool.query("SELECT count(*)::int AS c FROM authz.platform_role_assignment_transitions WHERE identity_id=$1",[CHARLIE])).rows[0].c)>=5);
  assert.ok(Number((await pool.query("SELECT count(*)::int AS c FROM audit.audit_events WHERE resource_type='PlatformRoleAssignment' AND resource_id LIKE $1",[`${CHARLIE}:%`])).rows[0].c)>=5);
  assert.ok(Number((await pool.query("SELECT count(*)::int AS c FROM events.outbox_events WHERE aggregate_type='PlatformRoleAssignment' AND aggregate_id LIKE $1",[`${CHARLIE}:%`])).rows[0].c)>=5);
});

import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import type { SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  createMenuVersion,
  fetchPublicMenu,
  publishMenuVersion,
  validateMenuVersion
} from "../../packages/ristoairen/src/menu/menu-version-publication.ts";
import {
  PostgresMenuVersionPublicationUnitOfWork,
  PostgresPublicMenuReader
} from "../../packages/persistence-postgres/src/risto-menu-version-publication.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });

const TENANT_A = "26262626-1111-4111-8111-111111111111";
const LOCATION_A = "26262626-2222-4222-8222-222222222222";
const LOCATION_A2 = "26262626-2222-4222-8222-222222222223";
const ACTOR = "26262626-3333-4333-8333-333333333333";
const TENANT_B = "26262626-4444-4444-8444-444444444444";
const LOCATION_B = "26262626-5555-4555-8555-555555555555";
const MENU_A = "26262626-6666-4666-8666-666666666666";

function context(
  correlationId: string,
  permissions: readonly string[],
  options: Readonly<{ tenantId?: string; locationId?: string; locationMembership?: boolean; entitlement?: boolean }> = {}
): SecurityContext {
  const tenantId = options.tenantId ?? TENANT_A;
  const locationId = options.locationId ?? LOCATION_A;
  const locationMembership = options.locationMembership ?? true;
  return Object.freeze({
    correlationId,
    actorIdentityId: ACTOR,
    platformRoles: [],
    platformPermissions: [],
    tenantId,
    locationId,
    tenantMembershipId: `mat026-tm-${tenantId}`,
    ...(locationMembership ? { locationMembershipId: `mat026-lm-${locationId}` } : {}),
    tenantRole: "responsabile",
    ...(locationMembership ? { locationRole: "responsabile" } : {}),
    permissions,
    entitlements: options.entitlement === false ? [] : ["vertical.ristoairen"]
  });
}

const uow = new PostgresMenuVersionPublicationUnitOfWork(pool);
const reader = new PostgresPublicMenuReader(pool);

async function seed(): Promise<void> {
  await pool.query(`
    INSERT INTO platform.tenants (id,slug,name)
    VALUES ('${TENANT_A}','mat026-a','MAT026 A'),('${TENANT_B}','mat026-b','MAT026 B');
    INSERT INTO platform.locations (id,tenant_id,slug,name,timezone)
    VALUES ('${LOCATION_A}','${TENANT_A}','main','MAT026 Main A','Europe/Rome'),
           ('${LOCATION_A2}','${TENANT_A}','second','MAT026 Second A','Europe/Rome'),
           ('${LOCATION_B}','${TENANT_B}','main','MAT026 Main B','Europe/Rome');
    INSERT INTO identity.identities (id,display_name)
    VALUES ('${ACTOR}','MAT026 Menu Manager');
    INSERT INTO ristoairen.menus
      (id,tenant_id,code,name,status,default_currency,row_version,environment_class)
    VALUES ('${MENU_A}','${TENANT_A}','DINNER','Dinner','ACTIVE','EUR',1,'TEST_TEMPORARY');
  `);
}

async function addDraftContent(
  versionId: string,
  suffix: string,
  items: readonly Readonly<{ code: string; name: string; amount: string }>[]
): Promise<Readonly<{ categoryId: string; itemIds: readonly string[] }>> {
  const categoryId = `26262626-7${suffix.padStart(3,"0")}-4777-8777-777777777777`;
  await pool.query(
    `INSERT INTO ristoairen.menu_categories
     (id,tenant_id,menu_id,menu_version_id,code,name,public_label,sort_order,active,row_version,environment_class)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$6,10,true,1,'TEST_TEMPORARY')`,
    [categoryId,TENANT_A,MENU_A,versionId,`CAT${suffix}`,`Category ${suffix}`]
  );
  const itemIds: string[] = [];
  for (let index=0; index<items.length; index += 1) {
    const itemId = `26262626-8${suffix.slice(-2).padStart(2,"0")}${index}-4888-8888-88888888888${index}`;
    itemIds.push(itemId);
    await pool.query(
      `INSERT INTO ristoairen.menu_items
       (id,tenant_id,menu_id,menu_version_id,category_id,code,name,description,
        base_price_amount,base_price_currency,status,sort_order,allergen_summary_sanitized,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9::numeric,'EUR','ACTIVE',$10,$11,1,'TEST_TEMPORARY')`,
      [itemId,TENANT_A,MENU_A,versionId,categoryId,items[index].code,items[index].name,
       `Public ${items[index].name}`,items[index].amount,(index+1)*10,index === 0 ? "GLUTEN" : null]
    );
  }
  return Object.freeze({ categoryId, itemIds: Object.freeze(itemIds) });
}

function createDeps() {
  return { unitOfWork: uow };
}

function validateDeps(at: string) {
  return { unitOfWork: uow, now: () => at };
}

function publishDeps(at: string) {
  return { unitOfWork: uow, now: () => at };
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}

test("MAT-026 / GJ2-020 menu version and publication runtime", async t => {
  await seed();
  t.after(async () => { await pool.end(); });

  let v1Id = "";
  let v1PublishedRowVersion = 0;
  let v2Id = "";
  let v2PublishedRowVersion = 0;
  let v2Item1 = "";
  let v2Item2 = "";

  await t.test("create allocates a monotonic DRAFT version and semantic replay does not duplicate it", async () => {
    const created = await createMenuVersion(
      context("mat026-v1-create",["menu.create"]),
      { menuId: MENU_A,label: "Dinner v1",idempotencyKey: "mat026-menu-v1" },
      createDeps()
    );
    v1Id = created.version.id;
    assert.equal(created.replayed,false);
    assert.equal(created.version.versionNumber,1);
    assert.equal(created.version.status,"DRAFT");
    const replay = await createMenuVersion(
      context("mat026-v1-replay",["menu.create"]),
      { menuId: MENU_A,label: "Dinner v1",idempotencyKey: "mat026-menu-v1" },
      createDeps()
    );
    assert.equal(replay.replayed,true);
    assert.equal(replay.version.id,v1Id);
    const count = await pool.query("SELECT count(*)::int AS count FROM ristoairen.menu_versions WHERE menu_id=$1",[MENU_A]);
    assert.equal(count.rows[0].count,1);
  });

  await t.test("unpublished DRAFT never leaks; validate freezes exact content with deterministic hash", async () => {
    await addDraftContent(v1Id,"001",[{ code:"PASTA",name:"Pasta v1",amount:"10.00" }]);
    const before = await fetchPublicMenu(
      { tenantId:TENANT_A,locationId:LOCATION_A,menuId:MENU_A,channel:"QR" },reader,"2026-09-10T16:00:00.000Z"
    );
    assert.equal(before,null);
    const validated = await validateMenuVersion(
      context("mat026-v1-validate",["menu.update"]),
      { menuVersionId:v1Id,expectedRowVersion:1 },
      validateDeps("2026-09-10T16:01:00.000Z")
    );
    assert.equal(validated.status,"VALIDATED");
    assert.match(validated.contentHash ?? "",/^[0-9a-f]{64}$/);
    assert.equal(validated.rowVersion,2);
    await assert.rejects(
      pool.query("UPDATE ristoairen.menu_items SET name='MUTATED' WHERE menu_version_id=$1",[v1Id]),
      /MENU_VERSION_CONTENT_IMMUTABLE/
    );
  });

  await t.test("publish v1 makes one immutable version visible through one atomic active pointer", async () => {
    const result = await publishMenuVersion(
      context("mat026-v1-publish",["menu.publish"]),
      { menuVersionId:v1Id,expectedRowVersion:2,channel:"QR" },
      publishDeps("2026-09-10T16:02:00.000Z")
    );
    assert.equal(result.replayed,false);
    assert.equal(result.version.status,"PUBLISHED");
    assert.equal(result.publication.status,"ACTIVE");
    v1PublishedRowVersion = result.version.rowVersion;
    const projection = await fetchPublicMenu(
      { tenantId:TENANT_A,locationId:LOCATION_A,menuId:MENU_A,channel:"QR" },reader,"2026-09-10T16:03:00.000Z"
    );
    assert.ok(projection);
    assert.equal(projection.menuVersionId,v1Id);
    assert.equal(projection.versionNumber,1);
    assert.equal(projection.categories.length,1);
    assert.equal(projection.categories[0].items.length,1);
    assert.equal(projection.categories[0].items[0].name,"Pasta v1");
    assert.equal(projection.categories[0].items[0].amount,"10.00");
    assert.equal("rowVersion" in projection,false);
    await assert.rejects(
      pool.query("UPDATE ristoairen.menu_items SET name='MUTATED-PUBLISHED' WHERE menu_version_id=$1",[v1Id]),
      /MENU_VERSION_CONTENT_IMMUTABLE/
    );
  });

  await t.test("a new DRAFT can be edited without leaking while public consumers continue seeing v1", async () => {
    const created = await createMenuVersion(
      context("mat026-v2-create",["menu.create"]),
      { menuId:MENU_A,label:"Dinner v2",idempotencyKey:"mat026-menu-v2" },
      createDeps()
    );
    v2Id = created.version.id;
    assert.equal(created.version.versionNumber,2);
    const content = await addDraftContent(v2Id,"002",[
      { code:"PASTA",name:"Pasta v2",amount:"12.00" },
      { code:"FISH",name:"Fish v2",amount:"20.00" }
    ]);
    v2Item1 = content.itemIds[0];
    v2Item2 = content.itemIds[1];
    await pool.query("UPDATE ristoairen.menu_items SET name='Pasta v2 edited',row_version=row_version+1 WHERE id=$1",[v2Item1]);
    const stillV1 = await fetchPublicMenu(
      { tenantId:TENANT_A,locationId:LOCATION_A,menuId:MENU_A,channel:"QR" },reader,"2026-09-10T16:04:00.000Z"
    );
    assert.equal(stillV1?.menuVersionId,v1Id);
    assert.equal(stillV1?.categories[0].items[0].name,"Pasta v1");
  });

  await t.test("v2 validation plus Location price/availability overrides switches public projection atomically", async () => {
    const validated = await validateMenuVersion(
      context("mat026-v2-validate",["menu.update"]),
      { menuVersionId:v2Id,expectedRowVersion:1 },
      validateDeps("2026-09-10T16:05:00.000Z")
    );
    assert.equal(validated.rowVersion,2);
    await pool.query(
      `INSERT INTO ristoairen.price_rules
       (tenant_id,location_id,menu_id,menu_version_id,menu_item_id,channel,price_amount,currency,reason_code,effective_from,priority,status,created_by_identity_id,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'QR',14.50,'EUR','DINNER_LOCATION_PRICE',$6::timestamptz,100,'ACTIVE',$7::uuid,1,'TEST_TEMPORARY')`,
      [TENANT_A,LOCATION_A,MENU_A,v2Id,v2Item1,"2026-09-10T16:00:00.000Z",ACTOR]
    );
    await pool.query(
      `INSERT INTO ristoairen.availability_rules
       (tenant_id,location_id,menu_id,menu_version_id,menu_item_id,channel,available,reason_code,effective_from,priority,status,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'QR',false,'SOLD_OUT',$6::timestamptz,100,'ACTIVE',1,'TEST_TEMPORARY')`,
      [TENANT_A,LOCATION_A,MENU_A,v2Id,v2Item2,"2026-09-10T16:00:00.000Z"]
    );
    const beforeSwitch = await fetchPublicMenu(
      { tenantId:TENANT_A,locationId:LOCATION_A,menuId:MENU_A,channel:"QR" },reader,"2026-09-10T16:05:30.000Z"
    );
    assert.equal(beforeSwitch?.menuVersionId,v1Id);

    const published = await publishMenuVersion(
      context("mat026-v2-publish",["menu.publish"]),
      { menuVersionId:v2Id,expectedRowVersion:2,channel:"QR" },
      publishDeps("2026-09-10T16:06:00.000Z")
    );
    v2PublishedRowVersion = published.version.rowVersion;
    const afterSwitch = await fetchPublicMenu(
      { tenantId:TENANT_A,locationId:LOCATION_A,menuId:MENU_A,channel:"QR" },reader,"2026-09-10T16:06:01.000Z"
    );
    assert.ok(afterSwitch);
    assert.equal(afterSwitch.menuVersionId,v2Id);
    assert.equal(afterSwitch.versionNumber,2);
    assert.equal(afterSwitch.categories.length,1);
    assert.equal(afterSwitch.categories[0].items.length,1);
    assert.equal(afterSwitch.categories[0].items[0].name,"Pasta v2 edited");
    assert.equal(afterSwitch.categories[0].items[0].amount,"14.50");
    assert.equal(afterSwitch.categories[0].items[0].currency,"EUR");
    assert.equal(afterSwitch.categories[0].items.some(item => item.code === "FISH"),false);

    const pointers = await pool.query(
      "SELECT status,count(*)::int AS count FROM ristoairen.menu_publications WHERE tenant_id=$1 AND location_id=$2 AND menu_id=$3 AND channel='QR' GROUP BY status ORDER BY status",
      [TENANT_A,LOCATION_A,MENU_A]
    );
    assert.deepEqual(pointers.rows,[{ status:"ACTIVE",count:1 },{ status:"ENDED",count:1 }]);
    const old = await pool.query("SELECT status,effective_to FROM ristoairen.menu_publications WHERE menu_version_id=$1",[v1Id]);
    assert.equal(old.rows[0].status,"ENDED");
    assert.ok(old.rows[0].effective_to);
  });

  await t.test("publication replay converges on the same pointer without duplicates", async () => {
    const replay = await publishMenuVersion(
      context("mat026-v2-replay",["menu.publish"]),
      { menuVersionId:v2Id,expectedRowVersion:v2PublishedRowVersion,channel:"QR" },
      publishDeps("2026-09-10T16:07:00.000Z")
    );
    assert.equal(replay.replayed,true);
    const count = await pool.query(
      "SELECT count(*)::int AS count FROM ristoairen.menu_publications WHERE menu_version_id=$1 AND location_id=$2 AND channel='QR'",
      [v2Id,LOCATION_A]
    );
    assert.equal(count.rows[0].count,1);
  });

  await t.test("stale publish and missing Location authority fail closed without changing the public pointer", async () => {
    const v3 = await createMenuVersion(
      context("mat026-v3-create",["menu.create"]),
      { menuId:MENU_A,label:"Dinner v3",idempotencyKey:"mat026-menu-v3" },
      createDeps()
    );
    await addDraftContent(v3.version.id,"003",[{ code:"PASTA",name:"Pasta v3",amount:"15.00" }]);
    const validated = await validateMenuVersion(
      context("mat026-v3-validate",["menu.update"]),
      { menuVersionId:v3.version.id,expectedRowVersion:1 },
      validateDeps("2026-09-10T16:08:00.000Z")
    );
    assert.equal(validated.rowVersion,2);
    await assert.rejects(
      publishMenuVersion(
        context("mat026-v3-stale",["menu.publish"]),
        { menuVersionId:v3.version.id,expectedRowVersion:1,channel:"QR" },
        publishDeps("2026-09-10T16:09:00.000Z")
      ),
      (error: unknown) => hasCode(error,"CONFLICT")
    );
    await assert.rejects(
      publishMenuVersion(
        context("mat026-v3-no-location",["menu.publish"],{ locationMembership:false }),
        { menuVersionId:v3.version.id,expectedRowVersion:2,channel:"QR" },
        publishDeps("2026-09-10T16:09:30.000Z")
      ),
      (error: unknown) => hasCode(error,"LOCATION_MEMBERSHIP_REQUIRED")
    );
    const projection = await fetchPublicMenu(
      { tenantId:TENANT_A,locationId:LOCATION_A,menuId:MENU_A,channel:"QR" },reader,"2026-09-10T16:10:00.000Z"
    );
    assert.equal(projection?.menuVersionId,v2Id);
  });

  await t.test("RLS hides Tenant A menu/publication from Tenant B and entitlement is independently required", async () => {
    const crossTenant = await fetchPublicMenu(
      { tenantId:TENANT_B,locationId:LOCATION_B,menuId:MENU_A,channel:"QR" },reader,"2026-09-10T16:10:00.000Z"
    );
    assert.equal(crossTenant,null);
    await assert.rejects(
      createMenuVersion(
        context("mat026-no-entitlement",["menu.create"],{ entitlement:false }),
        { menuId:MENU_A,label:"forbidden",idempotencyKey:"mat026-forbidden" },
        createDeps()
      ),
      (error: unknown) => hasCode(error,"ENTITLEMENT_REQUIRED")
    );
    await assert.rejects(
      createMenuVersion(
        context("mat026-cross-tenant-create",["menu.create"],{ tenantId:TENANT_B,locationId:LOCATION_B }),
        { menuId:MENU_A,label:"hidden",idempotencyKey:"mat026-hidden" },
        createDeps()
      ),
      (error: unknown) => hasCode(error,"NOT_FOUND")
    );
  });

  await t.test("audit evidence records create, validate and publish without mutating protected predecessor truth", async () => {
    const audits = await pool.query(
      `SELECT action_key,count(*)::int AS count FROM audit.audit_events
        WHERE tenant_id=$1 AND action_key IN ('MENU_VERSION_CREATED','MENU_VERSION_VALIDATED','MENU_VERSION_PUBLISHED')
        GROUP BY action_key ORDER BY action_key`,[TENANT_A]
    );
    assert.deepEqual(audits.rows,[
      { action_key:"MENU_VERSION_CREATED",count:3 },
      { action_key:"MENU_VERSION_PUBLISHED",count:2 },
      { action_key:"MENU_VERSION_VALIDATED",count:3 }
    ]);
    assert.ok(v1PublishedRowVersion >= 3);
    assert.ok(v2PublishedRowVersion >= 3);
  });
});

import { Pool, type PoolClient } from "pg";
import type { AuditRecord, UnitOfWork } from "../../audit-events/src/index.ts";
import type { DomainEvent, SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  CanonicalMenuContent,
  MenuChannel,
  MenuPublicationRecord,
  MenuRecord,
  MenuVersionPublicationTransaction,
  MenuVersionRecord,
  PublicMenuCategory,
  PublicMenuProjection,
  PublicMenuReader,
  PublicMenuScope
} from "../../ristoairen/src/menu/menu-version-publication.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function menuFromRow(row: Record<string, unknown>): MenuRecord {
  return Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenantId),
    code: String(row.code),
    status: String(row.status) as MenuRecord["status"],
    defaultCurrency: String(row.defaultCurrency),
    environmentClass: String(row.environmentClass)
  });
}

function versionFromRow(row: Record<string, unknown>): MenuVersionRecord {
  return Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenantId),
    menuId: String(row.menuId),
    versionNumber: Number(row.versionNumber),
    ...(row.label == null ? {} : { label: String(row.label) }),
    status: String(row.status) as MenuVersionRecord["status"],
    ...(row.contentHash == null ? {} : { contentHash: String(row.contentHash) }),
    sourceRequestKey: String(row.sourceRequestKey),
    rowVersion: Number(row.rowVersion),
    environmentClass: String(row.environmentClass),
    ...(row.validatedAt == null ? {} : { validatedAt: new Date(String(row.validatedAt)).toISOString() }),
    ...(row.publishedAt == null ? {} : { publishedAt: new Date(String(row.publishedAt)).toISOString() })
  });
}

function publicationFromRow(row: Record<string, unknown>): MenuPublicationRecord {
  return Object.freeze({
    id: String(row.id),
    tenantId: String(row.tenantId),
    locationId: String(row.locationId),
    menuId: String(row.menuId),
    menuVersionId: String(row.menuVersionId),
    channel: String(row.channel) as MenuChannel,
    status: String(row.status) as MenuPublicationRecord["status"],
    effectiveFrom: new Date(String(row.effectiveFrom)).toISOString(),
    ...(row.effectiveTo == null ? {} : { effectiveTo: new Date(String(row.effectiveTo)).toISOString() }),
    rowVersion: Number(row.rowVersion)
  });
}

const VERSION_SELECT = `SELECT id::text AS id, tenant_id::text AS "tenantId", menu_id::text AS "menuId",
 version_number AS "versionNumber", label, status, content_hash AS "contentHash",
 source_request_key AS "sourceRequestKey", row_version AS "rowVersion", environment_class AS "environmentClass",
 validated_at AS "validatedAt", published_at AS "publishedAt"
 FROM ristoairen.menu_versions`;

const PUBLICATION_SELECT = `SELECT id::text AS id, tenant_id::text AS "tenantId", location_id::text AS "locationId",
 menu_id::text AS "menuId", menu_version_id::text AS "menuVersionId", channel, status,
 effective_from AS "effectiveFrom", effective_to AS "effectiveTo", row_version AS "rowVersion"
 FROM ristoairen.menu_publications`;

export class PostgresMenuVersionPublicationTransaction implements MenuVersionPublicationTransaction {
  private readonly client: PoolClient;
  private readonly context: SecurityContext;

  constructor(client: PoolClient, context: SecurityContext) {
    this.client = client;
    this.context = context;
  }

  async getMenuForVersionCreation(menuId: string): Promise<MenuRecord | null> {
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`risto:menu-version:${this.context.tenantId}:${menuId}`]
    );
    const result = await this.client.query(
      `SELECT id::text AS id,tenant_id::text AS "tenantId",code,status,
              default_currency AS "defaultCurrency",environment_class AS "environmentClass"
         FROM ristoairen.menus WHERE id=$1::uuid FOR UPDATE`,
      [menuId]
    );
    return result.rows[0] ? menuFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async findVersionByRequestKey(menuId: string, sourceRequestKey: string): Promise<MenuVersionRecord | null> {
    const result = await this.client.query(
      `${VERSION_SELECT} WHERE menu_id=$1::uuid AND source_request_key=$2`,
      [menuId, sourceRequestKey]
    );
    return result.rows[0] ? versionFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async nextVersionNumber(menuId: string): Promise<number> {
    const result = await this.client.query(
      "SELECT COALESCE(MAX(version_number),0)::int+1 AS next FROM ristoairen.menu_versions WHERE menu_id=$1::uuid",
      [menuId]
    );
    return Number(result.rows[0].next);
  }

  async insertDraftVersion(input: Readonly<{
    tenantId: string; menuId: string; versionNumber: number; label?: string; sourceRequestKey: string;
    createdByIdentityId: string; environmentClass: string;
  }>): Promise<MenuVersionRecord> {
    const result = await this.client.query(
      `INSERT INTO ristoairen.menu_versions
       (tenant_id,menu_id,version_number,label,status,source_request_key,created_by_identity_id,row_version,environment_class)
       VALUES ($1::uuid,$2::uuid,$3,$4,'DRAFT',$5,$6::uuid,1,$7)
       RETURNING id::text AS id,tenant_id::text AS "tenantId",menu_id::text AS "menuId",
         version_number AS "versionNumber",label,status,content_hash AS "contentHash",
         source_request_key AS "sourceRequestKey",row_version AS "rowVersion",environment_class AS "environmentClass",
         validated_at AS "validatedAt",published_at AS "publishedAt"`,
      [input.tenantId,input.menuId,input.versionNumber,input.label ?? null,input.sourceRequestKey,input.createdByIdentityId,input.environmentClass]
    );
    return versionFromRow(result.rows[0] as Record<string, unknown>);
  }

  async getVersionForValidation(menuVersionId: string): Promise<MenuVersionRecord | null> {
    const result = await this.client.query(`${VERSION_SELECT} WHERE id=$1::uuid FOR UPDATE`, [menuVersionId]);
    return result.rows[0] ? versionFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async loadCanonicalContent(menuVersionId: string): Promise<CanonicalMenuContent> {
    const categories = await this.client.query(
      `SELECT id::text AS id,code,name,public_label AS "publicLabel",sort_order AS "sortOrder",active
         FROM ristoairen.menu_categories WHERE menu_version_id=$1::uuid
        ORDER BY sort_order,code,id`, [menuVersionId]
    );
    const items = await this.client.query(
      `SELECT id::text AS id,category_id::text AS "categoryId",code,name,description,
              base_price_amount::text AS "basePriceAmount",base_price_currency AS "basePriceCurrency",
              status,sort_order AS "sortOrder",allergen_summary_sanitized AS "allergenSummarySanitized"
         FROM ristoairen.menu_items WHERE menu_version_id=$1::uuid
        ORDER BY sort_order,code,id`, [menuVersionId]
    );
    return Object.freeze({
      categories: Object.freeze(categories.rows.map((row: Record<string, unknown>) => Object.freeze({
        id: String(row.id), code: String(row.code), name: String(row.name),
        ...(row.publicLabel == null ? {} : { publicLabel: String(row.publicLabel) }),
        sortOrder: Number(row.sortOrder), active: Boolean(row.active)
      }))),
      items: Object.freeze(items.rows.map((row: Record<string, unknown>) => Object.freeze({
        id: String(row.id), categoryId: String(row.categoryId), code: String(row.code), name: String(row.name),
        ...(row.description == null ? {} : { description: String(row.description) }),
        basePriceAmount: String(row.basePriceAmount), basePriceCurrency: String(row.basePriceCurrency),
        status: String(row.status) as "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED",
        sortOrder: Number(row.sortOrder),
        ...(row.allergenSummarySanitized == null ? {} : { allergenSummarySanitized: String(row.allergenSummarySanitized) })
      })))
    });
  }

  async markValidated(input: Readonly<{ menuVersionId: string; expectedRowVersion: number; contentHash: string; validatedAt: string }>): Promise<MenuVersionRecord> {
    const result = await this.client.query(
      `UPDATE ristoairen.menu_versions
          SET status='VALIDATED',content_hash=$3,validated_at=$4::timestamptz,
              row_version=row_version+1,updated_at=$4::timestamptz
        WHERE id=$1::uuid AND status='DRAFT' AND row_version=$2
        RETURNING id::text AS id,tenant_id::text AS "tenantId",menu_id::text AS "menuId",
          version_number AS "versionNumber",label,status,content_hash AS "contentHash",
          source_request_key AS "sourceRequestKey",row_version AS "rowVersion",environment_class AS "environmentClass",
          validated_at AS "validatedAt",published_at AS "publishedAt"`,
      [input.menuVersionId,input.expectedRowVersion,input.contentHash,input.validatedAt]
    );
    if (!result.rows[0]) throw new Error("MENU_VERSION_VALIDATE_STATE_CONFLICT");
    return versionFromRow(result.rows[0] as Record<string, unknown>);
  }

  async getVersionForPublication(menuVersionId: string): Promise<MenuVersionRecord | null> {
    const result = await this.client.query(`${VERSION_SELECT} WHERE id=$1::uuid FOR UPDATE`, [menuVersionId]);
    return result.rows[0] ? versionFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async findPublicationForVersion(input: Readonly<{ menuId: string; menuVersionId: string; locationId: string; channel: MenuChannel }>): Promise<MenuPublicationRecord | null> {
    const result = await this.client.query(
      `${PUBLICATION_SELECT} WHERE menu_id=$1::uuid AND menu_version_id=$2::uuid AND location_id=$3::uuid AND channel=$4
       ORDER BY created_at DESC LIMIT 1`,
      [input.menuId,input.menuVersionId,input.locationId,input.channel]
    );
    return result.rows[0] ? publicationFromRow(result.rows[0] as Record<string, unknown>) : null;
  }

  async switchPublication(input: Readonly<{
    menuVersion: MenuVersionRecord; expectedRowVersion: number; locationId: string; channel: MenuChannel;
    effectiveFrom: string; effectiveTo?: string; now: string; publishedByIdentityId: string;
  }>): Promise<Readonly<{ version: MenuVersionRecord; publication: MenuPublicationRecord }>> {
    await this.client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`risto:menu-publication:${this.context.tenantId}:${input.locationId}:${input.menuVersion.menuId}:${input.channel}`]
    );

    const isCurrent = Date.parse(input.effectiveFrom) <= Date.parse(input.now);
    if (isCurrent) {
      await this.client.query(
        `UPDATE ristoairen.menu_publications
            SET status='ENDED',effective_to=CASE
                  WHEN effective_to IS NULL OR effective_to>$5::timestamptz THEN $5::timestamptz ELSE effective_to END,
                row_version=row_version+1,updated_at=$5::timestamptz
          WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND menu_id=$3::uuid AND channel=$4 AND status='ACTIVE'`,
        [this.context.tenantId,input.locationId,input.menuVersion.menuId,input.channel,input.now]
      );
    } else {
      await this.client.query(
        `UPDATE ristoairen.menu_publications
            SET effective_to=CASE
                  WHEN effective_to IS NULL OR effective_to>$5::timestamptz THEN $5::timestamptz ELSE effective_to END,
                row_version=row_version+1,updated_at=$6::timestamptz
          WHERE tenant_id=$1::uuid AND location_id=$2::uuid AND menu_id=$3::uuid AND channel=$4 AND status='ACTIVE'`,
        [this.context.tenantId,input.locationId,input.menuVersion.menuId,input.channel,input.effectiveFrom,input.now]
      );
    }

    const versionResult = await this.client.query(
      `UPDATE ristoairen.menu_versions
          SET status='PUBLISHED',published_at=$3::timestamptz,row_version=row_version+1,updated_at=$3::timestamptz
        WHERE id=$1::uuid AND status='VALIDATED' AND row_version=$2
        RETURNING id::text AS id,tenant_id::text AS "tenantId",menu_id::text AS "menuId",
          version_number AS "versionNumber",label,status,content_hash AS "contentHash",
          source_request_key AS "sourceRequestKey",row_version AS "rowVersion",environment_class AS "environmentClass",
          validated_at AS "validatedAt",published_at AS "publishedAt"`,
      [input.menuVersion.id,input.expectedRowVersion,input.now]
    );
    if (!versionResult.rows[0]) throw new Error("MENU_VERSION_PUBLISH_STATE_CONFLICT");

    const publicationResult = await this.client.query(
      `INSERT INTO ristoairen.menu_publications
       (tenant_id,location_id,menu_id,menu_version_id,channel,status,effective_from,effective_to,
        published_by_identity_id,row_version,environment_class,created_at,updated_at)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::timestamptz,$8::timestamptz,$9::uuid,1,$10,$11::timestamptz,$11::timestamptz)
       RETURNING id::text AS id,tenant_id::text AS "tenantId",location_id::text AS "locationId",
         menu_id::text AS "menuId",menu_version_id::text AS "menuVersionId",channel,status,
         effective_from AS "effectiveFrom",effective_to AS "effectiveTo",row_version AS "rowVersion"`,
      [this.context.tenantId,input.locationId,input.menuVersion.menuId,input.menuVersion.id,input.channel,
       isCurrent ? "ACTIVE" : "SCHEDULED",input.effectiveFrom,input.effectiveTo ?? null,input.publishedByIdentityId,
       input.menuVersion.environmentClass,input.now]
    );
    return Object.freeze({
      version: versionFromRow(versionResult.rows[0] as Record<string, unknown>),
      publication: publicationFromRow(publicationResult.rows[0] as Record<string, unknown>)
    });
  }

  async audit(record: AuditRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO audit.audit_events
       (tenant_id,location_id,actor_identity_id,actor_kind,action_key,resource_type,resource_id,correlation_id,outcome,metadata)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'system',$4,$5,$6,$7,$8,$9::jsonb)`,
      [record.tenantId,record.locationId,record.actorIdentityId,record.actionKey,
       record.resourceType ?? null,record.resourceId ?? null,record.correlationId,record.outcome,JSON.stringify(record.metadata ?? {})]
    );
  }

  async outbox(_event: DomainEvent & { tenantId: string; locationId: string; correlationId: string }): Promise<void> {
    throw new Error("MENU_VERSION_PUBLICATION_HAS_NO_OUTBOX_IN_MAT026");
  }
}

export class PostgresMenuVersionPublicationUnitOfWork implements UnitOfWork<MenuVersionPublicationTransaction> {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async transaction<T>(fn: (tx: MenuVersionPublicationTransaction) => Promise<T>, context?: SecurityContext): Promise<T> {
    if (!context) throw new Error("SecurityContext is required for menu version/publication runtime");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
        [context.actorIdentityId,context.tenantId,context.locationId,context.correlationId]
      );
      const value = await fn(new PostgresMenuVersionPublicationTransaction(client,context));
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PostgresPublicMenuReader implements PublicMenuReader {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_app") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async fetch(scope: PublicMenuScope, atIso: string): Promise<PublicMenuProjection | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      await client.query(
        "SELECT set_config('airen.tenant_id',$1,true),set_config('airen.location_id',$2,true),set_config('airen.correlation_id',$3,true)",
        [scope.tenantId,scope.locationId,`public-menu:${scope.menuId}:${scope.channel}`]
      );
      const publication = await client.query(
        `SELECT p.id::text AS "publicationId",p.menu_version_id::text AS "menuVersionId",
                v.version_number AS "versionNumber",v.content_hash AS "contentHash"
           FROM ristoairen.menu_publications p
           JOIN ristoairen.menu_versions v
             ON v.tenant_id=p.tenant_id AND v.menu_id=p.menu_id AND v.id=p.menu_version_id
          WHERE p.menu_id=$1::uuid AND p.location_id=$2::uuid AND p.channel=$3
            AND p.status IN ('ACTIVE','SCHEDULED') AND p.effective_from<=$4::timestamptz
            AND (p.effective_to IS NULL OR p.effective_to>$4::timestamptz)
            AND v.status='PUBLISHED'
          ORDER BY p.effective_from DESC,p.created_at DESC LIMIT 1`,
        [scope.menuId,scope.locationId,scope.channel,atIso]
      );
      if (!publication.rows[0]) {
        await client.query("COMMIT");
        return null;
      }
      const pub = publication.rows[0] as Record<string, unknown>;
      const rows = await client.query(
        `SELECT c.id::text AS "categoryId",c.code AS "categoryCode",c.name AS "categoryName",
                c.public_label AS "publicLabel",c.sort_order AS "categorySortOrder",
                i.id::text AS "itemId",i.code AS "itemCode",i.name AS "itemName",i.description,
                COALESCE(pr.price_amount,i.base_price_amount)::text AS amount,
                COALESCE(pr.currency,i.base_price_currency) AS currency,
                i.sort_order AS "itemSortOrder",i.allergen_summary_sanitized AS "allergenSummarySanitized"
           FROM ristoairen.menu_categories c
           JOIN ristoairen.menu_items i
             ON i.tenant_id=c.tenant_id AND i.menu_id=c.menu_id
            AND i.menu_version_id=c.menu_version_id AND i.category_id=c.id
           LEFT JOIN LATERAL (
             SELECT ar.available
               FROM ristoairen.availability_rules ar
              WHERE ar.menu_version_id=i.menu_version_id AND ar.menu_item_id=i.id AND ar.status='ACTIVE'
                AND (ar.location_id IS NULL OR ar.location_id=$2::uuid)
                AND ar.channel IN ('ANY',$3) AND ar.effective_from<=$4::timestamptz
                AND (ar.effective_to IS NULL OR ar.effective_to>$4::timestamptz)
              ORDER BY (ar.location_id IS NOT NULL) DESC,ar.priority DESC,ar.effective_from DESC,ar.id DESC LIMIT 1
           ) ar ON true
           LEFT JOIN LATERAL (
             SELECT r.price_amount,r.currency
               FROM ristoairen.price_rules r
              WHERE r.menu_version_id=i.menu_version_id AND r.menu_item_id=i.id AND r.status='ACTIVE'
                AND (r.location_id IS NULL OR r.location_id=$2::uuid)
                AND r.channel IN ('ANY',$3) AND r.effective_from<=$4::timestamptz
                AND (r.effective_to IS NULL OR r.effective_to>$4::timestamptz)
              ORDER BY (r.location_id IS NOT NULL) DESC,r.priority DESC,r.effective_from DESC,r.id DESC LIMIT 1
           ) pr ON true
          WHERE c.menu_version_id=$1::uuid AND c.active=true AND i.status='ACTIVE'
            AND COALESCE(ar.available,true)=true
          ORDER BY c.sort_order,c.code,c.id,i.sort_order,i.code,i.id`,
        [String(pub.menuVersionId),scope.locationId,scope.channel,atIso]
      );
      const categories = new Map<string,{ id:string; code:string; name:string; publicLabel?:string; sortOrder:number; items:Array<{
        id:string; code:string; name:string; description?:string; amount:string; currency:string; sortOrder:number; allergenSummarySanitized?:string;
      }> }>();
      for (const raw of rows.rows as Record<string, unknown>[]) {
        const categoryId = String(raw.categoryId);
        let category = categories.get(categoryId);
        if (!category) {
          category = {
            id: categoryId,code: String(raw.categoryCode),name: String(raw.categoryName),
            ...(raw.publicLabel == null ? {} : { publicLabel: String(raw.publicLabel) }),
            sortOrder: Number(raw.categorySortOrder),items: []
          };
          categories.set(categoryId,category);
        }
        category.items.push({
          id: String(raw.itemId),code: String(raw.itemCode),name: String(raw.itemName),
          ...(raw.description == null ? {} : { description: String(raw.description) }),
          amount: String(raw.amount),currency: String(raw.currency),sortOrder: Number(raw.itemSortOrder),
          ...(raw.allergenSummarySanitized == null ? {} : { allergenSummarySanitized: String(raw.allergenSummarySanitized) })
        });
      }
      const frozenCategories: readonly PublicMenuCategory[] = Object.freeze([...categories.values()].map(category => Object.freeze({
        ...category,items: Object.freeze(category.items.map(item => Object.freeze(item)))
      })));
      await client.query("COMMIT");
      return Object.freeze({
        menuId: scope.menuId,
        menuVersionId: String(pub.menuVersionId),
        versionNumber: Number(pub.versionNumber),
        contentHash: String(pub.contentHash),
        locationId: scope.locationId,
        channel: scope.channel,
        publicationId: String(pub.publicationId),
        categories: frozenCategories
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

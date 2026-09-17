import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AppError, type SecurityContext } from "../../shared-contracts/src/index.ts";
import type {
  LoyaltyMutationInputV1,
  LoyaltyVoucherRepository,
  PublicLoyaltyVoucherProjectionV1,
  VoucherIssueInputV1,
  VoucherRedeemInputV1,
} from "../../ristoairen/src/loyalty-voucher/contracts.ts";
import { PUBLIC_LOYALTY_VOUCHER_IDENTITY_ID } from "../../ristoairen/src/loyalty-voucher/contracts.ts";
import type { ResolvedPublicTenantV1 } from "../../ristoairen/src/public-content/contracts.ts";

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function applyScope(client: PoolClient, input: Readonly<{ identityId: string; tenantId: string; locationId: string; correlationId: string }>): Promise<void> {
  await client.query("SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)", [input.identityId,input.tenantId,input.locationId,input.correlationId]);
  await client.query("SET LOCAL ROLE airen_app");
}

export class PostgresRistoLoyaltyVoucherRepository implements LoyaltyVoucherRepository {
  constructor(private readonly pool: Pool) {}

  async appendLoyalty(context: SecurityContext, input: LoyaltyMutationInputV1, kind: "EARN" | "REDEEM", idempotencyKey: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await applyScope(client, { identityId:context.actorIdentityId, tenantId:context.tenantId, locationId:context.locationId, correlationId:context.correlationId });
      const requestHash = digest({ kind,input });
      const existing = await client.query<{ request_hash:string }>("SELECT request_hash FROM ristoairen.loyalty_ledger WHERE tenant_id=$1 AND location_id=$2 AND idempotency_key=$3", [context.tenantId,context.locationId,idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0].request_hash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with different Loyalty payload");
        const balance = await this.loyaltyBalance(client, context.tenantId, context.locationId, input.customerPassId);
        await client.query("COMMIT"); return { replayed:true, loyaltyPoints:balance };
      }
      const pass = await client.query("SELECT 1 FROM ristoairen.customer_passes WHERE tenant_id=$1 AND location_id=$2 AND id=$3 AND status='ACTIVE' FOR SHARE", [context.tenantId,context.locationId,input.customerPassId]);
      if (!pass.rowCount) throw new AppError("NOT_FOUND", "CustomerPass not found");
      const current = await this.loyaltyBalance(client, context.tenantId, context.locationId, input.customerPassId);
      const delta = kind === "EARN" ? input.points : -input.points;
      if (current + delta < 0) throw new AppError("CONFLICT", "Insufficient Loyalty points");
      await client.query(`INSERT INTO ristoairen.loyalty_ledger
        (tenant_id,location_id,customer_pass_id,entry_kind,points_delta,reason,idempotency_key,request_hash,actor_identity_id,correlation_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [context.tenantId,context.locationId,input.customerPassId,kind,delta,input.reason,idempotencyKey,requestHash,context.actorIdentityId,context.correlationId]);
      await client.query("COMMIT"); return { replayed:false, loyaltyPoints:current+delta };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async issueVoucher(context: SecurityContext, input: VoucherIssueInputV1, idempotencyKey: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await applyScope(client, { identityId:context.actorIdentityId, tenantId:context.tenantId, locationId:context.locationId, correlationId:context.correlationId });
      const requestHash = digest({ kind:"ISSUE",input });
      const existing = await client.query<{ request_hash:string }>("SELECT request_hash FROM ristoairen.voucher_ledger WHERE tenant_id=$1 AND location_id=$2 AND idempotency_key=$3", [context.tenantId,context.locationId,idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0].request_hash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with different Voucher payload");
        await client.query("COMMIT"); return { replayed:true };
      }
      const pass = await client.query("SELECT 1 FROM ristoairen.customer_passes WHERE tenant_id=$1 AND location_id=$2 AND id=$3 AND status='ACTIVE' FOR SHARE", [context.tenantId,context.locationId,input.customerPassId]);
      if (!pass.rowCount) throw new AppError("NOT_FOUND", "CustomerPass not found");
      const voucher = await client.query<{ id:string }>(`INSERT INTO ristoairen.vouchers
        (tenant_id,location_id,customer_pass_id,public_reference,label,currency,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`, [context.tenantId,context.locationId,input.customerPassId,input.publicReference,input.label,input.currency,input.expiresAt ?? null]);
      await client.query(`INSERT INTO ristoairen.voucher_ledger
        (tenant_id,location_id,voucher_id,entry_kind,value_delta_minor,reason,idempotency_key,request_hash,actor_identity_id,correlation_id)
        VALUES ($1,$2,$3,'ISSUE',$4,$5,$6,$7,$8,$9)`, [context.tenantId,context.locationId,voucher.rows[0].id,input.valueMinor,input.reason,idempotencyKey,requestHash,context.actorIdentityId,context.correlationId]);
      await client.query("COMMIT"); return { replayed:false };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async redeemVoucher(context: SecurityContext, input: VoucherRedeemInputV1, idempotencyKey: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await applyScope(client, { identityId:context.actorIdentityId, tenantId:context.tenantId, locationId:context.locationId, correlationId:context.correlationId });
      const requestHash = digest({ kind:"REDEEM",input });
      const existing = await client.query<{ request_hash:string }>("SELECT request_hash FROM ristoairen.voucher_ledger WHERE tenant_id=$1 AND location_id=$2 AND idempotency_key=$3", [context.tenantId,context.locationId,idempotencyKey]);
      if (existing.rowCount) {
        if (existing.rows[0].request_hash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with different Voucher payload");
        await client.query("COMMIT"); return { replayed:true };
      }
      const voucher = await client.query<{ id:string; expires_at:string|null }>("SELECT id::text,expires_at FROM ristoairen.vouchers WHERE tenant_id=$1 AND location_id=$2 AND public_reference=$3 FOR UPDATE", [context.tenantId,context.locationId,input.publicReference]);
      if (!voucher.rowCount) throw new AppError("NOT_FOUND", "Voucher not found");
      const row = voucher.rows[0];
      if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) throw new AppError("CONFLICT", "Voucher expired");
      const balance = await client.query<{ remaining:number }>("SELECT COALESCE(SUM(value_delta_minor),0)::int AS remaining FROM ristoairen.voucher_ledger WHERE tenant_id=$1 AND location_id=$2 AND voucher_id=$3", [context.tenantId,context.locationId,row.id]);
      const remaining = balance.rows[0]?.remaining ?? 0;
      if (remaining < input.valueMinor) throw new AppError("CONFLICT", "Insufficient Voucher value");
      await client.query(`INSERT INTO ristoairen.voucher_ledger
        (tenant_id,location_id,voucher_id,entry_kind,value_delta_minor,reason,idempotency_key,request_hash,actor_identity_id,correlation_id)
        VALUES ($1,$2,$3,'REDEEM',$4,$5,$6,$7,$8,$9)`, [context.tenantId,context.locationId,row.id,-input.valueMinor,input.reason,idempotencyKey,requestHash,context.actorIdentityId,context.correlationId]);
      await client.query("COMMIT"); return { replayed:false };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async readOwnedProjection(scopeInput: ResolvedPublicTenantV1, credentialHash: string, correlationId: string): Promise<PublicLoyaltyVoucherProjectionV1 | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      await applyScope(client, { identityId:PUBLIC_LOYALTY_VOUCHER_IDENTITY_ID, tenantId:scopeInput.tenantId, locationId:scopeInput.locationId, correlationId });
      const pass = await client.query<{ id:string }>("SELECT id::text FROM ristoairen.customer_passes WHERE tenant_id=$1 AND location_id=$2 AND credential_hash=$3 AND status='ACTIVE'", [scopeInput.tenantId,scopeInput.locationId,credentialHash]);
      if (!pass.rowCount) { await client.query("COMMIT"); return null; }
      const passId = pass.rows[0].id;
      const loyalty = await this.loyaltyBalance(client, scopeInput.tenantId, scopeInput.locationId, passId);
      const vouchers = await client.query<{ reference:string;label:string;currency:string;expires_at:string|null;issued:number;redeemed:number;remaining:number;canceled:boolean }>(`SELECT v.public_reference AS reference,v.label,v.currency,v.expires_at,
        COALESCE(SUM(CASE WHEN l.entry_kind='ISSUE' THEN l.value_delta_minor ELSE 0 END),0)::int AS issued,
        COALESCE(-SUM(CASE WHEN l.entry_kind='REDEEM' THEN l.value_delta_minor ELSE 0 END),0)::int AS redeemed,
        COALESCE(SUM(l.value_delta_minor),0)::int AS remaining,
        BOOL_OR(l.entry_kind='CANCEL') AS canceled
        FROM ristoairen.vouchers v JOIN ristoairen.voucher_ledger l
          ON l.tenant_id=v.tenant_id AND l.location_id=v.location_id AND l.voucher_id=v.id
        WHERE v.tenant_id=$1 AND v.location_id=$2 AND v.customer_pass_id=$3
        GROUP BY v.id,v.public_reference,v.label,v.currency,v.expires_at ORDER BY v.created_at,v.public_reference`, [scopeInput.tenantId,scopeInput.locationId,passId]);
      const now = Date.now();
      const projection = Object.freeze({
        loyaltyPoints:loyalty,
        vouchers:Object.freeze(vouchers.rows.map((row) => Object.freeze({
          reference:row.reference,label:row.label,currency:row.currency,issuedValueMinor:row.issued,redeemedValueMinor:row.redeemed,remainingValueMinor:Math.max(0,row.remaining),
          status: row.canceled ? "CANCELLED" as const : row.expires_at && new Date(row.expires_at).getTime() <= now ? "EXPIRED" as const : row.remaining <= 0 ? "REDEEMED" as const : "ACTIVE" as const,
          ...(row.expires_at ? { expiresAt:new Date(row.expires_at).toISOString() } : {}),
        })))
      });
      await client.query("COMMIT"); return projection;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async loyaltyBalance(client: PoolClient, tenantId: string, locationId: string, customerPassId: string): Promise<number> {
    const result = await client.query<{ balance:number }>("SELECT COALESCE(SUM(points_delta),0)::int AS balance FROM ristoairen.loyalty_ledger WHERE tenant_id=$1 AND location_id=$2 AND customer_pass_id=$3", [tenantId,locationId,customerPassId]);
    return result.rows[0]?.balance ?? 0;
  }
}

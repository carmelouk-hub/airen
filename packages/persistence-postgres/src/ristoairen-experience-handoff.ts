import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../shared-contracts/src/index.ts";
import {
  RISTOAIREN_EXPERIENCE_PROJECTION_TTL_SECONDS,
  RISTOAIREN_HANDOFF_TTL_SECONDS,
  type RistoairenExperienceHandoffIssue,
  type RistoairenExperienceHandoffProjection,
  type RistoairenExperienceHandoffStore,
} from "../../platform-core/src/ristoairen-experience-handoff.ts";

const LAUNCH_CODE = /^[A-Za-z0-9_-]{43}$/;

function hash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function launchCode(value: string): string {
  const normalized = value.trim();
  if (!LAUNCH_CODE.test(normalized)) throw new AppError("AUTHENTICATION_REQUIRED", "RISTOAIREN Experience handoff is invalid or expired");
  return normalized;
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function translate(error: unknown): unknown {
  const candidate = error as { code?: string; message?: string; constraint?: string };
  if (candidate.code === "P0002" && candidate.message?.includes("AIRENOS_RISTOAIREN_HANDOFF_INVALID")) {
    return new AppError("AUTHENTICATION_REQUIRED", "RISTOAIREN Experience handoff is invalid or expired");
  }
  if (candidate.code === "42501" && candidate.message?.includes("ENTITLEMENT_REQUIRED")) {
    return new AppError("ENTITLEMENT_REQUIRED", "Effective RISTOAIREN entitlement is required for Experience handoff");
  }
  if (candidate.code === "42501") return new AppError("PERMISSION_DENIED", "AIRenOS denied RISTOAIREN Experience handoff issuance");
  if (["22023", "23502", "23503", "23514", "22P02"].includes(candidate.code ?? "")) {
    return new AppError("VALIDATION_FAILED", "RISTOAIREN Experience handoff violated the PostgreSQL capability contract");
  }
  if (candidate.code === "23505") return new AppError("CONFLICT", "RISTOAIREN Experience handoff could not be issued");
  return error;
}

export class PostgresRistoairenExperienceHandoffStore implements RistoairenExperienceHandoffStore {
  private readonly pool: Pool;
  private readonly appRole: string;
  private readonly now: () => number;

  constructor(pool: Pool, appRole = "airen_app", now: () => number = Date.now) {
    this.pool = pool;
    this.appRole = appRole;
    this.now = now;
  }

  async issue(input: Parameters<RistoairenExperienceHandoffStore["issue"]>[0]): Promise<RistoairenExperienceHandoffIssue> {
    if (!input.context.actorIdentityId || !input.context.tenantId || !input.context.locationId || !input.context.correlationId) {
      throw new AppError("VALIDATION_FAILED", "Complete trusted SecurityContext is required for RISTOAIREN Experience handoff");
    }
    if (!input.organizationId || !input.subscriptionId) {
      throw new AppError("VALIDATION_FAILED", "Organization and ProductSubscription are required for RISTOAIREN Experience handoff");
    }

    const code = randomBytes(32).toString("base64url");
    const expiresAtIso = new Date(this.now() + RISTOAIREN_HANDOFF_TTL_SECONDS * 1000).toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${this.assertRoleIdentifier(this.appRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id',$2,true),set_config('airen.location_id',$3,true),set_config('airen.correlation_id',$4,true)",
        [input.context.actorIdentityId, input.context.tenantId, input.context.locationId, input.context.correlationId],
      );
      await client.query(
        "SELECT * FROM security.issue_ristoairen_experience_handoff($1,$2,$3,$4::timestamptz)",
        [hash(code), input.organizationId, input.subscriptionId, expiresAtIso],
      );
      await client.query("COMMIT");
      return Object.freeze({ launchCode: code, expiresAtIso });
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally {
      client.release();
    }
  }

  async consume(rawCode: string): Promise<RistoairenExperienceHandoffProjection> {
    const code = launchCode(rawCode);
    const exchangeCorrelation = `ra01-handoff-exchange-${randomBytes(12).toString("hex")}`;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${this.assertRoleIdentifier(this.appRole)}`);
      const result = await client.query(
        "SELECT * FROM security.consume_ristoairen_experience_handoff($1,$2)",
        [hash(code), exchangeCorrelation],
      );
      await client.query("COMMIT");
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new AppError("AUTHENTICATION_REQUIRED", "RISTOAIREN Experience handoff is invalid or expired");
      const projectionExpiresAtIso = iso(row.projection_expires_at);
      const consumedAtIso = iso(row.consumed_at);
      const maxProjectionExpiry = new Date(new Date(consumedAtIso).getTime() + RISTOAIREN_EXPERIENCE_PROJECTION_TTL_SECONDS * 1000).toISOString();
      if (projectionExpiresAtIso !== maxProjectionExpiry) throw new AppError("INTERNAL_ERROR", "RISTOAIREN Experience projection TTL mismatch");
      return Object.freeze({
        handoffId: String(row.handoff_id),
        actorIdentityId: String(row.actor_identity_id),
        organizationId: String(row.organization_id),
        tenantId: String(row.tenant_id),
        locationId: String(row.location_id),
        subscriptionId: String(row.subscription_id),
        productCode: "ristoairen",
        entitlementKey: "vertical.ristoairen",
        permissionKey: "ristoairen.access",
        issuedAtIso: iso(row.issued_at),
        consumedAtIso,
        projectionExpiresAtIso,
        sourceCorrelationId: String(row.source_correlation_id),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally {
      client.release();
    }
  }

  private assertRoleIdentifier(role: string): string {
    if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
    return role;
  }
}

import type { PoolClient } from "pg";
import { AppError } from "../../shared-contracts/src/index.ts";
import type { BookingMutationResultV1, IdempotencyClaim, IdempotencyScope } from "../../ristoairen/src/booking/contracts.ts";

export async function claimFoundationIdempotency(client: PoolClient, scope: IdempotencyScope): Promise<IdempotencyClaim> {
  const inserted = await client.query(
    `INSERT INTO foundation_idempotency_keys
      (actor_identity_id, tenant_id, location_id, canonical_function_id, idempotency_key, semantic_hash, state, lease_until, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,'IN_PROGRESS',now() + interval '30 seconds',now() + interval '72 hours')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [scope.actorIdentityId, scope.tenantId, scope.locationId, scope.canonicalFunctionId, scope.idempotencyKey, scope.semanticHash]
  );
  if (inserted.rowCount === 1) return Object.freeze({ kind: "NEW" });

  const existing = await client.query(
    `SELECT semantic_hash, state, result_json, lease_until, expires_at
       FROM foundation_idempotency_keys
      WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3
        AND canonical_function_id=$4 AND idempotency_key=$5
      FOR UPDATE`,
    [scope.actorIdentityId, scope.tenantId, scope.locationId, scope.canonicalFunctionId, scope.idempotencyKey]
  );
  const row = existing.rows[0] as { semantic_hash: string; state: string; result_json: BookingMutationResultV1 | null; lease_until: Date; expires_at: Date } | undefined;
  if (!row) throw new AppError("INTERNAL_ERROR", "Idempotency row disappeared during claim");
  if (row.semantic_hash !== scope.semanticHash) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency key reused with different semantic payload");
  if (row.expires_at <= new Date()) throw new AppError("CONFLICT", "Expired idempotency key must be retried with a new key");
  if (row.state === "COMPLETED" && row.result_json) return Object.freeze({ kind: "REPLAY", result: row.result_json });
  if (row.state === "IN_PROGRESS" && row.lease_until > new Date()) throw new AppError("CONFLICT", "Idempotent mutation is already in progress");

  await client.query(
    `UPDATE foundation_idempotency_keys
        SET state='IN_PROGRESS', lease_until=now() + interval '30 seconds', updated_at=now()
      WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3
        AND canonical_function_id=$4 AND idempotency_key=$5`,
    [scope.actorIdentityId, scope.tenantId, scope.locationId, scope.canonicalFunctionId, scope.idempotencyKey]
  );
  return Object.freeze({ kind: "NEW" });
}

export async function completeFoundationIdempotency(client: PoolClient, scope: IdempotencyScope, result: BookingMutationResultV1): Promise<void> {
  const updated = await client.query(
    `UPDATE foundation_idempotency_keys
        SET state='COMPLETED', result_json=$6::jsonb, lease_until=now(), updated_at=now()
      WHERE actor_identity_id=$1 AND tenant_id=$2 AND location_id=$3
        AND canonical_function_id=$4 AND idempotency_key=$5 AND semantic_hash=$7`,
    [scope.actorIdentityId, scope.tenantId, scope.locationId, scope.canonicalFunctionId, scope.idempotencyKey, JSON.stringify(result), scope.semanticHash]
  );
  if (updated.rowCount !== 1) throw new AppError("IDEMPOTENCY_CONFLICT", "Idempotency completion scope mismatch");
}

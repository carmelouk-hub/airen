import type { Pool } from "pg";
import { AppError, type PlatformSecurityContext } from "../../shared-contracts/src/index.ts";
import type { AuditOutcome, PlatformAuditQueryRow, PlatformAuditQueryStore, PlatformAuditStoreInput } from "../../audit-events/src/index.ts";

function role(value:string):string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Unsafe PostgreSQL role identifier");
  return value;
}
function translate(error:unknown):unknown {
  const e=error as {code?:string;message?:string};
  if (e.code==="42501") return new AppError("PERMISSION_DENIED","Platform Audit query authority denied");
  if (["22023","22P02"].includes(e.code??"")) return new AppError("VALIDATION_FAILED","Platform Audit query input violated PostgreSQL contract");
  return error;
}
function iso(value:unknown):string { return new Date(String(value)).toISOString(); }
function row(value:any):PlatformAuditQueryRow {
  return {
    id:String(value.id),
    tenantId:value.tenant_id==null?undefined:String(value.tenant_id),
    locationId:value.location_id==null?undefined:String(value.location_id),
    actorIdentityId:value.actor_identity_id==null?undefined:String(value.actor_identity_id),
    actorKind:String(value.actor_kind),
    actionKey:String(value.action_key),
    resourceType:value.resource_type==null?undefined:String(value.resource_type),
    resourceId:value.resource_id==null?undefined:String(value.resource_id),
    correlationId:String(value.correlation_id),
    outcome:String(value.outcome) as AuditOutcome,
    metadata:value.metadata,
    createdAt:iso(value.created_at)
  };
}

export class PostgresPlatformAuditQueryStore implements PlatformAuditQueryStore {
  private readonly pool:Pool;
  private readonly controlPlaneRole:string;
  constructor(pool:Pool,controlPlaneRole="airen_control_plane"){this.pool=pool;this.controlPlaneRole=controlPlaneRole;}

  async queryPlatformAudit(input:PlatformAuditStoreInput,context:PlatformSecurityContext):Promise<readonly PlatformAuditQueryRow[]> {
    if (context.scopeKind!=="platform") throw new AppError("PERMISSION_DENIED","PlatformSecurityContext required");
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${role(this.controlPlaneRole)}`);
      await client.query(
        "SELECT set_config('airen.identity_id',$1,true),set_config('airen.tenant_id','',true),set_config('airen.location_id','',true),set_config('airen.correlation_id',$2,true)",
        [context.actorIdentityId,context.correlationId]
      );
      const result=await client.query(
        "SELECT * FROM security.platform_query_audit_events($1::timestamptz,$2::timestamptz,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text,$12::timestamptz,$13::uuid,$14::integer)",
        [
          input.createdFrom,input.createdUntil,input.tenantId??null,input.locationId??null,input.actorIdentityId??null,
          input.actorKind??null,input.actionKey??null,input.resourceType??null,input.resourceId??null,input.correlationId??null,
          input.outcome??null,input.cursorCreatedAt??null,input.cursorId??null,input.limit
        ]
      );
      await client.query("COMMIT");
      return result.rows.map(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw translate(error);
    } finally {
      client.release();
    }
  }
}

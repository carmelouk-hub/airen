import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { UUID } from "../../shared-contracts/src/index.ts";
import type { AirenOSIdentityDirectory } from "../../identity/src/session-authority.ts";
import type { AirenOSSessionLifecycleStore, AirenOSSessionRecord } from "../../identity/src/session-lifecycle.ts";

function assertRoleIdentifier(role: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error("Unsafe PostgreSQL role identifier");
  return role;
}

function oneOrNull<T extends QueryResultRow>(rows: T[]): T | null {
  return rows[0] ?? null;
}

export class PostgresAirenOSSessionLifecycleStore implements AirenOSSessionLifecycleStore, AirenOSIdentityDirectory {
  private readonly pool: Pool;
  private readonly assumeRole: string;

  constructor(pool: Pool, assumeRole = "airen_auth") {
    this.pool = pool;
    this.assumeRole = assumeRole;
  }

  async register(record: AirenOSSessionRecord): Promise<void> {
    await this.withAuthRole(false, async (client) => {
      await client.query(
        "SELECT security.register_airenos_session($1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz)",
        [record.sessionId, record.identityId, record.issuedAtIso, record.expiresAtIso]
      );
    });
  }

  async resolveActive(sessionId: string, identityId: UUID): Promise<AirenOSSessionRecord | null> {
    return this.withAuthRole(true, async (client) => {
      const result = await client.query(
        "SELECT session_id AS \"sessionId\", identity_id AS \"identityId\", issued_at AS \"issuedAt\", expires_at AS \"expiresAt\" FROM security.resolve_active_airenos_session($1::uuid,$2::uuid)",
        [sessionId, identityId]
      );
      const row = oneOrNull(result.rows) as { sessionId: string; identityId: UUID; issuedAt: Date | string; expiresAt: Date | string } | null;
      if (!row) return null;
      return {
        sessionId: String(row.sessionId),
        identityId: String(row.identityId),
        issuedAtIso: new Date(row.issuedAt).toISOString(),
        expiresAtIso: new Date(row.expiresAt).toISOString()
      };
    });
  }

  async revoke(sessionId: string, identityId: UUID, reason: string): Promise<boolean> {
    return this.withAuthRole(false, async (client) => {
      const result = await client.query(
        "SELECT security.revoke_airenos_session($1::uuid,$2::uuid,$3::text) AS revoked",
        [sessionId, identityId, reason]
      );
      return result.rows[0]?.revoked === true;
    });
  }

  async revokeAllForIdentity(identityId: UUID, reason: string): Promise<number> {
    return this.withAuthRole(false, async (client) => {
      const result = await client.query(
        "SELECT security.revoke_all_airenos_sessions($1::uuid,$2::text) AS count",
        [identityId, reason]
      );
      return Number(result.rows[0]?.count ?? 0);
    });
  }

  async resolveIdentity(identityId: UUID): Promise<Readonly<{ identityId: UUID; status: string; platformRoles: readonly string[] }> | null> {
    return this.withAuthRole(true, async (client) => {
      const result = await client.query(
        "SELECT identity_id AS \"identityId\", identity_status AS status, platform_roles AS \"platformRoles\" FROM security.resolve_airenos_identity($1::uuid)",
        [identityId]
      );
      const row = oneOrNull(result.rows) as { identityId: UUID; status: string; platformRoles: string[] | null } | null;
      return row ? { identityId: row.identityId, status: row.status, platformRoles: row.platformRoles ?? [] } : null;
    });
  }

  private async withAuthRole<T>(readOnly: boolean, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (readOnly) await client.query("SET TRANSACTION READ ONLY");
      await client.query(`SET LOCAL ROLE ${assertRoleIdentifier(this.assumeRole)}`);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

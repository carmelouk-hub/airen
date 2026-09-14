import type { Pool, PoolClient } from "pg";
import type { UUID } from "../../shared-contracts/src/index.ts";
import type { AirenOSIdentityDirectory } from "../../identity/src/session-authority.ts";

function oneOrNull<T>(rows: T[]): T | null {
  return rows[0] ?? null;
}

export class PostgresAirenOSIdentityDirectory implements AirenOSIdentityDirectory {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async resolveIdentity(identityId: UUID): Promise<Readonly<{ identityId: UUID; status: string; platformRoles: readonly string[] }> | null> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET TRANSACTION READ ONLY");
      await client.query("SET LOCAL ROLE airen_auth");
      const result = await client.query(
        "SELECT identity_id AS \"identityId\", identity_status AS status, platform_roles AS \"platformRoles\" FROM security.resolve_airenos_identity($1)",
        [identityId]
      );
      await client.query("COMMIT");
      const row = oneOrNull(result.rows) as { identityId: UUID; status: string; platformRoles: string[] | null } | null;
      return row
        ? {
            identityId: row.identityId,
            status: row.status,
            platformRoles: row.platformRoles ?? []
          }
        : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

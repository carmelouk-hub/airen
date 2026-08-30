import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");

test("K3-C generic PostgreSQL keeps semantic search fail-closed when pgvector runtime is unavailable", async () => {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
  try {
    const available = await pool.query<{ available: boolean }>("SELECT security.kairos_vector_runtime_available() AS available");
    assert.equal(available.rows[0]?.available, false, "plain postgres:16 CI must exercise the no-pgvector supported state");

    const registry = await pool.query<{ exists: boolean }>(
      "SELECT pg_catalog.to_regclass('kairos.embedding_model_registry') IS NOT NULL AS exists",
    );
    assert.equal(registry.rows[0]?.exists, true, "model registry must exist independently of pgvector");

    await assert.rejects(
      () => pool.query("SELECT * FROM security.kairos_search_semantic('k3.synthetic.3d','[1,0,0]',5)"),
      /AIRENOS_KAIROS_VECTOR_RUNTIME_UNAVAILABLE/,
    );
  } finally {
    await pool.end();
  }
});

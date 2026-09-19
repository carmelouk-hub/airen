import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { validateCanonicalMigrationSequence } from "../../deploy/migrate.ts";

test("Gate149/153 canonical migration census is exactly contiguous 0001..0040", async () => {
  const entries = await readdir(new URL("../../db/migrations/", import.meta.url));
  const files = validateCanonicalMigrationSequence(entries);
  assert.equal(files.length, 40);
  assert.equal(files[0], "0001_foundation_runtime_core.sql");
  assert.equal(files.at(-1), "0040_render_managed_control_plane_owner_rls_compat.sql");
  assert.deepEqual(
    files.map((name) => Number(name.slice(0, 4))),
    Array.from({ length: 40 }, (_, index) => index + 1),
  );
});

test("Gate149 sequence validator fails closed on gaps, duplicates, and malformed numbered files", () => {
  assert.throws(
    () => validateCanonicalMigrationSequence([
      "0001_one.sql",
      "0003_three.sql",
    ]),
    /contiguous from 0001/,
  );

  assert.throws(
    () => validateCanonicalMigrationSequence([
      "0001_one.sql",
      "0001_duplicate.sql",
    ]),
    /contiguous from 0001/,
  );

  assert.throws(
    () => validateCanonicalMigrationSequence([
      "0001_one.sql",
      "0002_bad name.sql",
    ]),
    /noncanonical numbered filenames/,
  );
});

test("Gate149 keeps runtime-role bootstrap and dynamic migration discovery in the canonical runner", async () => {
  const source = await readFile(new URL("../../deploy/migrate.ts", import.meta.url), "utf8");
  assert.match(source, /db\/bootstrap\/0000_runtime_roles\.sql/);
  assert.match(source, /validateCanonicalMigrationSequence/);
  assert.match(source, /airen_schema_migrations/);
  assert.match(source, /pg_advisory_lock/);
  assert.match(source, /migration\.skip/);
  assert.doesNotMatch(source, /0039_ra01_ristoairen_experience_handoff\.sql/);
});

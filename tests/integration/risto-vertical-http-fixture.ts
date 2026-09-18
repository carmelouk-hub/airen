import http from "node:http";
import { Buffer } from "node:buffer";
import { createPublicKey } from "node:crypto";
import { Pool } from "pg";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import { AIREN_BOOKING_ENTITLEMENT, type BookingReadRepository } from "../../packages/booking-core/src/contracts.ts";
import { BookingApplicationService } from "../../packages/booking-core/src/application-service.ts";
import {
  PostgresFoundationReadStore,
  PostgresLocationRepositoryAdapter,
  PostgresTenantRepositoryAdapter,
} from "../../packages/persistence-postgres/src/index.ts";
import { PostgresRistoBookingUnitOfWork } from "../../packages/persistence-postgres/src/risto-booking-repository.ts";
import { createRistoVerticalApi } from "../../apps/api/src/risto-vertical-api.ts";

export const SYNTHETIC = Object.freeze({
  tenantId: "e0930000-0000-4000-8000-000000000001",
  locationId: "e0930000-0000-4000-8000-000000000002",
  otherLocationId: "e0930000-0000-4000-8000-000000000003",
  allowedActorId: "e0930000-0000-4000-8000-000000000010",
  deniedActorId: "e0930000-0000-4000-8000-000000000011",
  crossTenantId: "e0930000-0000-4000-8000-000000000099",
});

const reads: BookingReadRepository = Object.freeze({
  async query() { throw new Error("not used by Gate093"); },
  async findVisibleById() { return null; },
});

const guard = Object.freeze({
  assertBookingAccess(context: SecurityContext): void {
    if (!context.entitlements.includes(AIREN_BOOKING_ENTITLEMENT)) {
      throw new AppError("ENTITLEMENT_REQUIRED", "airen.booking required");
    }
  },
});

export async function seedGate093(pool: Pool): Promise<void> {
  const s = SYNTHETIC;
  await pool.query(`
    INSERT INTO platform.tenants (id, slug, name, status)
      VALUES ('${s.tenantId}', 'gate093', 'Gate093 Synthetic', 'active')
      ON CONFLICT (id) DO NOTHING;

    INSERT INTO platform.locations (id, tenant_id, slug, name, timezone, is_primary, status)
      VALUES
        ('${s.locationId}', '${s.tenantId}', 'main', 'Main', 'Europe/Rome', true, 'active'),
        ('${s.otherLocationId}', '${s.tenantId}', 'other', 'Other', 'Europe/Rome', false, 'active')
      ON CONFLICT (id) DO NOTHING;

    INSERT INTO identity.identities (id, display_name, status)
      VALUES
        ('${s.allowedActorId}', 'Gate093 Allowed', 'active'),
        ('${s.deniedActorId}', 'Gate093 Denied', 'active')
      ON CONFLICT (id) DO NOTHING;

    INSERT INTO authz.tenant_memberships (id, tenant_id, identity_id, role_key, status)
      VALUES
        ('e0930000-0000-4000-8000-000000000020', '${s.tenantId}', '${s.allowedActorId}', 'gate093_booking_operator', 'active'),
        ('e0930000-0000-4000-8000-000000000021', '${s.tenantId}', '${s.deniedActorId}', 'gate093_booking_viewer', 'active')
      ON CONFLICT (id) DO NOTHING;

    INSERT INTO authz.location_memberships (id, tenant_id, tenant_membership_id, location_id, role_key, status)
      VALUES
        ('e0930000-0000-4000-8000-000000000030', '${s.tenantId}', 'e0930000-0000-4000-8000-000000000020', '${s.locationId}', 'gate093_location', 'active'),
        ('e0930000-0000-4000-8000-000000000031', '${s.tenantId}', 'e0930000-0000-4000-8000-000000000021', '${s.locationId}', 'gate093_location', 'active')
      ON CONFLICT (id) DO NOTHING;

    INSERT INTO authz.permission_registry (permission_key, description)
      VALUES ('booking.create', 'Create Booking')
      ON CONFLICT (permission_key) DO NOTHING;

    INSERT INTO authz.role_permission_grants (scope_kind, role_key, permission_key, effect)
      VALUES ('tenant', 'gate093_booking_operator', 'booking.create', 'allow')
      ON CONFLICT DO NOTHING;
  `);
}

export function createGate093Fixture(input: Readonly<{
  databaseUrl: string;
  publicKeyPem: string;
  issuer?: string;
  audience?: string;
  now?: () => number;
}>): Readonly<{ pool: Pool; handler: ReturnType<typeof createRistoVerticalApi> }> {
  const pool = new Pool({ connectionString: input.databaseUrl, max: 10 });
  const foundation = new PostgresFoundationReadStore(pool);
  const booking = new BookingApplicationService(
    reads,
    new PostgresRistoBookingUnitOfWork(pool, "airen_app", "user"),
    guard,
  );
  const handler = createRistoVerticalApi({
    publicKey: createPublicKey(input.publicKeyPem),
    issuer: input.issuer ?? "airenos-gate093",
    audience: input.audience ?? "ristoairen-gate093",
    tenants: new PostgresTenantRepositoryAdapter(foundation),
    locations: new PostgresLocationRepositoryAdapter(foundation),
    memberships: foundation,
    roles: foundation,
    booking,
    ...(input.now ? { now: input.now } : {}),
  });
  return Object.freeze({ pool, handler });
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startGate093FixtureServer(input: Readonly<{
  databaseUrl: string;
  publicKeyPem: string;
  port: number;
  host?: string;
}>): Promise<Readonly<{ server: http.Server; pool: Pool; close(): Promise<void> }>> {
  const { pool, handler } = createGate093Fixture(input);
  await seedGate093(pool);

  const server = http.createServer(async (req, res) => {
    try {
      const body = ["POST", "PATCH", "DELETE"].includes(String(req.method).toUpperCase()) ? await readBody(req) : undefined;
      const headers = Object.fromEntries(
        Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
      );
      const result = await handler({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers,
        body,
      });
      const payload = JSON.stringify(result.body);
      res.writeHead(result.status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload),
        ...result.headers,
      });
      res.end(payload);
    } catch {
      const payload = JSON.stringify({ ok: false, code: "INTERNAL_ERROR" });
      res.writeHead(500, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
      res.end(payload);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host ?? "127.0.0.1", () => resolve());
  });

  return Object.freeze({
    server,
    pool,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    },
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const databaseUrl = process.env.DATABASE_URL;
  const publicKeyB64 = process.env.RISTO_VPC_PUBLIC_KEY_PEM_B64;
  if (!databaseUrl || !publicKeyB64) throw new Error("DATABASE_URL and RISTO_VPC_PUBLIC_KEY_PEM_B64 are required");
  const port = Number.parseInt(process.env.RISTO_FIXTURE_PORT ?? "19093", 10);
  const publicKeyPem = Buffer.from(publicKeyB64, "base64").toString("utf8");
  const runtime = await startGate093FixtureServer({ databaseUrl, publicKeyPem, port });
  console.log(JSON.stringify({ event: "risto_gate093_fixture_listening", port }));
  const shutdown = async () => { await runtime.close(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

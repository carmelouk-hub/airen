import { createHash } from "node:crypto";
import { AppError, type SecurityContext } from "../../../shared-contracts/src/index.ts";
import { BookingApplicationService } from "../../../booking-core/src/application-service.ts";
import { AIREN_BOOKING_ENTITLEMENT, type BookingPrivateProjectionV1 } from "../../../booking-core/src/contracts.ts";
import { BOOKING_PERMISSIONS } from "../../../booking-core/src/policy.ts";
import {
  PUBLIC_SELF_SERVICE_BOOKING_SOURCE,
  PUBLIC_SELF_SERVICE_CREDENTIAL_BYTES,
  PUBLIC_SELF_SERVICE_IDENTITY_ID,
  type PublicBookingCancelInputV1,
  type PublicBookingCreateInputV1,
  type PublicBookingProjectionV1,
  type PublicBookingUpdateInputV1,
  type PublicQueueProjectionV1,
  type PublicSelfServiceDependencies,
} from "./contracts.ts";

function notFound(): never {
  throw new AppError("NOT_FOUND", "PUBLIC_SELF_SERVICE_RESOURCE_NOT_FOUND");
}

export function hashPublicSelfServiceCredential(rawCredential: string): string {
  const credential = rawCredential?.trim();
  if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential)) {
    throw new AppError("VALIDATION_FAILED", "INVALID_SELF_SERVICE_CREDENTIAL");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(credential, "base64url");
  } catch {
    throw new AppError("VALIDATION_FAILED", "INVALID_SELF_SERVICE_CREDENTIAL");
  }
  if (bytes.length !== PUBLIC_SELF_SERVICE_CREDENTIAL_BYTES || bytes.toString("base64url") !== credential) {
    throw new AppError("VALIDATION_FAILED", "INVALID_SELF_SERVICE_CREDENTIAL");
  }
  return createHash("sha256").update(bytes).digest("hex");
}

function projection(booking: BookingPrivateProjectionV1): PublicBookingProjectionV1 {
  return Object.freeze({
    kind: "booking",
    status: booking.status,
    partySize: booking.partySize,
    bookingDate: booking.bookingDate,
    bookingTimeLocal: booking.bookingTimeLocal,
    startsAt: booking.startsAt,
    expectedDurationMinutes: booking.expectedDurationMinutes,
    rowVersion: booking.rowVersion,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    ...(booking.cancelledAt ? { cancelledAt: booking.cancelledAt } : {}),
  });
}

export class RistoPublicSelfServiceApplicationService {
  private readonly dependencies: PublicSelfServiceDependencies;
  private readonly booking: BookingApplicationService;

  constructor(dependencies: PublicSelfServiceDependencies, booking: BookingApplicationService) {
    this.dependencies = dependencies;
    this.booking = booking;
  }

  private async resolve(hostname: string, correlationId: string, permission?: string): Promise<Readonly<{
    scope: NonNullable<Awaited<ReturnType<PublicSelfServiceDependencies["tenantResolver"]["resolveFromHostname"]>>>;
    context?: SecurityContext;
  }>> {
    const scope = await this.dependencies.tenantResolver.resolveFromHostname(hostname);
    if (!scope) throw new AppError("NOT_FOUND", "PUBLIC_SELF_SERVICE_RESOURCE_NOT_FOUND");
    const entitlements = await this.dependencies.entitlements.enabledForTenant(scope.tenantId);
    if (!entitlements.includes(AIREN_BOOKING_ENTITLEMENT)) {
      throw new AppError("ENTITLEMENT_REQUIRED", "AIRen Booking entitlement is required");
    }
    if (!permission) return Object.freeze({ scope });
    const context: SecurityContext = Object.freeze({
      correlationId,
      actorIdentityId: PUBLIC_SELF_SERVICE_IDENTITY_ID,
      platformRoles: Object.freeze([]),
      platformPermissions: Object.freeze([]),
      tenantId: scope.tenantId,
      locationId: scope.locationId,
      permissions: Object.freeze([permission]),
      entitlements: Object.freeze([...entitlements]),
    });
    return Object.freeze({ scope, context });
  }

  async createBooking(input: Readonly<{
    hostname: string;
    credential: string;
    correlationId: string;
    idempotencyKey: string;
    booking: PublicBookingCreateInputV1;
  }>): Promise<Readonly<{ booking: PublicBookingProjectionV1; replayed: boolean }>> {
    const credentialHash = hashPublicSelfServiceCredential(input.credential);
    const resolved = await this.resolve(input.hostname, input.correlationId, BOOKING_PERMISSIONS.create);
    const result = await this.booking.create(
      resolved.context!,
      Object.freeze({
        partySize: input.booking.partySize,
        bookingDate: input.booking.bookingDate,
        bookingTimeLocal: input.booking.bookingTimeLocal,
        expectedDurationMinutes: input.booking.expectedDurationMinutes,
        customerNameSnapshot: input.booking.customerNameSnapshot,
        ...(input.booking.phoneSnapshot === undefined ? {} : { phoneSnapshot: input.booking.phoneSnapshot }),
        ...(input.booking.emailSnapshot === undefined ? {} : { emailSnapshot: input.booking.emailSnapshot }),
        ...(input.booking.notes === undefined ? {} : { notes: input.booking.notes }),
        ...(input.booking.specialRequests === undefined ? {} : { specialRequests: input.booking.specialRequests }),
        source: PUBLIC_SELF_SERVICE_BOOKING_SOURCE,
        externalReference: credentialHash,
      }),
      input.idempotencyKey,
    );
    return Object.freeze({ booking: projection(result.booking), replayed: result.replayed });
  }

  async getBooking(input: Readonly<{ hostname: string; credential: string; correlationId: string }>): Promise<PublicBookingProjectionV1> {
    const credentialHash = hashPublicSelfServiceCredential(input.credential);
    const { scope } = await this.resolve(input.hostname, input.correlationId);
    const owned = await this.dependencies.ownership.findOwnedBooking(scope, credentialHash, input.correlationId);
    if (!owned) return notFound();
    return projection(owned.booking);
  }

  async updateBooking(input: Readonly<{
    hostname: string;
    credential: string;
    correlationId: string;
    idempotencyKey: string;
    update: PublicBookingUpdateInputV1;
  }>): Promise<Readonly<{ booking: PublicBookingProjectionV1; replayed: boolean }>> {
    const credentialHash = hashPublicSelfServiceCredential(input.credential);
    const resolved = await this.resolve(input.hostname, input.correlationId, BOOKING_PERMISSIONS.update);
    const owned = await this.dependencies.ownership.findOwnedBooking(resolved.scope, credentialHash, input.correlationId);
    if (!owned) return notFound();
    const result = await this.booking.update(resolved.context!, owned.bookingId, input.update, input.idempotencyKey);
    return Object.freeze({ booking: projection(result.booking), replayed: result.replayed });
  }

  async cancelBooking(input: Readonly<{
    hostname: string;
    credential: string;
    correlationId: string;
    idempotencyKey: string;
    cancel: PublicBookingCancelInputV1;
  }>): Promise<Readonly<{ booking: PublicBookingProjectionV1; replayed: boolean }>> {
    const credentialHash = hashPublicSelfServiceCredential(input.credential);
    const resolved = await this.resolve(input.hostname, input.correlationId, BOOKING_PERMISSIONS.statusUpdate);
    const owned = await this.dependencies.ownership.findOwnedBooking(resolved.scope, credentialHash, input.correlationId);
    if (!owned) return notFound();
    const result = await this.booking.transitionStatus(
      resolved.context!,
      owned.bookingId,
      Object.freeze({ requestedStatus: "CANCELLED", rowVersion: input.cancel.rowVersion, ...(input.cancel.reason ? { reason: input.cancel.reason } : {}) }),
      input.idempotencyKey,
    );
    return Object.freeze({ booking: projection(result.booking), replayed: result.replayed });
  }

  async getQueue(input: Readonly<{ hostname: string; credential: string; correlationId: string }>): Promise<PublicQueueProjectionV1> {
    const credentialHash = hashPublicSelfServiceCredential(input.credential);
    const { scope } = await this.resolve(input.hostname, input.correlationId);
    const queue = await this.dependencies.ownership.findOwnedQueue(scope, credentialHash, input.correlationId);
    if (!queue) return notFound();
    return queue;
  }
}

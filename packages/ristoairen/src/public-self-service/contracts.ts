import type { UUID } from "../../../shared-contracts/src/index.ts";
import type { BookingPrivateProjectionV1, BookingStatus } from "../../../booking-core/src/contracts.ts";
import type { PublicTenantResolverPort, ResolvedPublicTenantV1 } from "../public-content/contracts.ts";

export const PUBLIC_SELF_SERVICE_IDENTITY_ID = "c0010000-0000-4000-8000-000000000001" as const;
export const PUBLIC_SELF_SERVICE_BOOKING_SOURCE = "RISTOAIREN_PUBLIC_SELF_SERVICE" as const;
export const PUBLIC_SELF_SERVICE_CREDENTIAL_BYTES = 32 as const;

export type PublicBookingCreateInputV1 = Readonly<{
  partySize: number;
  bookingDate: string;
  bookingTimeLocal: string;
  expectedDurationMinutes: number;
  customerNameSnapshot: string;
  phoneSnapshot?: string;
  emailSnapshot?: string;
  notes?: string;
  specialRequests?: string;
}>;

export type PublicBookingUpdateInputV1 = Readonly<{
  partySize?: number;
  bookingDate?: string;
  bookingTimeLocal?: string;
  expectedDurationMinutes?: number;
  customerNameSnapshot?: string;
  phoneSnapshot?: string | null;
  emailSnapshot?: string | null;
  notes?: string | null;
  specialRequests?: string | null;
  rowVersion: number;
}>;

export type PublicBookingCancelInputV1 = Readonly<{
  rowVersion: number;
  reason?: string;
}>;

export type PublicBookingProjectionV1 = Readonly<{
  kind: "booking";
  status: BookingStatus;
  partySize: number;
  bookingDate: string;
  bookingTimeLocal: string;
  startsAt: string;
  expectedDurationMinutes: number;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
}>;

export type PublicQueueProjectionV1 = Readonly<{
  kind: "queue";
  status: "WAITING" | "CALLED";
  partySize: number;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}>;

export type OwnedPublicBookingV1 = Readonly<{
  bookingId: UUID;
  booking: BookingPrivateProjectionV1;
}>;

export interface PublicSelfServiceOwnershipRepository {
  findOwnedBooking(scope: ResolvedPublicTenantV1, credentialHash: string, correlationId: string): Promise<OwnedPublicBookingV1 | null>;
  findOwnedQueue(scope: ResolvedPublicTenantV1, credentialHash: string, correlationId: string): Promise<PublicQueueProjectionV1 | null>;
}

export interface PublicSelfServiceEntitlementAuthority {
  enabledForTenant(tenantId: UUID): Promise<readonly string[]>;
}

export type PublicSelfServiceDependencies = Readonly<{
  tenantResolver: PublicTenantResolverPort;
  entitlements: PublicSelfServiceEntitlementAuthority;
  ownership: PublicSelfServiceOwnershipRepository;
}>;

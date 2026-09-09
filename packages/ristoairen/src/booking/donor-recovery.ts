import type { BookingCreateInputV1, BookingStatus } from "./contracts.ts";

export const EX_CORTE_BOOKING_DONOR = "base44:6a6f34a3a69b01d00ee22a07" as const;

export const BOOKING_DONOR_FORBIDDEN_FIELDS = [
  "tenant_id",
  "location_id",
  "created_by_id",
  "customer_profile_id",
  "qr_token",
  "google_calendar_event_id",
  "promoter_id",
  "event_id",
] as const;

export type ExCorteBookingDonorInput = Readonly<{
  name?: string;
  customer_name?: string;
  phone?: string;
  customer_phone?: string;
  email?: string;
  guests?: number | string;
  date?: string;
  time?: string;
  experience_type?: string;
  source?: string;
  source_field?: string;
  notes?: string | null;
  admin_notes?: string | null;
  zone?: string | null;
  table_label?: string | null;
  status?: string | null;
  tenant_id?: string | null;
  location_id?: string | null;
  created_by_id?: string | null;
  customer_profile_id?: string | null;
  qr_token?: string | null;
  google_calendar_event_id?: string | null;
  promoter_id?: string | null;
  event_id?: string | null;
}>;

export type BookingDonorRecoveryResult = Readonly<{
  input: BookingCreateInputV1;
  donorStatus?: BookingStatus;
  deferredResolution: Readonly<{
    zoneLabel?: string;
    tableLabel?: string;
    promoter: boolean;
    event: boolean;
  }>;
}>;

const STATUS_MAP: Readonly<Record<string, BookingStatus>> = Object.freeze({
  pending: "PENDING",
  confirmed: "CONFIRMED",
  cancelled: "CANCELLED",
  no_show: "NO_SHOW",
});

function requiredText(value: unknown, field: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`REC001_INVALID_${field.toUpperCase()}`);
  return text;
}

function partySize(value: unknown): number {
  const n = Number.parseInt(String(value ?? "2"), 10);
  if (!Number.isFinite(n) || n < 1 || n > 99) throw new Error("REC001_INVALID_PARTY_SIZE");
  return n;
}

export function assertNoDonorAuthorityLeak(input: ExCorteBookingDonorInput): void {
  for (const field of BOOKING_DONOR_FORBIDDEN_FIELDS) {
    const value = input[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      throw new Error(`REC001_FORBIDDEN_DONOR_AUTHORITY:${field}`);
    }
  }
}

export function mapDonorBookingStatus(status: string | null | undefined): BookingStatus | undefined {
  if (!status) return undefined;
  return STATUS_MAP[String(status).trim().toLowerCase()];
}

/**
 * Converts only portable booking intent from the ex-Corte technical laboratory.
 * AIRenOS tenant/location/security context is intentionally absent: it must be
 * resolved by the canonical runtime before BookingApplicationService executes.
 * Donor entity IDs and provider truth never cross the recovery boundary.
 */
export function recoverBookingCreateIntent(
  donor: ExCorteBookingDonorInput,
  expectedDurationMinutes = 120,
): BookingDonorRecoveryResult {
  assertNoDonorAuthorityLeak(donor);

  const customerNameSnapshot = requiredText(donor.customer_name ?? donor.name, "customer_name");
  const phoneSnapshot = requiredText(donor.customer_phone ?? donor.phone, "phone");
  const bookingDate = requiredText(donor.date, "date");
  const bookingTimeLocal = requiredText(donor.time, "time");
  const source = String(donor.source_field ?? donor.source ?? "online").trim() || "online";
  const experience = String(donor.experience_type ?? "").trim();
  const notes = donor.notes ? String(donor.notes).trim() : undefined;
  const specialRequests = [experience ? `experience:${experience}` : "", donor.admin_notes ? String(donor.admin_notes).trim() : ""]
    .filter(Boolean)
    .join(" | ") || undefined;

  const input: BookingCreateInputV1 = Object.freeze({
    source,
    partySize: partySize(donor.guests),
    bookingDate,
    bookingTimeLocal,
    expectedDurationMinutes,
    customerNameSnapshot,
    phoneSnapshot,
    emailSnapshot: donor.email ? String(donor.email).trim().toLowerCase() : undefined,
    notes,
    specialRequests,
  });

  return Object.freeze({
    input,
    donorStatus: mapDonorBookingStatus(donor.status),
    deferredResolution: Object.freeze({
      zoneLabel: donor.zone ? String(donor.zone) : undefined,
      tableLabel: donor.table_label ? String(donor.table_label) : undefined,
      promoter: false,
      event: false,
    }),
  });
}

export const REC001_BOOKING_RECOVERY_EVIDENCE = Object.freeze({
  donor: EX_CORTE_BOOKING_DONOR,
  reusablePatterns: Object.freeze([
    "server-side booking trust point",
    "tenant-scoped guest identity lookup pattern",
    "status transition workflow",
    "manual/public booking UX separation",
    "calendar side-effect concept",
    "audit emission pattern",
  ]),
  refactorRequired: Object.freeze([
    "replace Base44 local tenant/role authority with AIRenOS SecurityContext",
    "remove venue branding and hard-coded contact/location values",
    "replace donor entity IDs with canonical re-resolution",
    "route all writes through BookingApplicationService",
    "preserve idempotency, rowVersion concurrency, audit and outbox contracts",
    "move calendar synchronization behind a provider adapter/outbox consumer",
  ]),
  acceptanceTests: Object.freeze(["GJ2-003", "GJ2-004", "GJ2-032", "GJ2-034"]),
});

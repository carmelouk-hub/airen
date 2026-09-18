import type { SecurityContext } from "../../../shared-contracts/src/index.ts";
import type { BookingReadRepository } from "../../../booking-core/src/contracts.ts";
import {
  AVAILABILITY_CONSUMING_BOOKING_STATUSES,
  type AvailabilityBookingOccupancyReader,
  type BookingOccupancyRecordV1
} from "./contracts.ts";

export class CanonicalBookingOccupancyReader implements AvailabilityBookingOccupancyReader {
  private readonly bookings: BookingReadRepository;

  constructor(bookings: BookingReadRepository) {
    this.bookings = bookings;
  }

  async listConsumingBookings(
    context: SecurityContext,
    bookingDate: string
  ): Promise<readonly BookingOccupancyRecordV1[]> {
    const items: BookingOccupancyRecordV1[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bookings.query(context, {
        statuses: AVAILABILITY_CONSUMING_BOOKING_STATUSES,
        fromDate: bookingDate,
        toDate: bookingDate,
        cursor,
        limit: 100,
        order: "starts_at.asc"
      });
      for (const booking of page.items) {
        if (
          booking.bookingDate === bookingDate &&
          AVAILABILITY_CONSUMING_BOOKING_STATUSES.includes(booking.status as (typeof AVAILABILITY_CONSUMING_BOOKING_STATUSES)[number])
        ) {
          items.push(Object.freeze({
            status: booking.status,
            partySize: booking.partySize,
            bookingDate: booking.bookingDate,
            bookingTimeLocal: booking.bookingTimeLocal.slice(0, 5),
            expectedDurationMinutes: booking.expectedDurationMinutes
          }));
        }
      }
      cursor = page.nextCursor;
    } while (cursor);

    return Object.freeze(items);
  }
}

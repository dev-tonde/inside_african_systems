import {CalendarEventSchema, type CalendarEvent} from "@lifeos/contracts";
import type {GoogleCalendarEvent} from "./calendar-client";
import {normalizeCalendarInterval} from "./calendar-time";

export const normalizeGoogleEvent = (accountId: string, event: GoogleCalendarEvent): CalendarEvent | null => {
  if (event.status === "cancelled" || !event.start || !event.end) return null;
  const interval = normalizeCalendarInterval(event.start, event.end);
  const parsed = CalendarEventSchema.safeParse({
    accountId,
    providerEventId: event.id,
    title: event.summary ?? "(untitled event)",
    startsAt: interval.startsAt,
    endsAt: interval.endsAt,
    attendeeCount: event.attendees?.length ?? 0,
    sourceVersion: event.etag,
    location: event.location,
    organizerEmail: event.organizer?.email,
  });
  if (!parsed.success) throw new Error("Calendar event was invalid");
  return parsed.data;
};

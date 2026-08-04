import {CalendarEventSchema, type CalendarEvent} from "@lifeos/contracts";
import type {GoogleCalendarEvent} from "./calendar-client";

const allDayInstant = (date: string) => new Date(`${date}T00:00:00+02:00`).toISOString();

const isValidDate = (date: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
};

const normalizeInstant = (part: {dateTime?: string; date?: string}): string => {
  if (part.dateTime) {
    const date = new Date(part.dateTime);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (part.date && isValidDate(part.date)) return allDayInstant(part.date);
  throw new Error("Calendar event was invalid");
};

export const normalizeGoogleEvent = (accountId: string, event: GoogleCalendarEvent): CalendarEvent | null => {
  if (event.status === "cancelled" || !event.start || !event.end) return null;
  const parsed = CalendarEventSchema.safeParse({
    accountId,
    providerEventId: event.id,
    title: event.summary ?? "(untitled event)",
    startsAt: normalizeInstant(event.start),
    endsAt: normalizeInstant(event.end),
    attendeeCount: event.attendees?.length ?? 0,
    sourceVersion: event.etag,
    location: event.location,
    organizerEmail: event.organizer?.email,
  });
  if (!parsed.success) throw new Error("Calendar event was invalid");
  return parsed.data;
};

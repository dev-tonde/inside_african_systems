import type {CalendarEvent} from "@lifeos/contracts";
import {CalendarSyncExpiredError, type CalendarClient, type CalendarListing} from "./calendar-client";
import {normalizeGoogleEvent} from "./normalize-event";
import type {CalendarRepository} from "../repositories/calendar-repository";

export type SyncResult = {mode: "full" | "delta"; changed: number; deleted: number; cursor: string};

const fullWindow = (now: Date) => ({
  timeMin: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  timeMax: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
});

const hasValidCursor = (cursor: string | null): cursor is string =>
  typeof cursor === "string" && cursor.trim().length > 0;

export const syncCalendarAccount = async (input: {
  accountId: string;
  client: CalendarClient;
  repository: CalendarRepository;
  now: Date;
  forceFull?: boolean;
}): Promise<SyncResult> => {
  const storedCursor = input.forceFull ? null : await input.repository.getCursor(input.accountId);
  const cursor = hasValidCursor(storedCursor) ? storedCursor : null;
  let mode: SyncResult["mode"] = cursor ? "delta" : "full";
  let listing: CalendarListing;
  try {
    listing = cursor
      ? await input.client.listDelta(cursor)
      : await input.client.listInitial(fullWindow(input.now));
  } catch (error) {
    if (!cursor || !(error instanceof CalendarSyncExpiredError)) throw error;
    mode = "full";
    listing = await input.client.listInitial(fullWindow(input.now));
  }

  const finalEvents = new Map<string, typeof listing.events[number]>();
  for (const event of listing.events) finalEvents.set(event.id, event);
  const normalized: CalendarEvent[] = [];
  const cancelledIds: string[] = [];
  for (const event of finalEvents.values()) {
    const normalizedEvent = normalizeGoogleEvent(input.accountId, event);
    if (normalizedEvent) normalized.push(normalizedEvent);
    else if (event.status === "cancelled") cancelledIds.push(event.id);
  }

  const now = input.now.toISOString();
  const changed = await input.repository.upsertEvents(normalized, now);
  const deleted = await input.repository.deleteEvents(input.accountId, cancelledIds);
  await input.repository.setCursor(input.accountId, listing.nextSyncToken, now);
  return {mode, changed, deleted, cursor: listing.nextSyncToken};
};

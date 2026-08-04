import type {CalendarEvent} from "@lifeos/contracts";

export interface CalendarRepository {
  getCursor(accountId: string): Promise<string | null>;
  upsertEvents(events: CalendarEvent[], now: string): Promise<number>;
  deleteEvents(accountId: string, providerIds: string[]): Promise<number>;
  setCursor(accountId: string, cursor: string, now: string): Promise<void>;
}

export const createCalendarRepository = (db: D1Database): CalendarRepository => ({
  async getCursor(accountId) {
    const row = await db
      .prepare("SELECT cursor FROM sync_cursors WHERE account_id = ? AND provider = 'calendar'")
      .bind(accountId)
      .first<{cursor: string | null}>();
    return row?.cursor ?? null;
  },

  async upsertEvents(events, now) {
    if (events.length === 0) return 0;
    const results = await db.batch(
      events.map((event) =>
        db
          .prepare(
            `INSERT INTO calendar_events
              (account_id, provider_event_id, title, starts_at, ends_at, attendee_count, source_version, location, organizer_email, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(account_id, provider_event_id) DO UPDATE SET
               title = excluded.title,
               starts_at = excluded.starts_at,
               ends_at = excluded.ends_at,
               attendee_count = excluded.attendee_count,
               source_version = excluded.source_version,
               location = excluded.location,
               organizer_email = excluded.organizer_email,
               updated_at = excluded.updated_at
             WHERE calendar_events.source_version <> excluded.source_version`,
          )
          .bind(
            event.accountId,
            event.providerEventId,
            event.title,
            event.startsAt,
            event.endsAt,
            event.attendeeCount,
            event.sourceVersion,
            event.location ?? null,
            event.organizerEmail ?? null,
            now,
          ),
      ),
    );
    return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
  },

  async deleteEvents(accountId, providerIds) {
    const uniqueIds = [...new Set(providerIds)];
    if (uniqueIds.length === 0) return 0;
    const results = await db.batch(
      uniqueIds.map((providerId) =>
        db.prepare("DELETE FROM calendar_events WHERE account_id = ? AND provider_event_id = ?").bind(accountId, providerId),
      ),
    );
    return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
  },

  async setCursor(accountId, cursor, now) {
    await db
      .prepare(
        `INSERT INTO sync_cursors (account_id, provider, cursor, last_success_at)
         VALUES (?, 'calendar', ?, ?)
         ON CONFLICT(account_id, provider) DO UPDATE SET
           cursor = excluded.cursor,
           last_success_at = excluded.last_success_at`,
      )
      .bind(accountId, cursor, now)
      .run();
  },
});

import {applyD1Migrations, env} from "cloudflare:test";
import {beforeEach, describe, expect, it} from "vitest";
import {
  CalendarSyncExpiredError,
  createCalendarClient,
  type CalendarClient,
  type GoogleCalendarEvent,
} from "../src/calendar/calendar-client";
import {normalizeGoogleEvent} from "../src/calendar/normalize-event";
import {syncCalendarAccount} from "../src/calendar/sync-calendar";
import {createCalendarRepository, type CalendarRepository} from "../src/repositories/calendar-repository";

const now = new Date("2026-08-04T07:00:00.000Z");
const testDb = (env as unknown as {DB: D1Database}).DB;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});

const timedEvent = (id = "event-timed", etag = "etag-1"): GoogleCalendarEvent => ({
  id,
  etag,
  status: "confirmed",
  summary: "Project review",
  location: "Cape Town",
  organizer: {email: "organizer@example.com"},
  attendees: [{email: "guest@example.com", responseStatus: "accepted"}],
  start: {dateTime: "2026-08-04T11:00:00+02:00", timeZone: "Africa/Johannesburg"},
  end: {dateTime: "2026-08-04T12:00:00+02:00", timeZone: "Africa/Johannesburg"},
});

const allDayEvent = (id = "event-all-day", etag = "etag-1"): GoogleCalendarEvent => ({
  id,
  etag,
  status: "confirmed",
  summary: "Public holiday",
  start: {date: "2026-08-05"},
  end: {date: "2026-08-06"},
});

class FakeCalendarRepository implements CalendarRepository {
  cursor: string | null;
  readonly events: Array<NonNullable<ReturnType<typeof normalizeGoogleEvent>>> = [];
  readonly deletedIds: string[] = [];
  readonly operations: string[] = [];

  constructor(cursor: string | null = null, private readonly failure?: "upsert" | "delete") {
    this.cursor = cursor;
  }

  async getCursor(): Promise<string | null> {
    this.operations.push("getCursor");
    return this.cursor;
  }

  async upsertEvents(events: Array<NonNullable<ReturnType<typeof normalizeGoogleEvent>>>): Promise<number> {
    this.operations.push("upsertEvents");
    if (this.failure === "upsert") throw new Error("D1 unavailable");
    let changed = 0;
    for (const event of events) {
      const existing = this.events.find((candidate) => candidate.providerEventId === event.providerEventId);
      if (!existing) {
        this.events.push(event);
        changed += 1;
      } else if (existing.sourceVersion !== event.sourceVersion) {
        this.events.splice(this.events.indexOf(existing), 1, event);
        changed += 1;
      }
    }
    return changed;
  }

  async deleteEvents(_accountId: string, providerIds: string[]): Promise<number> {
    this.operations.push("deleteEvents");
    if (this.failure === "delete") throw new Error("D1 unavailable");
    let deleted = 0;
    for (const providerId of providerIds) {
      const existing = this.events.find((candidate) => candidate.providerEventId === providerId);
      if (existing) {
        this.events.splice(this.events.indexOf(existing), 1);
        deleted += 1;
      }
      this.deletedIds.push(providerId);
    }
    return deleted;
  }

  async setCursor(_accountId: string, cursor: string): Promise<void> {
    this.operations.push("setCursor");
    this.cursor = cursor;
  }
}

class FakeCalendarClient implements CalendarClient {
  initialCalls: Array<{timeMin: string; timeMax: string}> = [];
  deltaCalls: string[] = [];

  constructor(private readonly input: {
    events: GoogleCalendarEvent[];
    nextSyncToken: string;
    syncExpired?: boolean;
    error?: Error;
  }) {}

  async listInitial(input: {timeMin: string; timeMax: string}) {
    this.initialCalls.push(input);
    if (this.input.error) throw this.input.error;
    return {events: this.input.events, nextSyncToken: this.input.nextSyncToken};
  }

  async listDelta(syncToken: string) {
    this.deltaCalls.push(syncToken);
    if (this.input.syncExpired) throw new CalendarSyncExpiredError();
    if (this.input.error) throw this.input.error;
    return {events: this.input.events, nextSyncToken: this.input.nextSyncToken};
  }
}

const baseInput = (input: {client: CalendarClient; repository: CalendarRepository; forceFull?: boolean}) => ({
  accountId: "account-1",
  client: input.client,
  repository: input.repository,
  now,
  forceFull: input.forceFull,
});

describe("Calendar synchronization", () => {
  it("normalizes timed and all-day events in Johannesburg time", async () => {
    const repository = new FakeCalendarRepository();
    await syncCalendarAccount(baseInput({
      client: new FakeCalendarClient({events: [timedEvent(), allDayEvent()], nextSyncToken: "sync-2"}),
      repository,
    }));

    expect(repository.events).toHaveLength(2);
    expect(repository.events[0]).toMatchObject({startsAt: "2026-08-04T09:00:00.000Z", attendeeCount: 1});
    expect(repository.events[1]?.startsAt).toBe("2026-08-04T22:00:00.000Z");
    expect(repository.events[1]?.endsAt).toBe("2026-08-05T22:00:00.000Z");
  });

  it("uses exactly seven days before and 30 days after now for a full snapshot", async () => {
    const repository = new FakeCalendarRepository();
    const client = new FakeCalendarClient({events: [], nextSyncToken: "sync-2"});
    await syncCalendarAccount(baseInput({client, repository}));

    expect(client.initialCalls).toEqual([{timeMin: "2026-07-28T07:00:00.000Z", timeMax: "2026-09-03T07:00:00.000Z"}]);
    expect(client.deltaCalls).toEqual([]);
  });

  it("uses delta mode for an existing token and removes cancelled provider events", async () => {
    const repository = new FakeCalendarRepository("sync-1");
    await repository.upsertEvents([normalizeGoogleEvent("account-1", timedEvent("event-1"))!]);
    const result = await syncCalendarAccount(baseInput({
      client: new FakeCalendarClient({
        events: [{id: "event-1", status: "cancelled", etag: "etag-2"}],
        nextSyncToken: "sync-2",
      }),
      repository,
    }));

    expect(result).toEqual({mode: "delta", changed: 0, deleted: 1, cursor: "sync-2"});
    expect(repository.events).toEqual([]);
    expect(repository.deletedIds).toEqual(["event-1"]);
  });

  it("falls back to the bounded full snapshot only after Google expires a sync token", async () => {
    const repository = new FakeCalendarRepository("expired");
    const client = new FakeCalendarClient({syncExpired: true, events: [], nextSyncToken: "sync-3"});
    const result = await syncCalendarAccount(baseInput({client, repository}));

    expect(result).toEqual({mode: "full", changed: 0, deleted: 0, cursor: "sync-3"});
    expect(client.deltaCalls).toEqual(["expired"]);
    expect(client.initialCalls).toEqual([{timeMin: "2026-07-28T07:00:00.000Z", timeMax: "2026-09-03T07:00:00.000Z"}]);
  });

  it("does not fall back to a full snapshot for non-expiry failures", async () => {
    const repository = new FakeCalendarRepository("sync-1");
    const client = new FakeCalendarClient({events: [], nextSyncToken: "sync-2", error: new Error("private provider failure")});

    await expect(syncCalendarAccount(baseInput({client, repository}))).rejects.toThrow("private provider failure");
    expect(client.initialCalls).toEqual([]);
    expect(repository.operations).toEqual(["getCursor"]);
    expect(repository.cursor).toBe("sync-1");
  });

  it("does not advance the cursor when event persistence fails", async () => {
    const repository = new FakeCalendarRepository("sync-1", "upsert");
    await expect(syncCalendarAccount(baseInput({
      client: new FakeCalendarClient({events: [timedEvent()], nextSyncToken: "sync-2"}),
      repository,
    }))).rejects.toThrow("D1 unavailable");

    expect(repository.cursor).toBe("sync-1");
    expect(repository.operations).toEqual(["getCursor", "upsertEvents"]);
  });

  it("does not advance the cursor when cancellation persistence fails", async () => {
    const repository = new FakeCalendarRepository("sync-1", "delete");
    await expect(syncCalendarAccount(baseInput({
      client: new FakeCalendarClient({events: [{id: "event-1", status: "cancelled", etag: "etag-2"}], nextSyncToken: "sync-2"}),
      repository,
    }))).rejects.toThrow("D1 unavailable");

    expect(repository.cursor).toBe("sync-1");
    expect(repository.operations).toEqual(["getCursor", "upsertEvents", "deleteEvents"]);
  });

  it("uses the latest provider update once when an event repeats across a response", async () => {
    const repository = new FakeCalendarRepository();
    const result = await syncCalendarAccount(baseInput({
      client: new FakeCalendarClient({
        events: [timedEvent("event-1", "etag-1"), {...timedEvent("event-1", "etag-2"), summary: "Updated"}],
        nextSyncToken: "sync-2",
      }),
      repository,
    }));

    expect(result.changed).toBe(1);
    expect(repository.events).toMatchObject([{providerEventId: "event-1", sourceVersion: "etag-2", title: "Updated"}]);
  });
});

describe("Calendar API client", () => {
  it("uses only Calendar read requests, paginates initial snapshots, and retains only the terminal sync token", async () => {
    const requests: Array<{url: URL; init?: RequestInit}> = [];
    const fetcher = (async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(request));
      requests.push({url, init});
      if (!url.searchParams.get("pageToken")) {
        return json({items: [timedEvent("event-1")], nextPageToken: "page-2"});
      }
      return json({items: [allDayEvent("event-2")], nextSyncToken: "sync-2"});
    }) as typeof fetch;

    const listing = await createCalendarClient("access-token", fetcher).listInitial({
      timeMin: "2026-07-28T07:00:00.000Z",
      timeMax: "2026-09-03T07:00:00.000Z",
    });

    expect(listing.events.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(listing.nextSyncToken).toBe("sync-2");
    expect(requests).toHaveLength(2);
    for (const {url, init} of requests) {
      expect(url.origin).toBe("https://www.googleapis.com");
      expect(url.pathname).toBe("/calendar/v3/calendars/primary/events");
      expect(url.searchParams.get("singleEvents")).toBe("true");
      expect(url.searchParams.get("showDeleted")).toBe("true");
      expect(init?.method).toBeUndefined();
      expect(init?.headers).toEqual({authorization: "Bearer access-token"});
    }
    expect(requests[0]?.url.searchParams.get("timeMin")).toBe("2026-07-28T07:00:00.000Z");
    expect(requests[0]?.url.searchParams.get("timeMax")).toBe("2026-09-03T07:00:00.000Z");
    expect(requests[1]?.url.searchParams.get("pageToken")).toBe("page-2");
  });

  it("uses the supplied sync token for delta pages and retains the terminal token", async () => {
    const requests: URL[] = [];
    const fetcher = (async (request: RequestInfo | URL) => {
      const url = new URL(String(request));
      requests.push(url);
      if (!url.searchParams.get("pageToken")) return json({items: [{id: "event-1", status: "cancelled", etag: "etag-2"}], nextPageToken: "page-2"});
      return json({items: [], nextSyncToken: "sync-2"});
    }) as typeof fetch;

    await expect(createCalendarClient("access-token", fetcher).listDelta("sync-1")).resolves.toMatchObject({nextSyncToken: "sync-2"});
    for (const url of requests) {
      expect(url.searchParams.get("syncToken")).toBe("sync-1");
      expect(url.searchParams.get("showDeleted")).toBe("true");
      expect(url.searchParams.has("timeMin")).toBe(false);
      expect(url.searchParams.has("timeMax")).toBe(false);
    }
  });

  it("maps only HTTP 410 to sync expiry and redacts all other provider failures", async () => {
    const expired = createCalendarClient("access-token", (async () => new Response(null, {status: 410})) as typeof fetch);
    await expect(expired.listDelta("sync-1")).rejects.toBeInstanceOf(CalendarSyncExpiredError);

    const failed = createCalendarClient(
      "access-token",
      (async () => new Response("private upstream error access-token", {status: 404})) as typeof fetch,
    );
    await expect(failed.listDelta("sync-1")).rejects.toThrow("Calendar request failed");
    await expect(failed.listDelta("sync-1")).rejects.not.toThrow("access-token");
  });

  it("rejects malformed envelopes and does not expose provider contents", async () => {
    const invalidBodies: unknown[] = [
      {items: "PRIVATE EVENTS", nextSyncToken: "sync-2"},
      {items: [{id: "", etag: "etag-1"}], nextSyncToken: "sync-2"},
      {items: [timedEvent(), "PRIVATE EVENT"], nextSyncToken: "sync-2"},
      {items: [], nextPageToken: 42},
      {items: [], nextPageToken: "page-2", nextSyncToken: "sync-2"},
      {items: []},
    ];
    for (const body of invalidBodies) {
      const client = createCalendarClient("access-token", (async () => json(body)) as typeof fetch);
      await expect(client.listInitial({timeMin: now.toISOString(), timeMax: now.toISOString()})).rejects.toThrow("Calendar response was invalid");
      await expect(client.listInitial({timeMin: now.toISOString(), timeMax: now.toISOString()})).rejects.not.toThrow("PRIVATE");
    }
  });

  it("rejects invalid event dates before they can be persisted", async () => {
    const client = createCalendarClient(
      "access-token",
      (async () => json({
        items: [{...allDayEvent(), start: {date: "2026-02-30"}, end: {date: "2026-03-01"}}],
        nextSyncToken: "sync-2",
      })) as typeof fetch,
    );

    await expect(client.listInitial({timeMin: now.toISOString(), timeMax: now.toISOString()})).rejects.toThrow("Calendar response was invalid");
  });

  it("strictly validates offset-bearing RFC3339 values instead of accepting Date rollovers", async () => {
    const invalidEvents: GoogleCalendarEvent[] = [
      {...timedEvent(), start: {dateTime: "2026-02-30T11:00:00+02:00"}},
      {...timedEvent(), start: {dateTime: "2026-08-04T11:00:00+24:00"}},
      {...timedEvent(), start: {dateTime: "2026-08-04T11:00:00+02:60"}},
      {...timedEvent(), start: {dateTime: "2026-08-04T24:00:00+02:00"}},
      {...timedEvent(), start: {dateTime: "2026-08-04T11:00+02:00"}},
      {...timedEvent(), start: {dateTime: "2026-08-04T11:00:00.+02:00"}},
      {...timedEvent(), start: {dateTime: "2026-08-04T11:00:00.nope+02:00"}},
    ];
    for (const event of invalidEvents) {
      const client = createCalendarClient(
        "access-token",
        (async () => json({items: [event], nextSyncToken: "sync-2"})) as typeof fetch,
      );
      await expect(client.listInitial({timeMin: now.toISOString(), timeMax: now.toISOString()}))
        .rejects.toThrow("Calendar response was invalid");
    }
  });

  it("accepts arbitrary RFC3339 fractional precision and truncates deterministically to milliseconds", async () => {
    const repository = new FakeCalendarRepository();
    const client = createCalendarClient(
      "access-token",
      (async () => json({
        items: [
          {
            ...timedEvent("fraction-4"),
            start: {dateTime: "2026-08-04T11:00:00.1234+02:00"},
            end: {dateTime: "2026-08-04T11:00:01.9876+02:00"},
          },
          {
            ...timedEvent("fraction-6"),
            start: {dateTime: "2026-08-04T11:00:02.123456+02:00"},
            end: {dateTime: "2026-08-04T11:00:03.987654+02:00"},
          },
          {
            ...timedEvent("fraction-long"),
            start: {dateTime: "2026-08-04T11:00:04.123456789012+02:00"},
            end: {dateTime: "2026-08-04T11:00:05.987654321098+02:00"},
          },
          {
            ...timedEvent("fraction-short"),
            start: {dateTime: "2026-08-04T11:00:06.1+02:00"},
            end: {dateTime: "2026-08-04T11:00:07.2+02:00"},
          },
        ],
        nextSyncToken: "sync-2",
      })) as typeof fetch,
    );

    await syncCalendarAccount(baseInput({client, repository}));
    expect(repository.events.map(({providerEventId, startsAt, endsAt}) => ({providerEventId, startsAt, endsAt}))).toEqual([
      {providerEventId: "fraction-4", startsAt: "2026-08-04T09:00:00.123Z", endsAt: "2026-08-04T09:00:01.987Z"},
      {providerEventId: "fraction-6", startsAt: "2026-08-04T09:00:02.123Z", endsAt: "2026-08-04T09:00:03.987Z"},
      {providerEventId: "fraction-long", startsAt: "2026-08-04T09:00:04.123Z", endsAt: "2026-08-04T09:00:05.987Z"},
      {providerEventId: "fraction-short", startsAt: "2026-08-04T09:00:06.100Z", endsAt: "2026-08-04T09:00:07.200Z"},
    ]);
  });

  it("resolves offsetless Johannesburg event times in their supplied IANA zone", async () => {
    const repository = new FakeCalendarRepository();
    const client = createCalendarClient(
      "access-token",
      (async () => json({
        items: [{
          ...timedEvent(),
          start: {dateTime: "2026-08-04T11:00:00", timeZone: "Africa/Johannesburg"},
          end: {dateTime: "2026-08-04T12:00:00", timeZone: "Africa/Johannesburg"},
        }],
        nextSyncToken: "sync-2",
      })) as typeof fetch,
    );

    await syncCalendarAccount(baseInput({client, repository}));
    expect(repository.events).toMatchObject([{startsAt: "2026-08-04T09:00:00.000Z", endsAt: "2026-08-04T10:00:00.000Z"}]);
  });

  it("resolves offsetless RFC3339 fractional values through their supplied IANA zone", async () => {
    const repository = new FakeCalendarRepository();
    const client = createCalendarClient(
      "access-token",
      (async () => json({
        items: [{
          ...timedEvent(),
          start: {dateTime: "2026-08-04T11:00:00.123456", timeZone: "Africa/Johannesburg"},
          end: {dateTime: "2026-08-04T12:00:00.987654", timeZone: "Africa/Johannesburg"},
        }],
        nextSyncToken: "sync-2",
      })) as typeof fetch,
    );

    await syncCalendarAccount(baseInput({client, repository}));
    expect(repository.events).toMatchObject([{startsAt: "2026-08-04T09:00:00.123Z", endsAt: "2026-08-04T10:00:00.987Z"}]);
  });

  it("fails closed for offsetless invalid zones and DST gaps or folds", async () => {
    const invalidEvents: GoogleCalendarEvent[] = [
      {...timedEvent(), start: {dateTime: "2026-08-04T11:00:00", timeZone: "Mars/Olympus"}},
      {...timedEvent(), start: {dateTime: "2026-03-08T02:30:00", timeZone: "America/New_York"}},
      {...timedEvent(), start: {dateTime: "2026-11-01T01:30:00", timeZone: "America/New_York"}},
      {...allDayEvent(), start: {date: "2026-08-05", timeZone: "Mars/Olympus"}},
    ];
    for (const event of invalidEvents) {
      const client = createCalendarClient(
        "access-token",
        (async () => json({items: [event], nextSyncToken: "sync-2"})) as typeof fetch,
      );
      await expect(client.listInitial({timeMin: now.toISOString(), timeMax: now.toISOString()}))
        .rejects.toThrow("Calendar response was invalid");
    }
  });

  it("rejects mixed, zero-length, and reversed event intervals before they can be persisted", async () => {
    const invalidEvents: GoogleCalendarEvent[] = [
      {...timedEvent(), end: {date: "2026-08-05"}},
      {...timedEvent(), end: {dateTime: "2026-08-04T11:00:00+02:00", timeZone: "Africa/Johannesburg"}},
      {...timedEvent(), end: {dateTime: "2026-08-04T10:00:00+02:00", timeZone: "Africa/Johannesburg"}},
      {...timedEvent(), start: {dateTime: "2026-08-04T11:00:00+02:00", date: "2026-08-04"}},
      {...timedEvent(), start: {timeZone: "Africa/Johannesburg"}},
      {...allDayEvent(), end: {date: "2026-08-05"}},
      {...allDayEvent(), end: {date: "2026-08-04"}},
    ];
    for (const event of invalidEvents) {
      const client = createCalendarClient(
        "access-token",
        (async () => json({items: [event], nextSyncToken: "sync-2"})) as typeof fetch,
      );
      await expect(client.listInitial({timeMin: now.toISOString(), timeMax: now.toISOString()}))
        .rejects.toThrow("Calendar response was invalid");
    }
  });
});

const calendarRepositoryMigrations = [
  {
    name: "task8_calendar_repository_prerequisites.sql",
    queries: [
      "CREATE TABLE users (id TEXT PRIMARY KEY, google_subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL, time_zone TEXT NOT NULL, created_at TEXT NOT NULL)",
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), google_subject TEXT NOT NULL, email TEXT NOT NULL, context TEXT NOT NULL, encrypted_refresh_token TEXT NOT NULL, scopes_json TEXT NOT NULL, connected_at TEXT NOT NULL)",
      "CREATE TABLE calendar_events (account_id TEXT NOT NULL REFERENCES accounts(id), provider_event_id TEXT NOT NULL, title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, attendee_count INTEGER NOT NULL, source_version TEXT NOT NULL, location TEXT, organizer_email TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (account_id, provider_event_id))",
      "CREATE TABLE sync_cursors (account_id TEXT NOT NULL REFERENCES accounts(id), provider TEXT NOT NULL, cursor TEXT, last_success_at TEXT, PRIMARY KEY (account_id, provider))",
    ],
  },
];

describe("D1 calendar repository", () => {
  beforeEach(async () => {
    await applyD1Migrations(testDb, calendarRepositoryMigrations);
    await testDb.prepare("DELETE FROM calendar_events").run();
    await testDb.prepare("DELETE FROM sync_cursors").run();
    await testDb.prepare("DELETE FROM accounts").run();
    await testDb.prepare("DELETE FROM users").run();
    await testDb
      .prepare("INSERT INTO users (id, google_subject, email, time_zone, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind("user-1", "owner-subject", "owner@example.com", "Africa/Johannesburg", now.toISOString())
      .run();
    await testDb
      .prepare("INSERT INTO accounts (id, user_id, google_subject, email, context, encrypted_refresh_token, scopes_json, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("account-1", "user-1", "account-subject", "account@example.com", "work", "encrypted", "[]", now.toISOString())
      .run();
  });

  it("upserts only changed calendar records, deletes cancellations, and keeps one calendar cursor", async () => {
    const repository = createCalendarRepository(testDb);
    const first = normalizeGoogleEvent("account-1", timedEvent("event-1", "etag-1"))!;
    const changed = {...first, sourceVersion: "etag-2", title: "Updated review"};

    await expect(repository.getCursor("account-1")).resolves.toBeNull();
    await expect(repository.upsertEvents([], now.toISOString())).resolves.toBe(0);
    await expect(repository.upsertEvents([first], now.toISOString())).resolves.toBe(1);
    await expect(repository.upsertEvents([first], now.toISOString())).resolves.toBe(0);
    await expect(repository.upsertEvents([changed], now.toISOString())).resolves.toBe(1);
    await expect(repository.deleteEvents("account-1", [])).resolves.toBe(0);
    await expect(repository.deleteEvents("account-1", ["event-1"])).resolves.toBe(1);
    await repository.setCursor("account-1", "sync-1", now.toISOString());
    await repository.setCursor("account-1", "sync-2", now.toISOString());

    await expect(repository.getCursor("account-1")).resolves.toBe("sync-2");
    await expect(testDb.prepare("SELECT * FROM calendar_events WHERE account_id = ?").bind("account-1").all())
      .resolves.toMatchObject({results: []});
  });

  it("deletes only the requested account's cancelled event", async () => {
    await testDb
      .prepare("INSERT INTO accounts (id, user_id, google_subject, email, context, encrypted_refresh_token, scopes_json, connected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind("account-2", "user-1", "second-subject", "second@example.com", "personal", "encrypted", "[]", now.toISOString())
      .run();
    const repository = createCalendarRepository(testDb);
    await repository.upsertEvents([
      normalizeGoogleEvent("account-1", timedEvent("same-event"))!,
      normalizeGoogleEvent("account-2", timedEvent("same-event"))!,
    ], now.toISOString());

    await expect(repository.deleteEvents("account-1", ["same-event"])).resolves.toBe(1);
    const rows = await testDb.prepare("SELECT account_id FROM calendar_events WHERE provider_event_id = ? ORDER BY account_id").bind("same-event").all<{account_id: string}>();
    expect(rows.results).toEqual([{account_id: "account-2"}]);
  });
});

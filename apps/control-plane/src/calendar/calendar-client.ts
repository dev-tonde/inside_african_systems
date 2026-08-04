import {normalizeCalendarDatePart, normalizeCalendarInterval, type CalendarDatePart} from "./calendar-time";

export type GoogleCalendarEvent = {
  id: string;
  etag: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  location?: string;
  organizer?: {email?: string};
  attendees?: Array<{email?: string; responseStatus?: string}>;
  start?: {dateTime?: string; date?: string; timeZone?: string};
  end?: {dateTime?: string; date?: string; timeZone?: string};
};

export type CalendarListing = {events: GoogleCalendarEvent[]; nextSyncToken: string};

export class CalendarSyncExpiredError extends Error {
  constructor() {
    super("Calendar sync token expired");
    this.name = "CalendarSyncExpiredError";
  }
}

export interface CalendarClient {
  listInitial(input: {timeMin: string; timeMax: string}): Promise<CalendarListing>;
  listDelta(syncToken: string): Promise<CalendarListing>;
}

const calendarEventsUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const invalidEnvelope = (): never => {
  throw new Error("Calendar response was invalid");
};

const validateDatePart = (value: unknown): CalendarDatePart => {
  if (!isRecord(value)) return invalidEnvelope();
  const dateTime = value.dateTime;
  const date = value.date;
  const timeZone = value.timeZone;
  if (dateTime !== undefined && !isNonEmptyString(dateTime)) return invalidEnvelope();
  if (date !== undefined && !isNonEmptyString(date)) return invalidEnvelope();
  if (timeZone !== undefined && !isNonEmptyString(timeZone)) return invalidEnvelope();
  if ((dateTime === undefined && date === undefined) || (dateTime !== undefined && date !== undefined)) return invalidEnvelope();
  const part = {dateTime: dateTime as string | undefined, date: date as string | undefined, timeZone: timeZone as string | undefined};
  try {
    normalizeCalendarDatePart(part);
  } catch {
    return invalidEnvelope();
  }
  return part;
};

const validateOptionalPerson = (value: unknown): {email?: string} | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || (value.email !== undefined && !isNonEmptyString(value.email))) return invalidEnvelope();
  return value.email === undefined ? {} : {email: value.email};
};

const validateAttendees = (value: unknown): GoogleCalendarEvent["attendees"] => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return invalidEnvelope();
  return value.map((attendee) => {
    if (!isRecord(attendee)) return invalidEnvelope();
    const {email, responseStatus} = attendee;
    if (email !== undefined && !isNonEmptyString(email)) return invalidEnvelope();
    if (responseStatus !== undefined && !isNonEmptyString(responseStatus)) return invalidEnvelope();
    return {
      ...(email === undefined ? {} : {email}),
      ...(responseStatus === undefined ? {} : {responseStatus}),
    };
  });
};

const validateEvent = (value: unknown): GoogleCalendarEvent => {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.etag)) return invalidEnvelope();
  const status = value.status;
  if (status !== undefined && status !== "confirmed" && status !== "tentative" && status !== "cancelled") return invalidEnvelope();
  for (const key of ["summary", "location"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") return invalidEnvelope();
  }

  const isCancelled = status === "cancelled";
  const start = value.start === undefined ? undefined : validateDatePart(value.start);
  const end = value.end === undefined ? undefined : validateDatePart(value.end);
  const organizer = validateOptionalPerson(value.organizer);
  const attendees = validateAttendees(value.attendees);
  if (!isCancelled && (start === undefined || end === undefined)) return invalidEnvelope();
  if (start && end) {
    try {
      normalizeCalendarInterval(start, end);
    } catch {
      return invalidEnvelope();
    }
  }
  return {
    id: value.id,
    etag: value.etag,
    ...(status === undefined ? {} : {status}),
    ...(value.summary === undefined ? {} : {summary: value.summary as string}),
    ...(value.location === undefined ? {} : {location: value.location as string}),
    ...(organizer === undefined ? {} : {organizer}),
    ...(attendees === undefined ? {} : {attendees}),
    ...(start === undefined ? {} : {start}),
    ...(end === undefined ? {} : {end}),
  };
};

const getPage = async (url: URL, accessToken: string, fetcher: typeof fetch): Promise<Record<string, unknown>> => {
  let response: Response;
  try {
    response = await fetcher(url, {headers: {authorization: `Bearer ${accessToken}`}});
  } catch {
    throw new Error("Calendar request failed");
  }
  if (response.status === 410) throw new CalendarSyncExpiredError();
  if (!response.ok) throw new Error("Calendar request failed");
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) return invalidEnvelope();
  return body;
};

const nextPageToken = (body: Record<string, unknown>): string | undefined => {
  if (body.nextPageToken === undefined) return undefined;
  if (!isNonEmptyString(body.nextPageToken)) return invalidEnvelope();
  return body.nextPageToken;
};

const listEvents = async (
  accessToken: string,
  fetcher: typeof fetch,
  makeUrl: (pageToken?: string) => URL,
): Promise<CalendarListing> => {
  let pageToken: string | undefined;
  const visitedPageTokens = new Set<string>();
  const events: GoogleCalendarEvent[] = [];
  do {
    const body = await getPage(makeUrl(pageToken), accessToken, fetcher);
    if (body.items !== undefined && !Array.isArray(body.items)) return invalidEnvelope();
    events.push(...(body.items ?? []).map(validateEvent));
    const next = nextPageToken(body);
    if (next) {
      if (body.nextSyncToken !== undefined || visitedPageTokens.has(next)) return invalidEnvelope();
      visitedPageTokens.add(next);
      pageToken = next;
      continue;
    }
    if (!isNonEmptyString(body.nextSyncToken)) return invalidEnvelope();
    return {events, nextSyncToken: body.nextSyncToken};
  } while (pageToken);
  return invalidEnvelope();
};

export const createCalendarClient = (accessToken: string, fetcher: typeof fetch = fetch): CalendarClient => ({
  listInitial({timeMin, timeMax}) {
    return listEvents(accessToken, fetcher, (pageToken) => {
      const url = new URL(calendarEventsUrl);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return url;
    });
  },

  listDelta(syncToken) {
    return listEvents(accessToken, fetcher, (pageToken) => {
      const url = new URL(calendarEventsUrl);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("showDeleted", "true");
      url.searchParams.set("syncToken", syncToken);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      return url;
    });
  },
});

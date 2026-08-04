import {
  CalendarAssessmentSchema,
  CalendarEventSchema,
  EmailClassificationSchema,
  EmailRecordSchema,
  type CalendarAssessment,
  type CalendarEvent,
  type EmailClassification,
  type EmailRecord,
} from "@lifeos/contracts";

export type EmailReadModel = {record: EmailRecord; classification: EmailClassification};
export type CalendarReadModel = {event: CalendarEvent; assessment: CalendarAssessment};
export type ReadModelQuery = {after?: string; limit: number};

export interface ReadModelRepository {
  listInbox(userId: string, input: ReadModelQuery): Promise<EmailReadModel[]>;
  listCalendar(userId: string, input: ReadModelQuery): Promise<CalendarReadModel[]>;
  loadPlanInputs(
    userId: string,
    accountIds: string[],
    from: string,
    to: string,
  ): Promise<{emails: EmailReadModel[]; events: CalendarReadModel[]}>;
}

type EmailRow = {
  account_id: string;
  provider_message_id: string;
  thread_id: string;
  subject: string;
  sender: string;
  received_at: string;
  source_version: string;
  snippet: string;
  importance: string;
  workflow_state: string;
  life_priority: string;
  confidence: number;
  explanation: string;
  classified_at: string;
};

type CalendarRow = {
  account_id: string;
  provider_event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  attendee_count: number;
  source_version: string;
  location: string | null;
  organizer_email: string | null;
  category: string;
  life_priority: string;
  score: number;
  confidence: number;
  explanation: string;
  assessed_at: string;
};

const emailSelect = `SELECT
  email.account_id, email.provider_message_id, email.thread_id, email.subject, email.sender,
  email.received_at, email.source_version, email.snippet,
  classification.importance, classification.workflow_state, classification.life_priority,
  classification.confidence, classification.explanation, classification.classified_at
FROM email_records AS email
INNER JOIN accounts AS account ON account.id = email.account_id
INNER JOIN email_classifications AS classification
  ON classification.account_id = email.account_id
 AND classification.provider_message_id = email.provider_message_id
 AND classification.source_version = email.source_version`;

const calendarSelect = `SELECT
  event.account_id, event.provider_event_id, event.title, event.starts_at, event.ends_at,
  event.attendee_count, event.source_version, event.location, event.organizer_email,
  assessment.category, assessment.life_priority, assessment.score, assessment.confidence,
  assessment.explanation, assessment.assessed_at
FROM calendar_events AS event
INNER JOIN accounts AS account ON account.id = event.account_id
INNER JOIN calendar_assessments AS assessment
  ON assessment.account_id = event.account_id
 AND assessment.provider_event_id = event.provider_event_id
 AND assessment.source_version = event.source_version`;

const parseInstant = (value: string, label: string): string => {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) throw new RangeError(`${label} must be an ISO instant`);
  return new Date(time).toISOString();
};

const validateQuery = (input: ReadModelQuery): Required<ReadModelQuery> => {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError("limit must be an integer between 1 and 100");
  }
  return {after: input.after ? parseInstant(input.after, "after") : "9999-12-31T23:59:59.999Z", limit: input.limit};
};

const toEmail = (row: EmailRow): EmailReadModel => ({
  record: EmailRecordSchema.parse({
    accountId: row.account_id,
    providerMessageId: row.provider_message_id,
    threadId: row.thread_id,
    subject: row.subject,
    sender: row.sender,
    receivedAt: row.received_at,
    sourceVersion: row.source_version,
    snippet: row.snippet,
  }),
  classification: EmailClassificationSchema.parse({
    accountId: row.account_id,
    providerMessageId: row.provider_message_id,
    sourceVersion: row.source_version,
    importance: row.importance,
    workflowState: row.workflow_state,
    lifePriority: row.life_priority,
    confidence: row.confidence,
    explanation: row.explanation,
    classifiedAt: row.classified_at,
  }),
});

const toCalendar = (row: CalendarRow): CalendarReadModel => ({
  event: CalendarEventSchema.parse({
    accountId: row.account_id,
    providerEventId: row.provider_event_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    attendeeCount: row.attendee_count,
    sourceVersion: row.source_version,
    ...(row.location === null ? {} : {location: row.location}),
    ...(row.organizer_email === null ? {} : {organizerEmail: row.organizer_email}),
  }),
  assessment: CalendarAssessmentSchema.parse({
    accountId: row.account_id,
    providerEventId: row.provider_event_id,
    sourceVersion: row.source_version,
    category: row.category,
    lifePriority: row.life_priority,
    score: row.score,
    confidence: row.confidence,
    explanation: row.explanation,
    assessedAt: row.assessed_at,
  }),
});

const validatePlanInput = (accountIds: string[], from: string, to: string) => {
  const uniqueAccountIds = [...new Set(accountIds)];
  if (uniqueAccountIds.length === 0 || uniqueAccountIds.length > 20 || uniqueAccountIds.some((id) => !id)) {
    throw new RangeError("account list must contain between 1 and 20 unique IDs");
  }
  const normalizedFrom = parseInstant(from, "window");
  const normalizedTo = parseInstant(to, "window");
  if (Date.parse(normalizedFrom) >= Date.parse(normalizedTo)) throw new RangeError("window must be increasing");
  return {accountIds: uniqueAccountIds, from: normalizedFrom, to: normalizedTo};
};

export const createReadModelRepository = (db: D1Database): ReadModelRepository => ({
  async listInbox(userId, input) {
    const query = validateQuery(input);
    const rows = await db.prepare(
      `${emailSelect}
       WHERE account.user_id = ? AND email.received_at < ?
       ORDER BY email.received_at DESC, email.account_id ASC, email.provider_message_id ASC
       LIMIT ?`,
    ).bind(userId, query.after, query.limit).all<EmailRow>();
    return rows.results.map(toEmail);
  },

  async listCalendar(userId, input) {
    const query = validateQuery(input);
    const after = input.after ? parseInstant(input.after, "after") : "1970-01-01T00:00:00.000Z";
    const rows = await db.prepare(
      `${calendarSelect}
       WHERE account.user_id = ? AND event.starts_at > ?
       ORDER BY event.starts_at ASC, event.account_id ASC, event.provider_event_id ASC
       LIMIT ?`,
    ).bind(userId, after, query.limit).all<CalendarRow>();
    return rows.results.map(toCalendar);
  },

  async loadPlanInputs(userId, rawAccountIds, rawFrom, rawTo) {
    const {accountIds, from, to} = validatePlanInput(rawAccountIds, rawFrom, rawTo);
    const placeholders = accountIds.map(() => "?").join(", ");
    const [emailRows, calendarRows] = await Promise.all([
      db.prepare(
        `${emailSelect}
         WHERE account.user_id = ?
           AND email.account_id IN (${placeholders})
           AND email.received_at >= ? AND email.received_at < ?
         ORDER BY email.received_at DESC, email.account_id ASC, email.provider_message_id ASC`,
      ).bind(userId, ...accountIds, from, to).all<EmailRow>(),
      db.prepare(
        `${calendarSelect}
         WHERE account.user_id = ?
           AND event.account_id IN (${placeholders})
           AND event.starts_at >= ? AND event.starts_at < ?
         ORDER BY event.starts_at ASC, event.account_id ASC, event.provider_event_id ASC`,
      ).bind(userId, ...accountIds, from, to).all<CalendarRow>(),
    ]);
    return {emails: emailRows.results.map(toEmail), events: calendarRows.results.map(toCalendar)};
  },
});

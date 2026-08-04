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

export interface ClassificationRepository {
  saveEmailClassification(value: EmailClassification): Promise<void>;
  saveCalendarAssessment(value: CalendarAssessment): Promise<void>;
  listEmailsNeedingClassification(accountId: string, limit: number): Promise<EmailRecord[]>;
  listEventsNeedingAssessment(accountId: string, from: string, to: string): Promise<CalendarEvent[]>;
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
};

const validateLimit = (limit: number): void => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("Classification limit must be an integer between 1 and 100");
  }
};

const validateWindow = (from: string, to: string): {from: string; to: string} => {
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime >= toTime) {
    throw new RangeError("Assessment window must be a valid increasing ISO interval");
  }
  return {from: new Date(fromTime).toISOString(), to: new Date(toTime).toISOString()};
};

const toEmailRecord = (row: EmailRow): EmailRecord => EmailRecordSchema.parse({
  accountId: row.account_id,
  providerMessageId: row.provider_message_id,
  threadId: row.thread_id,
  subject: row.subject,
  sender: row.sender,
  receivedAt: row.received_at,
  sourceVersion: row.source_version,
  snippet: row.snippet,
});

const toCalendarEvent = (row: CalendarRow): CalendarEvent => CalendarEventSchema.parse({
  accountId: row.account_id,
  providerEventId: row.provider_event_id,
  title: row.title,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  attendeeCount: row.attendee_count,
  sourceVersion: row.source_version,
  ...(row.location === null ? {} : {location: row.location}),
  ...(row.organizer_email === null ? {} : {organizerEmail: row.organizer_email}),
});

export const createClassificationRepository = (db: D1Database): ClassificationRepository => ({
  async saveEmailClassification(value) {
    const parsed = EmailClassificationSchema.parse(value);
    await db.prepare(
      `INSERT INTO email_classifications
        (account_id, provider_message_id, source_version, importance, workflow_state, life_priority, confidence, explanation, classified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, provider_message_id, source_version) DO NOTHING`,
    ).bind(
      parsed.accountId,
      parsed.providerMessageId,
      parsed.sourceVersion,
      parsed.importance,
      parsed.workflowState,
      parsed.lifePriority,
      parsed.confidence,
      parsed.explanation,
      parsed.classifiedAt,
    ).run();
  },

  async saveCalendarAssessment(value) {
    const parsed = CalendarAssessmentSchema.parse(value);
    await db.prepare(
      `INSERT INTO calendar_assessments
        (account_id, provider_event_id, source_version, category, life_priority, score, confidence, explanation, assessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, provider_event_id, source_version) DO NOTHING`,
    ).bind(
      parsed.accountId,
      parsed.providerEventId,
      parsed.sourceVersion,
      parsed.category,
      parsed.lifePriority,
      parsed.score,
      parsed.confidence,
      parsed.explanation,
      parsed.assessedAt,
    ).run();
  },

  async listEmailsNeedingClassification(accountId, limit) {
    validateLimit(limit);
    const rows = await db.prepare(
      `SELECT
         email.account_id,
         email.provider_message_id,
         email.thread_id,
         email.subject,
         email.sender,
         email.received_at,
         email.source_version,
         email.snippet
       FROM email_records AS email
       WHERE email.account_id = ?
         AND NOT EXISTS (
           SELECT 1
           FROM email_classifications AS classification
           WHERE classification.account_id = email.account_id
             AND classification.provider_message_id = email.provider_message_id
             AND classification.source_version = email.source_version
         )
       ORDER BY email.received_at DESC, email.provider_message_id ASC
       LIMIT ?`,
    ).bind(accountId, limit).all<EmailRow>();
    return rows.results.map(toEmailRecord);
  },

  async listEventsNeedingAssessment(accountId, from, to) {
    const window = validateWindow(from, to);
    const rows = await db.prepare(
      `SELECT
         event.account_id,
         event.provider_event_id,
         event.title,
         event.starts_at,
         event.ends_at,
         event.attendee_count,
         event.source_version,
         event.location,
         event.organizer_email
       FROM calendar_events AS event
       WHERE event.account_id = ?
         AND event.starts_at >= ?
         AND event.starts_at < ?
         AND NOT EXISTS (
           SELECT 1
           FROM calendar_assessments AS assessment
           WHERE assessment.account_id = event.account_id
             AND assessment.provider_event_id = event.provider_event_id
             AND assessment.source_version = event.source_version
         )
       ORDER BY event.starts_at ASC, event.provider_event_id ASC`,
    ).bind(accountId, window.from, window.to).all<CalendarRow>();
    return rows.results.map(toCalendarEvent);
  },
});

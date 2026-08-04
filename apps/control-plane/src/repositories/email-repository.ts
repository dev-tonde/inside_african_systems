import type {EmailRecord} from "@lifeos/contracts";

export interface EmailRepository {
  getCursor(accountId: string): Promise<string | null>;
  upsertRecords(records: EmailRecord[], now: string): Promise<number>;
  setCursor(accountId: string, cursor: string, now: string): Promise<void>;
}

export const createEmailRepository = (db: D1Database): EmailRepository => ({
  async getCursor(accountId) {
    const row = await db
      .prepare("SELECT cursor FROM sync_cursors WHERE account_id = ? AND provider = 'gmail'")
      .bind(accountId)
      .first<{cursor: string | null}>();
    return row?.cursor ?? null;
  },

  async upsertRecords(records, now) {
    if (records.length === 0) return 0;
    const results = await db.batch(
      records.map((record) =>
        db
          .prepare(
            `INSERT INTO email_records
              (account_id, provider_message_id, thread_id, subject, sender, received_at, source_version, snippet, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(account_id, provider_message_id) DO UPDATE SET
               thread_id = excluded.thread_id,
               subject = excluded.subject,
               sender = excluded.sender,
               received_at = excluded.received_at,
               source_version = excluded.source_version,
               snippet = excluded.snippet,
               updated_at = excluded.updated_at
             WHERE email_records.source_version <> excluded.source_version`,
          )
          .bind(
            record.accountId,
            record.providerMessageId,
            record.threadId,
            record.subject,
            record.sender,
            record.receivedAt,
            record.sourceVersion,
            record.snippet,
            now,
          ),
      ),
    );
    return results.reduce((count, result) => count + (result.meta.changes ?? 0), 0);
  },

  async setCursor(accountId, cursor, now) {
    await db
      .prepare(
        `INSERT INTO sync_cursors (account_id, provider, cursor, last_success_at)
         VALUES (?, 'gmail', ?, ?)
         ON CONFLICT(account_id, provider) DO UPDATE SET
           cursor = excluded.cursor,
           last_success_at = excluded.last_success_at`,
      )
      .bind(accountId, cursor, now)
      .run();
  },
});

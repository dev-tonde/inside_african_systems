export type StoredOAuthFlow = {
  purpose: "owner_login" | "connect_account";
  encryptedVerifier: string;
  context: "personal" | "work" | null;
  userId: string | null;
  sessionIdHash: string | null;
};

export interface AuthRepository {
  saveOAuthFlow(input: {
    stateHash: string;
    purpose: StoredOAuthFlow["purpose"];
    encryptedVerifier: string;
    context: StoredOAuthFlow["context"];
    userId: string | null;
    sessionIdHash: string | null;
    expiresAt: string;
  }): Promise<void>;
  consumeOAuthFlow(stateHash: string, now: string): Promise<StoredOAuthFlow | null>;
  upsertOwner(input: {googleSubject: string; email: string; now: string}): Promise<string>;
  saveSession(input: {idHash: string; userId: string; expiresAt: string; now: string}): Promise<void>;
  findSession(
    idHash: string,
    now: string,
  ): Promise<{userId: string; email: string; googleSubject: string} | null>;
  deleteSession(idHash: string): Promise<void>;
  saveAccount(input: {
    userId: string;
    googleSubject: string;
    email: string;
    context: "personal" | "work";
    encryptedRefreshToken: string;
    scopes: string[];
    now: string;
  }): Promise<void>;
}

type OAuthFlowRow = {
  purpose: StoredOAuthFlow["purpose"];
  code_verifier_encrypted: string;
  context: StoredOAuthFlow["context"];
  user_id: string | null;
  session_id_hash: string | null;
};

export const createAuthRepository = (db: D1Database): AuthRepository => ({
  async saveOAuthFlow(input) {
    await db
      .prepare(
        `INSERT INTO oauth_flows
          (state_hash, purpose, code_verifier_encrypted, context, user_id, session_id_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.stateHash,
        input.purpose,
        input.encryptedVerifier,
        input.context,
        input.userId,
        input.sessionIdHash,
        input.expiresAt,
        new Date().toISOString(),
      )
      .run();
  },

  async consumeOAuthFlow(stateHash, now) {
    const [selection] = await db.batch<OAuthFlowRow>([
      db
        .prepare(
          `SELECT purpose, code_verifier_encrypted, context, user_id, session_id_hash
           FROM oauth_flows
           WHERE state_hash = ? AND expires_at > ?`,
        )
        .bind(stateHash, now),
      db.prepare("DELETE FROM oauth_flows WHERE state_hash = ?").bind(stateHash),
    ]);
    const row = selection.results[0];
    if (!row) return null;
    return {
      purpose: row.purpose,
      encryptedVerifier: row.code_verifier_encrypted,
      context: row.context,
      userId: row.user_id,
      sessionIdHash: row.session_id_hash,
    };
  },

  async upsertOwner(input) {
    const generatedId = crypto.randomUUID();
    const row = await db
      .prepare(
        `INSERT INTO users (id, google_subject, email, time_zone, created_at)
         VALUES (?, ?, ?, 'Africa/Johannesburg', ?)
         ON CONFLICT(google_subject) DO UPDATE SET email = excluded.email
         RETURNING id`,
      )
      .bind(generatedId, input.googleSubject, input.email, input.now)
      .first<{id: string}>();
    if (!row) throw new Error("Owner persistence failed");
    return row.id;
  },

  async saveSession(input) {
    await db
      .prepare("INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(input.idHash, input.userId, input.expiresAt, input.now)
      .run();
  },

  async findSession(idHash, now) {
    return db
      .prepare(
        `SELECT sessions.user_id AS userId, users.email AS email, users.google_subject AS googleSubject
         FROM sessions
         INNER JOIN users ON users.id = sessions.user_id
         WHERE sessions.id_hash = ? AND sessions.expires_at > ?`,
      )
      .bind(idHash, now)
      .first<{userId: string; email: string; googleSubject: string}>();
  },

  async deleteSession(idHash) {
    await db.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(idHash).run();
  },

  async saveAccount(input) {
    await db
      .prepare(
        `INSERT INTO accounts
          (id, user_id, google_subject, email, context, encrypted_refresh_token, scopes_json, connected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, context) DO UPDATE SET
           google_subject = excluded.google_subject,
           email = excluded.email,
           encrypted_refresh_token = excluded.encrypted_refresh_token,
           scopes_json = excluded.scopes_json,
           connected_at = excluded.connected_at`,
      )
      .bind(
        crypto.randomUUID(),
        input.userId,
        input.googleSubject,
        input.email,
        input.context,
        input.encryptedRefreshToken,
        JSON.stringify(input.scopes),
        input.now,
      )
      .run();
  },
});

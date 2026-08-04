import {readOnlyScopes} from "../google/oauth";

export type ConnectedAccount = {
  id: string;
  userId: string;
  email: string;
  context: "personal" | "work";
  encryptedRefreshToken: string;
  scopes: string[];
};

export interface AccountRepository {
  findOwnerUserId(googleSubject: string): Promise<string | null>;
  listConnectedAccounts(userId: string): Promise<ConnectedAccount[]>;
}

type AccountRow = {
  id: string;
  user_id: string;
  email: string;
  context: string;
  encrypted_refresh_token: string;
  scopes_json: string;
};

const exactReadOnlyScopes = new Set<string>(readOnlyScopes);

const parseScopes = (value: string): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Connected account must contain exact read-only scopes");
  }
  if (!Array.isArray(parsed) || parsed.some((scope) => typeof scope !== "string")) {
    throw new Error("Connected account must contain exact read-only scopes");
  }
  const unique = new Set(parsed);
  if (unique.size !== exactReadOnlyScopes.size || [...exactReadOnlyScopes].some((scope) => !unique.has(scope))) {
    throw new Error("Connected account must contain exact read-only scopes");
  }
  return [...readOnlyScopes];
};

export const createAccountRepository = (db: D1Database): AccountRepository => ({
  async findOwnerUserId(googleSubject) {
    const row = await db.prepare("SELECT id FROM users WHERE google_subject = ?").bind(googleSubject).first<{id: string}>();
    return row?.id ?? null;
  },

  async listConnectedAccounts(userId) {
    const result = await db.prepare(
      `SELECT id, user_id, email, context, encrypted_refresh_token, scopes_json
       FROM accounts
       WHERE user_id = ?
       ORDER BY CASE context WHEN 'personal' THEN 0 ELSE 1 END, id ASC`,
    ).bind(userId).all<AccountRow>();
    return result.results.map((row) => {
      if (row.context !== "personal" && row.context !== "work") throw new Error("Connected account context is invalid");
      return {
        id: row.id,
        userId: row.user_id,
        email: row.email,
        context: row.context,
        encryptedRefreshToken: row.encrypted_refresh_token,
        scopes: parseScopes(row.scopes_json),
      };
    });
  },
});

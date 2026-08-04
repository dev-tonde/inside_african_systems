import {applyD1Migrations, env} from "cloudflare:test";
import {beforeEach, describe, expect, it} from "vitest";
import {createGmailClient, GmailHistoryExpiredError, type GmailClient, type GmailMessage} from "../src/gmail/gmail-client";
import {normalizeGmailMessage} from "../src/gmail/normalize-message";
import {syncGmailAccount} from "../src/gmail/sync-gmail";
import {getGoogleAccessToken} from "../src/google/token-provider";
import {createEmailRepository, type EmailRepository} from "../src/repositories/email-repository";
import {encryptSecret} from "../src/security/crypto";

const now = new Date("2026-08-04T07:00:00.000Z");
const encryptionKey = btoa(String.fromCharCode(...Array.from({length: 32}, (_, index) => index)));
const testDb = (env as unknown as {DB: D1Database}).DB;

class FakeEmailRepository implements EmailRepository {
  cursor: string | null;
  readonly records: Array<ReturnType<typeof normalizeGmailMessage>> = [];

  constructor(cursor: string | null = null) {
    this.cursor = cursor;
  }

  async getCursor(): Promise<string | null> {
    return this.cursor;
  }

  async upsertRecords(records: Array<ReturnType<typeof normalizeGmailMessage>>): Promise<number> {
    let changed = 0;
    for (const record of records) {
      const existing = this.records.find((candidate) => candidate.providerMessageId === record.providerMessageId);
      if (!existing) {
        this.records.push(record);
        changed += 1;
      } else if (existing.sourceVersion !== record.sourceVersion) {
        this.records.splice(this.records.indexOf(existing), 1, record);
        changed += 1;
      }
    }
    return changed;
  }

  async setCursor(_accountId: string, cursor: string): Promise<void> {
    this.cursor = cursor;
  }
}

class FakeGmailClient implements GmailClient {
  constructor(
    private readonly input: {
      messages: GmailMessage[];
      nextCursor: string;
      historyExpired?: boolean;
    },
  ) {}

  async listRecentMessages(): Promise<GmailMessage[]> {
    return this.input.messages;
  }

  async listChangedMessages(): Promise<GmailMessage[]> {
    if (this.input.historyExpired) throw new GmailHistoryExpiredError();
    return this.input.messages;
  }

  async getCurrentHistoryId(): Promise<string> {
    return this.input.nextCursor;
  }
}

const gmailMessage = (id: string, historyId: string, secret = "") : GmailMessage => ({
  id,
  threadId: `thread-${id}`,
  historyId,
  internalDate: now.getTime().toString(),
  snippet: "Visible preview",
  payload: {
    headers: [
      {name: "From", value: "sender@example.com"},
      {name: "Subject", value: "Subject"},
    ],
  },
  // This deliberately models a provider response containing an out-of-contract
  // body field. The normalizer must never copy it into D1 records.
  ...({body: {data: secret}} as object),
});

const baseInput = (input: {client: GmailClient; repository: EmailRepository}) => ({
  accountId: "account-1",
  client: input.client,
  repository: input.repository,
  now,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});

describe("Gmail synchronization", () => {
  it("upserts the same provider message only once", async () => {
    const repository = new FakeEmailRepository();
    const result = await syncGmailAccount(baseInput({
      client: new FakeGmailClient({
        messages: [gmailMessage("m-1", "etag-1"), gmailMessage("m-1", "etag-1")],
        nextCursor: "history-10",
      }),
      repository,
    }));

    expect(result).toEqual({mode: "full", changed: 1, cursor: "history-10"});
    expect(repository.records).toHaveLength(1);
    expect(repository.cursor).toBe("history-10");
  });

  it("never persists a decoded message body", async () => {
    const repository = new FakeEmailRepository();
    await syncGmailAccount(baseInput({
      client: new FakeGmailClient({messages: [gmailMessage("m-2", "etag-2", "PRIVATE BODY")], nextCursor: "history-11"}),
      repository,
    }));

    expect(JSON.stringify(repository.records)).not.toContain("PRIVATE BODY");
  });

  it("falls back to a bounded full sync when history expires", async () => {
    const repository = new FakeEmailRepository("expired");
    const result = await syncGmailAccount(baseInput({
      client: new FakeGmailClient({historyExpired: true, messages: [], nextCursor: "history-12"}),
      repository,
    }));

    expect(result).toEqual({mode: "full", changed: 0, cursor: "history-12"});
    expect(repository.cursor).toBe("history-12");
  });

  it("uses delta mode for a current Gmail history cursor", async () => {
    const repository = new FakeEmailRepository("history-12");
    const result = await syncGmailAccount(baseInput({
      client: new FakeGmailClient({messages: [gmailMessage("m-3", "etag-3")], nextCursor: "history-13"}),
      repository,
    }));

    expect(result.mode).toBe("delta");
    expect(repository.records[0]?.providerMessageId).toBe("m-3");
  });
});

describe("Gmail API client", () => {
  it("paginates recent IDs and requests only message metadata", async () => {
    const requests: Array<{url: URL; init?: RequestInit}> = [];
    const fetcher = (async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(request));
      requests.push({url, init});
      if (url.pathname === "/gmail/v1/users/me/messages" && !url.searchParams.get("pageToken")) {
        return json({messages: [{id: "m-1"}], nextPageToken: "next"});
      }
      if (url.pathname === "/gmail/v1/users/me/messages" && url.searchParams.get("pageToken") === "next") {
        return json({messages: [{id: "m-2"}]});
      }
      if (url.pathname === "/gmail/v1/users/me/messages/m-1") return json(gmailMessage("m-1", "h-1"));
      if (url.pathname === "/gmail/v1/users/me/messages/m-2") return json(gmailMessage("m-2", "h-2"));
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch;

    const messages = await createGmailClient("access-token", fetcher).listRecentMessages("newer_than:7d");

    expect(messages.map((message) => message.id)).toEqual(["m-1", "m-2"]);
    const detailRequests = requests.filter(({url}) => /^\/gmail\/v1\/users\/me\/messages\/m-/u.test(url.pathname));
    expect(detailRequests).toHaveLength(2);
    for (const {url, init} of detailRequests) {
      expect(url.searchParams.get("format")).toBe("metadata");
      expect(url.searchParams.getAll("metadataHeaders")).toEqual(["From", "Subject"]);
      expect(init?.headers).toEqual({authorization: "Bearer access-token"});
      expect(url.searchParams.has("fields")).toBe(false);
    }
  });

  it("paginates history additions, deduplicates message IDs, and maps history 404 to expiry", async () => {
    const fetcher = (async (request: RequestInfo | URL) => {
      const url = new URL(String(request));
      if (url.pathname === "/gmail/v1/users/me/history" && !url.searchParams.get("pageToken")) {
        return json({history: [{messagesAdded: [{message: {id: "m-1"}}]}], nextPageToken: "next"});
      }
      if (url.pathname === "/gmail/v1/users/me/history" && url.searchParams.get("pageToken") === "next") {
        return json({history: [{messagesAdded: [{message: {id: "m-1"}}, {message: {id: "m-2"}}]}]});
      }
      if (url.pathname === "/gmail/v1/users/me/messages/m-1") return json(gmailMessage("m-1", "h-1"));
      if (url.pathname === "/gmail/v1/users/me/messages/m-2") return json(gmailMessage("m-2", "h-2"));
      throw new Error(`Unexpected request ${url}`);
    }) as typeof fetch;
    const client = createGmailClient("access-token", fetcher);

    await expect(client.listChangedMessages("history-1")).resolves.toHaveLength(2);

    const expiredClient = createGmailClient(
      "access-token",
      (async () => new Response(null, {status: 404})) as typeof fetch,
    );
    await expect(expiredClient.listChangedMessages("missing")).rejects.toBeInstanceOf(GmailHistoryExpiredError);
  });

  it("reads the profile history ID and redacts non-history API failures", async () => {
    const client = createGmailClient(
      "access-token",
      (async (request: RequestInfo | URL) => {
        const url = new URL(String(request));
        if (url.pathname.endsWith("/profile")) return json({historyId: "history-99"});
        return new Response("private upstream failure access-token", {status: 500});
      }) as typeof fetch,
    );

    await expect(client.getCurrentHistoryId()).resolves.toBe("history-99");
    await expect(client.listRecentMessages("newer_than:7d")).rejects.toThrow("Gmail request failed");
    await expect(client.listRecentMessages("newer_than:7d")).rejects.not.toThrow("access-token");
  });

  it("redacts transport failures that could otherwise include the bearer token", async () => {
    const client = createGmailClient(
      "access-token",
      (async () => {
        throw new Error("network diagnostic Bearer access-token");
      }) as typeof fetch,
    );

    await expect(client.listRecentMessages("newer_than:7d")).rejects.toThrow("Gmail request failed");
    await expect(client.listRecentMessages("newer_than:7d")).rejects.not.toThrow("access-token");
  });
});

describe("Google access-token refresh", () => {
  it("decrypts the refresh token transiently and posts the exact refresh grant", async () => {
    const encryptedRefreshToken = await encryptSecret("refresh-token", encryptionKey);
    let captured: {url: string; init?: RequestInit} | undefined;
    const accessToken = await getGoogleAccessToken({
      encryptedRefreshToken,
      encryptionKeyB64: encryptionKey,
      clientId: "client-id",
      clientSecret: "client-secret",
      fetcher: (async (request: RequestInfo | URL, init?: RequestInit) => {
        captured = {url: String(request), init};
        return json({access_token: "short-lived-access-token", expires_in: 3600});
      }) as typeof fetch,
    });

    expect(accessToken).toBe("short-lived-access-token");
    expect(captured?.url).toBe("https://oauth2.googleapis.com/token");
    expect(captured?.init?.method).toBe("POST");
    expect(captured?.init?.headers).toEqual({"content-type": "application/x-www-form-urlencoded"});
    expect(new URLSearchParams(String(captured?.init?.body))).toEqual(new URLSearchParams({
      client_id: "client-id",
      client_secret: "client-secret",
      grant_type: "refresh_token",
      refresh_token: "refresh-token",
    }));
  });

  it("redacts refresh failures and rejects missing access tokens", async () => {
    const encryptedRefreshToken = await encryptSecret("refresh-token", encryptionKey);
    const operation = getGoogleAccessToken({
      encryptedRefreshToken,
      encryptionKeyB64: encryptionKey,
      clientId: "client-id",
      clientSecret: "client-secret",
      fetcher: (async () => new Response("refresh-token and client-secret leaked", {status: 400})) as typeof fetch,
    });

    await expect(operation).rejects.toThrow("Google access token refresh failed");
    await expect(operation).rejects.not.toThrow("refresh-token");
    await expect(getGoogleAccessToken({
      encryptedRefreshToken,
      encryptionKeyB64: encryptionKey,
      clientId: "client-id",
      clientSecret: "client-secret",
      fetcher: (async () => json({})) as typeof fetch,
    })).rejects.toThrow("Google access token refresh failed");
  });

  it("redacts access-token refresh transport failures", async () => {
    const encryptedRefreshToken = await encryptSecret("refresh-token", encryptionKey);
    const operation = getGoogleAccessToken({
      encryptedRefreshToken,
      encryptionKeyB64: encryptionKey,
      clientId: "client-id",
      clientSecret: "client-secret",
      fetcher: (async () => {
        throw new Error("transport failed for refresh-token");
      }) as typeof fetch,
    });

    await expect(operation).rejects.toThrow("Google access token refresh failed");
    await expect(operation).rejects.not.toThrow("refresh-token");
  });
});

const emailRepositoryMigrations = [
  {
    name: "task7_gmail_repository_prerequisites.sql",
    queries: [
      "CREATE TABLE users (id TEXT PRIMARY KEY, google_subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL, time_zone TEXT NOT NULL, created_at TEXT NOT NULL)",
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), google_subject TEXT NOT NULL, email TEXT NOT NULL, context TEXT NOT NULL, encrypted_refresh_token TEXT NOT NULL, scopes_json TEXT NOT NULL, connected_at TEXT NOT NULL)",
      "CREATE TABLE email_records (account_id TEXT NOT NULL REFERENCES accounts(id), provider_message_id TEXT NOT NULL, thread_id TEXT NOT NULL, subject TEXT NOT NULL, sender TEXT NOT NULL, received_at TEXT NOT NULL, source_version TEXT NOT NULL, snippet TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (account_id, provider_message_id))",
      "CREATE TABLE sync_cursors (account_id TEXT NOT NULL REFERENCES accounts(id), provider TEXT NOT NULL, cursor TEXT, last_success_at TEXT, PRIMARY KEY (account_id, provider))",
    ],
  },
];

describe("D1 email repository", () => {
  beforeEach(async () => {
    await applyD1Migrations(testDb, emailRepositoryMigrations);
    await testDb.prepare("DELETE FROM email_records").run();
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

  it("updates metadata only when the provider source version changes and stores one Gmail cursor", async () => {
    const repository = createEmailRepository(testDb);
    const first = normalizeGmailMessage("account-1", gmailMessage("m-4", "history-1", "PRIVATE BODY"));
    const changed = {...first, sourceVersion: "history-2", subject: "Updated subject"};

    await expect(repository.getCursor("account-1")).resolves.toBeNull();
    await expect(repository.upsertRecords([first], now.toISOString())).resolves.toBe(1);
    await expect(repository.upsertRecords([first], now.toISOString())).resolves.toBe(0);
    await expect(repository.upsertRecords([changed], now.toISOString())).resolves.toBe(1);
    await repository.setCursor("account-1", "history-2", now.toISOString());
    await repository.setCursor("account-1", "history-3", now.toISOString());

    const row = await testDb
      .prepare("SELECT subject, source_version, snippet FROM email_records WHERE account_id = ? AND provider_message_id = ?")
      .bind("account-1", "m-4")
      .first<{subject: string; source_version: string; snippet: string}>();
    expect(row).toEqual({subject: "Updated subject", source_version: "history-2", snippet: "Visible preview"});
    await expect(repository.getCursor("account-1")).resolves.toBe("history-3");
  });
});

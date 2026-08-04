import {applyD1Migrations, env} from "cloudflare:test";
import type {DailyPlan} from "@lifeos/contracts";
import {beforeEach, describe, expect, it} from "vitest";
import {createAccountRepository} from "../src/repositories/account-repository";
import {createPlanRepository} from "../src/repositories/plan-repository";
import {createReadModelRepository} from "../src/repositories/read-model-repository";
import {createRunRepository} from "../src/repositories/run-repository";

const testDb = (env as unknown as {DB: D1Database}).DB;

const migrations = [
  {
    name: "refresh-test-schema.sql",
    queries: [
      "PRAGMA foreign_keys = ON",
      "CREATE TABLE users (id TEXT PRIMARY KEY, google_subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL, time_zone TEXT NOT NULL, created_at TEXT NOT NULL)",
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), google_subject TEXT NOT NULL, email TEXT NOT NULL, context TEXT NOT NULL, encrypted_refresh_token TEXT NOT NULL, scopes_json TEXT NOT NULL, connected_at TEXT NOT NULL, UNIQUE(user_id, context))",
      "CREATE TABLE email_records (account_id TEXT NOT NULL REFERENCES accounts(id), provider_message_id TEXT NOT NULL, thread_id TEXT NOT NULL, subject TEXT NOT NULL, sender TEXT NOT NULL, received_at TEXT NOT NULL, source_version TEXT NOT NULL, snippet TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(account_id, provider_message_id))",
      "CREATE TABLE email_classifications (account_id TEXT NOT NULL, provider_message_id TEXT NOT NULL, source_version TEXT NOT NULL, importance TEXT NOT NULL, workflow_state TEXT NOT NULL, life_priority TEXT NOT NULL, confidence REAL NOT NULL, explanation TEXT NOT NULL, classified_at TEXT NOT NULL, PRIMARY KEY(account_id, provider_message_id, source_version))",
      "CREATE TABLE calendar_events (account_id TEXT NOT NULL REFERENCES accounts(id), provider_event_id TEXT NOT NULL, title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, attendee_count INTEGER NOT NULL, source_version TEXT NOT NULL, location TEXT, organizer_email TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(account_id, provider_event_id))",
      "CREATE TABLE calendar_assessments (account_id TEXT NOT NULL, provider_event_id TEXT NOT NULL, source_version TEXT NOT NULL, category TEXT NOT NULL, life_priority TEXT NOT NULL, score REAL NOT NULL, confidence REAL NOT NULL, explanation TEXT NOT NULL, assessed_at TEXT NOT NULL, PRIMARY KEY(account_id, provider_event_id, source_version))",
      "CREATE TABLE daily_plans (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), local_date TEXT NOT NULL, revision INTEGER NOT NULL, generated_at TEXT NOT NULL, plan_json TEXT NOT NULL, UNIQUE(user_id, local_date, revision))",
      "CREATE TABLE daily_plan_revisions (user_id TEXT NOT NULL REFERENCES users(id), local_date TEXT NOT NULL, next_revision INTEGER NOT NULL, PRIMARY KEY(user_id, local_date))",
      "CREATE TABLE agent_runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), agent TEXT NOT NULL, mode TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL, input_refs_json TEXT NOT NULL, result_json TEXT, error_code TEXT)",
      "CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), severity TEXT NOT NULL, dedupe_key TEXT NOT NULL, safe_summary TEXT NOT NULL, created_at TEXT NOT NULL, acknowledged_at TEXT, UNIQUE(user_id, dedupe_key))",
      "CREATE TABLE refresh_leases (user_id TEXT PRIMARY KEY REFERENCES users(id), run_id TEXT NOT NULL, expires_at TEXT NOT NULL)",
    ],
  },
];

const plan = (revision: number): DailyPlan => ({
  id: `plan-owner-a-2026-08-03-${revision}`,
  localDate: "2026-08-03",
  timeZone: "Africa/Johannesburg",
  revision,
  generatedAt: `2026-08-03T05:0${revision}:00.000Z`,
  weekendMode: false,
  priorities: [],
  decisions: [],
  timeline: [],
});

describe("refresh D1 repositories", () => {
  beforeEach(async () => {
    await applyD1Migrations(testDb, migrations);
    await testDb.batch([
      testDb.prepare("DELETE FROM notifications"),
      testDb.prepare("DELETE FROM refresh_leases"),
      testDb.prepare("DELETE FROM agent_runs"),
      testDb.prepare("DELETE FROM daily_plans"),
      testDb.prepare("DELETE FROM daily_plan_revisions"),
      testDb.prepare("DELETE FROM calendar_assessments"),
      testDb.prepare("DELETE FROM calendar_events"),
      testDb.prepare("DELETE FROM email_classifications"),
      testDb.prepare("DELETE FROM email_records"),
      testDb.prepare("DELETE FROM accounts"),
      testDb.prepare("DELETE FROM users"),
    ]);
    await testDb.batch([
      testDb.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)").bind("owner-a", "google-a", "a@example.com", "Africa/Johannesburg", "2026-08-03T00:00:00.000Z"),
      testDb.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)").bind("owner-b", "google-b", "b@example.com", "Africa/Johannesburg", "2026-08-03T00:00:00.000Z"),
      testDb.prepare("INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
        "account-a", "owner-a", "account-google-a", "account-a@example.com", "personal", "cipher-a",
        JSON.stringify(["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly"]),
        "2026-08-03T00:00:00.000Z",
      ),
      testDb.prepare("INSERT INTO accounts VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(
        "account-b", "owner-b", "account-google-b", "account-b@example.com", "work", "cipher-b",
        JSON.stringify(["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly"]),
        "2026-08-03T00:00:00.000Z",
      ),
    ]);
  });

  it("loads only the requested owner's exact read-only connected accounts", async () => {
    const repository = createAccountRepository(testDb);

    await expect(repository.findOwnerUserId("google-a")).resolves.toBe("owner-a");
    await expect(repository.listConnectedAccounts("owner-a")).resolves.toEqual([{
      id: "account-a",
      userId: "owner-a",
      email: "account-a@example.com",
      context: "personal",
      encryptedRefreshToken: "cipher-a",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly"],
    }]);
  });

  it("rejects malformed or write-capable stored account scopes", async () => {
    await testDb.prepare("UPDATE accounts SET scopes_json = ? WHERE id = ?")
      .bind(JSON.stringify(["https://www.googleapis.com/auth/gmail.modify"]), "account-a")
      .run();

    await expect(createAccountRepository(testDb).listConnectedAccounts("owner-a")).rejects.toThrow("read-only scopes");
  });

  it("allocates unique monotonic revisions under concurrent requests and never updates an old plan", async () => {
    const repository = createPlanRepository(testDb);
    const revisions = await Promise.all(Array.from({length: 5}, () => repository.nextRevision("owner-a", "2026-08-03")));
    expect([...revisions].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);

    await repository.save(plan(1), "owner-a");
    await expect(repository.save({...plan(1), generatedAt: "2026-08-03T09:00:00.000Z"}, "owner-a")).rejects.toThrow();
    await expect(repository.getLatest("owner-a", "2026-08-03")).resolves.toEqual(plan(1));
    await expect(repository.getLatest("owner-b", "2026-08-03")).resolves.toBeNull();
  });

  it("claims one run id once and prevents overlapping user leases", async () => {
    const repository = createRunRepository(testDb);
    const input = {id: "refresh:owner-a:2026-08-03T07:00", userId: "owner-a", mode: "full" as const, startedAt: "2026-08-03T05:00:00.000Z"};

    await expect(repository.begin(input)).resolves.toBe("started");
    await expect(repository.begin(input)).resolves.toBe("exists");
    await expect(repository.acquireUserLease("owner-a", input.id, input.startedAt, "2026-08-03T05:10:00.000Z")).resolves.toBe(true);
    await expect(repository.acquireUserLease("owner-a", "another-run", "2026-08-03T05:01:00.000Z", "2026-08-03T05:11:00.000Z")).resolves.toBe(false);
    await repository.releaseUserLease("owner-a", input.id);
    await expect(repository.acquireUserLease("owner-a", "another-run", "2026-08-03T05:01:00.000Z", "2026-08-03T05:11:00.000Z")).resolves.toBe(true);
  });

  it("atomically persists an immutable plan, deduplicated notification, and completed run result", async () => {
    const runs = createRunRepository(testDb);
    const plans = createPlanRepository(testDb);
    const runId = "refresh:owner-a:2026-08-03T07:00";
    await runs.begin({id: runId, userId: "owner-a", mode: "full", startedAt: "2026-08-03T05:00:00.000Z"});
    const result = {revision: 1, envelope: {revision: 1, generatedAt: "2026-08-03T05:01:00.000Z", importance: "high", changedCounts: {email: 1, calendar: 0}}};
    const commit = {
      plan: plan(1),
      userId: "owner-a",
      notification: {id: `notification:${runId}`, dedupeKey: runId, severity: "high" as const, safeSummary: "Important LifeOS changes are ready.", createdAt: "2026-08-03T05:01:00.000Z"},
      run: {id: runId, status: "completed" as const, result, completedAt: "2026-08-03T05:01:00.000Z"},
    };

    await runs.completeWithPlan(commit);
    await expect(runs.find(runId)).resolves.toMatchObject({status: "completed", result});
    await expect(plans.getLatest("owner-a", "2026-08-03")).resolves.toEqual(plan(1));
    await expect(plans.getRefreshEnvelope("owner-a", 0)).resolves.toEqual(result.envelope);
    await expect(plans.getRefreshEnvelope("owner-a", 1)).resolves.toBeNull();
    await expect(runs.completeWithPlan(commit)).rejects.toThrow();
    const count = await testDb.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?").bind("owner-a").first<{count: number}>();
    expect(count?.count).toBe(1);
  });

  it("writes no plan or notification when the run no longer owns a running claim", async () => {
    const runs = createRunRepository(testDb);
    const plans = createPlanRepository(testDb);
    const runId = "refresh:owner-a:2026-08-03T07:00";
    await runs.begin({id: runId, userId: "owner-a", mode: "full", startedAt: "2026-08-03T05:00:00.000Z"});
    await runs.complete({
      id: runId,
      status: "failed",
      result: {code: "cancelled"},
      completedAt: "2026-08-03T05:00:30.000Z",
      errorCode: "cancelled",
    });

    await expect(runs.completeWithPlan({
      plan: plan(1),
      userId: "owner-a",
      notification: {
        id: `notification:${runId}`,
        dedupeKey: runId,
        severity: "high",
        safeSummary: "Important LifeOS changes are ready.",
        createdAt: "2026-08-03T05:01:00.000Z",
      },
      run: {
        id: runId,
        status: "completed",
        result: {revision: 1},
        completedAt: "2026-08-03T05:01:00.000Z",
      },
    })).rejects.toThrow("claim");
    await expect(plans.getLatest("owner-a", "2026-08-03")).resolves.toBeNull();
    const count = await testDb.prepare("SELECT COUNT(*) AS count FROM notifications WHERE user_id = ?")
      .bind("owner-a")
      .first<{count: number}>();
    expect(count?.count).toBe(0);
  });

  it("joins only current source versions into owner-isolated read models", async () => {
    await testDb.batch([
      testDb.prepare("INSERT INTO email_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("account-a", "message-a", "thread-a", "Owner A", "sender@example.com", "2026-08-03T04:00:00.000Z", "v2", "snippet", "2026-08-03T04:00:00.000Z"),
      testDb.prepare("INSERT INTO email_classifications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("account-a", "message-a", "v1", "critical", "reply", "primary_job_or_business", 0.9, "stale", "2026-08-03T04:00:00.000Z"),
      testDb.prepare("INSERT INTO email_classifications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("account-a", "message-a", "v2", "high", "reply", "primary_job_or_business", 0.9, "current", "2026-08-03T04:01:00.000Z"),
      testDb.prepare("INSERT INTO email_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("account-b", "message-b", "thread-b", "Owner B", "sender@example.com", "2026-08-03T04:00:00.000Z", "v1", "snippet", "2026-08-03T04:00:00.000Z"),
      testDb.prepare("INSERT INTO email_classifications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("account-b", "message-b", "v1", "critical", "reply", "primary_job_or_business", 0.9, "foreign", "2026-08-03T04:01:00.000Z"),
    ]);
    const repository = createReadModelRepository(testDb);

    const inbox = await repository.listInbox("owner-a", {limit: 20});
    const planInputs = await repository.loadPlanInputs("owner-a", ["account-a"], "2026-08-03T00:00:00.000Z", "2026-08-04T00:00:00.000Z");

    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.record.subject).toBe("Owner A");
    expect(inbox[0]?.classification.explanation).toBe("current");
    expect(planInputs.emails).toHaveLength(1);
  });

  it("rejects unsafe read-model limits, cursors, account lists, and windows", async () => {
    const repository = createReadModelRepository(testDb);
    await expect(repository.listInbox("owner-a", {limit: 0})).rejects.toThrow("limit");
    await expect(repository.listInbox("owner-a", {limit: 20, after: "not-an-instant"})).rejects.toThrow("after");
    await expect(repository.loadPlanInputs("owner-a", [], "2026-08-03T00:00:00.000Z", "2026-08-04T00:00:00.000Z")).rejects.toThrow("account");
    await expect(repository.loadPlanInputs("owner-a", ["account-a"], "2026-08-04T00:00:00.000Z", "2026-08-03T00:00:00.000Z")).rejects.toThrow("window");
  });
});

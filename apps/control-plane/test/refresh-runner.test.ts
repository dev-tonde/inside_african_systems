import type {
  CalendarAssessment,
  CalendarEvent,
  DailyPlan,
  EmailClassification,
  EmailRecord,
} from "@lifeos/contracts";
import {describe, expect, it} from "vitest";
import type {CalendarClient} from "../src/calendar/calendar-client";
import type {GmailClient} from "../src/gmail/gmail-client";
import type {ConnectedAccount} from "../src/repositories/account-repository";
import type {StoredRun} from "../src/repositories/run-repository";
import {
  deterministicRunId,
  runRefresh,
  type RefreshDependencies,
  type RefreshResult,
} from "../src/planning/run-refresh";

const userId = "owner:one";
const accounts: ConnectedAccount[] = [
  {
    id: "account-personal",
    userId,
    email: "personal@example.com",
    context: "personal",
    encryptedRefreshToken: "encrypted-personal",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
  },
  {
    id: "account-work",
    userId,
    email: "work@example.com",
    context: "work",
    encryptedRefreshToken: "encrypted-work",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
    ],
  },
];

const classification = (accountId: string, providerMessageId: string, importance: EmailClassification["importance"]): EmailClassification => ({
  accountId,
  providerMessageId,
  sourceVersion: "email-v1",
  importance,
  workflowState: "reply",
  lifePriority: "primary_job_or_business",
  confidence: 0.9,
  explanation: "Fixture classification",
  classifiedAt: "2026-08-03T05:00:00.000Z",
});

const email = (accountId: string, providerMessageId = "message-1"): EmailRecord => ({
  accountId,
  providerMessageId,
  threadId: "thread-1",
  subject: "Decision required",
  sender: "sender@example.com",
  receivedAt: "2026-08-03T04:45:00.000Z",
  sourceVersion: "email-v1",
  snippet: "Fixture",
});

const event = (accountId: string, startsAt = "2026-08-03T06:00:00.000Z"): CalendarEvent => ({
  accountId,
  providerEventId: "event-1",
  title: "Protected meeting",
  startsAt,
  endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
  attendeeCount: 3,
  sourceVersion: "event-v1",
});

const assessment = (accountId: string, startsAt = "2026-08-03T06:00:00.000Z"): {event: CalendarEvent; assessment: CalendarAssessment} => ({
  event: event(accountId, startsAt),
  assessment: {
    accountId,
    providerEventId: "event-1",
    sourceVersion: "event-v1",
    category: "protect",
    lifePriority: "inside_african_systems",
    score: 90,
    confidence: 0.9,
    explanation: "Fixture assessment",
    assessedAt: "2026-08-03T05:00:00.000Z",
  },
});

type HarnessOptions = {
  now?: string;
  failedAccount?: string;
  emailImportance?: EmailClassification["importance"];
  eventStartsAt?: string;
  noCurrentData?: boolean;
  existingRun?: StoredRun;
};

const harness = (options: HarnessOptions = {}) => {
  const now = options.now ?? "2026-08-03T05:00:00.000Z";
  const storedRuns = new Map<string, StoredRun>();
  if (options.existingRun) storedRuns.set(options.existingRun.id, structuredClone(options.existingRun));
  const plans: DailyPlan[] = [];
  const notifications: Array<{dedupeKey: string; severity: string}> = [];
  const classificationSaves: EmailClassification[] = [];
  const assessmentSaves: CalendarAssessment[] = [];
  const syncModes: Array<{accountId: string; forceFull: boolean}> = [];
  const decryptedTokens: string[] = [];
  let revision = 0;
  let lease: string | null = null;

  const deps: RefreshDependencies = {
    now: () => new Date(now),
    accounts: {
      async findOwnerUserId() {
        return userId;
      },
      async listConnectedAccounts(requestedUserId) {
        return requestedUserId === userId ? structuredClone(accounts) : [];
      },
    },
    plans: {
      async nextRevision(requestedUserId) {
        if (requestedUserId !== userId) throw new Error("wrong user");
        revision += 1;
        return revision;
      },
      async save(plan) {
        plans.push(structuredClone(plan));
      },
      async getLatest() {
        return plans.at(-1) ?? null;
      },
      async getRefreshEnvelope() {
        return null;
      },
    },
    runs: {
      async begin(input) {
        if (storedRuns.has(input.id)) return "exists";
        storedRuns.set(input.id, {
          ...input,
          status: "running",
          completedAt: null,
          result: null,
          errorCode: null,
        });
        return "started";
      },
      async restart(input) {
        const current = storedRuns.get(input.id);
        if (!current || current.status !== "failed") return false;
        storedRuns.set(input.id, {...current, status: "running", startedAt: input.startedAt, completedAt: null, result: null, errorCode: null});
        return true;
      },
      async acquireUserLease(requestedUserId, runId) {
        if (requestedUserId !== userId) return false;
        if (lease) return false;
        lease = runId;
        return true;
      },
      async releaseUserLease(requestedUserId, runId) {
        if (requestedUserId === userId && lease === runId) lease = null;
      },
      async complete(input) {
        const current = storedRuns.get(input.id);
        if (!current) throw new Error("missing run");
        storedRuns.set(input.id, {...current, status: input.status, result: input.result, completedAt: input.completedAt, errorCode: input.errorCode ?? null});
      },
      async completeWithPlan(input) {
        const current = storedRuns.get(input.run.id);
        if (!current) throw new Error("missing run");
        plans.push(structuredClone(input.plan));
        notifications.push({dedupeKey: input.notification.dedupeKey, severity: input.notification.severity});
        storedRuns.set(input.run.id, {
          ...current,
          status: input.run.status,
          result: structuredClone(input.run.result),
          completedAt: input.run.completedAt,
          errorCode: null,
        });
      },
      async find(id) {
        return structuredClone(storedRuns.get(id) ?? null);
      },
    },
    emailRepository: {
      async getCursor() { return null; },
      async upsertRecords() { return 1; },
      async setCursor() {},
    },
    calendarRepository: {
      async getCursor() { return null; },
      async upsertEvents() { return 1; },
      async deleteEvents() { return 0; },
      async setCursor() {},
    },
    classifications: {
      async saveEmailClassification(value) {
        classificationSaves.push(structuredClone(value));
      },
      async saveCalendarAssessment(value) {
        assessmentSaves.push(structuredClone(value));
      },
      async listEmailsNeedingClassification(accountId) {
        return classificationSaves.some((value) => value.accountId === accountId) ? [] : [email(accountId)];
      },
      async listEventsNeedingAssessment(accountId) {
        return assessmentSaves.some((value) => value.accountId === accountId) ? [] : [event(accountId, options.eventStartsAt)];
      },
    },
    readModels: {
      async listInbox() { return []; },
      async listCalendar() { return []; },
      async loadPlanInputs(requestedUserId, accountIds) {
        if (requestedUserId !== userId || options.noCurrentData) return {emails: [], events: []};
        return {
          emails: accountIds.map((accountId) => ({
            record: email(accountId),
            classification: classification(accountId, "message-1", options.emailImportance ?? "high"),
          })),
          events: accountIds.map((accountId) => assessment(accountId, options.eventStartsAt)),
        };
      },
    },
    async getAccessToken(account) {
      decryptedTokens.push(account.encryptedRefreshToken);
      return `access-${account.id}`;
    },
    createGmailClient(accessToken): GmailClient {
      const accountId = accessToken.replace("access-", "");
      return {
        async listRecentMessages() {
          if (accountId === options.failedAccount) throw new Error(`secret from ${accountId}`);
          return {messages: [], checkpoint: "gmail-next"};
        },
        async listChangedMessages() {
          if (accountId === options.failedAccount) throw new Error(`secret from ${accountId}`);
          return {messages: [], checkpoint: "gmail-next"};
        },
      };
    },
    createCalendarClient(accessToken): CalendarClient {
      const accountId = accessToken.replace("access-", "");
      return {
        async listInitial() {
          syncModes.push({accountId, forceFull: true});
          return {events: [], nextSyncToken: "calendar-next"};
        },
        async listDelta() {
          syncModes.push({accountId, forceFull: false});
          return {events: [], nextSyncToken: "calendar-next"};
        },
      };
    },
    modelClient: {
      async generateJson(request) {
        if (request.schemaName === "email_classification") {
          return {
            importance: options.emailImportance ?? "high",
            workflowState: "reply",
            lifePriority: "primary_job_or_business",
            confidence: 0.9,
            explanation: "Fixture model result",
          };
        }
        return {
          category: "protect",
          lifePriority: "inside_african_systems",
          score: 90,
          confidence: 0.9,
          explanation: "Fixture model result",
        };
      },
    },
  };

  return {deps, plans, notifications, storedRuns, classificationSaves, assessmentSaves, syncModes, decryptedTokens};
};

const runAt = async (instant: string, options: Omit<HarnessOptions, "now"> = {}): Promise<RefreshResult> => {
  const test = harness({...options, now: instant});
  return runRefresh({userId, trigger: "scheduled", scheduledAt: new Date(instant)}, test.deps);
};

describe("refresh runner", () => {
  it("runs a full reconciliation only at 07:00 Johannesburg time", async () => {
    await expect(runAt("2026-08-03T05:00:00.000Z")).resolves.toMatchObject({mode: "full"});
    await expect(runAt("2026-08-03T05:30:00.000Z")).resolves.toMatchObject({mode: "delta"});
    await expect(runAt("2026-08-03T17:00:00.000Z")).resolves.toMatchObject({mode: "delta"});
  });

  it("rejects times outside exact scheduled slots", async () => {
    await expect(runAt("2026-08-03T05:01:00.000Z")).rejects.toThrow("scheduled refresh slot");
    await expect(runAt("2026-08-03T17:30:00.000Z")).rejects.toThrow("scheduled refresh slot");
  });

  it("uses encoded deterministic Johannesburg slot identifiers", () => {
    expect(deterministicRunId(userId, new Date("2026-08-03T05:00:00.000Z"), "scheduled")).toBe(
      "refresh:owner%3Aone:2026-08-03T07:00",
    );
    expect(deterministicRunId(userId, new Date("2026-08-03T05:08:59.000Z"), "manual")).toBe(
      "refresh:owner%3Aone:2026-08-03T07:05",
    );
  });

  it("marks a repeated completed invocation as reused without writing another plan", async () => {
    const test = harness({now: "2026-08-03T06:00:00.000Z"});
    const input = {userId, trigger: "scheduled" as const, scheduledAt: new Date("2026-08-03T06:00:00.000Z")};

    const first = await runRefresh(input, test.deps);
    const second = await runRefresh(input, test.deps);

    expect(second).toEqual({...first, reused: true});
    expect(test.plans).toHaveLength(1);
    expect(test.notifications).toHaveLength(1);
  });

  it("continues with one account and records only redacted error codes when the other is degraded", async () => {
    const test = harness({now: "2026-08-03T05:00:00.000Z", failedAccount: "account-work"});

    const result = await runRefresh({userId, trigger: "scheduled", scheduledAt: new Date("2026-08-03T05:00:00.000Z")}, test.deps);

    expect(result).toMatchObject({
      status: "degraded",
      completedAccounts: ["personal"],
      failedAccounts: [{context: "work", code: "account_sync_failed"}],
    });
    expect(JSON.stringify(result)).not.toContain("secret from");
    expect(test.plans[0]?.priorities.every((item) => item.context === "personal")).toBe(true);
  });

  it("does not save a plan when no account produces usable current data", async () => {
    const test = harness({now: "2026-08-03T05:00:00.000Z", noCurrentData: true});

    await expect(runRefresh(
      {userId, trigger: "scheduled", scheduledAt: new Date("2026-08-03T05:00:00.000Z")},
      test.deps,
    )).rejects.toThrow("No usable current data");
    expect(test.plans).toEqual([]);
    expect([...test.storedRuns.values()][0]?.status).toBe("failed");
  });

  it("classifies only source versions that do not already have saved results", async () => {
    const test = harness({now: "2026-08-03T06:00:00.000Z"});
    const firstTime = new Date("2026-08-03T06:00:00.000Z");
    const secondTime = new Date("2026-08-03T06:30:00.000Z");

    await runRefresh({userId, trigger: "scheduled", scheduledAt: firstTime}, test.deps);
    await runRefresh({userId, trigger: "scheduled", scheduledAt: secondTime}, test.deps);

    expect(test.classificationSaves).toHaveLength(2);
    expect(test.assessmentSaves).toHaveLength(2);
  });

  it("computes critical for a new critical email or protected event within two hours", async () => {
    await expect(runAt("2026-08-03T05:00:00.000Z", {emailImportance: "critical"})).resolves.toMatchObject({importance: "critical"});
    await expect(runAt("2026-08-03T05:00:00.000Z", {emailImportance: "normal", eventStartsAt: "2026-08-03T06:30:00.000Z"}))
      .resolves.toMatchObject({importance: "critical"});
  });

  it("computes high for new high email and routine when no new item is urgent", async () => {
    await expect(runAt("2026-08-03T05:00:00.000Z", {emailImportance: "high", eventStartsAt: "2026-08-04T08:00:00.000Z"}))
      .resolves.toMatchObject({importance: "high"});
    await expect(runAt("2026-08-03T05:00:00.000Z", {emailImportance: "normal", eventStartsAt: "2026-08-04T08:00:00.000Z"}))
      .resolves.toMatchObject({importance: "routine"});
  });

  it("sets weekend mode using Johannesburg rather than UTC date", async () => {
    const test = harness({now: "2026-08-07T22:00:00.000Z"});
    const result = await runRefresh({
      userId,
      trigger: "manual",
      scheduledAt: new Date("2026-08-07T22:00:00.000Z"),
    }, test.deps);
    expect(result).toMatchObject({localDate: "2026-08-08", weekendMode: true});
  });

  it("keeps access tokens transient and forces both connectors to use the selected mode", async () => {
    const test = harness({now: "2026-08-03T05:00:00.000Z"});

    const result = await runRefresh({userId, trigger: "scheduled", scheduledAt: new Date("2026-08-03T05:00:00.000Z")}, test.deps);

    expect(test.decryptedTokens).toEqual(["encrypted-personal", "encrypted-work"]);
    expect(test.syncModes).toEqual([
      {accountId: "account-personal", forceFull: true},
      {accountId: "account-work", forceFull: true},
    ]);
    expect(JSON.stringify(result)).not.toContain("access-account");
    expect(JSON.stringify(result)).not.toContain("encrypted-");
  });

  it("retries a failed claim but reuses a completed claim", async () => {
    const at = new Date("2026-08-03T06:00:00.000Z");
    const id = deterministicRunId(userId, at, "scheduled");
    const failed = harness({
      now: at.toISOString(),
      existingRun: {
        id,
        userId,
        mode: "delta",
        startedAt: "2026-08-03T05:59:00.000Z",
        completedAt: "2026-08-03T05:59:30.000Z",
        status: "failed",
        result: {code: "previous_failure"},
        errorCode: "previous_failure",
      },
    });

    const result = await runRefresh({userId, trigger: "scheduled", scheduledAt: at}, failed.deps);
    expect(result.reused).toBe(false);
    expect(result.status).toBe("completed");
  });

  it("returns an in-progress result instead of overlapping a user refresh", async () => {
    const at = new Date("2026-08-03T06:00:00.000Z");
    const id = deterministicRunId(userId, at, "scheduled");
    const test = harness({
      now: at.toISOString(),
      existingRun: {
        id,
        userId,
        mode: "delta",
        startedAt: at.toISOString(),
        completedAt: null,
        status: "running",
        result: null,
        errorCode: null,
      },
    });
    await test.deps.runs.acquireUserLease(userId, id, at.toISOString(), "2026-08-03T06:10:00.000Z");

    await expect(runRefresh({userId, trigger: "scheduled", scheduledAt: at}, test.deps)).resolves.toMatchObject({
      runId: id,
      status: "running",
      reused: true,
    });
    expect(test.plans).toEqual([]);
  });
});

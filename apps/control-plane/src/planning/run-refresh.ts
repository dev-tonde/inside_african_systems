import type {
  CalendarAssessment,
  CalendarEvent,
  EmailClassification,
  RefreshEnvelope,
} from "@lifeos/contracts";
import type {ModelClient} from "../ai/model-client";
import {assessCalendarEvent} from "../ai/assess-calendar";
import {classifyEmail} from "../ai/classify-email";
import type {CalendarClient} from "../calendar/calendar-client";
import {syncCalendarAccount} from "../calendar/sync-calendar";
import type {GmailClient} from "../gmail/gmail-client";
import {syncGmailAccount} from "../gmail/sync-gmail";
import type {AccountRepository, ConnectedAccount} from "../repositories/account-repository";
import type {CalendarRepository} from "../repositories/calendar-repository";
import type {ClassificationRepository} from "../repositories/classification-repository";
import type {EmailRepository} from "../repositories/email-repository";
import type {PlanRepository} from "../repositories/plan-repository";
import type {ReadModelRepository} from "../repositories/read-model-repository";
import type {RunRepository} from "../repositories/run-repository";
import {buildDailyPlan} from "./build-daily-plan";

export type RefreshTrigger = "scheduled" | "manual";
export type RefreshMode = "full" | "delta";
export type RefreshImportance = "routine" | "high" | "critical";

export type RefreshResult = {
  runId: string;
  mode: RefreshMode;
  status: "running" | "completed" | "degraded";
  reused: boolean;
  localDate: string;
  weekendMode: boolean;
  completedAccounts: Array<"personal" | "work">;
  failedAccounts: Array<{context: "personal" | "work"; code: "account_sync_failed"}>;
  changedCounts: {email: number; calendar: number};
  revision: number | null;
  importance: RefreshImportance;
  envelope: RefreshEnvelope | null;
};

export type RefreshDependencies = {
  now: () => Date;
  accounts: AccountRepository;
  plans: PlanRepository;
  runs: RunRepository;
  emailRepository: EmailRepository;
  calendarRepository: CalendarRepository;
  classifications: ClassificationRepository;
  readModels: ReadModelRepository;
  getAccessToken(account: ConnectedAccount): Promise<string>;
  createGmailClient(accessToken: string): GmailClient;
  createCalendarClient(accessToken: string): CalendarClient;
  modelClient: ModelClient;
};

export type RunRefreshInput = {
  userId: string;
  trigger: RefreshTrigger;
  scheduledAt: Date;
};

type JohannesburgParts = {
  localDate: string;
  hour: number;
  minute: number;
  second: number;
};

const johannesburgFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const johannesburgParts = (instant: Date): JohannesburgParts => {
  if (!Number.isFinite(instant.getTime())) throw new RangeError("Refresh time must be valid");
  const parts = Object.fromEntries(
    johannesburgFormatter.formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  if (!year || !month || !day) throw new Error("Johannesburg time conversion failed");
  return {
    localDate: `${year}-${month}-${day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

export const johannesburgDate = (instant: Date): string => johannesburgParts(instant).localDate;

const localSlot = (instant: Date, trigger: RefreshTrigger): string => {
  const parts = johannesburgParts(instant);
  const minute = trigger === "manual" ? Math.floor(parts.minute / 5) * 5 : parts.minute;
  return `${parts.localDate}T${String(parts.hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export const deterministicRunId = (userId: string, instant: Date, trigger: RefreshTrigger): string =>
  `refresh:${encodeURIComponent(userId)}:${localSlot(instant, trigger)}`;

const assertScheduledSlot = (instant: Date): void => {
  const parts = johannesburgParts(instant);
  const regular = parts.hour >= 7 && parts.hour <= 18 && (parts.minute === 0 || parts.minute === 30);
  const final = parts.hour === 19 && parts.minute === 0;
  if ((!regular && !final) || parts.second !== 0 || instant.getUTCMilliseconds() !== 0) {
    throw new RangeError("Time is not an exact scheduled refresh slot");
  }
};

const modeAt = (instant: Date): RefreshMode => {
  const parts = johannesburgParts(instant);
  return parts.hour === 7 && parts.minute === 0 ? "full" : "delta";
};

const isWeekend = (localDate: string): boolean => {
  const day = new Date(`${localDate}T12:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
};

const localDayWindow = (localDate: string): {from: string; to: string} => {
  const from = new Date(`${localDate}T00:00:00+02:00`);
  return {from: from.toISOString(), to: new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString()};
};

const assessmentWindow = (instant: Date): {from: string; to: string} => ({
  from: instant.toISOString(),
  to: new Date(instant.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
});

const importanceOf = (
  emails: EmailClassification[],
  events: Array<{event: CalendarEvent; assessment: CalendarAssessment}>,
  now: Date,
): RefreshImportance => {
  if (emails.some((email) => email.importance === "critical")) return "critical";
  const twoHours = now.getTime() + 2 * 60 * 60 * 1000;
  if (events.some(({event, assessment}) => {
    const start = Date.parse(event.startsAt);
    return assessment.category === "protect" && start >= now.getTime() && start <= twoHours;
  })) return "critical";
  if (emails.some((email) => email.importance === "high")) return "high";
  const localDate = johannesburgDate(now);
  if (events.some(({event, assessment}) =>
    assessment.category === "protect" && johannesburgDate(new Date(event.startsAt)) === localDate,
  )) return "high";
  return "routine";
};

const isReusableResult = (value: unknown, runId: string): value is RefreshResult => {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Partial<RefreshResult>;
  return result.runId === runId && (result.status === "completed" || result.status === "degraded") && typeof result.reused === "boolean";
};

const runningResult = (
  runId: string,
  mode: RefreshMode,
  localDate: string,
  weekendMode: boolean,
): RefreshResult => ({
  runId,
  mode,
  status: "running",
  reused: true,
  localDate,
  weekendMode,
  completedAccounts: [],
  failedAccounts: [],
  changedCounts: {email: 0, calendar: 0},
  revision: null,
  importance: "routine",
  envelope: null,
});

const synchronizeAndClassify = async (
  account: ConnectedAccount,
  forceFull: boolean,
  now: Date,
  dependencies: RefreshDependencies,
): Promise<{
  changedEmail: number;
  changedCalendar: number;
  newEmailClassifications: EmailClassification[];
  newEventAssessments: Array<{event: CalendarEvent; assessment: CalendarAssessment}>;
}> => {
  const accessToken = await dependencies.getAccessToken(account);
  const [gmail, calendar] = await Promise.all([
    syncGmailAccount({
      accountId: account.id,
      client: dependencies.createGmailClient(accessToken),
      repository: dependencies.emailRepository,
      now,
      forceFull,
    }),
    syncCalendarAccount({
      accountId: account.id,
      client: dependencies.createCalendarClient(accessToken),
      repository: dependencies.calendarRepository,
      now,
      forceFull,
    }),
  ]);

  const pendingEmails = await dependencies.classifications.listEmailsNeedingClassification(account.id, 100);
  const window = assessmentWindow(now);
  const pendingEvents = await dependencies.classifications.listEventsNeedingAssessment(account.id, window.from, window.to);
  const newEmailClassifications: EmailClassification[] = [];
  for (const record of pendingEmails) {
    const {classification} = await classifyEmail(record, dependencies.modelClient, now, {accountId: account.id});
    await dependencies.classifications.saveEmailClassification(classification);
    newEmailClassifications.push(classification);
  }
  const newEventAssessments: Array<{event: CalendarEvent; assessment: CalendarAssessment}> = [];
  for (const event of pendingEvents) {
    const {assessment} = await assessCalendarEvent(event, dependencies.modelClient, now, {accountId: account.id});
    await dependencies.classifications.saveCalendarAssessment(assessment);
    newEventAssessments.push({event, assessment});
  }
  return {
    changedEmail: gmail.changed,
    changedCalendar: calendar.changed + calendar.deleted,
    newEmailClassifications,
    newEventAssessments,
  };
};

export const runRefresh = async (input: RunRefreshInput, dependencies: RefreshDependencies): Promise<RefreshResult> => {
  const executionTime = new Date(input.scheduledAt.getTime());
  if (input.trigger === "scheduled") assertScheduledSlot(executionTime);
  const mode = modeAt(executionTime);
  const localDate = johannesburgDate(executionTime);
  const weekendMode = isWeekend(localDate);
  const runId = deterministicRunId(input.userId, executionTime, input.trigger);
  const startedAt = dependencies.now().toISOString();
  const claim = await dependencies.runs.begin({id: runId, userId: input.userId, mode, startedAt});

  if (claim === "exists") {
    const existing = await dependencies.runs.find(runId);
    if (!existing || existing.userId !== input.userId || existing.mode !== mode) throw new Error("Existing refresh claim is invalid");
    if ((existing.status === "completed" || existing.status === "degraded") && isReusableResult(existing.result, runId)) {
      return {...existing.result, reused: true};
    }
    if (existing.status === "failed") {
      const restarted = await dependencies.runs.restart({id: runId, startedAt});
      if (!restarted) return runningResult(runId, mode, localDate, weekendMode);
    }
  }

  const leaseExpiresAt = new Date(dependencies.now().getTime() + 10 * 60 * 1000).toISOString();
  const leaseAcquired = await dependencies.runs.acquireUserLease(
    input.userId,
    runId,
    dependencies.now().toISOString(),
    leaseExpiresAt,
  );
  if (!leaseAcquired) return runningResult(runId, mode, localDate, weekendMode);

  let committed = false;
  try {
    const connectedAccounts = await dependencies.accounts.listConnectedAccounts(input.userId);
    if (connectedAccounts.length === 0) throw new Error("No usable current data");
    const completedAccounts: Array<"personal" | "work"> = [];
    const completedAccountIds: string[] = [];
    const failedAccounts: Array<{context: "personal" | "work"; code: "account_sync_failed"}> = [];
    const newEmailClassifications: EmailClassification[] = [];
    const newEventAssessments: Array<{event: CalendarEvent; assessment: CalendarAssessment}> = [];
    const changedCounts = {email: 0, calendar: 0};

    for (const account of connectedAccounts) {
      if (account.userId !== input.userId) {
        failedAccounts.push({context: account.context, code: "account_sync_failed"});
        continue;
      }
      try {
        const result = await synchronizeAndClassify(account, mode === "full", executionTime, dependencies);
        completedAccounts.push(account.context);
        completedAccountIds.push(account.id);
        changedCounts.email += result.changedEmail;
        changedCounts.calendar += result.changedCalendar;
        newEmailClassifications.push(...result.newEmailClassifications);
        newEventAssessments.push(...result.newEventAssessments);
      } catch {
        failedAccounts.push({context: account.context, code: "account_sync_failed"});
      }
    }

    if (completedAccountIds.length === 0) throw new Error("No usable current data");
    const window = localDayWindow(localDate);
    const current = await dependencies.readModels.loadPlanInputs(
      input.userId,
      completedAccountIds,
      window.from,
      window.to,
    );
    if (current.emails.length === 0 && current.events.length === 0) throw new Error("No usable current data");

    const revision = await dependencies.plans.nextRevision(input.userId, localDate);
    const completedAt = dependencies.now().toISOString();
    const accountContexts = Object.fromEntries(
      connectedAccounts
        .filter((account) => completedAccountIds.includes(account.id))
        .map((account) => [account.id, account.context]),
    );
    const plan = buildDailyPlan({
      id: `plan:${encodeURIComponent(input.userId)}:${localDate}:${revision}`,
      localDate,
      revision,
      generatedAt: completedAt,
      weekendMode,
      accountContexts,
      emails: current.emails,
      events: current.events,
    });
    const importance = importanceOf(newEmailClassifications, newEventAssessments, executionTime);
    const envelope: RefreshEnvelope = {revision, generatedAt: completedAt, importance, changedCounts};
    const status = failedAccounts.length === 0 ? "completed" as const : "degraded" as const;
    const result: RefreshResult = {
      runId,
      mode,
      status,
      reused: false,
      localDate,
      weekendMode,
      completedAccounts,
      failedAccounts,
      changedCounts,
      revision,
      importance,
      envelope,
    };
    await dependencies.runs.completeWithPlan({
      userId: input.userId,
      plan,
      notification: {
        id: `notification:${runId}`,
        dedupeKey: runId,
        severity: importance,
        safeSummary: importance === "routine" ? "LifeOS is up to date." : "Important LifeOS changes are ready.",
        createdAt: completedAt,
      },
      run: {id: runId, status, result, completedAt},
    });
    committed = true;
    return result;
  } catch (cause) {
    if (!committed) {
      try {
        await dependencies.runs.complete({
          id: runId,
          status: "failed",
          result: {code: "refresh_failed"},
          completedAt: dependencies.now().toISOString(),
          errorCode: "refresh_failed",
        });
      } catch {
        // Preserve the original redacted failure when persistence also fails.
      }
    }
    if (cause instanceof Error && cause.message === "No usable current data") throw cause;
    throw new Error("Refresh failed");
  } finally {
    try {
      await dependencies.runs.releaseUserLease(input.userId, runId);
    } catch {
      // The lease expires automatically; do not replace the run outcome with cleanup details.
    }
  }
};

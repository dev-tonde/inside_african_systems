import type {
  CalendarAssessment,
  CalendarEvent,
  EmailClassification,
  EmailRecord,
} from "@lifeos/contracts";
import {describe, expect, it} from "vitest";
import {buildDailyPlan, sourceRef, type DailyPlanInput} from "../src/planning/build-daily-plan";

const email = (
  providerMessageId: string,
  importance: EmailClassification["importance"] = "high",
  lifePriority: EmailClassification["lifePriority"] = "primary_job_or_business",
  accountId = "personal:account",
): {record: EmailRecord; classification: EmailClassification} => ({
  record: {
    accountId,
    providerMessageId,
    threadId: `thread-${providerMessageId}`,
    subject: `Email ${providerMessageId}`,
    sender: "sender@example.com",
    receivedAt: "2026-08-03T04:00:00.000Z",
    sourceVersion: "v1",
    snippet: "Safe fixture",
  },
  classification: {
    accountId,
    providerMessageId,
    sourceVersion: "v1",
    importance,
    workflowState: "reply",
    lifePriority,
    confidence: 0.9,
    explanation: "Fixture classification",
    classifiedAt: "2026-08-03T04:01:00.000Z",
  },
});

const event = (
  providerEventId: string,
  startsAt: string,
  category: CalendarAssessment["category"] = "protect",
  accountId = "work/account",
): {event: CalendarEvent; assessment: CalendarAssessment} => ({
  event: {
    accountId,
    providerEventId,
    title: `Event ${providerEventId}`,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
    attendeeCount: 2,
    sourceVersion: "v1",
  },
  assessment: {
    accountId,
    providerEventId,
    sourceVersion: "v1",
    category,
    lifePriority: "inside_african_systems",
    score: 80,
    confidence: 0.8,
    explanation: "Fixture assessment",
    assessedAt: "2026-08-03T04:01:00.000Z",
  },
});

const input = (overrides: Partial<DailyPlanInput> = {}): DailyPlanInput => ({
  id: "plan:user:2026-08-03:1",
  localDate: "2026-08-03",
  revision: 1,
  generatedAt: "2026-08-03T05:00:00.000Z",
  weekendMode: false,
  accountContexts: {
    "personal:account": "personal",
    "work/account": "work",
  },
  emails: [email("message:one")],
  events: [event("event/one", "2026-08-03T08:00:00.000Z")],
  ...overrides,
});

describe("daily plan", () => {
  it("selects no more than three priorities in approved life-priority order", () => {
    const plan = buildDailyPlan(input({
      emails: [
        email("four", "critical", "inside_african_systems"),
        email("three", "high", "personal_administration"),
        email("two", "high", "income_and_wealth"),
        email("one", "critical", "faith_and_community"),
      ],
      events: [],
    }));

    expect(plan.priorities.map((item) => item.label)).toEqual([
      "Email one",
      "Email two",
      "Email three",
    ]);
  });

  it("uses urgency only as the tie-breaker within one life priority", () => {
    const plan = buildDailyPlan(input({
      emails: [
        email("high", "high", "income_and_wealth"),
        email("critical", "critical", "income_and_wealth"),
      ],
      events: [],
    }));

    expect(plan.priorities.map((item) => item.label)).toEqual(["Email critical", "Email high"]);
  });

  it("keeps an unambiguous encoded account context on every source reference", () => {
    const plan = buildDailyPlan(input());

    expect(sourceRef("personal:account", "message:one")).toBe("personal%3Aaccount:message%3Aone");
    expect(plan.decisions[0]?.sourceId).toBe("personal%3Aaccount:message%3Aone");
    expect(plan.timeline[0]?.sourceId).toBe("work%2Faccount:event%2Fone");
  });

  it("orders the timeline without mutating input arrays or objects", () => {
    const events = [
      event("late", "2026-08-03T10:00:00.000Z"),
      event("early", "2026-08-03T07:00:00.000Z"),
    ];
    const emails = [email("b"), email("a", "critical")];
    const beforeEvents = structuredClone(events);
    const beforeEmails = structuredClone(emails);

    const plan = buildDailyPlan(input({events, emails}));

    expect(plan.timeline.map((item) => item.label)).toEqual(["Event early", "Event late"]);
    expect(events).toEqual(beforeEvents);
    expect(emails).toEqual(beforeEmails);
  });

  it("excludes normal email and optional calendar items from decisions and timeline", () => {
    const plan = buildDailyPlan(input({
      emails: [email("routine", "normal")],
      events: [event("optional", "2026-08-03T07:00:00.000Z", "optional")],
    }));

    expect(plan.priorities).toEqual([]);
    expect(plan.decisions).toEqual([]);
    expect(plan.timeline).toEqual([]);
  });

  it("rejects data whose account context is not owned by the plan input", () => {
    expect(() => buildDailyPlan(input({emails: [email("foreign", "high", "primary_job_or_business", "foreign")]})))
      .toThrow("Missing account context");
  });
});

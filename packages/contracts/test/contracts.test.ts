import {describe, expect, it} from "vitest";
import {
  AccountContextSchema,
  ApiErrorSchema,
  CalendarAssessmentSchema,
  CalendarEventSchema,
  DailyPlanSchema,
  EmailClassificationSchema,
  EmailRecordSchema,
  LifePrioritySchema,
  RefreshEnvelopeSchema,
} from "../src";

describe("shared contracts", () => {
  it("rejects records without an account partition", () => {
    expect(() =>
      EmailRecordSchema.parse({
        providerMessageId: "m-1",
        threadId: "t-1",
        subject: "Hello",
        sender: "sender@example.com",
        receivedAt: "2026-08-03T05:00:00.000Z",
        sourceVersion: "v-1",
      }),
    ).toThrow();
  });

  it("accepts a normalized calendar event", () => {
    expect(
      CalendarEventSchema.parse({
        accountId: "acct-personal",
        providerEventId: "event-1",
        title: "Community meeting",
        startsAt: "2026-08-03T06:00:00.000Z",
        endsAt: "2026-08-03T07:00:00.000Z",
        attendeeCount: 4,
        sourceVersion: "etag-1",
      }).accountId,
    ).toBe("acct-personal");
  });

  it("requires immutable plan revisions", () => {
    const plan = DailyPlanSchema.parse({
      id: "plan-2026-08-03-r1",
      localDate: "2026-08-03",
      timeZone: "Africa/Johannesburg",
      revision: 1,
      generatedAt: "2026-08-03T05:00:00.000Z",
      weekendMode: false,
      priorities: [],
      decisions: [],
      timeline: [],
    });
    expect(plan.revision).toBe(1);
  });

  it("wraps refresh data with a monotonic revision", () => {
    expect(
      RefreshEnvelopeSchema.parse({
        revision: 2,
        generatedAt: "2026-08-03T05:30:00.000Z",
        importance: "high",
        changedCounts: {email: 1, calendar: 0},
      }).importance,
    ).toBe("high");
  });

  it("limits account contexts to work and personal", () => {
    expect(() => AccountContextSchema.parse("shared")).toThrow();
  });

  it("accepts only the approved life-priority values", () => {
    expect(LifePrioritySchema.parse("inside_african_systems")).toBe(
      "inside_african_systems",
    );
    expect(() => LifePrioritySchema.parse("health")).toThrow();
  });

  it("keeps email importance separate from workflow state", () => {
    expect(
      EmailClassificationSchema.parse({
        accountId: "acct-work",
        providerMessageId: "m-2",
        sourceVersion: "v-2",
        importance: "critical",
        workflowState: "waiting",
        lifePriority: "primary_job_or_business",
        confidence: 0,
        explanation: "Awaiting an external response.",
        classifiedAt: "2026-08-03T05:00:00.000Z",
      }).workflowState,
    ).toBe("waiting");
  });

  it("bounds email classification confidence", () => {
    expect(() =>
      EmailClassificationSchema.parse({
        accountId: "acct-work",
        providerMessageId: "m-2",
        sourceVersion: "v-2",
        importance: "normal",
        workflowState: "read_later",
        lifePriority: "primary_job_or_business",
        confidence: 1.01,
        explanation: "Read after focused work.",
        classifiedAt: "2026-08-03T05:00:00.000Z",
      }),
    ).toThrow();
  });

  it("accepts exact calendar categories and bounds assessment scores", () => {
    expect(
      CalendarAssessmentSchema.parse({
        accountId: "acct-personal",
        providerEventId: "event-2",
        sourceVersion: "etag-2",
        category: "recommend_decline_or_reschedule",
        lifePriority: "faith_and_community",
        score: 100,
        confidence: 1,
        explanation: "Conflicts with a protected commitment.",
        assessedAt: "2026-08-03T05:00:00.000Z",
      }).score,
    ).toBe(100);
    expect(() =>
      CalendarAssessmentSchema.parse({
        accountId: "acct-personal",
        providerEventId: "event-2",
        sourceVersion: "etag-2",
        category: "decline",
        lifePriority: "faith_and_community",
        score: 101,
        confidence: 1,
        explanation: "Outside the approved range.",
        assessedAt: "2026-08-03T05:00:00.000Z",
      }),
    ).toThrow();
  });

  it("limits daily plans to three priorities in Johannesburg time", () => {
    const priority = {
      id: "item-1",
      label: "Review the operating plan",
      context: "work",
      lifePriority: "inside_african_systems",
      sourceType: "system",
      sourceId: "system-1",
    };
    expect(() =>
      DailyPlanSchema.parse({
        id: "plan-2026-08-03-r2",
        localDate: "2026-08-03",
        timeZone: "Africa/Johannesburg",
        revision: 2,
        generatedAt: "2026-08-03T05:00:00.000Z",
        weekendMode: false,
        priorities: [priority, {...priority, id: "item-2"}, {...priority, id: "item-3"}, {...priority, id: "item-4"}],
        decisions: [],
        timeline: [],
      }),
    ).toThrow();
  });

  it("requires structured API errors", () => {
    expect(
      ApiErrorSchema.parse({
        error: {code: "UPSTREAM_UNAVAILABLE", message: "Google is unavailable.", requestId: "req-1"},
      }).error.requestId,
    ).toBe("req-1");
    expect(() => ApiErrorSchema.parse({error: {code: "", message: "", requestId: ""}})).toThrow();
  });
});

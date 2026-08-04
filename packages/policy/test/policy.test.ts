import {describe, expect, it} from "vitest";
import {
  lifePriorities,
  lifePriorityRank,
  scoreCalendarEvent,
  scoreEmail,
} from "../src";

describe("approved life priorities", () => {
  it("keeps the approved priority order exactly", () => {
    expect(lifePriorities).toEqual([
      "faith_and_community",
      "income_and_wealth",
      "personal_administration",
      "primary_job_or_business",
      "inside_african_systems",
      "family_and_relationships",
    ]);
  });

  it("returns the zero-based rank for every approved priority", () => {
    expect(lifePriorities.map(lifePriorityRank)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("rejects an unknown priority at the runtime boundary", () => {
    expect(() => lifePriorityRank("health" as never)).toThrow(/life priority/i);
  });
});

describe("deterministic email policy", () => {
  it("marks an explicit same-day deadline as critical", () => {
    expect(
      scoreEmail({
        knownSender: true,
        directRecipient: true,
        hoursUntilDeadline: 3,
        automatedSender: false,
        newsletter: false,
        spamSignals: 0,
      }),
    ).toMatchObject({
      importance: "critical",
      workflowState: "do",
      lifePriority: "personal_administration",
      confidence: 0.92,
      explanation: "An explicit deadline is within six hours.",
    });
  });

  it("treats the six-hour deadline boundary as critical", () => {
    expect(
      scoreEmail({
        knownSender: false,
        directRecipient: false,
        hoursUntilDeadline: 6,
        automatedSender: false,
        newsletter: false,
        spamSignals: 0,
      }).importance,
    ).toBe("critical");
  });

  it("does not inflate a deadline more than six hours away", () => {
    expect(
      scoreEmail({
        knownSender: false,
        directRecipient: false,
        hoursUntilDeadline: 6.01,
        automatedSender: false,
        newsletter: false,
        spamSignals: 0,
      }).importance,
    ).toBe("normal");
  });

  it("routes newsletters to safe reviewable auto-archive", () => {
    expect(
      scoreEmail({
        knownSender: false,
        directRecipient: false,
        hoursUntilDeadline: null,
        automatedSender: true,
        newsletter: true,
        spamSignals: 0,
      }).workflowState,
    ).toBe("auto_archive");
  });

  it("gives spam review precedence over an urgent deadline", () => {
    expect(
      scoreEmail({
        knownSender: true,
        directRecipient: true,
        hoursUntilDeadline: 0,
        automatedSender: false,
        newsletter: false,
        spamSignals: 2,
      }),
    ).toMatchObject({importance: "low", workflowState: "spam_review"});
  });

  it("routes direct known-sender messages to reply", () => {
    expect(
      scoreEmail({
        knownSender: true,
        directRecipient: true,
        hoursUntilDeadline: null,
        automatedSender: false,
        newsletter: false,
        spamSignals: 1,
        lifePriority: "inside_african_systems",
      }),
    ).toMatchObject({
      importance: "high",
      workflowState: "reply",
      lifePriority: "inside_african_systems",
    });
  });

  it.each([
    {field: "hoursUntilDeadline", value: -1},
    {field: "hoursUntilDeadline", value: 8_760.01},
    {field: "hoursUntilDeadline", value: Number.NaN},
    {field: "hoursUntilDeadline", value: Number.POSITIVE_INFINITY},
    {field: "spamSignals", value: -1},
    {field: "spamSignals", value: 1.5},
    {field: "spamSignals", value: 11},
    {field: "spamSignals", value: Number.NaN},
  ])("rejects invalid email numeric input: $field=$value", ({field, value}) => {
    const signals = {
      knownSender: false,
      directRecipient: false,
      hoursUntilDeadline: null as number | null,
      automatedSender: false,
      newsletter: false,
      spamSignals: 0,
    };
    Object.assign(signals, {[field]: value});
    expect(() => scoreEmail(signals)).toThrow(/must be/i);
  });

  it("rejects an unapproved life priority instead of producing an impossible result", () => {
    expect(() =>
      scoreEmail({
        knownSender: false,
        directRecipient: false,
        hoursUntilDeadline: null,
        automatedSender: false,
        newsletter: false,
        spamSignals: 0,
        lifePriority: "health" as never,
      }),
    ).toThrow(/life priority/i);
  });
});

describe("deterministic calendar policy", () => {
  const baseCalendarSignals = {
    priorityRank: 3 as const,
    obligation: false,
    relationshipValue: 0,
    financialCareerValue: 0,
    rarity: 0,
    totalMinutes: 30,
    conflictCost: 0,
    evidenceConfidence: 1,
  };

  it("protects a high-priority community commitment", () => {
    expect(
      scoreCalendarEvent({
        priorityRank: 1,
        obligation: true,
        relationshipValue: 8,
        financialCareerValue: 2,
        rarity: 7,
        totalMinutes: 90,
        conflictCost: 1,
        evidenceConfidence: 0.9,
      }),
    ).toMatchObject({
      category: "protect",
      lifePriority: "personal_administration",
      confidence: 0.9,
    });
  });

  it("makes low-confidence calendar decisions optional rather than decline recommendations", () => {
    expect(
      scoreCalendarEvent({
        priorityRank: 6,
        obligation: false,
        relationshipValue: 1,
        financialCareerValue: 1,
        rarity: 1,
        totalMinutes: 240,
        conflictCost: 8,
        evidenceConfidence: 0.3,
      }).category,
    ).toBe("optional");
  });

  it("makes only confidence below the low-confidence boundary optional", () => {
    expect(
      scoreCalendarEvent({...baseCalendarSignals, evidenceConfidence: 0.49}).category,
    ).toBe("optional");
    expect(
      scoreCalendarEvent({...baseCalendarSignals, evidenceConfidence: 0.5}).category,
    ).toBe("recommend_decline_or_reschedule");
  });

  it("uses protected category for any sufficiently confident obligation", () => {
    expect(
      scoreCalendarEvent({
        ...baseCalendarSignals,
        priorityRank: 6,
        obligation: true,
        totalMinutes: 1_440,
        conflictCost: 10,
        evidenceConfidence: 0.5,
      }).category,
    ).toBe("protect");
  });

  it("keeps the maximum defined signal combination within the score range", () => {
    expect(
      scoreCalendarEvent({
        ...baseCalendarSignals,
        priorityRank: 1,
        obligation: true,
        relationshipValue: 10,
        financialCareerValue: 10,
        rarity: 10,
      }).score,
    ).toBe(95);
  });

  it("uses stable, explanatory output for identical signals", () => {
    const signals = {...baseCalendarSignals, relationshipValue: 10, rarity: 10};
    expect(scoreCalendarEvent(signals)).toEqual(scoreCalendarEvent(signals));
    expect(scoreCalendarEvent(signals).explanation).toBe(
      "Score combines priority, obligation, relationship, career, rarity, duration and conflict cost.",
    );
  });

  it("uses the defined score-category boundaries", () => {
    const at = (relationshipValue: number, financialCareerValue: number, rarity: number) =>
      scoreCalendarEvent({
        ...baseCalendarSignals,
        priorityRank: 6,
        totalMinutes: 0,
        relationshipValue,
        financialCareerValue,
        rarity,
      }).category;

    expect(at(8, 0, 0)).toBe("recommend_decline_or_reschedule");
    expect(at(8.5, 0, 0)).toBe("optional");
    expect(at(10, 5.5, 0)).toBe("optional");
    expect(at(10, 6, 0)).toBe("attend");
    expect(at(10, 10, 22 / 3)).toBe("attend");
    expect(at(10, 10, 8)).toBe("protect");
  });

  it("rejects an unapproved calendar life priority", () => {
    expect(() =>
      scoreCalendarEvent({...baseCalendarSignals, lifePriority: "health" as never}),
    ).toThrow(/life priority/i);
  });

  it.each([
    {field: "priorityRank", value: 0},
    {field: "priorityRank", value: 7},
    {field: "priorityRank", value: 1.5},
    {field: "relationshipValue", value: -1},
    {field: "relationshipValue", value: 10.01},
    {field: "financialCareerValue", value: Number.NaN},
    {field: "rarity", value: Number.POSITIVE_INFINITY},
    {field: "totalMinutes", value: -1},
    {field: "totalMinutes", value: 1_441},
    {field: "conflictCost", value: -0.1},
    {field: "evidenceConfidence", value: -0.01},
    {field: "evidenceConfidence", value: 1.01},
  ])("rejects invalid calendar numeric input: $field=$value", ({field, value}) => {
    const signals = {...baseCalendarSignals};
    Object.assign(signals, {[field]: value});
    expect(() => scoreCalendarEvent(signals)).toThrow(/must be/i);
  });
});

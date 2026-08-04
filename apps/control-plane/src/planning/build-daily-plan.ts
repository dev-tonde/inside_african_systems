import {
  DailyPlanSchema,
  type CalendarAssessment,
  type CalendarEvent,
  type DailyPlan,
  type EmailClassification,
  type EmailRecord,
} from "@lifeos/contracts";
import {lifePriorityRank} from "@lifeos/policy";

export type DailyPlanInput = {
  id: string;
  localDate: string;
  revision: number;
  generatedAt: string;
  weekendMode: boolean;
  accountContexts: Record<string, "personal" | "work">;
  emails: Array<{record: EmailRecord; classification: EmailClassification}>;
  events: Array<{event: CalendarEvent; assessment: CalendarAssessment}>;
};

export const sourceRef = (accountId: string, providerId: string): string =>
  `${encodeURIComponent(accountId)}:${encodeURIComponent(providerId)}`;

const contextFor = (input: DailyPlanInput, accountId: string): "personal" | "work" => {
  const context = input.accountContexts[accountId];
  if (!context) throw new Error(`Missing account context for ${encodeURIComponent(accountId)}`);
  return context;
};

export const buildDailyPlan = (input: DailyPlanInput): DailyPlan => {
  const urgentEmails = input.emails
    .filter(({classification}) => classification.importance === "critical" || classification.importance === "high")
    .slice()
    .sort((a, b) =>
      lifePriorityRank(a.classification.lifePriority) - lifePriorityRank(b.classification.lifePriority) ||
      (b.classification.importance === "critical" ? 1 : 0) - (a.classification.importance === "critical" ? 1 : 0) ||
      b.classification.confidence - a.classification.confidence ||
      sourceRef(a.record.accountId, a.record.providerMessageId).localeCompare(sourceRef(b.record.accountId, b.record.providerMessageId)),
    );
  const protectedEvents = input.events
    .filter(({assessment}) => assessment.category === "protect" || assessment.category === "attend")
    .slice()
    .sort((a, b) =>
      a.event.startsAt.localeCompare(b.event.startsAt) ||
      sourceRef(a.event.accountId, a.event.providerEventId).localeCompare(sourceRef(b.event.accountId, b.event.providerEventId)),
    );

  const candidates = [
    ...urgentEmails.map(({record, classification}) => ({
      id: `email:${sourceRef(record.accountId, record.providerMessageId)}`,
      label: record.subject || "Email requiring attention",
      context: contextFor(input, record.accountId),
      lifePriority: classification.lifePriority,
      sourceType: "email" as const,
      sourceId: sourceRef(record.accountId, record.providerMessageId),
      priorityRank: lifePriorityRank(classification.lifePriority),
      urgency: classification.importance === "critical" ? 3 : 2,
    })),
    ...protectedEvents.map(({event, assessment}) => ({
      id: `calendar:${sourceRef(event.accountId, event.providerEventId)}`,
      label: event.title || "Calendar event",
      context: contextFor(input, event.accountId),
      lifePriority: assessment.lifePriority,
      sourceType: "calendar" as const,
      sourceId: sourceRef(event.accountId, event.providerEventId),
      priorityRank: lifePriorityRank(assessment.lifePriority),
      urgency: assessment.category === "protect" ? 2 : 1,
    })),
  ].sort((a, b) =>
    a.priorityRank - b.priorityRank ||
    b.urgency - a.urgency ||
    a.sourceType.localeCompare(b.sourceType) ||
    a.sourceId.localeCompare(b.sourceId),
  );

  return DailyPlanSchema.parse({
    id: input.id,
    localDate: input.localDate,
    timeZone: "Africa/Johannesburg",
    revision: input.revision,
    generatedAt: input.generatedAt,
    weekendMode: input.weekendMode,
    priorities: candidates.slice(0, 3).map(({priorityRank: _rank, urgency: _urgency, ...item}) => item),
    decisions: urgentEmails.map(({record, classification}) => ({
      id: `email:${sourceRef(record.accountId, record.providerMessageId)}`,
      label: record.subject || "Email requiring attention",
      context: contextFor(input, record.accountId),
      lifePriority: classification.lifePriority,
      sourceType: "email" as const,
      sourceId: sourceRef(record.accountId, record.providerMessageId),
    })),
    timeline: protectedEvents.map(({event, assessment}) => ({
      id: `calendar:${sourceRef(event.accountId, event.providerEventId)}`,
      label: event.title || "Calendar event",
      context: contextFor(input, event.accountId),
      lifePriority: assessment.lifePriority,
      sourceType: "calendar" as const,
      sourceId: sourceRef(event.accountId, event.providerEventId),
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      protected: assessment.category === "protect",
    })),
  });
};

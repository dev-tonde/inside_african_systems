import {CalendarAssessmentSchema, type CalendarEvent} from "@lifeos/contracts";
import {scoreCalendarEvent, type CalendarSignals} from "@lifeos/policy";
import {z} from "zod";
import type {ModelClient} from "./model-client";
import {classificationSystemPrompt, untrustedBlock} from "./untrusted-content";

const ModelCalendarSchema = z.object({
  category: z.enum(["protect", "attend", "optional", "recommend_decline_or_reschedule"]),
  lifePriority: z.enum([
    "faith_and_community",
    "income_and_wealth",
    "personal_administration",
    "primary_job_or_business",
    "inside_african_systems",
    "family_and_relationships",
  ]),
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  explanation: z.string().trim().min(1).max(500),
}).strict();

const defaultSignals: CalendarSignals = {
  priorityRank: 6,
  obligation: false,
  relationshipValue: 0,
  financialCareerValue: 0,
  rarity: 0,
  totalMinutes: 0,
  conflictCost: 0,
  evidenceConfidence: 0.3,
};

const calendarSystemPrompt = `${classificationSystemPrompt}
Return exactly these fields: category, lifePriority, score, confidence, and
explanation. Do not return identifiers, timestamps, actions, tools, or commands.`;

export const assessCalendarEvent = async (
  event: CalendarEvent,
  client: ModelClient,
  now: Date,
  context: {accountId: string; signals?: CalendarSignals} = {accountId: event.accountId},
) => {
  if (context.accountId !== event.accountId) throw new Error("Account context mismatch");
  if (!Number.isFinite(now.getTime())) throw new Error("Assessment time must be valid");

  const assessedAt = now.toISOString();
  const fallback = scoreCalendarEvent(context.signals ?? defaultSignals);
  const buildFallback = (overrides: {
    category?: "optional";
    confidence?: number;
    explanation?: string;
  } = {}) => ({
    source: "deterministic_fallback" as const,
    assessment: CalendarAssessmentSchema.parse({
      ...fallback,
      ...overrides,
      accountId: event.accountId,
      providerEventId: event.providerEventId,
      sourceVersion: event.sourceVersion,
      assessedAt,
    }),
  });

  try {
    const parsed = ModelCalendarSchema.parse(await client.generateJson({
      system: calendarSystemPrompt,
      schemaName: "calendar_assessment",
      user: untrustedBlock("untrusted_calendar", {
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        attendeeCount: event.attendeeCount,
        location: event.location,
        organizerEmail: event.organizerEmail,
      }),
    }));
    if (parsed.confidence < 0.5) {
      return buildFallback({
        category: "optional",
        confidence: Math.min(fallback.confidence, 0.49),
        explanation: "Low model confidence keeps this event optional.",
      });
    }
    return {
      source: "workers_ai" as const,
      assessment: CalendarAssessmentSchema.parse({
        ...parsed,
        accountId: event.accountId,
        providerEventId: event.providerEventId,
        sourceVersion: event.sourceVersion,
        assessedAt,
      }),
    };
  } catch {
    return buildFallback();
  }
};

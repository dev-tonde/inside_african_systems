import {z} from "zod";
import {LifePrioritySchema} from "./priority";

export const CalendarCategorySchema = z.enum([
  "protect",
  "attend",
  "optional",
  "recommend_decline_or_reschedule",
]);
export type CalendarCategory = z.infer<typeof CalendarCategorySchema>;

export const CalendarEventSchema = z.object({
  accountId: z.string().min(1),
  providerEventId: z.string().min(1),
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  attendeeCount: z.number().int().nonnegative(),
  sourceVersion: z.string().min(1),
  location: z.string().optional(),
  organizerEmail: z.email().optional(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const CalendarAssessmentSchema = z.object({
  accountId: z.string().min(1),
  providerEventId: z.string().min(1),
  sourceVersion: z.string().min(1),
  category: CalendarCategorySchema,
  lifePriority: LifePrioritySchema,
  score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1).max(500),
  assessedAt: z.iso.datetime(),
});
export type CalendarAssessment = z.infer<typeof CalendarAssessmentSchema>;

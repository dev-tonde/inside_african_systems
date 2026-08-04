import {z} from "zod";
import {LifePrioritySchema} from "./priority";

const PlanItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  context: z.enum(["personal", "work"]),
  lifePriority: LifePrioritySchema,
  sourceType: z.enum(["email", "calendar", "system"]),
  sourceId: z.string().min(1),
});

const TimelineItemSchema = PlanItemSchema.extend({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  protected: z.boolean(),
});

export const DailyPlanSchema = z.object({
  id: z.string().min(1),
  localDate: z.iso.date(),
  timeZone: z.literal("Africa/Johannesburg"),
  revision: z.number().int().positive(),
  generatedAt: z.iso.datetime(),
  weekendMode: z.boolean(),
  priorities: z.array(PlanItemSchema).max(3),
  decisions: z.array(PlanItemSchema),
  timeline: z.array(TimelineItemSchema),
});
export type DailyPlan = z.infer<typeof DailyPlanSchema>;

import {z} from "zod";

export const LifePrioritySchema = z.enum([
  "faith_and_community",
  "income_and_wealth",
  "personal_administration",
  "primary_job_or_business",
  "inside_african_systems",
  "family_and_relationships",
]);
export type LifePriority = z.infer<typeof LifePrioritySchema>;

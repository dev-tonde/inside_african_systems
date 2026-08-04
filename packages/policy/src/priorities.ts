import type {LifePriority} from "@lifeos/contracts";

export type PriorityRank = 1 | 2 | 3 | 4 | 5 | 6;

export const lifePriorities = [
  "faith_and_community",
  "income_and_wealth",
  "personal_administration",
  "primary_job_or_business",
  "inside_african_systems",
  "family_and_relationships",
] as const satisfies readonly LifePriority[];

const isLifePriority = (value: unknown): value is LifePriority =>
  typeof value === "string" && lifePriorities.includes(value as LifePriority);

export const assertLifePriority: (value: unknown) => asserts value is LifePriority = (value) => {
  if (!isLifePriority(value)) {
    throw new RangeError("life priority must be one of the approved priorities");
  }
};

export const lifePriorityRank = (priority: LifePriority): PriorityRank => {
  assertLifePriority(priority);
  return (lifePriorities.indexOf(priority) + 1) as PriorityRank;
};

import type {CalendarCategory, LifePriority} from "@lifeos/contracts";
import {assertLifePriority} from "./priorities";

export type CalendarSignals = {
  priorityRank: 1 | 2 | 3 | 4 | 5 | 6;
  obligation: boolean;
  relationshipValue: number;
  financialCareerValue: number;
  rarity: number;
  totalMinutes: number;
  conflictCost: number;
  evidenceConfidence: number;
  lifePriority?: LifePriority;
};

export type CalendarScore = {
  category: CalendarCategory;
  lifePriority: LifePriority;
  score: number;
  confidence: number;
  explanation: string;
};

const assertFiniteRange: (
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
) => asserts value is number = (value, name, minimum, maximum) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a finite number between ${minimum} and ${maximum}`);
  }
};

const assertSignals = (signals: CalendarSignals): void => {
  assertFiniteRange(signals.priorityRank, "priorityRank", 1, 6);
  if (!Number.isInteger(signals.priorityRank)) {
    throw new RangeError("priorityRank must be an integer between 1 and 6");
  }
  if (typeof signals.obligation !== "boolean") {
    throw new TypeError("obligation must be a boolean");
  }
  assertFiniteRange(signals.relationshipValue, "relationshipValue", 0, 10);
  assertFiniteRange(signals.financialCareerValue, "financialCareerValue", 0, 10);
  assertFiniteRange(signals.rarity, "rarity", 0, 10);
  assertFiniteRange(signals.totalMinutes, "totalMinutes", 0, 1_440);
  assertFiniteRange(signals.conflictCost, "conflictCost", 0, 10);
  assertFiniteRange(signals.evidenceConfidence, "evidenceConfidence", 0, 1);
  if (signals.lifePriority !== undefined) {
    assertLifePriority(signals.lifePriority);
  }
};

export const scoreCalendarEvent = (signals: CalendarSignals): CalendarScore => {
  assertSignals(signals);

  const priorityValue = 12 - signals.priorityRank * 1.5;
  const durationCost = Math.min(10, signals.totalMinutes / 30);
  const raw =
    priorityValue +
    (signals.obligation ? 30 : 0) +
    signals.relationshipValue * 2 +
    signals.financialCareerValue * 2 +
    signals.rarity * 1.5 -
    signals.conflictCost * 2 -
    durationCost;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  let category: CalendarCategory;
  if (signals.evidenceConfidence < 0.5) {
    category = "optional";
  } else if (signals.obligation || score >= 55) {
    category = "protect";
  } else if (score >= 35) {
    category = "attend";
  } else if (score >= 20) {
    category = "optional";
  } else {
    category = "recommend_decline_or_reschedule";
  }

  return {
    category,
    lifePriority: signals.lifePriority ?? "personal_administration",
    score,
    confidence: signals.evidenceConfidence,
    explanation: "Score combines priority, obligation, relationship, career, rarity, duration and conflict cost.",
  };
};

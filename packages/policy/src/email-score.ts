import type {
  EmailImportance,
  EmailWorkflowState,
  LifePriority,
} from "@lifeos/contracts";
import {assertLifePriority} from "./priorities";

export type EmailSignals = {
  knownSender: boolean;
  directRecipient: boolean;
  hoursUntilDeadline: number | null;
  automatedSender: boolean;
  newsletter: boolean;
  spamSignals: number;
  lifePriority?: LifePriority;
};

export type EmailScore = {
  importance: EmailImportance;
  workflowState: EmailWorkflowState;
  lifePriority: LifePriority;
  confidence: number;
  explanation: string;
};

const assertBoolean: (value: unknown, name: string) => asserts value is boolean = (value, name) => {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean`);
  }
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

const assertSignals = (signals: EmailSignals): void => {
  assertBoolean(signals.knownSender, "knownSender");
  assertBoolean(signals.directRecipient, "directRecipient");
  assertBoolean(signals.automatedSender, "automatedSender");
  assertBoolean(signals.newsletter, "newsletter");
  if (signals.hoursUntilDeadline !== null) {
    assertFiniteRange(signals.hoursUntilDeadline, "hoursUntilDeadline", 0, 8_760);
  }
  assertFiniteRange(signals.spamSignals, "spamSignals", 0, 10);
  if (!Number.isInteger(signals.spamSignals)) {
    throw new RangeError("spamSignals must be an integer between 0 and 10");
  }
  if (signals.lifePriority !== undefined) {
    assertLifePriority(signals.lifePriority);
  }
};

export const scoreEmail = (signals: EmailSignals): EmailScore => {
  assertSignals(signals);
  const lifePriority = signals.lifePriority ?? "personal_administration";

  if (signals.spamSignals >= 2) {
    return {
      importance: "low",
      workflowState: "spam_review",
      lifePriority,
      confidence: 0.9,
      explanation: "Multiple spam signals require review.",
    };
  }
  if (signals.hoursUntilDeadline !== null && signals.hoursUntilDeadline <= 6) {
    return {
      importance: "critical",
      workflowState: "do",
      lifePriority,
      confidence: 0.92,
      explanation: "An explicit deadline is within six hours.",
    };
  }
  if (signals.newsletter && signals.automatedSender && !signals.directRecipient) {
    return {
      importance: "low",
      workflowState: "auto_archive",
      lifePriority,
      confidence: 0.9,
      explanation: "Automated newsletter not addressed directly.",
    };
  }
  if (signals.knownSender && signals.directRecipient) {
    return {
      importance: "high",
      workflowState: "reply",
      lifePriority,
      confidence: 0.78,
      explanation: "Known sender addressed the owner directly.",
    };
  }
  return {
    importance: "normal",
    workflowState: "read_later",
    lifePriority,
    confidence: 0.55,
    explanation: "No urgent or low-value deterministic signal.",
  };
};

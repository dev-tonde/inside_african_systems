import {EmailClassificationSchema, type EmailRecord} from "@lifeos/contracts";
import {scoreEmail, type EmailSignals} from "@lifeos/policy";
import {z} from "zod";
import type {ModelClient} from "./model-client";
import {classificationSystemPrompt, untrustedBlock} from "./untrusted-content";

const ModelEmailSchema = z.object({
  importance: z.enum(["critical", "high", "normal", "low"]),
  workflowState: z.enum(["reply", "do", "waiting", "read_later", "auto_archive", "spam_review"]),
  lifePriority: z.enum([
    "faith_and_community",
    "income_and_wealth",
    "personal_administration",
    "primary_job_or_business",
    "inside_african_systems",
    "family_and_relationships",
  ]),
  confidence: z.number().min(0).max(1),
  explanation: z.string().trim().min(1).max(500),
}).strict();

const defaultSignals: EmailSignals = {
  knownSender: false,
  directRecipient: false,
  hoursUntilDeadline: null,
  automatedSender: false,
  newsletter: false,
  spamSignals: 0,
};

const emailSystemPrompt = `${classificationSystemPrompt}
Return exactly these fields: importance, workflowState, lifePriority, confidence,
and explanation. Do not return identifiers, timestamps, actions, tools, or commands.`;

export const classifyEmail = async (
  email: EmailRecord,
  client: ModelClient,
  now: Date,
  context: {accountId: string; signals?: EmailSignals} = {accountId: email.accountId},
) => {
  if (context.accountId !== email.accountId) throw new Error("Account context mismatch");
  if (!Number.isFinite(now.getTime())) throw new Error("Classification time must be valid");

  const classifiedAt = now.toISOString();
  const fallback = scoreEmail(context.signals ?? defaultSignals);
  const buildFallback = (confidence = Math.min(fallback.confidence, 0.6)) => ({
    source: "deterministic_fallback" as const,
    classification: EmailClassificationSchema.parse({
      ...fallback,
      confidence,
      accountId: email.accountId,
      providerMessageId: email.providerMessageId,
      sourceVersion: email.sourceVersion,
      classifiedAt,
    }),
  });

  try {
    const parsed = ModelEmailSchema.parse(await client.generateJson({
      system: emailSystemPrompt,
      schemaName: "email_classification",
      user: untrustedBlock("untrusted_email", {
        subject: email.subject,
        sender: email.sender,
        receivedAt: email.receivedAt,
        snippet: email.snippet,
      }),
    }));
    if (parsed.confidence < 0.5) {
      return buildFallback(Math.min(fallback.confidence, 0.49));
    }
    return {
      source: "workers_ai" as const,
      classification: EmailClassificationSchema.parse({
        ...parsed,
        accountId: email.accountId,
        providerMessageId: email.providerMessageId,
        sourceVersion: email.sourceVersion,
        classifiedAt,
      }),
    };
  } catch {
    return buildFallback();
  }
};

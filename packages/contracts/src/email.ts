import {z} from "zod";
import {LifePrioritySchema} from "./priority";

export const EmailImportanceSchema = z.enum(["critical", "high", "normal", "low"]);
export const EmailWorkflowStateSchema = z.enum([
  "reply",
  "do",
  "waiting",
  "read_later",
  "auto_archive",
  "spam_review",
]);
export type EmailImportance = z.infer<typeof EmailImportanceSchema>;
export type EmailWorkflowState = z.infer<typeof EmailWorkflowStateSchema>;

export const EmailRecordSchema = z.object({
  accountId: z.string().min(1),
  providerMessageId: z.string().min(1),
  threadId: z.string().min(1),
  subject: z.string(),
  sender: z.string().min(1),
  receivedAt: z.iso.datetime(),
  sourceVersion: z.string().min(1),
  snippet: z.string().max(500).default(""),
});
export type EmailRecord = z.infer<typeof EmailRecordSchema>;

export const EmailClassificationSchema = z.object({
  accountId: z.string().min(1),
  providerMessageId: z.string().min(1),
  sourceVersion: z.string().min(1),
  importance: EmailImportanceSchema,
  workflowState: EmailWorkflowStateSchema,
  lifePriority: LifePrioritySchema,
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1).max(500),
  classifiedAt: z.iso.datetime(),
});
export type EmailClassification = z.infer<typeof EmailClassificationSchema>;

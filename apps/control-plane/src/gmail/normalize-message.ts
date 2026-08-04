import {EmailRecordSchema, type EmailRecord} from "@lifeos/contracts";
import type {GmailMessage} from "./gmail-client";

const header = (message: GmailMessage, name: string) =>
  message.payload?.headers?.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())?.value ?? "";

export const normalizeGmailMessage = (accountId: string, message: GmailMessage): EmailRecord =>
  EmailRecordSchema.parse({
    accountId,
    providerMessageId: message.id,
    threadId: message.threadId,
    subject: header(message, "Subject"),
    sender: header(message, "From") || "(unknown sender)",
    receivedAt: new Date(Number(message.internalDate)).toISOString(),
    sourceVersion: message.historyId,
    snippet: message.snippet.slice(0, 500),
  });

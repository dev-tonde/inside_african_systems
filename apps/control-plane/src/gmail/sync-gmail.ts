import type {EmailRecord} from "@lifeos/contracts";
import {GmailHistoryExpiredError, type GmailClient} from "./gmail-client";
import {normalizeGmailMessage} from "./normalize-message";
import type {EmailRepository} from "../repositories/email-repository";

export type SyncResult = {mode: "full" | "delta"; changed: number; cursor: string};

export const syncGmailAccount = async (input: {
  accountId: string;
  client: GmailClient;
  repository: EmailRepository;
  now: Date;
  forceFull?: boolean;
}): Promise<SyncResult> => {
  const cursor = input.forceFull ? null : await input.repository.getCursor(input.accountId);
  let mode: SyncResult["mode"] = cursor ? "delta" : "full";
  let listing;
  try {
    listing = cursor
      ? await input.client.listChangedMessages(cursor)
      : await input.client.listRecentMessages("newer_than:7d");
  } catch (error) {
    if (!(error instanceof GmailHistoryExpiredError)) throw error;
    mode = "full";
    listing = await input.client.listRecentMessages("newer_than:7d");
  }
  const unique = new Map<string, EmailRecord>();
  for (const message of listing.messages) unique.set(message.id, normalizeGmailMessage(input.accountId, message));
  const now = input.now.toISOString();
  const changed = await input.repository.upsertRecords([...unique.values()], now);
  await input.repository.setCursor(input.accountId, listing.checkpoint, now);
  return {mode, changed, cursor: listing.checkpoint};
};

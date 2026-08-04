export type GmailMessage = {
  id: string;
  threadId: string;
  historyId: string;
  internalDate: string;
  snippet: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{name: string; value: string}>;
  };
};

export type GmailListing = {messages: GmailMessage[]; checkpoint: string};

export class GmailHistoryExpiredError extends Error {
  constructor() {
    super("Gmail history cursor expired");
    this.name = "GmailHistoryExpiredError";
  }
}

export interface GmailClient {
  listRecentMessages(query: string): Promise<GmailListing>;
  listChangedMessages(startHistoryId: string): Promise<GmailListing>;
}

const gmailBaseUrl = "https://gmail.googleapis.com/gmail/v1/users/me";

type MessageListResponse = {messages?: Array<{id?: unknown}>; nextPageToken?: unknown};
type HistoryListResponse = {
  history?: Array<{messagesAdded?: Array<{message?: {id?: unknown}}>}>;
  nextPageToken?: unknown;
  historyId?: unknown;
};
type ProfileResponse = {historyId?: unknown};

const messageMetadata = new URLSearchParams([
  ["format", "metadata"],
  ["metadataHeaders", "From"],
  ["metadataHeaders", "Subject"],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const getJson = async <ResponseBody>(
  url: URL,
  accessToken: string,
  fetcher: typeof fetch,
  options: {historyRequest?: boolean; missingMessageIsEmpty?: boolean} = {},
): Promise<ResponseBody | null> => {
  let response: Response;
  try {
    response = await fetcher(url, {headers: {authorization: `Bearer ${accessToken}`}});
  } catch {
    throw new Error("Gmail request failed");
  }
  if (response.status === 404 && options.historyRequest) throw new GmailHistoryExpiredError();
  if (response.status === 404 && options.missingMessageIsEmpty) return null;
  if (!response.ok) throw new Error("Gmail request failed");

  const value: unknown = await response.json().catch(() => null);
  if (!isRecord(value)) throw new Error("Gmail response was invalid");
  return value as ResponseBody;
};

const invalidMessage = (): never => {
  throw new Error("Gmail message response was invalid");
};

const validateMessage = (value: unknown): GmailMessage => {
  if (!isRecord(value)) return invalidMessage();
  const {id, threadId, historyId, internalDate} = value;
  if (!isNonEmptyString(id) || !isNonEmptyString(threadId) || !isNonEmptyString(historyId) || !isNonEmptyString(internalDate)) {
    return invalidMessage();
  }
  if (!/^\d+$/u.test(internalDate) || !Number.isSafeInteger(Number(internalDate)) || Number.isNaN(new Date(Number(internalDate)).getTime())) {
    return invalidMessage();
  }

  const snippet = value.snippet === undefined ? "" : value.snippet;
  if (typeof snippet !== "string") return invalidMessage();

  let payload: GmailMessage["payload"];
  if (value.payload !== undefined) {
    if (!isRecord(value.payload)) return invalidMessage();
    const headers = value.payload.headers;
    if (headers !== undefined) {
      if (!Array.isArray(headers) || headers.some((header) => !isRecord(header) || typeof header.name !== "string" || typeof header.value !== "string")) {
        return invalidMessage();
      }
      payload = {headers: headers.map((header) => ({name: header.name as string, value: header.value as string}))};
    } else {
      payload = {};
    }
  }

  return {id, threadId, historyId, internalDate, snippet, payload};
};

const loadMessage = async (id: string, accessToken: string, fetcher: typeof fetch): Promise<GmailMessage | null> => {
  const url = new URL(`${gmailBaseUrl}/messages/${encodeURIComponent(id)}`);
  for (const [name, value] of messageMetadata) url.searchParams.append(name, value);
  const value = await getJson<unknown>(url, accessToken, fetcher, {missingMessageIsEmpty: true});
  return value === null ? null : validateMessage(value);
};

const uniqueMessageIds = (ids: unknown[]): string[] => {
  const unique = new Set<string>();
  for (const id of ids) if (isNonEmptyString(id)) unique.add(id);
  return [...unique];
};

const loadMessages = async (ids: unknown[], accessToken: string, fetcher: typeof fetch): Promise<GmailMessage[]> => {
  const messages = await Promise.all(uniqueMessageIds(ids).map((id) => loadMessage(id, accessToken, fetcher)));
  return messages.filter((message): message is GmailMessage => message !== null);
};

const pageToken = (value: unknown): string | undefined => isNonEmptyString(value) ? value : undefined;

export const createGmailClient = (accessToken: string, fetcher: typeof fetch = fetch): GmailClient => ({
  async listRecentMessages(query) {
    // Capture this first. If Gmail changes while messages are listed, the next delta starts
    // at this earlier checkpoint and safely sees the later history records.
    const profile = await getJson<ProfileResponse>(new URL(`${gmailBaseUrl}/profile`), accessToken, fetcher);
    if (!profile || !isNonEmptyString(profile.historyId)) throw new Error("Gmail profile response was invalid");
    const checkpoint = profile.historyId;
    let currentPageToken: string | undefined;
    const ids: unknown[] = [];
    do {
      const url = new URL(`${gmailBaseUrl}/messages`);
      url.searchParams.set("q", query);
      if (currentPageToken) url.searchParams.set("pageToken", currentPageToken);
      const page = await getJson<MessageListResponse>(url, accessToken, fetcher);
      if (!page) throw new Error("Gmail response was invalid");
      ids.push(...(page.messages ?? []).map((message) => message.id));
      currentPageToken = pageToken(page.nextPageToken);
    } while (currentPageToken);

    return {messages: await loadMessages(ids, accessToken, fetcher), checkpoint};
  },

  async listChangedMessages(startHistoryId) {
    let currentPageToken: string | undefined;
    let checkpoint: string | undefined;
    const ids: unknown[] = [];
    do {
      const url = new URL(`${gmailBaseUrl}/history`);
      url.searchParams.set("startHistoryId", startHistoryId);
      url.searchParams.set("historyTypes", "messageAdded");
      if (currentPageToken) url.searchParams.set("pageToken", currentPageToken);
      const page = await getJson<HistoryListResponse>(url, accessToken, fetcher, {historyRequest: true});
      if (!page) throw new Error("Gmail response was invalid");
      for (const history of page.history ?? []) {
        ids.push(...(history.messagesAdded ?? []).map((addition) => addition.message?.id));
      }
      checkpoint = isNonEmptyString(page.historyId) ? page.historyId : undefined;
      currentPageToken = pageToken(page.nextPageToken);
    } while (currentPageToken);
    if (!checkpoint) throw new Error("Gmail history response was invalid");

    return {messages: await loadMessages(ids, accessToken, fetcher), checkpoint};
  },
});

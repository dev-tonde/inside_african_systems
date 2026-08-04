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

export class GmailHistoryExpiredError extends Error {
  constructor() {
    super("Gmail history cursor expired");
    this.name = "GmailHistoryExpiredError";
  }
}

export interface GmailClient {
  listRecentMessages(query: string): Promise<GmailMessage[]>;
  listChangedMessages(startHistoryId: string): Promise<GmailMessage[]>;
  getCurrentHistoryId(): Promise<string>;
}

const gmailBaseUrl = "https://gmail.googleapis.com/gmail/v1/users/me";

type MessageListResponse = {messages?: Array<{id?: string}>; nextPageToken?: string};
type HistoryListResponse = {
  history?: Array<{messagesAdded?: Array<{message?: {id?: string}}>}>;
  nextPageToken?: string;
};
type ProfileResponse = {historyId?: string};

const messageMetadata = new URLSearchParams([
  ["format", "metadata"],
  ["metadataHeaders", "From"],
  ["metadataHeaders", "Subject"],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getJson = async <ResponseBody>(
  url: URL,
  accessToken: string,
  fetcher: typeof fetch,
  options: {historyRequest?: boolean} = {},
): Promise<ResponseBody> => {
  let response: Response;
  try {
    response = await fetcher(url, {headers: {authorization: `Bearer ${accessToken}`}});
  } catch {
    throw new Error("Gmail request failed");
  }
  if (response.status === 404 && options.historyRequest) throw new GmailHistoryExpiredError();
  if (!response.ok) throw new Error("Gmail request failed");

  const value: unknown = await response.json().catch(() => null);
  if (!isRecord(value)) throw new Error("Gmail response was invalid");
  return value as ResponseBody;
};

const loadMessage = async (id: string, accessToken: string, fetcher: typeof fetch): Promise<GmailMessage> => {
  const url = new URL(`${gmailBaseUrl}/messages/${encodeURIComponent(id)}`);
  for (const [name, value] of messageMetadata) url.searchParams.append(name, value);
  return getJson<GmailMessage>(url, accessToken, fetcher);
};

const uniqueMessageIds = (ids: Array<string | undefined>): string[] => {
  const unique = new Set<string>();
  for (const id of ids) if (id) unique.add(id);
  return [...unique];
};

export const createGmailClient = (accessToken: string, fetcher: typeof fetch = fetch): GmailClient => ({
  async listRecentMessages(query) {
    let pageToken: string | undefined;
    const ids: Array<string | undefined> = [];
    do {
      const url = new URL(`${gmailBaseUrl}/messages`);
      url.searchParams.set("q", query);
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const page = await getJson<MessageListResponse>(url, accessToken, fetcher);
      ids.push(...(page.messages ?? []).map((message) => message.id));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return Promise.all(uniqueMessageIds(ids).map((id) => loadMessage(id, accessToken, fetcher)));
  },

  async listChangedMessages(startHistoryId) {
    let pageToken: string | undefined;
    const ids: Array<string | undefined> = [];
    do {
      const url = new URL(`${gmailBaseUrl}/history`);
      url.searchParams.set("startHistoryId", startHistoryId);
      url.searchParams.set("historyTypes", "messageAdded");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const page = await getJson<HistoryListResponse>(url, accessToken, fetcher, {historyRequest: true});
      for (const history of page.history ?? []) {
        ids.push(...(history.messagesAdded ?? []).map((addition) => addition.message?.id));
      }
      pageToken = page.nextPageToken;
    } while (pageToken);

    return Promise.all(uniqueMessageIds(ids).map((id) => loadMessage(id, accessToken, fetcher)));
  },

  async getCurrentHistoryId() {
    const profile = await getJson<ProfileResponse>(new URL(`${gmailBaseUrl}/profile`), accessToken, fetcher);
    if (!profile.historyId) throw new Error("Gmail profile response was invalid");
    return profile.historyId;
  },
});

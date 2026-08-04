import type {PlanRepository} from "../repositories/plan-repository";
import type {ReadModelRepository, ReadModelQuery} from "../repositories/read-model-repository";
import {johannesburgDate} from "../planning/run-refresh";

export type CockpitRepositories = {
  plans: PlanRepository;
  readModels: ReadModelRepository;
  now: () => Date;
  publicOrigin: string;
  startRefresh(userId: string, now: Date): {runId: string; completion: Promise<unknown>};
  waitUntil(promise: Promise<unknown>): void;
};

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: {"cache-control": "no-store"},
});

const error = (code: string, message: string, status: number) =>
  json({error: {code, message, requestId: crypto.randomUUID()}}, status);

const methodNotAllowed = () => error("method_not_allowed", "Method not allowed", 405);

const hasOnlyParams = (params: URLSearchParams, allowed: ReadonlySet<string>): boolean => {
  const counts = new Map<string, number>();
  for (const key of params.keys()) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].every(([key, count]) => allowed.has(key) && count === 1);
};

const parseNonnegativeInteger = (value: string | null, fallback: number): number | null => {
  if (value === null) return fallback;
  if (!/^(0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const parseReadQuery = (params: URLSearchParams): ReadModelQuery | null => {
  if (!hasOnlyParams(params, new Set(["after", "limit"]))) return null;
  const limit = parseNonnegativeInteger(params.get("limit"), 50);
  if (limit === null || limit < 1 || limit > 100) return null;
  const after = params.get("after");
  if (after !== null) {
    const time = Date.parse(after);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== after) return null;
  }
  return after === null ? {limit} : {after, limit};
};

const isSameOriginPost = (request: Request, publicOrigin: string): boolean => {
  try {
    return new URL(request.url).origin === publicOrigin && request.headers.get("origin") === publicOrigin;
  } catch {
    return false;
  }
};

export const handleCockpitRoute = async (
  request: Request,
  owner: {userId: string; email: string},
  repositories: CockpitRepositories,
): Promise<Response | null> => {
  const url = new URL(request.url);
  const recognized = new Set(["/api/today", "/api/inbox", "/api/calendar", "/api/refresh"]);
  if (!recognized.has(url.pathname)) return null;

  if (url.pathname === "/api/today") {
    if (request.method !== "GET") return methodNotAllowed();
    if (url.search !== "") return error("invalid_request", "Invalid query parameters", 400);
    return json(await repositories.plans.getLatest(owner.userId, johannesburgDate(repositories.now())));
  }

  if (url.pathname === "/api/inbox" || url.pathname === "/api/calendar") {
    if (request.method !== "GET") return methodNotAllowed();
    const input = parseReadQuery(url.searchParams);
    if (!input) return error("invalid_request", "Invalid query parameters", 400);
    const body = url.pathname === "/api/inbox"
      ? await repositories.readModels.listInbox(owner.userId, input)
      : await repositories.readModels.listCalendar(owner.userId, input);
    return json(body);
  }

  if (request.method === "GET") {
    if (!hasOnlyParams(url.searchParams, new Set(["after"]))) {
      return error("invalid_request", "Invalid query parameters", 400);
    }
    const after = parseNonnegativeInteger(url.searchParams.get("after"), 0);
    if (after === null) return error("invalid_request", "Invalid query parameters", 400);
    return json(await repositories.plans.getRefreshEnvelope(owner.userId, after));
  }

  if (request.method === "POST") {
    if (url.search !== "") return error("invalid_request", "Invalid query parameters", 400);
    if (!isSameOriginPost(request, repositories.publicOrigin)) {
      return error("forbidden", "Invalid request origin", 403);
    }
    const now = repositories.now();
    const started = repositories.startRefresh(owner.userId, now);
    repositories.waitUntil(started.completion);
    return json({runId: started.runId}, 202);
  }

  return methodNotAllowed();
};

import {createWorkersAiClient} from "./ai/model-client";
import {createCalendarClient} from "./calendar/calendar-client";
import type {Env} from "./env";
import {createGmailClient} from "./gmail/gmail-client";
import {getGoogleAccessToken} from "./google/token-provider";
import {deterministicRunId, runRefresh, type RunRefreshInput} from "./planning/run-refresh";
import {createAccountRepository, type ConnectedAccount} from "./repositories/account-repository";
import {createAuthRepository, type AuthRepository} from "./repositories/auth-repository";
import {createCalendarRepository} from "./repositories/calendar-repository";
import {createClassificationRepository} from "./repositories/classification-repository";
import {createEmailRepository} from "./repositories/email-repository";
import {createPlanRepository} from "./repositories/plan-repository";
import {createReadModelRepository} from "./repositories/read-model-repository";
import {createRunRepository} from "./repositories/run-repository";
import {handleAuthRoute, requireOwner} from "./routes/auth";
import {handleCockpitRoute} from "./routes/cockpit";

export type WorkerRuntime = {
  now(): Date;
  authRepository(db: D1Database): AuthRepository;
  findOwnerUserId(env: Env): Promise<string | null>;
  startRefresh(input: RunRefreshInput, env: Env): Promise<unknown>;
};

export type LifeOsWorker = {
  fetch(request: Request, env: Env, context: {waitUntil(promise: Promise<unknown>): void}): Promise<Response>;
  scheduled(
    controller: Pick<ScheduledController, "scheduledTime" | "cron">,
    env: Env,
    context: {waitUntil(promise: Promise<unknown>): void},
  ): void;
};

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: {"cache-control": "no-store"},
});

const apiError = (code: string, message: string, status: number) => json({
  error: {code, message, requestId: crypto.randomUUID()},
}, status);

const productionRuntime: WorkerRuntime = {
  now: () => new Date(),
  authRepository: createAuthRepository,
  async findOwnerUserId(env) {
    return createAccountRepository(env.DB).findOwnerUserId(env.OWNER_GOOGLE_SUB);
  },
  async startRefresh(input, env) {
    const accounts = createAccountRepository(env.DB);
    const dependencies = {
      now: () => new Date(),
      accounts,
      plans: createPlanRepository(env.DB),
      runs: createRunRepository(env.DB),
      emailRepository: createEmailRepository(env.DB),
      calendarRepository: createCalendarRepository(env.DB),
      classifications: createClassificationRepository(env.DB),
      readModels: createReadModelRepository(env.DB),
      getAccessToken: (account: ConnectedAccount) =>
        getGoogleAccessToken({
          encryptedRefreshToken: account.encryptedRefreshToken,
          encryptionKeyB64: env.TOKEN_ENCRYPTION_KEY_B64,
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          fetcher: fetch,
        }),
      createGmailClient: (accessToken: string) => createGmailClient(accessToken, fetch),
      createCalendarClient: (accessToken: string) => createCalendarClient(accessToken, fetch),
      modelClient: createWorkersAiClient(env.AI),
    };
    return runRefresh(input, dependencies);
  },
};

export const createWorker = (runtime: WorkerRuntime): LifeOsWorker => ({
  async fetch(request, env, context): Promise<Response> {
    try {
      const authRepository = runtime.authRepository(env.DB);
      const authResponse = await handleAuthRoute(request, env, {
        repository: authRepository,
        now: runtime.now,
        fetcher: fetch,
      });
      if (authResponse) return authResponse;

      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({
          service: "lifeos-control-plane",
          mode: "read-only",
          now: runtime.now().toISOString(),
        });
      }

      const owner = await requireOwner(request, env, authRepository);
      if (owner instanceof Response) return owner;
      const response = await handleCockpitRoute(request, owner, {
        plans: createPlanRepository(env.DB),
        readModels: createReadModelRepository(env.DB),
        now: runtime.now,
        publicOrigin: env.PUBLIC_APP_ORIGIN,
        startRefresh(userId, now) {
          const input = {userId, trigger: "manual" as const, scheduledAt: now};
          return {
            runId: deterministicRunId(userId, now, "manual"),
            completion: runtime.startRefresh(input, env),
          };
        },
        waitUntil: (promise) => context.waitUntil(promise),
      });
      if (response) return response;
      return apiError("not_found", "Route not found", 404);
    } catch {
      return apiError("internal_error", "The request could not be completed", 500);
    }
  },

  scheduled(controller, env, context): void {
    const completion = (async () => {
      const userId = await runtime.findOwnerUserId(env);
      if (!userId) throw new Error("Scheduled owner was not found");
      await runtime.startRefresh({
        userId,
        trigger: "scheduled",
        scheduledAt: new Date(controller.scheduledTime),
      }, env);
    })();
    context.waitUntil(completion);
  },
});

export default createWorker(productionRuntime);

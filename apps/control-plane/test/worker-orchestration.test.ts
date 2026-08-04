import {env} from "cloudflare:test";
import {describe, expect, it} from "vitest";
import type {Env} from "../src/env";
import type {AuthRepository, StoredOAuthFlow} from "../src/repositories/auth-repository";
import {createWorker, type WorkerRuntime} from "../src/index";

const bindings = env as unknown as Pick<Env, "DB" | "AI">;
const testEnv: Env = {
  DB: bindings.DB,
  AI: bindings.AI,
  OWNER_GOOGLE_SUB: "owner-subject",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  TOKEN_ENCRYPTION_KEY_B64: "unused-in-this-test",
  SESSION_HASH_KEY: "session-hash-key",
  PUBLIC_APP_ORIGIN: "https://lifeos.example",
};

const authRepository = (): AuthRepository => ({
  async saveOAuthFlow() {},
  async consumeOAuthFlow(): Promise<StoredOAuthFlow | null> { return null; },
  async upsertOwner() { return "owner-a"; },
  async saveSession() {},
  async findSession() {
    return {userId: "owner-a", email: "owner@example.com", googleSubject: "owner-subject"};
  },
  async deleteSession() {},
  async saveAccount() {},
});

describe("worker orchestration boundary", () => {
  it("passes the controller timestamp to one waitUntil scheduled owner refresh", async () => {
    const starts: Array<{userId: string; trigger: string; scheduledAt: string}> = [];
    const pending: Promise<unknown>[] = [];
    const runtime: WorkerRuntime = {
      now: () => new Date("2026-08-03T05:00:01.000Z"),
      authRepository: () => authRepository(),
      async findOwnerUserId() { return "owner-a"; },
      async startRefresh(input) {
        starts.push({...input, scheduledAt: input.scheduledAt.toISOString()});
        return {status: "completed"};
      },
    };
    const worker = createWorker(runtime);
    const context = {
      waitUntil(promise: Promise<unknown>) { pending.push(promise); },
    };

    worker.scheduled({scheduledTime: Date.parse("2026-08-03T05:00:00.000Z"), cron: "0,30 5-16 * * *"}, testEnv, context);
    expect(pending).toHaveLength(1);
    await pending[0];
    expect(starts).toEqual([{userId: "owner-a", trigger: "scheduled", scheduledAt: "2026-08-03T05:00:00.000Z"}]);
  });

  it("redacts exception messages at the authenticated API boundary", async () => {
    const runtime: WorkerRuntime = {
      now: () => new Date("2026-08-03T05:00:00.000Z"),
      authRepository: () => ({
        ...authRepository(),
        async findSession() { throw new Error("refresh-token=private-secret"); },
      }),
      async findOwnerUserId() { return "owner-a"; },
      async startRefresh() { return {status: "completed"}; },
    };
    const worker = createWorker(runtime);
    const context = {
      waitUntil() {},
    };
    const response = await worker.fetch(new Request("https://lifeos.example/api/refresh", {
      method: "POST",
      headers: {
        origin: "https://lifeos.example",
        cookie: "__Host-lifeos_session=opaque-session",
      },
    }), testEnv, context);
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain('"code":"internal_error"');
    expect(body).not.toContain("private-secret");
    expect(body).not.toContain("refresh-token");
  });
});

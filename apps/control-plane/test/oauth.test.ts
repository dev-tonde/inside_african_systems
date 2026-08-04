import {applyD1Migrations, env, SELF} from "cloudflare:test";
import {beforeEach, describe, expect, it} from "vitest";
import type {Env} from "../src/env";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  newPkce,
  type GoogleTokenResponse,
  type OAuthPurpose,
} from "../src/google/oauth";
import {
  createAuthRepository,
  type AuthRepository,
  type StoredOAuthFlow,
} from "../src/repositories/auth-repository";
import {handleAuthRoute, requireOwner} from "../src/routes/auth";
import {decryptSecret, encryptSecret} from "../src/security/crypto";
import {hashOpaqueToken} from "../src/security/session-token";

const appOrigin = "https://lifeos.example";
const callbackUrl = `${appOrigin}/auth/callback`;
const now = new Date("2026-08-03T10:00:00.000Z");
const encryptionKey = btoa(String.fromCharCode(...Array.from({length: 32}, (_, index) => index)));
const readScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const testEnv = {
  OWNER_GOOGLE_SUB: "owner-subject",
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  TOKEN_ENCRYPTION_KEY_B64: encryptionKey,
  SESSION_HASH_KEY: "session-hash-key",
  PUBLIC_APP_ORIGIN: appOrigin,
} as Env;
const testDb = (env as unknown as Env).DB;

const build = (purpose: OAuthPurpose) =>
  buildGoogleAuthorizationUrl({
    clientId: "client-id",
    redirectUri: callbackUrl,
    state: "state-value",
    codeChallenge: "challenge-value",
    purpose,
  });

type SavedFlow = StoredOAuthFlow & {
  stateHash: string;
  sessionIdHash: string | null;
  expiresAt: string;
};
type SavedSession = {idHash: string; userId: string; expiresAt: string; now: string};
type SavedAccount = Parameters<AuthRepository["saveAccount"]>[0];

class FakeAuthRepository implements AuthRepository {
  readonly flows = new Map<string, SavedFlow>();
  readonly savedFlows: SavedFlow[] = [];
  readonly savedSessions: SavedSession[] = [];
  readonly sessions = new Map<string, {userId: string; email: string; googleSubject: string}>();
  readonly deletedSessions: string[] = [];
  readonly savedAccounts: SavedAccount[] = [];
  readonly savedOwners: Array<{googleSubject: string; email: string; now: string}> = [];

  async saveOAuthFlow(input: Parameters<AuthRepository["saveOAuthFlow"]>[0]): Promise<void> {
    const flow = {
      stateHash: input.stateHash,
      purpose: input.purpose,
      encryptedVerifier: input.encryptedVerifier,
      context: input.context,
      userId: input.userId,
      sessionIdHash: input.sessionIdHash,
      expiresAt: input.expiresAt,
    };
    this.flows.set(input.stateHash, flow);
    this.savedFlows.push(flow);
  }

  async consumeOAuthFlow(stateHash: string, currentTime: string): Promise<StoredOAuthFlow | null> {
    const flow = this.flows.get(stateHash);
    this.flows.delete(stateHash);
    if (!flow || flow.expiresAt <= currentTime) return null;
    return flow;
  }

  async upsertOwner(input: Parameters<AuthRepository["upsertOwner"]>[0]): Promise<string> {
    this.savedOwners.push(input);
    return "owner-user-id";
  }

  async saveSession(input: SavedSession): Promise<void> {
    this.savedSessions.push(input);
    this.sessions.set(input.idHash, {
      userId: input.userId,
      email: "owner@example.com",
      googleSubject: "owner-subject",
    });
  }

  async findSession(
    idHash: string,
  ): Promise<{userId: string; email: string; googleSubject: string} | null> {
    return this.sessions.get(idHash) ?? null;
  }

  async deleteSession(idHash: string): Promise<void> {
    this.deletedSessions.push(idHash);
    this.sessions.delete(idHash);
  }

  async saveAccount(input: SavedAccount): Promise<void> {
    this.savedAccounts.push(input);
  }
}

const grantOwnerSession = async (repository: FakeAuthRepository, token = "owner-session") => {
  repository.sessions.set(await hashOpaqueToken(token, testEnv.SESSION_HASH_KEY), {
    userId: "owner-user-id",
    email: "owner@example.com",
    googleSubject: "owner-subject",
  });
  return token;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});

const googleFetcher = (input: {
  tokens?: Partial<GoogleTokenResponse>;
  identity?: Partial<{sub: string; email: string; aud: string; iss: string; exp: string}>;
  tokenStatus?: number;
  tokenError?: string;
  requests?: string[];
}) =>
  (async (request: RequestInfo | URL) => {
    const url = String(request);
    input.requests?.push(url);
    if (url === "https://oauth2.googleapis.com/token") {
      if (input.tokenStatus && input.tokenStatus !== 200) {
        return new Response(input.tokenError ?? "upstream rejected secret-token", {status: input.tokenStatus});
      }
      return jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        id_token: "id-token",
        scope: readScopes.join(" "),
        expires_in: 3600,
        ...input.tokens,
      });
    }
    if (url.startsWith("https://oauth2.googleapis.com/tokeninfo?")) {
      return jsonResponse({
        sub: "owner-subject",
        email: "owner@example.com",
        aud: "client-id",
        iss: "https://accounts.google.com",
        exp: String(Math.floor(now.getTime() / 1000) + 3600),
        ...input.identity,
      });
    }
    throw new Error(`Unexpected external request: ${url}`);
  }) as typeof fetch;

const seedFlow = async (
  repository: FakeAuthRepository,
  input: {
    state?: string;
    purpose: OAuthPurpose;
    context?: "personal" | "work" | null;
    userId?: string | null;
    sessionIdHash?: string | null;
    expiresAt?: string;
  },
) => {
  const state = input.state ?? "callback-state";
  const stateHash = await hashOpaqueToken(state, testEnv.SESSION_HASH_KEY);
  const flow: SavedFlow = {
    stateHash,
    purpose: input.purpose,
    encryptedVerifier: await encryptSecret("pkce-verifier", testEnv.TOKEN_ENCRYPTION_KEY_B64),
    context: input.context ?? null,
    userId: input.userId ?? null,
    sessionIdHash: input.sessionIdHash ?? null,
    expiresAt: input.expiresAt ?? new Date(now.getTime() + 600_000).toISOString(),
  };
  repository.flows.set(stateHash, flow);
  return state;
};

const runCallback = async (input: {
  repository?: FakeAuthRepository;
  purpose: OAuthPurpose;
  context?: "personal" | "work";
  userId?: string;
  flowSessionToken?: string;
  callbackSessionToken?: string | null;
  seedCallbackSession?: boolean;
  callbackSessionUserId?: string;
  state?: string;
  expiresAt?: string;
  tokens?: Partial<GoogleTokenResponse>;
  identity?: Partial<{sub: string; email: string; aud: string; iss: string; exp: string}>;
  tokenStatus?: number;
  tokenError?: string;
  requests?: string[];
}) => {
  const repository = input.repository ?? new FakeAuthRepository();
  const defaultSessionToken = input.purpose === "connect_account" ? "callback-owner-session" : null;
  const flowSessionToken = input.flowSessionToken ?? defaultSessionToken;
  const callbackSessionToken =
    input.callbackSessionToken === undefined ? defaultSessionToken : input.callbackSessionToken;
  if (callbackSessionToken && input.seedCallbackSession !== false) {
    repository.sessions.set(await hashOpaqueToken(callbackSessionToken, testEnv.SESSION_HASH_KEY), {
      userId: input.callbackSessionUserId ?? "owner-user-id",
      email: "owner@example.com",
      googleSubject: "owner-subject",
    });
  }
  const state = await seedFlow(repository, {
    state: input.state,
    purpose: input.purpose,
    context: input.context,
    userId: input.userId,
    sessionIdHash: flowSessionToken
      ? await hashOpaqueToken(flowSessionToken, testEnv.SESSION_HASH_KEY)
      : null,
    expiresAt: input.expiresAt,
  });
  const headers = new Headers();
  if (callbackSessionToken) headers.set("cookie", `__Host-lifeos_session=${callbackSessionToken}`);
  const response = await handleAuthRoute(
    new Request(`${callbackUrl}?state=${encodeURIComponent(state)}&code=authorization-code`, {headers}),
    testEnv,
    {
      repository,
      now: () => now,
      fetcher: googleFetcher({
        ...input,
        tokens: {
          scope: input.purpose === "owner_login" ? "openid email" : readScopes.join(" "),
          ...input.tokens,
        },
      }),
    },
  );
  return {repository, response: response!};
};

describe("Google OAuth primitives", () => {
  it("creates a canonical high-entropy PKCE verifier and its recomputable S256 challenge", async () => {
    const pkce = await newPkce();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pkce.verifier));
    const expectedChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");

    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{64}$/u);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(pkce.challenge).toBe(expectedChallenge);
  });

  it("uses exact identity-only scopes for owner login", () => {
    const url = new URL(build("owner_login"));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("redirect_uri")).toBe(callbackUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });

  it("uses exact read-only Gmail and Calendar scopes for account connection", () => {
    const url = new URL(build("connect_account"));
    const scopes = url.searchParams.get("scope")?.split(" ") ?? [];

    expect(scopes).toEqual(readScopes);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(scopes.some((scope) => /(modify|compose|send|calendar\.events)/u.test(scope))).toBe(false);
  });

  it("sends the exact authorization-code exchange form including the PKCE verifier", async () => {
    let capturedRequest: {url: string; init?: RequestInit} | undefined;
    const fetcher = (async (request: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = {url: String(request), init};
      return jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        id_token: "id-token",
        scope: readScopes.join(" "),
        expires_in: 3600,
      });
    }) as typeof fetch;

    await exchangeGoogleCode({
      code: "authorization-code",
      verifier: "pkce-verifier",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: callbackUrl,
      fetcher,
    });

    expect(capturedRequest?.url).toBe("https://oauth2.googleapis.com/token");
    expect(capturedRequest?.init?.method).toBe("POST");
    expect(capturedRequest?.init?.headers).toEqual({"content-type": "application/x-www-form-urlencoded"});
    expect(new URLSearchParams(String(capturedRequest?.init?.body))).toEqual(
      new URLSearchParams({
        code: "authorization-code",
        code_verifier: "pkce-verifier",
        client_id: "client-id",
        client_secret: "client-secret",
        redirect_uri: callbackUrl,
        grant_type: "authorization_code",
      }),
    );
  });

  it("redacts an upstream token-exchange error", async () => {
    const upstreamSecret = "invalid_grant for client-secret and authorization-code";
    const operation = exchangeGoogleCode({
      code: "authorization-code",
      verifier: "pkce-verifier",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: callbackUrl,
      fetcher: (async () => new Response(upstreamSecret, {status: 400})) as typeof fetch,
    });

    await expect(operation).rejects.toThrow("Google token exchange failed");
    await expect(operation).rejects.not.toThrow(upstreamSecret);
  });
});

describe("auth routes", () => {
  it("stores only a keyed state hash and an encrypted PKCE verifier for owner login", async () => {
    const repository = new FakeAuthRepository();
    const response = await handleAuthRoute(new Request(`${appOrigin}/auth/login`), testEnv, {
      repository,
      now: () => now,
      fetcher: googleFetcher({}),
    });

    expect(response?.status).toBe(302);
    const authorizationUrl = new URL(response!.headers.get("location")!);
    const state = authorizationUrl.searchParams.get("state")!;
    const verifier = await decryptSecret(repository.savedFlows[0].encryptedVerifier, encryptionKey);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");

    expect(repository.savedFlows[0]).toMatchObject({
      stateHash: await hashOpaqueToken(state, testEnv.SESSION_HASH_KEY),
      purpose: "owner_login",
      context: null,
      userId: null,
      sessionIdHash: null,
      expiresAt: "2026-08-03T10:10:00.000Z",
    });
    expect(repository.savedFlows[0].stateHash).not.toContain(state);
    expect(repository.savedFlows[0].encryptedVerifier).not.toContain(verifier);
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(challenge);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(callbackUrl);
  });

  it.each(["personal", "work"] as const)("binds an authenticated owner and %s context to a connect flow", async (context) => {
    const repository = new FakeAuthRepository();
    const token = await grantOwnerSession(repository);
    const response = await handleAuthRoute(
      new Request(`${appOrigin}/auth/connect/${context}`, {
        headers: {cookie: `__Host-lifeos_session=${token}`},
      }),
      testEnv,
      {repository, now: () => now, fetcher: googleFetcher({})},
    );

    expect(response?.status).toBe(302);
    expect(repository.savedFlows).toHaveLength(1);
    expect(repository.savedFlows[0]).toMatchObject({
      purpose: "connect_account",
      context,
      userId: "owner-user-id",
      sessionIdHash: await hashOpaqueToken(token, testEnv.SESSION_HASH_KEY),
    });
  });

  it("requires an owner session to start a connection", async () => {
    const repository = new FakeAuthRepository();
    const response = await handleAuthRoute(new Request(`${appOrigin}/auth/connect/personal`), testEnv, {
      repository,
      now: () => now,
      fetcher: googleFetcher({}),
    });

    expect(response?.status).toBe(401);
    expect(repository.savedFlows).toHaveLength(0);
  });

  it("rejects an unrecognized connection context", async () => {
    const repository = new FakeAuthRepository();
    const token = await grantOwnerSession(repository);
    const response = await handleAuthRoute(
      new Request(`${appOrigin}/auth/connect/shared`, {
        headers: {cookie: `__Host-lifeos_session=${token}`},
      }),
      testEnv,
      {repository, now: () => now, fetcher: googleFetcher({})},
    );

    expect(response?.status).toBe(400);
    expect(repository.savedFlows).toHaveLength(0);
  });

  it.each([
    ["owner login", `${appOrigin.replace("lifeos", "evil")}/auth/login`],
    ["account connection", `${appOrigin.replace("lifeos", "evil")}/auth/connect/personal`],
    ["callback", `${appOrigin.replace("lifeos", "evil")}/auth/callback?state=state&code=code`],
  ])("rejects an origin mismatch on %s", async (_name, url) => {
    const repository = new FakeAuthRepository();
    const response = await handleAuthRoute(new Request(url), testEnv, {
      repository,
      now: () => now,
      fetcher: googleFetcher({}),
    });

    expect(response?.status).toBe(400);
    expect(repository.savedFlows).toHaveLength(0);
  });

  it("creates a seven-day owner session with the exact secure host cookie", async () => {
    const {repository, response} = await runCallback({purpose: "owner_login"});
    const cookie = response.headers.get("set-cookie")!;

    expect(response.status).toBe(302);
    expect(cookie).toMatch(
      /^__Host-lifeos_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800$/u,
    );
    expect(repository.savedOwners).toEqual([
      {googleSubject: "owner-subject", email: "owner@example.com", now: now.toISOString()},
    ]);
    expect(repository.savedSessions).toHaveLength(1);
    expect(repository.savedSessions[0]).toMatchObject({
      userId: "owner-user-id",
      expiresAt: "2026-08-10T10:00:00.000Z",
      now: now.toISOString(),
    });
    expect(cookie).not.toContain(repository.savedSessions[0].idHash);
  });

  it("rejects a non-owner Google subject before creating an owner or session", async () => {
    const {repository, response} = await runCallback({
      purpose: "owner_login",
      identity: {sub: "someone-else"},
    });

    expect(response.status).toBe(403);
    expect(repository.savedOwners).toHaveLength(0);
    expect(repository.savedSessions).toHaveLength(0);
  });

  it.each([
    ["audience", {aud: "another-client"}],
    ["issuer", {iss: "https://evil.example"}],
    ["expiry", {exp: String(Math.floor(now.getTime() / 1000))}],
  ])("rejects an invalid Google identity %s before database writes", async (_name, identity) => {
    const {repository, response} = await runCallback({purpose: "owner_login", identity});

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("OAuth callback failed");
    expect(repository.savedOwners).toHaveLength(0);
    expect(repository.savedSessions).toHaveLength(0);
  });

  it("rejects account connection without a refresh token", async () => {
    const {repository, response} = await runCallback({
      purpose: "connect_account",
      context: "personal",
      userId: "owner-user-id",
      tokens: {refresh_token: undefined},
    });

    expect(response.status).toBe(409);
    expect(repository.savedAccounts).toHaveLength(0);
  });

  it.each([
    ["missing Gmail read access", "openid email https://www.googleapis.com/auth/calendar.readonly"],
    ["missing Calendar read access", "openid email https://www.googleapis.com/auth/gmail.readonly"],
    ["Gmail modify access", `${readScopes.join(" ")} https://www.googleapis.com/auth/gmail.modify`],
    ["Gmail send access", `${readScopes.join(" ")} https://www.googleapis.com/auth/gmail.send`],
    ["Calendar event write access", `${readScopes.join(" ")} https://www.googleapis.com/auth/calendar.events`],
    ["missing OpenID identity access", readScopes.filter((scope) => scope !== "openid").join(" ")],
    ["missing email identity access", readScopes.filter((scope) => scope !== "email").join(" ")],
  ])("rejects unsafe granted scopes: %s", async (_name, scope) => {
    const {repository, response} = await runCallback({
      purpose: "connect_account",
      context: "personal",
      userId: "owner-user-id",
      tokens: {scope},
    });

    expect(response.status).toBe(400);
    expect(repository.savedAccounts).toHaveLength(0);
  });

  it("rejects owner login when Google grants connection scopes beyond the identity request", async () => {
    const {repository, response} = await runCallback({
      purpose: "owner_login",
      tokens: {scope: readScopes.join(" ")},
    });

    expect(response.status).toBe(400);
    expect(repository.savedOwners).toHaveLength(0);
    expect(repository.savedSessions).toHaveLength(0);
  });

  it("encrypts refresh tokens and preserves personal/work account partitioning", async () => {
    const repository = new FakeAuthRepository();
    await runCallback({repository, purpose: "connect_account", context: "personal", userId: "owner-user-id", state: "p"});
    await runCallback({repository, purpose: "connect_account", context: "work", userId: "owner-user-id", state: "w"});

    expect(repository.savedAccounts.map((account) => account.context)).toEqual(["personal", "work"]);
    expect(repository.savedAccounts.map((account) => account.scopes)).toEqual([readScopes, readScopes]);
    for (const account of repository.savedAccounts) {
      expect(account.encryptedRefreshToken).not.toContain("refresh-token");
      await expect(decryptSecret(account.encryptedRefreshToken, encryptionKey)).resolves.toBe("refresh-token");
    }
  });

  it("requires the exact initiating owner session before exchanging a connection code", async () => {
    const repository = new FakeAuthRepository();
    const requests: string[] = [];
    const {response} = await runCallback({
      repository,
      purpose: "connect_account",
      context: "personal",
      userId: "owner-user-id",
      callbackSessionToken: null,
      requests,
    });

    expect(response.status).toBe(401);
    expect(requests).toEqual([]);
    expect(repository.savedAccounts).toHaveLength(0);
  });

  it("rejects an expired or unknown initiating session before exchanging a connection code", async () => {
    const repository = new FakeAuthRepository();
    const requests: string[] = [];
    const {response} = await runCallback({
      repository,
      purpose: "connect_account",
      context: "personal",
      userId: "owner-user-id",
      seedCallbackSession: false,
      requests,
    });

    expect(response.status).toBe(401);
    expect(requests).toEqual([]);
    expect(repository.savedAccounts).toHaveLength(0);
  });

  it("rejects a different valid owner session before exchanging a connection code", async () => {
    const repository = new FakeAuthRepository();
    const requests: string[] = [];
    const {response} = await runCallback({
      repository,
      purpose: "connect_account",
      context: "personal",
      userId: "owner-user-id",
      flowSessionToken: "initiating-owner-session",
      callbackSessionToken: "different-owner-session",
      requests,
    });

    expect(response.status).toBe(403);
    expect(requests).toEqual([]);
    expect(repository.savedAccounts).toHaveLength(0);
  });

  it("rejects a flow bound to another user before exchanging a connection code", async () => {
    const repository = new FakeAuthRepository();
    const requests: string[] = [];
    const {response} = await runCallback({
      repository,
      purpose: "connect_account",
      context: "personal",
      userId: "another-user-id",
      requests,
    });

    expect(response.status).toBe(403);
    expect(requests).toEqual([]);
    expect(repository.savedAccounts).toHaveLength(0);
  });

  it("completes a connection with the exact initiating owner session", async () => {
    const requests: string[] = [];
    const {repository, response} = await runCallback({
      purpose: "connect_account",
      context: "work",
      userId: "owner-user-id",
      flowSessionToken: "exact-owner-session",
      callbackSessionToken: "exact-owner-session",
      requests,
    });

    expect(response.status).toBe(302);
    expect(requests).toHaveLength(2);
    expect(repository.savedAccounts).toHaveLength(1);
    expect(repository.savedAccounts[0].context).toBe("work");
  });

  it("consumes callback state once", async () => {
    const repository = new FakeAuthRepository();
    const state = await seedFlow(repository, {
      purpose: "connect_account",
      context: "personal",
      userId: "owner-user-id",
      sessionIdHash: await hashOpaqueToken("owner-session", testEnv.SESSION_HASH_KEY),
    });
    await grantOwnerSession(repository);
    const request = () =>
      new Request(`${callbackUrl}?state=${state}&code=authorization-code`, {
        headers: {cookie: "__Host-lifeos_session=owner-session"},
      });
    const dependencies = {repository, now: () => now, fetcher: googleFetcher({})};

    expect((await handleAuthRoute(request(), testEnv, dependencies))?.status).toBe(302);
    expect((await handleAuthRoute(request(), testEnv, dependencies))?.status).toBe(400);
    expect(repository.savedAccounts).toHaveLength(1);
  });

  it("rejects and consumes an expired callback state", async () => {
    const repository = new FakeAuthRepository();
    const state = await seedFlow(repository, {
      purpose: "connect_account",
      context: "personal",
      userId: "owner-user-id",
      sessionIdHash: await hashOpaqueToken("owner-session", testEnv.SESSION_HASH_KEY),
      expiresAt: "2026-08-03T09:59:59.000Z",
    });
    const dependencies = {repository, now: () => now, fetcher: googleFetcher({})};
    const request = () =>
      new Request(`${callbackUrl}?state=${state}&code=authorization-code`, {
        headers: {cookie: "__Host-lifeos_session=owner-session"},
      });

    expect((await handleAuthRoute(request(), testEnv, dependencies))?.status).toBe(400);
    expect((await handleAuthRoute(request(), testEnv, dependencies))?.status).toBe(400);
    expect(repository.savedAccounts).toHaveLength(0);
  });

  it("returns a safe callback error without upstream or secret values", async () => {
    const {response} = await runCallback({
      purpose: "owner_login",
      tokenStatus: 400,
      tokenError: "invalid client-secret authorization-code id-token",
    });
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toBe("OAuth callback failed");
    expect(body).not.toMatch(/client-secret|authorization-code|id-token/iu);
  });

  it("returns unauthorized and authenticated owner identities from GET /api/me", async () => {
    const repository = new FakeAuthRepository();
    const unauthorized = await handleAuthRoute(new Request(`${appOrigin}/api/me`), testEnv, {
      repository,
      now: () => now,
      fetcher: googleFetcher({}),
    });
    const token = await grantOwnerSession(repository);
    const authorized = await handleAuthRoute(
      new Request(`${appOrigin}/api/me`, {headers: {cookie: `other=value; __Host-lifeos_session=${token}`}}),
      testEnv,
      {repository, now: () => now, fetcher: googleFetcher({})},
    );

    expect(unauthorized?.status).toBe(401);
    expect(authorized?.status).toBe(200);
    await expect(authorized?.json()).resolves.toEqual({userId: "owner-user-id", email: "owner@example.com"});
    expect(authorized?.headers.get("cache-control")).toBe("no-store");
  });

  it("invalidates the current session and clears the secure host cookie on logout", async () => {
    const repository = new FakeAuthRepository();
    const token = await grantOwnerSession(repository);
    const response = await handleAuthRoute(
      new Request(`${appOrigin}/auth/logout`, {
        method: "POST",
        headers: {cookie: `__Host-lifeos_session=${token}`, origin: appOrigin},
      }),
      testEnv,
      {repository, now: () => now, fetcher: googleFetcher({})},
    );

    expect(response?.status).toBe(204);
    expect(repository.deletedSessions).toEqual([await hashOpaqueToken(token, testEnv.SESSION_HASH_KEY)]);
    expect(response?.headers.get("set-cookie")).toBe(
      "__Host-lifeos_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0",
    );
    expect((await requireOwner(new Request(`${appOrigin}/api/me`, {headers: {cookie: `__Host-lifeos_session=${token}`}}), testEnv, repository)) instanceof Response).toBe(true);
  });

  it.each([
    ["missing", null],
    ["hostile", "https://evil.example"],
  ])("rejects a logout with a %s initiating Origin without changing the session", async (_name, origin) => {
    const repository = new FakeAuthRepository();
    const token = await grantOwnerSession(repository);
    const headers = new Headers({cookie: `__Host-lifeos_session=${token}`});
    if (origin) headers.set("origin", origin);

    const response = await handleAuthRoute(
      new Request(`${appOrigin}/auth/logout`, {method: "POST", headers}),
      testEnv,
      {repository, now: () => now, fetcher: googleFetcher({})},
    );

    expect(response?.status).toBe(403);
    expect(repository.deletedSessions).toEqual([]);
    expect(response?.headers.get("set-cookie")).toBeNull();
    expect(repository.sessions.has(await hashOpaqueToken(token, testEnv.SESSION_HASH_KEY))).toBe(true);
  });

  it("rejects a session issued to a subject that is no longer the configured owner", async () => {
    const repository = new FakeAuthRepository();
    const token = "stale-owner-session";
    repository.sessions.set(await hashOpaqueToken(token, testEnv.SESSION_HASH_KEY), {
      userId: "previous-owner-id",
      email: "previous@example.com",
      googleSubject: "previous-owner-subject",
    });

    const result = await requireOwner(
      new Request(`${appOrigin}/api/me`, {headers: {cookie: `__Host-lifeos_session=${token}`}}),
      testEnv,
      repository,
    );

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });
});

const repositoryMigrations = [
  {
    name: "0001_read_only_core.sql",
    queries: [
      "CREATE TABLE users (id TEXT PRIMARY KEY, google_subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL, time_zone TEXT NOT NULL CHECK (time_zone = 'Africa/Johannesburg'), created_at TEXT NOT NULL)",
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, google_subject TEXT NOT NULL, email TEXT NOT NULL, context TEXT NOT NULL CHECK (context IN ('personal', 'work')), encrypted_refresh_token TEXT NOT NULL, scopes_json TEXT NOT NULL, connected_at TEXT NOT NULL, UNIQUE(user_id, google_subject), UNIQUE(user_id, context))",
      "CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)",
      "CREATE TABLE oauth_flows (state_hash TEXT PRIMARY KEY, purpose TEXT NOT NULL CHECK (purpose IN ('owner_login', 'connect_account')), code_verifier_encrypted TEXT NOT NULL, context TEXT CHECK (context IN ('personal', 'work')), expires_at TEXT NOT NULL, created_at TEXT NOT NULL)",
    ],
  },
  {
    name: "0002_oauth_owner.sql",
    queries: [
      "ALTER TABLE oauth_flows ADD COLUMN user_id TEXT",
      "CREATE INDEX idx_oauth_flows_expires ON oauth_flows(expires_at)",
    ],
  },
  {
    name: "0003_oauth_session_binding.sql",
    queries: ["ALTER TABLE oauth_flows ADD COLUMN session_id_hash TEXT"],
  },
];

describe("D1 auth repository", () => {
  beforeEach(async () => {
    await applyD1Migrations(testDb, repositoryMigrations);
  });

  it("atomically consumes an OAuth flow only once", async () => {
    const repository = createAuthRepository(testDb);
    await repository.saveOAuthFlow({
      stateHash: "state-hash",
      purpose: "connect_account",
      encryptedVerifier: "encrypted-verifier",
      context: "work",
      userId: "owner-user-id",
      sessionIdHash: "initiating-session-hash",
      expiresAt: "2026-08-03T10:10:00.000Z",
    });

    await expect(repository.consumeOAuthFlow("state-hash", now.toISOString())).resolves.toEqual({
      purpose: "connect_account",
      encryptedVerifier: "encrypted-verifier",
      context: "work",
      userId: "owner-user-id",
      sessionIdHash: "initiating-session-hash",
    });
    await expect(repository.consumeOAuthFlow("state-hash", now.toISOString())).resolves.toBeNull();
  });

  it("rejects and deletes an expired OAuth flow", async () => {
    const repository = createAuthRepository(testDb);
    await repository.saveOAuthFlow({
      stateHash: "expired-state-hash",
      purpose: "owner_login",
      encryptedVerifier: "encrypted-verifier",
      context: null,
      userId: null,
      sessionIdHash: null,
      expiresAt: "2026-08-03T09:59:59.000Z",
    });

    await expect(repository.consumeOAuthFlow("expired-state-hash", now.toISOString())).resolves.toBeNull();
    const row = await testDb.prepare("SELECT state_hash FROM oauth_flows WHERE state_hash = ?")
      .bind("expired-state-hash")
      .first();
    expect(row).toBeNull();
  });

  it("persists, resolves, expires, and deletes keyed sessions", async () => {
    const repository = createAuthRepository(testDb);
    const userId = await repository.upsertOwner({
      googleSubject: "owner-subject",
      email: "owner@example.com",
      now: now.toISOString(),
    });
    await repository.saveSession({
      idHash: "valid-session-hash",
      userId,
      expiresAt: "2026-08-03T10:00:01.000Z",
      now: now.toISOString(),
    });
    await repository.saveSession({
      idHash: "expired-session-hash",
      userId,
      expiresAt: "2026-08-03T09:59:59.000Z",
      now: now.toISOString(),
    });

    await expect(repository.findSession("valid-session-hash", now.toISOString())).resolves.toEqual({
      userId,
      email: "owner@example.com",
      googleSubject: "owner-subject",
    });
    await expect(repository.findSession("expired-session-hash", now.toISOString())).resolves.toBeNull();
    await repository.deleteSession("valid-session-hash");
    await expect(repository.findSession("valid-session-hash", now.toISOString())).resolves.toBeNull();
  });

  it("upserts reconnects by context and never creates a third account", async () => {
    const repository = createAuthRepository(testDb);
    const userId = await repository.upsertOwner({
      googleSubject: "owner-subject",
      email: "owner@example.com",
      now: now.toISOString(),
    });
    await repository.saveAccount({
      userId,
      googleSubject: "personal-subject",
      email: "personal@example.com",
      context: "personal",
      encryptedRefreshToken: "encrypted-personal-v1",
      scopes: readScopes,
      now: now.toISOString(),
    });
    await repository.saveAccount({
      userId,
      googleSubject: "work-subject",
      email: "work@example.com",
      context: "work",
      encryptedRefreshToken: "encrypted-work",
      scopes: readScopes,
      now: now.toISOString(),
    });
    await repository.saveAccount({
      userId,
      googleSubject: "personal-subject-v2",
      email: "new-personal@example.com",
      context: "personal",
      encryptedRefreshToken: "encrypted-personal-v2",
      scopes: readScopes,
      now: "2026-08-04T10:00:00.000Z",
    });

    const accounts = await testDb.prepare(
      "SELECT context, google_subject, email, encrypted_refresh_token FROM accounts WHERE user_id = ? ORDER BY context",
    )
      .bind(userId)
      .all<{context: string; google_subject: string; email: string; encrypted_refresh_token: string}>();
    expect(accounts.results).toEqual([
      {
        context: "personal",
        google_subject: "personal-subject-v2",
        email: "new-personal@example.com",
        encrypted_refresh_token: "encrypted-personal-v2",
      },
      {
        context: "work",
        google_subject: "work-subject",
        email: "work@example.com",
        encrypted_refresh_token: "encrypted-work",
      },
    ]);
  });
});

describe("Worker auth policy boundary", () => {
  it("keeps health public and defaults unknown API routes to unauthorized", async () => {
    const health = await SELF.fetch("https://lifeos.test/api/health");
    const unknownApi = await SELF.fetch("https://lifeos.test/api/unknown");

    expect(health.status).toBe(200);
    expect(unknownApi.status).toBe(401);
    expect(unknownApi.headers.get("cache-control")).toBe("no-store");
  });
});

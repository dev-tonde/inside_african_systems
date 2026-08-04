import type {Env} from "../env";
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleCode,
  fetchGoogleIdentity,
  identityScopes,
  newPkce,
  readOnlyScopes,
  type GoogleIdentity,
  type GoogleTokenResponse,
  type OAuthPurpose,
} from "../google/oauth";
import type {AuthRepository, StoredOAuthFlow} from "../repositories/auth-repository";
import {decryptSecret, encryptSecret} from "../security/crypto";
import {hashOpaqueToken, newOpaqueToken} from "../security/session-token";

const sessionCookieName = "__Host-lifeos_session";
const sessionLifetimeSeconds = 604_800;
const oauthLifetimeMilliseconds = 10 * 60 * 1000;
const allowedGrantedScopes = new Set<string>(readOnlyScopes);

export type AuthRouteDependencies = {
  repository: AuthRepository;
  now: () => Date;
  fetcher: typeof fetch;
};

export type HandleAuthRoute = (
  request: Request,
  env: Env,
  dependencies: AuthRouteDependencies,
) => Promise<Response | null>;

export type RequireOwner = (
  request: Request,
  env: Env,
  repository: AuthRepository,
) => Promise<{userId: string; email: string} | Response>;

const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, {
    status,
    headers: {"cache-control": "no-store", ...headers},
  });

const error = (code: string, message: string, status: number) =>
  json({error: {code, message, requestId: crypto.randomUUID()}}, status);

const text = (body: string, status: number) =>
  new Response(body, {status, headers: {"cache-control": "no-store"}});

const sessionCookie = (token: string, maxAge: number) =>
  `${sessionCookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;

const readSessionCookie = (request: Request): string | null => {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === sessionCookieName) {
      const value = part.slice(separator + 1).trim();
      return value || null;
    }
  }
  return null;
};

const callbackUri = (env: Env) => new URL("/auth/callback", env.PUBLIC_APP_ORIGIN).toString();

const requestHasPinnedOrigin = (request: Request, env: Env) =>
  new URL(request.url).origin === env.PUBLIC_APP_ORIGIN;

const identityIsValid = (identity: GoogleIdentity, env: Env, now: Date): boolean => {
  const expirationSeconds = Number(identity.exp);
  return (
    identity.aud === env.GOOGLE_CLIENT_ID &&
    ["accounts.google.com", "https://accounts.google.com"].includes(identity.iss) &&
    Number.isFinite(expirationSeconds) &&
    expirationSeconds * 1000 > now.getTime()
  );
};

const grantedScopesAreSafe = (scopeValue: string, purpose: OAuthPurpose): string[] | null => {
  const scopes = scopeValue.split(/\s+/u).filter(Boolean);
  const expectedScopes = purpose === "owner_login" ? identityScopes : readOnlyScopes;
  const granted = new Set(scopes);
  if (
    granted.size !== expectedScopes.length ||
    scopes.some((scope) => !allowedGrantedScopes.has(scope)) ||
    !expectedScopes.every((scope) => granted.has(scope))
  ) {
    return null;
  }
  return [...expectedScopes];
};

const startOAuth = async (
  env: Env,
  dependencies: AuthRouteDependencies,
  purpose: OAuthPurpose,
  context: StoredOAuthFlow["context"],
  userId: string | null,
): Promise<Response> => {
  const {verifier, challenge} = await newPkce();
  const state = newOpaqueToken();
  const stateHash = await hashOpaqueToken(state, env.SESSION_HASH_KEY);
  const encryptedVerifier = await encryptSecret(verifier, env.TOKEN_ENCRYPTION_KEY_B64);
  const expiresAt = new Date(dependencies.now().getTime() + oauthLifetimeMilliseconds).toISOString();
  await dependencies.repository.saveOAuthFlow({
    stateHash,
    purpose,
    encryptedVerifier,
    context,
    userId,
    expiresAt,
  });
  const location = buildGoogleAuthorizationUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: callbackUri(env),
    state,
    codeChallenge: challenge,
    purpose,
  });
  return new Response(null, {
    status: 302,
    headers: {location, "cache-control": "no-store"},
  });
};

const handleCallback = async (
  request: Request,
  env: Env,
  dependencies: AuthRouteDependencies,
): Promise<Response> => {
  if (!requestHasPinnedOrigin(request, env)) return text("Invalid request origin", 400);

  try {
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    if (!state) return text("OAuth callback failed", 400);
    const stateHash = await hashOpaqueToken(state, env.SESSION_HASH_KEY);
    const flow = await dependencies.repository.consumeOAuthFlow(stateHash, dependencies.now().toISOString());
    if (!flow) return text("OAuth callback failed", 400);

    const code = url.searchParams.get("code");
    if (!code) return text("OAuth callback failed", 400);
    const verifier = await decryptSecret(flow.encryptedVerifier, env.TOKEN_ENCRYPTION_KEY_B64);
    const tokens = await exchangeGoogleCode({
      code,
      verifier,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: callbackUri(env),
      fetcher: dependencies.fetcher,
    });
    if (!tokens.id_token || typeof tokens.scope !== "string") return text("OAuth callback failed", 400);
    const identity = await fetchGoogleIdentity(tokens.id_token, dependencies.fetcher);
    if (!identityIsValid(identity, env, dependencies.now())) return text("OAuth callback failed", 400);
    const scopes = grantedScopesAreSafe(tokens.scope, flow.purpose);
    if (!scopes) return text("OAuth callback failed", 400);

    if (flow.purpose === "owner_login") {
      if (identity.sub !== env.OWNER_GOOGLE_SUB) return text("Forbidden", 403);
      const timestamp = dependencies.now();
      const userId = await dependencies.repository.upsertOwner({
        googleSubject: identity.sub,
        email: identity.email,
        now: timestamp.toISOString(),
      });
      const token = newOpaqueToken();
      await dependencies.repository.saveSession({
        idHash: await hashOpaqueToken(token, env.SESSION_HASH_KEY),
        userId,
        expiresAt: new Date(timestamp.getTime() + sessionLifetimeSeconds * 1000).toISOString(),
        now: timestamp.toISOString(),
      });
      return new Response(null, {
        status: 302,
        headers: {
          location: new URL("/", env.PUBLIC_APP_ORIGIN).toString(),
          "cache-control": "no-store",
          "set-cookie": sessionCookie(token, sessionLifetimeSeconds),
        },
      });
    }

    if (!flow.userId || !flow.context) return text("OAuth callback failed", 400);
    if (!tokens.refresh_token) return text("Google did not return offline access", 409);
    const timestamp = dependencies.now().toISOString();
    await dependencies.repository.saveAccount({
      userId: flow.userId,
      googleSubject: identity.sub,
      email: identity.email,
      context: flow.context,
      encryptedRefreshToken: await encryptSecret(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY_B64),
      scopes,
      now: timestamp,
    });
    return new Response(null, {
      status: 302,
      headers: {location: new URL("/", env.PUBLIC_APP_ORIGIN).toString(), "cache-control": "no-store"},
    });
  } catch {
    return text("OAuth callback failed", 400);
  }
};

export const requireOwner: RequireOwner = async (request, env, repository) => {
  const token = readSessionCookie(request);
  if (!token) return error("unauthorized", "Authentication required", 401);
  const idHash = await hashOpaqueToken(token, env.SESSION_HASH_KEY);
  const owner = await repository.findSession(idHash, new Date().toISOString());
  if (!owner || owner.googleSubject !== env.OWNER_GOOGLE_SUB) {
    return error("unauthorized", "Authentication required", 401);
  }
  return {userId: owner.userId, email: owner.email};
};

export const handleAuthRoute: HandleAuthRoute = async (request, env, dependencies) => {
  const url = new URL(request.url);

  if (url.pathname === "/auth/login") {
    if (request.method !== "GET") return text("Method not allowed", 405);
    if (!requestHasPinnedOrigin(request, env)) return text("Invalid request origin", 400);
    return startOAuth(env, dependencies, "owner_login", null, null);
  }

  if (url.pathname.startsWith("/auth/connect/")) {
    if (request.method !== "GET") return text("Method not allowed", 405);
    if (!requestHasPinnedOrigin(request, env)) return text("Invalid request origin", 400);
    const context = url.pathname.slice("/auth/connect/".length);
    if (context !== "personal" && context !== "work") return text("Invalid account context", 400);
    const owner = await requireOwner(request, env, dependencies.repository);
    if (owner instanceof Response) return owner;
    return startOAuth(env, dependencies, "connect_account", context, owner.userId);
  }

  if (url.pathname === "/auth/callback") {
    if (request.method !== "GET") return text("Method not allowed", 405);
    return handleCallback(request, env, dependencies);
  }

  if (url.pathname === "/auth/logout") {
    if (request.method !== "POST") return text("Method not allowed", 405);
    const token = readSessionCookie(request);
    if (token) {
      await dependencies.repository.deleteSession(await hashOpaqueToken(token, env.SESSION_HASH_KEY));
    }
    return new Response(null, {
      status: 204,
      headers: {
        "cache-control": "no-store",
        "set-cookie": sessionCookie("", 0),
      },
    });
  }

  if (url.pathname === "/api/me") {
    if (request.method !== "GET") return text("Method not allowed", 405);
    const owner = await requireOwner(request, env, dependencies.repository);
    if (owner instanceof Response) return owner;
    return json(owner);
  }

  return null;
};

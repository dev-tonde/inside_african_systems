import {bytesToBase64Url} from "../security/base64url";

export type OAuthPurpose = "owner_login" | "connect_account";

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  scope: string;
  expires_in: number;
};

export type GoogleIdentity = {
  sub: string;
  email: string;
  aud: string;
  iss: string;
  exp: string;
};

export const identityScopes = ["openid", "email"] as const;
export const readOnlyScopes = [
  ...identityScopes,
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export const newPkce = async (): Promise<{verifier: string; challenge: string}> => {
  const verifier = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return {verifier, challenge: bytesToBase64Url(new Uint8Array(digest))};
};

export const buildGoogleAuthorizationUrl = (input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  purpose: OAuthPurpose;
}): string => {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: (input.purpose === "owner_login" ? identityScopes : readOnlyScopes).join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: input.purpose === "connect_account" ? "consent" : "select_account",
  }).toString();
  return url.toString();
};

export const exchangeGoogleCode = async (input: {
  code: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetcher?: typeof fetch;
}): Promise<GoogleTokenResponse> => {
  const response = await (input.fetcher ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      code: input.code,
      code_verifier: input.verifier,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error("Google token exchange failed");
  return (await response.json()) as GoogleTokenResponse;
};

export const fetchGoogleIdentity = async (
  idToken: string,
  fetcher: typeof fetch = fetch,
): Promise<GoogleIdentity> => {
  const url = new URL("https://oauth2.googleapis.com/tokeninfo");
  url.searchParams.set("id_token", idToken);
  const response = await fetcher(url);
  if (!response.ok) throw new Error("Google identity validation failed");
  return (await response.json()) as GoogleIdentity;
};

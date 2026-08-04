import {decryptSecret} from "../security/crypto";

export type GetGoogleAccessToken = (input: {
  encryptedRefreshToken: string;
  encryptionKeyB64: string;
  clientId: string;
  clientSecret: string;
  fetcher?: typeof fetch;
}) => Promise<string>;

export const getGoogleAccessToken: GetGoogleAccessToken = async (input) => {
  const refreshToken = await decryptSecret(input.encryptedRefreshToken, input.encryptionKeyB64);
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded"},
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
  } catch {
    throw new Error("Google access token refresh failed");
  }
  if (!response.ok) throw new Error("Google access token refresh failed");

  const payload: unknown = await response.json().catch(() => null);
  const accessToken = typeof payload === "object" && payload !== null
    ? (payload as {access_token?: unknown}).access_token
    : null;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("Google access token refresh failed");
  }
  return accessToken;
};

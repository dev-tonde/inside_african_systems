import {bytesToBase64Url} from "./base64url";

export const newOpaqueToken = (): string => bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));

export const hashOpaqueToken = async (token: string, hashKey: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(hashKey),
    {name: "HMAC", hash: "SHA-256"},
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return bytesToBase64Url(new Uint8Array(signature));
};

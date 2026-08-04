import {base64ToBytes, base64UrlToBytes, bytesToBase64Url} from "./base64url";

const importAesKey = async (keyB64: string): Promise<CryptoKey> => {
  const keyBytes = base64ToBytes(keyB64);
  if (keyBytes.byteLength !== 32) throw new Error("Encryption key must be 32 bytes");
  return crypto.subtle.importKey("raw", keyBytes, {name: "AES-GCM"}, false, ["encrypt", "decrypt"]);
};

export const encryptSecret = async (plaintext: string, keyB64: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(keyB64);
  const ciphertext = await crypto.subtle.encrypt(
    {name: "AES-GCM", iv},
    key,
    new TextEncoder().encode(plaintext),
  );
  return "v1." + bytesToBase64Url(iv) + "." + bytesToBase64Url(new Uint8Array(ciphertext));
};

export const decryptSecret = async (payload: string, keyB64: string): Promise<string> => {
  const parts = payload.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) {
    throw new Error("Unsupported encrypted secret");
  }

  const iv = base64UrlToBytes(parts[1]);
  const ciphertext = base64UrlToBytes(parts[2]);
  if (iv.byteLength !== 12 || ciphertext.byteLength < 16) throw new Error("Malformed encrypted secret");

  const key = await importAesKey(keyB64);
  const plaintext = await crypto.subtle.decrypt({name: "AES-GCM", iv}, key, ciphertext);
  return new TextDecoder().decode(plaintext);
};

import {describe, expect, it} from "vitest";
import {decryptSecret, encryptSecret} from "../src/security/crypto";
import {hashOpaqueToken, newOpaqueToken} from "../src/security/session-token";

const key = btoa(String.fromCharCode(...Array.from({length: 32}, (_, index) => index)));
const wrongKey = btoa(String.fromCharCode(...Array.from({length: 32}, (_, index) => 255 - index)));
const base64UrlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const decodeBase64Url = (value: string): Uint8Array => {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const encodeBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

describe("security primitives", () => {
  it("round-trips an encrypted secret without exposing plaintext", async () => {
    const encrypted = await encryptSecret("refresh-token-value", key);

    expect(encrypted).not.toContain("refresh-token-value");
    await expect(decryptSecret(encrypted, key)).resolves.toBe("refresh-token-value");
  });

  it("uses the v1 compact format with a 12-byte IV and 16-byte authentication tag", async () => {
    const encrypted = await encryptSecret("refresh-token-value", key);
    const match = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(encrypted);

    expect(match).not.toBeNull();
    expect(decodeBase64Url(match![1])).toHaveLength(12);
    expect(decodeBase64Url(match![2])).toHaveLength(35);
  });

  it("uses a fresh IV for every encryption", async () => {
    const first = await encryptSecret("refresh-token-value", key);
    const second = await encryptSecret("refresh-token-value", key);

    expect(first).not.toBe(second);
    await expect(decryptSecret(first, key)).resolves.toBe("refresh-token-value");
    await expect(decryptSecret(second, key)).resolves.toBe("refresh-token-value");
  });

  it("round-trips Unicode secrets", async () => {
    const plaintext = "Mámá 🦁 東京";

    await expect(decryptSecret(await encryptSecret(plaintext, key), key)).resolves.toBe(plaintext);
  });

  it("rejects decryption with a different key", async () => {
    const encrypted = await encryptSecret("refresh-token-value", key);

    await expect(decryptSecret(encrypted, wrongKey)).rejects.toThrow();
  });

  it.each([
    btoa(String.fromCharCode(...Array.from({length: 31}, (_, index) => index))),
    btoa(String.fromCharCode(...Array.from({length: 33}, (_, index) => index))),
    "not valid base64!",
  ])("rejects an invalid AES key %s", async (invalidKey) => {
    await expect(encryptSecret("refresh-token-value", invalidKey)).rejects.toThrow();
  });

  it("rejects tampered ciphertext", async () => {
    const encrypted = await encryptSecret("refresh-token-value", key);
    const [version, iv, ciphertextPart] = encrypted.split(".");
    const ciphertext = decodeBase64Url(ciphertextPart);
    ciphertext[0] ^= 1;
    const tampered = `${version}.${iv}.${encodeBase64Url(ciphertext)}`;

    await expect(decryptSecret(tampered, key)).rejects.toThrow();
  });

  it("rejects a non-canonical ciphertext alias that decodes to the same bytes", async () => {
    const encrypted = await encryptSecret("refresh-token-value", key);
    const [version, iv, ciphertextPart] = encrypted.split(".");
    const finalIndex = base64UrlAlphabet.indexOf(ciphertextPart.at(-1)!);
    const alias = ciphertextPart.slice(0, -1) + base64UrlAlphabet[(finalIndex & 0b111100) | ((finalIndex + 1) & 0b11)];

    expect(decodeBase64Url(alias)).toEqual(decodeBase64Url(ciphertextPart));
    await expect(decryptSecret(`${version}.${iv}.${alias}`, key)).rejects.toThrow();
  });

  it.each(["v2.abc.def", "v1..def", "v1.abc.", "v1.abc.def.extra", "not-a-payload"])(
    "rejects malformed encrypted payload %s",
    async (payload) => {
      await expect(decryptSecret(payload, key)).rejects.toThrow();
    },
  );

  it("creates distinct opaque tokens with stable keyed hashes", async () => {
    const first = newOpaqueToken();
    const second = newOpaqueToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(decodeBase64Url(first)).toHaveLength(32);
    expect(decodeBase64Url(second)).toHaveLength(32);
    expect(first.at(-1)).toMatch(/^[AEIMQUYcgkosw048]$/u);
    expect(second.at(-1)).toMatch(/^[AEIMQUYcgkosw048]$/u);
    expect(first).not.toBe(second);
    await expect(hashOpaqueToken(first, "hash-key")).resolves.toBe(await hashOpaqueToken(first, "hash-key"));
  });

  it("changes the keyed hash when either the token or key differs", async () => {
    const first = await hashOpaqueToken("token-one", "hash-key");
    const differentToken = await hashOpaqueToken("token-two", "hash-key");
    const differentKey = await hashOpaqueToken("token-one", "different-hash-key");

    expect(first).not.toBe(differentToken);
    expect(first).not.toBe(differentKey);
  });

  it("uses HMAC-SHA-256 for opaque token hashes", async () => {
    await expect(hashOpaqueToken("The quick brown fox jumps over the lazy dog", "key")).resolves.toBe(
      "97yD9DBThCSxMpjmqm-xQ-9NWaFJRhdZl0edvC0aPNg",
    );
  });
});

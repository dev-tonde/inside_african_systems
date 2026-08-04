import {describe, expect, it} from "vitest";
import {decryptSecret, encryptSecret} from "../src/security/crypto";
import {hashOpaqueToken, newOpaqueToken} from "../src/security/session-token";

const key = btoa(String.fromCharCode(...Array.from({length: 32}, (_, index) => index)));
const wrongKey = btoa(String.fromCharCode(...Array.from({length: 32}, (_, index) => 255 - index)));

describe("security primitives", () => {
  it("round-trips an encrypted secret without exposing plaintext", async () => {
    const encrypted = await encryptSecret("refresh-token-value", key);

    expect(encrypted).not.toContain("refresh-token-value");
    await expect(decryptSecret(encrypted, key)).resolves.toBe("refresh-token-value");
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

  it("rejects tampered ciphertext", async () => {
    const encrypted = await encryptSecret("refresh-token-value", key);
    const tampered = encrypted.slice(0, -1) + (encrypted.endsWith("A") ? "B" : "A");

    await expect(decryptSecret(tampered, key)).rejects.toThrow();
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
});

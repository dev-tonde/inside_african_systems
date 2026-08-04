import {SELF} from "cloudflare:test";
import {describe, expect, it} from "vitest";

describe("health route", () => {
  it("reports the service and read-only mode without caching", async () => {
    const response = await SELF.fetch("https://lifeos.test/api/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      service: "lifeos-control-plane",
      mode: "read-only",
    });
  });

  it("protects unknown API routes with the uncached auth boundary", async () => {
    const response = await SELF.fetch("https://lifeos.test/api/unknown");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "unauthorized",
        message: "Authentication required",
      },
    });
  });
});

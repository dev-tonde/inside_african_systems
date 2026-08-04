import {describe, expect, it} from "vitest";
import {handleCockpitRoute, type CockpitRepositories} from "../src/routes/cockpit";

const owner = {userId: "owner-a", email: "owner@example.com"};

const harness = () => {
  const calls: Array<{route: string; userId: string; input?: unknown}> = [];
  const pending: Promise<unknown>[] = [];
  const repositories: CockpitRepositories = {
    plans: {
      async nextRevision() { return 1; },
      async save() {},
      async getLatest(userId, localDate) {
        calls.push({route: "today", userId, input: localDate});
        return null;
      },
      async getRefreshEnvelope(userId, after) {
        calls.push({route: "refresh", userId, input: after});
        return null;
      },
    },
    readModels: {
      async listInbox(userId, input) {
        calls.push({route: "inbox", userId, input});
        return [];
      },
      async listCalendar(userId, input) {
        calls.push({route: "calendar", userId, input});
        return [];
      },
      async loadPlanInputs() { return {emails: [], events: []}; },
    },
    now: () => new Date("2026-08-03T22:30:00.000Z"),
    publicOrigin: "https://lifeos.example",
    startRefresh(userId, now) {
      calls.push({route: "start", userId, input: now.toISOString()});
      return {
        runId: "refresh:owner-a:2026-08-04T00:30",
        completion: Promise.resolve(),
      };
    },
    waitUntil(promise) {
      pending.push(promise);
    },
  };
  return {repositories, calls, pending};
};

describe("cockpit routes", () => {
  it("uses Johannesburg's local date for the owner-only today view", async () => {
    const test = harness();
    const response = await handleCockpitRoute(new Request("https://lifeos.example/api/today"), owner, test.repositories);

    expect(response?.status).toBe(200);
    expect(test.calls).toEqual([{route: "today", userId: "owner-a", input: "2026-08-04"}]);
  });

  it("strictly parses refresh revisions and rejects duplicates, negatives, decimals, and junk", async () => {
    const test = harness();
    const valid = await handleCockpitRoute(new Request("https://lifeos.example/api/refresh?after=12"), owner, test.repositories);
    expect(valid?.status).toBe(200);
    expect(test.calls.at(-1)).toEqual({route: "refresh", userId: "owner-a", input: 12});

    for (const query of ["after=-1", "after=1.5", "after=1x", "after=1&after=2"]) {
      const response = await handleCockpitRoute(new Request(`https://lifeos.example/api/refresh?${query}`), owner, test.repositories);
      expect(response?.status, query).toBe(400);
    }
  });

  it("strictly bounds inbox and calendar cursor and limit inputs", async () => {
    const test = harness();
    const inbox = await handleCockpitRoute(
      new Request("https://lifeos.example/api/inbox?after=2026-08-03T00%3A00%3A00.000Z&limit=50"),
      owner,
      test.repositories,
    );
    expect(inbox?.status).toBe(200);
    expect(test.calls.at(-1)).toEqual({
      route: "inbox",
      userId: "owner-a",
      input: {after: "2026-08-03T00:00:00.000Z", limit: 50},
    });

    for (const url of [
      "/api/inbox?limit=0",
      "/api/inbox?limit=101",
      "/api/calendar?limit=2.5",
      "/api/calendar?after=yesterday",
      "/api/calendar?limit=20&limit=30",
    ]) {
      const response = await handleCockpitRoute(new Request(`https://lifeos.example${url}`), owner, test.repositories);
      expect(response?.status, url).toBe(400);
    }
  });

  it("accepts same-origin manual refresh once per deterministic five-minute key and schedules completion", async () => {
    const test = harness();
    const request = new Request("https://lifeos.example/api/refresh", {
      method: "POST",
      headers: {origin: "https://lifeos.example"},
    });

    const response = await handleCockpitRoute(request, owner, test.repositories);

    expect(response?.status).toBe(202);
    await expect(response?.json()).resolves.toEqual({runId: "refresh:owner-a:2026-08-04T00:30"});
    expect(test.pending).toHaveLength(1);
    expect(test.calls.at(-1)).toEqual({route: "start", userId: "owner-a", input: "2026-08-03T22:30:00.000Z"});
  });

  it("rejects cross-origin POST refresh and wrong methods without starting work", async () => {
    const test = harness();
    const crossOrigin = await handleCockpitRoute(new Request("https://lifeos.example/api/refresh", {
      method: "POST",
      headers: {origin: "https://attacker.example"},
    }), owner, test.repositories);
    const wrongMethod = await handleCockpitRoute(new Request("https://lifeos.example/api/today", {method: "POST"}), owner, test.repositories);

    expect(crossOrigin?.status).toBe(403);
    expect(wrongMethod?.status).toBe(405);
    expect(test.calls).toEqual([]);
  });

  it("returns null only for unrecognized paths", async () => {
    const test = harness();
    await expect(handleCockpitRoute(new Request("https://lifeos.example/api/unknown"), owner, test.repositories)).resolves.toBeNull();
  });
});

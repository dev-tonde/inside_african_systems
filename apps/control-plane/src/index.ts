import type {Env} from "./env";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {"cache-control": "no-store"},
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        service: "lifeos-control-plane",
        mode: "read-only",
        now: new Date().toISOString(),
      });
    }
    return json({error: {code: "not_found", message: "Route not found", requestId: crypto.randomUUID()}}, 404);
  },
};

import type {Env} from "./env";
import {createAuthRepository} from "./repositories/auth-repository";
import {handleAuthRoute} from "./routes/auth";

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {"cache-control": "no-store"},
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const repository = createAuthRepository(env.DB);
    const authResponse = await handleAuthRoute(request, env, {
      repository,
      now: () => new Date(),
      fetcher: fetch,
    });
    if (authResponse) return authResponse;

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        service: "lifeos-control-plane",
        mode: "read-only",
        now: new Date().toISOString(),
      });
    }
    if (url.pathname.startsWith("/api/")) {
      return json(
        {error: {code: "unauthorized", message: "Authentication required", requestId: crypto.randomUUID()}},
        401,
      );
    }
    return json({error: {code: "not_found", message: "Route not found", requestId: crypto.randomUUID()}}, 404);
  },
};

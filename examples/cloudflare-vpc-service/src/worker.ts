import type { worker } from "../alchemy.run.ts";

export default {
  async fetch(request: Request, env: typeof worker.Env) {
    const url = new URL(request.url);
    const target = new URL(url.pathname + url.search, "http://localhost:5173");
    return await env.VPC_SERVICE.fetch(target);
  },
};

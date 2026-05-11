import type { worker } from "../alchemy.run.ts";

export default {
  async fetch(request: Request, env: typeof worker.Env) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q");

    // ── New AI Search Binding (recommended) ──────────────────────
    // Direct access via the ai_search binding — no AI binding needed
    if (url.pathname === "/search" && query) {
      const result = await env.SEARCH.search({
        query,
      });
      return Response.json(result);
    }

    // ── Namespace binding — dynamic instance access ──────────────
    // Access any instance in the namespace at runtime
    if (url.pathname === "/ns-search" && query) {
      const instanceName = url.searchParams.get("instance") || "search";
      const result = await env.DOCS.get(instanceName).search({
        query,
      });
      return Response.json(result);
    }

    // ── List instances in the namespace ──────────────────────────
    if (url.pathname === "/list") {
      const instances = await env.DOCS.list();
      return Response.json(instances);
    }

    // ── Upload a file into the ai_search binding ─────────────────
    // POST a multipart form with a `file` field.
    if (url.pathname === "/upload" && request.method === "POST") {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return new Response("No `file` field in form data", { status: 400 });
      }
      const item = await env.SEARCH.items.upload(file.name, file);
      return Response.json({ uploaded: file.name, status: item.status });
    }

    // ── Legacy: AI binding with autorag() (still works) ─────────
    if (url.pathname === "/legacy/query" && query) {
      const result = await env.AI.autorag(env.RAG_ID).aiSearch({
        query,
      });
      // Empty results are a "no-match" response, not a client error —
      // return 200 with the payload so callers can inspect `result.data`.
      return Response.json(result);
    }

    return new Response(
      "Usage:\n" +
        "  /search?q=...           — AI Search binding\n" +
        "  /ns-search?q=...&instance=... — Namespace binding\n" +
        "  /list                   — List instances in namespace\n" +
        "  /upload (POST form data with `file`) — Upload a file\n" +
        "  /legacy/query?q=...     — Legacy AI.autorag()\n",
    );
  },
};

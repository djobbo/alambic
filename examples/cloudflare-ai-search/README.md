# cloudflare-ai-search

Example project demonstrating Cloudflare AI Search (formerly AutoRAG) with Alchemy.

Covers:

- Creating an AI Search instance backed by an R2 bucket
- Seeding the bucket with text documents
- Creating an AI Search namespace
- Binding the AI Search instance to a Worker as both a direct binding (`ai_search`) and a namespace binding (`ai_search_namespaces`)
- Using the legacy `env.AI.autorag()` path for comparison

## Prerequisites

Set your Cloudflare API token in `.env` at the repo root:

```sh
CLOUDFLARE_API_TOKEN=your-api-token
```

## Deploy

```sh
bun run deploy
```

The script logs the Worker URL when done.

## Endpoints

- `GET /search?q=<query>` — AI Search single-instance binding
- `GET /ns-search?q=<query>&instance=<name>` — AI Search namespace binding
- `GET /list` — List instances in the namespace
- `POST /upload` (multipart form with a `file` field) — upload a document to the single-instance binding
- `GET /legacy/query?q=<query>` — Legacy `env.AI.autorag()` path

## Tear Down

```sh
bun run destroy
```

## Local Dev

> Note: AI Search bindings are not natively supported by Miniflare. In
> `alchemy dev` they are proxied to the deployed instance via the
> remote-binding-proxy worker, so the bindings only work after you've run
> `alchemy deploy` at least once.

```sh
bun run dev
```

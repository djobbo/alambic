---
title: AiSearch
description: Learn how to create and configure Cloudflare AI Search instances for RAG-powered semantic search using Alchemy.
---

The AiSearch resource lets you create and manage [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/) instances (formerly AutoRAG). AI Search automatically indexes your data from R2 buckets, web crawlers, or manual file uploads, creates vector embeddings, and provides natural language search with AI-generated responses.

:::note[Requirements]
- `@cloudflare/workers-types` ≥ `4.20260417.1`
- Single-instance `ai_search` bindings only work for instances in the `default` namespace. For non-default namespaces, bind the enclosing [AiSearchNamespace](/providers/cloudflare/ai-search-namespace) and use `env.BINDING.get(name)`.
:::

## Query shapes

The search / chatCompletions APIs accept two equivalent request shapes:

- **`query: string`** — a simple text query, ideal for one-off lookups.
- **`messages: Array<{role, content}>`** — a chat-style conversation array, ideal for RAG and multi-turn context.

You can pass either `query` OR `messages`, not both. The examples in this page mix both styles.

## Minimal Example

Create an AI Search instance backed by an R2 bucket. Just pass the bucket directly as the source - Alchemy automatically handles service token management:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("docs-search", {
  source: bucket,
});
```

## Built-in Storage (No Source)

Create an AI Search instance with built-in storage for manual file uploads via the binding. No source or token is needed:

```ts
import { AiSearch } from "alchemy/cloudflare";

const search = await AiSearch("docs-search", {
  name: "my-knowledge-base",
});
```

Items can be uploaded through the AI Search binding at runtime. The `upload()` method accepts a `ReadableStream`, `Blob`, or `string` for content:

```ts
// In your Worker (where DOCS is bound to the AiSearch instance)
// Upload a markdown document as a string
await env.DOCS.items.upload("faq.md", "# FAQ\n\nQ: ...");

// Upload a Blob (e.g. from a fetch response or form data)
const file = (await request.formData()).get("file") as File;
await env.DOCS.items.upload(file.name, file);
```

## Using AI Search Bindings (Recommended)

AI Search instances can be bound directly to Workers as `ai_search` bindings, providing first-class access to search, chat, items, and jobs APIs:

```ts
import { Worker, AiSearch } from "alchemy/cloudflare";

const search = await AiSearch("docs-search", {
  name: "my-docs",
});

await Worker("api", {
  entrypoint: "./src/worker.ts",
  bindings: {
    DOCS: search, // Direct AI Search binding
  },
});
```

```ts
// src/worker.ts
export default {
  async fetch(request, env) {
    // Simple lookup: pass `query`. For multi-turn / chat-style context,
    // pass `messages: [{ role, content }, …]` instead (see Query shapes above).
    const results = await env.DOCS.search({
      query: "How does caching work?",
    });
    return Response.json(results);
  },
};
```

:::tip[Namespace Binding]
For dynamic multi-instance access (per-tenant SaaS, multi-language content, AI agents), use the [AiSearchNamespace](/providers/cloudflare/ai-search-namespace) binding instead. See the [AiSearchNamespace docs](/providers/cloudflare/ai-search-namespace) for details.
:::

## Namespaces

AI Search instances belong to namespaces. By default, instances are created in the `"default"` namespace. Use the `namespace` prop to place instances in a specific namespace:

```ts
import { AiSearch, AiSearchNamespace } from "alchemy/cloudflare";

const ns = await AiSearchNamespace("production", {
  name: "production",
});

const search = await AiSearch("docs-search", {
  source: bucket,
  namespace: ns, // or namespace: "production"
});
```

See [AiSearchNamespace](/providers/cloudflare/ai-search-namespace) for managing namespaces.

## Using AI Search via the AI Binding (Legacy)

AI Search instances can also be accessed through the `AI` binding using `env.AI.autorag(name)`. This is scoped to the default namespace only:

```ts
import { Worker, Ai, AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("docs-search", {
  source: bucket,
});

await Worker("api", {
  entrypoint: "./src/worker.ts",
  bindings: {
    AI: Ai(), // AI binding required to access AI Search
    RAG_ID: search.id, // Pass the actual instance name
  },
});
```

```ts
// src/worker.ts
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || "";

    // Use search() for vector similarity search only
    const searchResults = await env.AI.autorag(env.RAG_ID).search({
      query,
      max_num_results: 10,
    });

    return Response.json({
      results: searchResults.data,
    });
  },
};
```

:::tip[Instance Naming]
If you don't provide an explicit `name`, Alchemy generates one using `${app}-${stage}-${id}` (e.g., `myapp-dev-docs-search`). Always use `search.id` as a binding for portability across environments, or pass an explicit `name` if you need a predictable value.
:::

## RAG Response Generation (legacy `AI` binding)

Use the legacy `AI` binding's `autorag(id).aiSearch()` to get AI-generated responses along with source documents. For the modern `ai_search` / `ai_search_namespaces` bindings, use `search()` / `chatCompletions()` on the binding directly instead (see [the docs](https://developers.cloudflare.com/ai-search/api/search/workers-binding/)).

```ts
// src/worker.ts
export default {
  async fetch(request, env) {
    const { question } = await request.json();

    // Use aiSearch() for RAG - returns AI response + sources
    const result = await env.AI.autorag(env.RAG_ID).aiSearch({
      query: question,
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      max_num_results: 5,
      reranking: {
        enabled: true,
        model: "@cf/baai/bge-reranker-base",
      },
    });

    return Response.json({
      answer: result.response,
      sources: result.data,
    });
  },
};
```

## With Custom Models and Chunking

Configure an AI Search instance with custom embedding and generation models:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("custom-search", {
  source: bucket,
  aiSearchModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  embeddingModel: "@cf/baai/bge-m3",
  chunkSize: 512,
  chunkOverlap: 20,
  maxNumResults: 15,
});
```

## With Reranking and Query Rewriting

Enable advanced retrieval features for better search results:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("advanced-search", {
  source: bucket,
  reranking: true,
  rerankingModel: "@cf/baai/bge-reranker-base",
  rewriteQuery: true,
  scoreThreshold: 0.3,
});
```

## Web Crawler Source

For crawling websites, use the [`AiCrawler`](/providers/cloudflare/ai-crawler) helper to build the source configuration from URLs:

```ts
import { AiSearch, AiCrawler } from "alchemy/cloudflare";

const search = await AiSearch("docs-search", {
  source: AiCrawler(["https://docs.example.com"]),
});
```

### Crawl Specific Paths

Provide multiple URLs to crawl specific sections of a site:

```ts
import { AiSearch, AiCrawler } from "alchemy/cloudflare";

const search = await AiSearch("blog-search", {
  source: AiCrawler([
    "https://example.com/blog",
    "https://example.com/news",
  ]),
});
```

:::warning[Domain Requirements]
The domain must be:
- Added as a zone in your Cloudflare account
- Have active nameservers pointing to Cloudflare
- All URLs must be from the same domain
:::

### R2 Source with Paths and Jurisdiction

When using an R2 source object instead of a bucket directly, you can set jurisdiction, prefix, and path filters:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("docs-search", {
  source: {
    type: "r2",
    bucket,
    jurisdiction: "eu", // or "default"
    prefix: "public/",
    includePaths: ["**/*.md", "**/docs/**"],
    excludePaths: ["**/draft/**"],
  },
});
```

Path patterns support wildcards: `*` matches any characters except `/`, `**` matches any characters including `/` (up to 10 patterns each for include and exclude).

### Low-Level Web Crawler Configuration

For more control, configure the web-crawler source directly:

```ts
import { AiSearch } from "alchemy/cloudflare";

const search = await AiSearch("docs-search", {
  source: {
    type: "web-crawler",
    domain: "docs.example.com", // Just the domain, not a URL
    includePaths: ["**/docs/**", "**/blog/**"],
    excludePaths: ["**/api/**"],
    parseType: "sitemap", // or "feed-rss"
    parseOptions: {
      include_images: true,
      use_browser_rendering: false,
      specific_sitemaps: ["https://docs.example.com/sitemap.xml"],
    },
    storeOptions: {
      storage_id: "my-r2-bucket-name",
      jurisdiction: "default",
      storage_type: "r2",
    },
  },
});
```

Path patterns support wildcards (up to 10 each). `parseOptions` can include `include_headers`, `include_images`, `specific_sitemaps` (when `parseType` is `"sitemap"`), and `use_browser_rendering`. Use `storeOptions` to send crawled content to an R2 bucket.

## With Caching

Enable similarity caching to improve latency on repeated queries:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("cached-search", {
  source: bucket,
  cache: true,
  cacheThreshold: "close_enough", // or "super_strict_match" | "flexible_friend" | "anything_goes"
});
```

## Service Token

Service tokens are **only required for R2 bucket sources**. Web crawler and built-in storage instances do not need tokens.

When using an R2 source, Alchemy handles token management automatically:

1. **If tokens already exist**: Alchemy detects existing AI Search service tokens in your account and lets AI Search auto-select one. No new token is created.

2. **If no tokens exist**: Alchemy creates an account API token with the required permissions and registers it with AI Search.

The automatically created token has:
- **AI Search Index Engine** permission
- **Workers R2 Storage Write** permission

When the AI Search instance is destroyed, the token is automatically cleaned up.

### Using an Explicit Token

For advanced use cases (e.g., sharing a token across multiple instances), you can create an [AiSearchToken](/providers/cloudflare/ai-search-token) explicitly:

```ts
import { AiSearch, AiSearchToken, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

// Create a token resource explicitly
const token = await AiSearchToken("my-token", {
  name: "docs-search-token",
});

const search = await AiSearch("docs-search", {
  source: {
    type: "r2",
    bucket,
  },
  token, // Use the explicit token
});
```

See [AiSearchToken](/providers/cloudflare/ai-search-token) for more details.

## Configuration Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | auto-generated | Instance name (1-32 characters) |
| `source` | `R2Bucket \| AiSearchR2Source \| AiSearchWebCrawlerSource` | — | Data source. Omit for built-in storage (upload-only). |
| `namespace` | `string \| AiSearchNamespace` | `"default"` | Namespace the instance belongs to |
| `aiSearchModel` | `string` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Text generation model |
| `embeddingModel` | `string` | `@cf/baai/bge-m3` | Embedding model |
| `indexMethod` | `{ vector?: boolean; keyword?: boolean }` | vector-only | Controls which storage backends are used. Set both to `true` for hybrid search. |
| `fusionMethod` | `"max" \| "rrf"` | `"rrf"` | Fusion method for combining vector and keyword results |
| `chunk` | `boolean` | `true` | Enable document chunking |
| `chunkSize` | `number` | `256` | Chunk size (minimum 64) |
| `chunkOverlap` | `number` | `10` | Overlap between chunks (0-30) |
| `maxNumResults` | `number` | `10` | Max search results (1-50) |
| `scoreThreshold` | `number` | `0.4` | Minimum match score (0-1) |
| `reranking` | `boolean` | `false` | Enable result reranking |
| `rerankingModel` | `string` | `@cf/baai/bge-reranker-base` | Reranking model |
| `rewriteQuery` | `boolean` | `false` | Enable query rewriting |
| `rewriteModel` | `string` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Query rewriting model |
| `cache` | `boolean` | `false` | Enable similarity caching |
| `cacheThreshold` | `"super_strict_match" \| "close_enough" \| "flexible_friend" \| "anything_goes"` | `"close_enough"` | Cache similarity threshold |
| `metadata` | `Record<string, unknown>` | — | Custom metadata |
| `indexOnCreate` | `boolean` | `true` | Index source documents on creation (only when source is provided) |
| `token` | `AiSearchToken` | auto-created for R2 | Service token (only needed for R2 sources) |
| `delete` | `boolean` | `true` | Delete instance on removal |
| `adopt` | `boolean` | `false` | Adopt existing instance |

## Output Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Instance name on Cloudflare (equal to `name`) |
| `name` | `string` | Instance name (what `ai_search` bindings emit as `instance_name`) |
| `namespace` | `string` | Namespace the instance lives in (defaults to `"default"`) |
| `createdAt` | `string` | Creation timestamp (ISO 8601) |
| `modifiedAt` | `string` | Last-modified timestamp |
| `internalId` | `string` | Cloudflare-internal identifier for the instance |
| `vectorizeName` | `string` | Underlying Vectorize index name (legacy instances only) |
| `tokenId` | `string \| undefined` | Service-token id (only present for R2-backed instances) |
| `source` | `string \| undefined` | Resolved data source (bucket name for R2, domain for web-crawler, `undefined` for sourceless) |
| `type` | `"r2" \| "web-crawler" \| undefined` | Source type, or `undefined` for sourceless (built-in storage) instances |

## Type Guard

To narrow an unknown binding or resource to an `AiSearch`, use `isAiSearch`:

```ts
import { isAiSearch } from "alchemy/cloudflare";

if (isAiSearch(binding)) {
  // binding is narrowed to AiSearch
  console.log(binding.name, binding.namespace);
}
```

## See also

- [Cloudflare AI Search — Workers binding reference](https://developers.cloudflare.com/ai-search/api/search/workers-binding/)
- [Cloudflare AI Search — Overview](https://developers.cloudflare.com/ai-search/)

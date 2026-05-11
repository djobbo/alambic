---
title: AiCrawler
description: Helper function to build AI Search web crawler configuration from URLs.
---

The `AiCrawler` helper function builds an `AiSearchWebCrawlerSource` configuration from URLs. It extracts the domain and path filters automatically, making it easy to set up web crawling for AI Search.

## Minimal Example

```ts
import { AiSearch, AiCrawler } from "alchemy/cloudflare";

const search = await AiSearch("docs-search", {
  source: AiCrawler(["https://docs.example.com"]),
});
```

## Crawl Specific Paths

Provide multiple URLs to crawl specific sections of a site. The function automatically extracts the domain and builds path filters:

```ts
import { AiSearch, AiCrawler } from "alchemy/cloudflare";

const search = await AiSearch("blog-search", {
  source: AiCrawler([
    "https://example.com/blog",
    "https://example.com/news",
  ]),
});
```

This is equivalent to:

```ts
const search = await AiSearch("blog-search", {
  source: {
    type: "web-crawler",
    domain: "example.com",
    includePaths: ["**/blog**", "**/news**"],
  },
});
```

## How It Works

`AiCrawler` performs the following transformations:

1. **Parses URLs** - Extracts the hostname and path from each URL
2. **Validates domain** - Ensures all URLs are from the same domain
3. **Builds path filters** - Converts URL paths to glob patterns for `includePaths`

```ts
// Input
AiCrawler([
  "https://docs.example.com/getting-started",
  "https://docs.example.com/api-reference",
])

// Output (AiSearchWebCrawlerSource)
{
  type: "web-crawler",
  domain: "docs.example.com",
  includePaths: ["**/getting-started**", "**/api-reference**"],
}
```

## Domain Requirements

:::warning
The domain must be:
- Added as a zone in your Cloudflare account
- Have active nameservers pointing to Cloudflare
- All URLs must be from the same domain
:::

If you try to crawl URLs from different domains, `AiCrawler` will throw an error:

```ts
// This will throw an error
AiCrawler([
  "https://docs.example.com",
  "https://blog.example.org", // Different domain!
]);
// Error: All URLs must be from the same domain. Found: docs.example.com, blog.example.org
```

## URL Format Flexibility

`AiCrawler` accepts URLs with or without the protocol:

```ts
// All of these work
AiCrawler(["https://docs.example.com"])
AiCrawler(["http://docs.example.com"])
AiCrawler(["docs.example.com"]) // Protocol added automatically
```

## Complete Example

```ts
import { AiSearch, AiCrawler, Worker, Ai } from "alchemy/cloudflare";

// Create AI Search instance that crawls documentation
const search = await AiSearch("docs-search", {
  source: AiCrawler(["https://docs.example.com"]),
  chunkSize: 512,
  reranking: true,
});

// Create a worker to query the search
await Worker("search-api", {
  entrypoint: "./src/worker.ts",
  bindings: {
    AI: Ai(),
    RAG_NAME: search.name,
  },
});
```

## See Also

- [AiSearch](/providers/cloudflare/ai-search) - The main AI Search resource
- [Cloudflare AI Search Documentation](https://developers.cloudflare.com/ai-search/)

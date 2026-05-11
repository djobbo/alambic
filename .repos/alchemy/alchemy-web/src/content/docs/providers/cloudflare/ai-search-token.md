---
title: AiSearchToken
description: Learn how to create and manage Cloudflare AI Search service tokens for authenticating with the AI Search API using Alchemy.
---

The AiSearchToken resource creates a service token for authenticating with [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/). This token is required for AI Search to access your R2 buckets or other data sources.

:::note
In most cases, you don't need to create this resource directly. The [AiSearch](/providers/cloudflare/ai-search) resource automatically detects existing tokens or creates one for you.
:::

## When to Use

Use `AiSearchToken` explicitly when you need to:

- Share a single token across multiple AI Search instances
- Have fine-grained control over token lifecycle
- Inspect token properties (e.g., `tokenId`, `cfApiId`)

## Minimal Example

Create an AI Search token and use it with an AI Search instance:

```ts
import { AiSearch, AiSearchToken, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const token = await AiSearchToken("search-token", {
  name: "docs-search-token",
});

const search = await AiSearch("docs-search", {
  source: {
    type: "r2",
    bucket,
    token,
  },
});
```

## Share Token Across Instances

Use a single token for multiple AI Search instances:

```ts
import { AiSearch, AiSearchToken, R2Bucket } from "alchemy/cloudflare";

const docsToken = await AiSearchToken("shared-token", {
  name: "shared-docs-token",
});

const docsBucket = await R2Bucket("docs", { name: "docs-bucket" });
const blogBucket = await R2Bucket("blog", { name: "blog-bucket" });

const docsSearch = await AiSearch("docs-search", {
  source: { type: "r2", bucket: docsBucket, token: docsToken },
});

const blogSearch = await AiSearch("blog-search", {
  source: { type: "r2", bucket: blogBucket, token: docsToken },
});
```

## Adopt Existing Token

Adopt a token that already exists in your account:

```ts
import { AiSearchToken } from "alchemy/cloudflare";

const token = await AiSearchToken("existing-token", {
  name: "my-existing-token",
  adopt: true,
});
```

## How It Works

When you create an `AiSearchToken`, Alchemy:

1. Creates an **account API token** with the required permissions:
   - `AI Search Index Engine` — allows AI Search to index and query data
   - `Workers R2 Storage Write` — allows AI Search to read from R2 buckets
2. Registers the token with the **AI Search service**
3. Returns the token details including the `tokenId` and `cfApiKey`

When the resource is destroyed, both the AI Search token registration and the underlying account API token are cleaned up.

## Configuration Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | resource ID | Name of the token |
| `adopt` | `boolean` | `false` | Adopt an existing token with the same name |
| `delete` | `boolean` | `true` | Delete the token when removed from Alchemy |

## Output Properties

| Property | Type | Description |
|----------|------|-------------|
| `tokenId` | `string` | The AI Search token ID (UUID) |
| `accountTokenId` | `string` | The underlying account API token ID |
| `accountId` | `string` | The Cloudflare account ID |
| `accountTag` | `string` | The Cloudflare account tag |
| `name` | `string` | Name of the token |
| `cfApiId` | `string` | The CF API ID for this token |
| `cfApiKey` | `Secret` | The CF API key (stored securely) |
| `enabled` | `boolean` | Whether the token is enabled |
| `createdAt` | `string` | When the token was created |
| `modifiedAt` | `string` | When the token was last modified |

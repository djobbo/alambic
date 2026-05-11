---
title: AiSearchNamespace
description: Create and manage Cloudflare AI Search namespaces for grouping and isolating search instances.
---

The AiSearchNamespace resource creates and manages [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/) namespaces. Namespaces group AI Search instances together, providing logical isolation and scoped access control. Instance names are unique within their namespace.

When used as a Worker binding, `AiSearchNamespace` provides a `ai_search_namespaces` binding that gives the Worker dynamic access to all instances within the namespace -- enabling runtime creation, deletion, search, and chat operations.

:::note[Requirements]
- `@cloudflare/workers-types` ≥ `4.20260417.1`
- The `default` namespace is reserved by Cloudflare. It is created automatically on every account and cannot be created, updated, or deleted via the API. To bind to it, pass `adopt: true`.
:::

## Minimal Example

```ts
import { AiSearchNamespace } from "alchemy/cloudflare";

const ns = await AiSearchNamespace("production", {
  name: "production",
});
```

## Use as Worker Binding

The primary use case for `AiSearchNamespace` is as a Worker binding. This gives your Worker dynamic access to all instances in the namespace at runtime:

```ts
import { Worker, AiSearchNamespace } from "alchemy/cloudflare";

const ns = await AiSearchNamespace("docs", {
  name: "docs",
});

await Worker("api", {
  entrypoint: "./src/worker.ts",
  bindings: {
    DOCS: ns, // Namespace binding
  },
});
```

```ts
// src/worker.ts
export default {
  async fetch(request, env) {
    // Access an instance within the namespace. For a one-off lookup the
    // simpler `query` shape is preferred; use `messages` for multi-turn /
    // chat-style context.
    const results = await env.DOCS.get("my-blog").search({
      query: "How does caching work?",
    });

    // List all instances in the namespace
    const instances = await env.DOCS.list();

    // Create a new instance at runtime (no redeployment needed).
    // `index_method` defaults to hybrid (vector + keyword); override for
    // keyword-only or vector-only indexing.
    const tenant = await env.DOCS.create({ id: "tenant-123" });
    await tenant.items.upload("faq.md", "# FAQ\n\n...");

    // Delete an instance
    await env.DOCS.delete("old-docs");

    return Response.json(results);
  },
};
```

## Use Cases

### Multi-language Content

One instance per language, accessed through a single binding:

```ts
import { AiSearchNamespace, Worker } from "alchemy/cloudflare";

const blog = await AiSearchNamespace("blog", { name: "blog" });

await Worker("api", {
  entrypoint: "./src/worker.ts",
  bindings: { BLOG: blog },
});
```

```ts
// src/worker.ts
export default {
  async fetch(request, env) {
    const lang = new URL(request.url).searchParams.get("lang") || "en";
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const results = await env.BLOG.get(`blog-${lang}`).search({ query: q });
    return Response.json(results);
  },
};
```

### Per-tenant SaaS

Dynamically create isolated instances per tenant without redeployment:

```ts
// src/worker.ts
export default {
  async fetch(request, env) {
    const tenantId = request.headers.get("x-tenant-id");
    const url = new URL(request.url);

    if (url.pathname === "/onboard" && request.method === "POST") {
      await env.TENANTS.create({ id: `tenant-${tenantId}` });
      return new Response("Onboarded");
    }

    if (url.pathname === "/search") {
      const results = await env.TENANTS.get(`tenant-${tenantId}`).search({
        query: url.searchParams.get("q") ?? "",
      });
      return Response.json(results);
    }

    return new Response("Not found", { status: 404 });
  },
};
```

## With AiSearch Instances

Create instances in a specific namespace using the `namespace` prop on [AiSearch](/providers/cloudflare/ai-search):

```ts
import { AiSearch, AiSearchNamespace, R2Bucket } from "alchemy/cloudflare";

const ns = await AiSearchNamespace("production", {
  name: "production",
});

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("docs-search", {
  source: bucket,
  namespace: ns,
});
```

## Both Binding Types in One Worker

You can use both namespace bindings (dynamic multi-instance) and single instance bindings (direct access) in the same Worker:

```ts
import { Worker, AiSearch, AiSearchNamespace } from "alchemy/cloudflare";

const ns = await AiSearchNamespace("docs", { name: "docs" });
const blog = await AiSearch("blog-search", { name: "blog" });

await Worker("api", {
  entrypoint: "./src/worker.ts",
  bindings: {
    DOCS: ns,         // Namespace binding — dynamic access
    BLOG_SEARCH: blog, // Single instance binding — direct access
  },
});
```

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | auto-generated | Namespace name (pattern: `^[a-z0-9]([a-z0-9-]{0,26}[a-z0-9])?$`) |
| `description` | `string` | — | Optional description (max 256 characters) |
| `delete` | `boolean` | `true` | Delete namespace on removal. Namespace must be empty. |
| `adopt` | `boolean` | `false` | Adopt existing namespace |

## Output Properties

| Property | Type | Description |
|----------|------|-------------|
| `type` | `"ai_search_namespace"` | Resource type identifier |
| `id` | `string` | Stable identifier (equal to `namespace`) |
| `namespace` | `string` | The namespace name |
| `description` | `string \| null` | Namespace description, or `null` if unset/cleared |
| `createdAt` | `string` | Creation timestamp (ISO 8601) |

## Type Guard

To narrow an unknown binding or resource to an `AiSearchNamespace`, use `isAiSearchNamespace`:

```ts
import { isAiSearchNamespace } from "alchemy/cloudflare";

if (isAiSearchNamespace(binding)) {
  // binding is narrowed to AiSearchNamespace
  console.log(binding.namespace);
}
```

## Clearing a description

Descriptions follow three-way semantics on update:

- **Absent from props** (`undefined`): leave the current description untouched. Useful when you don't want to overwrite out-of-band edits made from the Cloudflare dashboard.
- **String value**: set the description to that value.
- **`null`**: explicitly clear a previously-set description.

```ts
// Set initially
await AiSearchNamespace("ns", {
  name: "docs",
  description: "Documentation namespace",
});

// Later: clear the description
await AiSearchNamespace("ns", {
  name: "docs",
  description: null, // explicit null clears the description
});
```

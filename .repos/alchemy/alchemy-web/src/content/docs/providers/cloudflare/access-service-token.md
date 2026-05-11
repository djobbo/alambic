---
title: AccessServiceToken
description: Create Cloudflare Zero Trust Access service tokens for machine-to-machine authentication against Access-protected applications.
---

A [Cloudflare Access service token](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/) authenticates non-human callers (CI runners, scripts, services) against Access-protected applications. The `clientSecret` is only returned on creation — store it immediately.

## Minimal Example

```ts
import { AccessServiceToken } from "alchemy/cloudflare";

const token = await AccessServiceToken("ci-runner", {
  name: "ci-runner",
});

// token.clientId / token.clientSecret.unencrypted go into the
// CF-Access-Client-Id / CF-Access-Client-Secret request headers.
```

## Custom Duration

By default tokens are valid for 1 year. Override with a Cloudflare duration string.

```ts
const previewToken = await AccessServiceToken("preview-deploy", {
  name: "preview-deploy",
  duration: "720h", // 30 days
});
```

## Use With a Worker

Bind the secret into a Worker so it can authenticate against another Access-protected app.

```ts
import { Worker, AccessServiceToken } from "alchemy/cloudflare";

const token = await AccessServiceToken("worker-to-admin", {
  name: "worker-to-admin",
});

await Worker("admin-client", {
  entrypoint: "./src/worker.ts",
  bindings: {
    CF_ACCESS_CLIENT_ID: token.clientId,
    CF_ACCESS_CLIENT_SECRET: token.clientSecret!,
  },
});
```

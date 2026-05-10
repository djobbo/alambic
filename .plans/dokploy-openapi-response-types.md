# Dokploy OpenAPI: correct 200 response types for Crucible call sites

Upstream Dokploy ships [`openapi.json`](.repos/dokploy/openapi.json) with many **`POST` `200` responses** whose body schema is an **empty object** (`properties: {}`, `additionalProperties: false`). That drives **`@effect/openapi-generator` → httpclient** to produce weak or useless return types for [`packages/dokploy-api/src/generated/DokployClient.ts`](packages/dokploy-api/src/generated/DokployClient.ts), while [`packages/crucible/src/Dokploy/DokployEngine.ts`](packages/crucible/src/Dokploy/DokployEngine.ts) already assumes richer JSON in several flows (e.g. parsing `applicationId` from create responses).

This plan describes how to **extend [`openapi.codegen.patch.json`](packages/dokploy-api/openapi.codegen.patch.json)** with **[JSON Patch](https://datatracker.ietf.org/doc/html/rfc6902) `replace` (and occasionally `add`)** operations so **`200` `application/json` schemas** match what Dokploy actually returns, then **regenerate** the client and optionally tighten Crucible.

---

## Why the patch file (not editing `openapi.json` in place)

- The **vendor spec** lives under [`.repos/dokploy/openapi.json`](.repos/dokploy/openapi.json) and is refreshed by subtree pulls; local edits there are easy to lose.
- [`packages/dokploy-api/scripts/codegen.mjs`](packages/dokploy-api/scripts/codegen.mjs) runs **`openapigen`** with **`--patch openapi.codegen.patch.json`**, which applies patches **before** codegen.
- [`build-openapi-patch.mjs`](packages/dokploy-api/scripts/build-openapi-patch.mjs) today **only** regenerates **`security` → `apiKey`** replacements. **Response-schema fixes are maintained manually** (or you extend that script later to merge generated security ops with hand-authored response ops—see *Maintenance* below).

---

## Step 1 — Inventory operations Crucible actually calls

Every HTTP path used through **`DokployApi`** in `DokployEngine.ts` should be on the list to verify or fix. Current call sites (method names map to paths like `/application.create`, `/environment.update`, etc.):

| Area | Client methods |
|------|----------------|
| Reads (often `includeResponse: true`) | `applicationOne`, `projectOne`, `environmentOne`, `environmentByProjectId`, `domainByApplicationId` |
| Ports / mounts | `portDelete`, `portCreate`, `mountsRemove`, `mountsCreate` |
| Compose / deploy | `applicationSaveEnvironment`, `applicationUpdate`, `applicationRedeploy`, `applicationDeploy`, `applicationSaveDockerProvider`, `applicationUpdateTraefikConfig` |
| Metadata | `projectUpdate`, `environmentUpdate` |
| Lifecycle | `applicationCreate`, `applicationDelete`, `projectCreate`, `projectRemove`, `environmentCreate`, `environmentRemove` |
| Domains | `domainCreate`, `domainUpdate`, `domainDelete` |

**Action:** For each row, locate the path in `.repos/dokploy/openapi.json` under `paths["/<dotted.path>"][<method>]` and inspect `responses["200"].content["application/json"].schema`. If it is the empty object pattern, it is a patch candidate.

---

## Step 2 — Discover the real JSON shape

Prefer **ground truth** in this order:

1. **Dokploy server handlers** in [`.repos/dokploy`](.repos/dokploy) — search for the tRPC / route implementation that backs `application.create`, `environment.update`, etc., and see what it returns on success.
2. **Integration probe** — one-off `curl` against a dev Dokploy instance with a valid API key (capture anonymized JSON). Useful when server code is indirect or wraps helpers.
3. **Existing Crucible parsers** — [`extractApplicationId`](packages/crucible/src/Dokploy/DokployEngine.ts), `extractProjectId`, `extractEnvironmentId`, `extractDomainId`, and field readers encode **minimum** required fields; schemas should be **at least** as wide as those expectations (and ideally match the full object the API returns).

Document for each operation: required keys, optional keys, nested objects, arrays, and whether the body is sometimes **non-JSON** (then the spec should not claim JSON—rare for these routes).

---

## Step 3 — Author JSON Patch operations

**Path encoding:** OpenAPI paths use dotted segments (e.g. `/environment.update`). In JSON Pointer segments, **`/` → `~1`**, **`~` → `~0`** (same escaping as [`build-openapi-patch.mjs`](packages/dokploy-api/scripts/build-openapi-patch.mjs) `escapeSegment`).

**Typical replace target** for a typed JSON body on success:

```text
/paths/~1environment.update/post/responses/200/content/application/json/schema
```

**Schema options:**

- **Inline** `type: "object"` with `properties` / `required` as needed.
- **`$ref`** to `#/components/schemas/...` if the same shape is reused — add or update **`components/schemas`** via additional patch ops if the upstream spec lacks a suitable named schema.

**`required` vs `properties` (critical for codegen):** In OpenAPI 3 / JSON Schema, keys listed under **`properties` are optional by default.** Only keys listed in the object’s **`required`** array are treated as mandatory. `@effect/openapi-generator` maps required keys to non-optional Effect fields (and thus plain `string` in TypeScript); omitted keys become `Schema.optionalKey` / `?:` in the output. So for response bodies where Dokploy always returns identifiers (e.g. `projectId` + `name` on `project.one`), add both **`properties` typings** and a matching **`required`** array — otherwise call sites keep seeing `string | undefined` and need non-null assertions.

[`openapi.codegen.response-patch.json`](packages/dokploy-api/openapi.codegen.response-patch.json) defines shared `components/schemas` such as `dokploy.projectOneGraph`, `dokploy.projectRow`, `dokploy.environmentLike`, etc.; each uses **`required`** for fields that are stable on success responses (nullable fields stay out of `required` unless the key is always present and only the value may be `null`).

**Examples of goals:**

- **Create/update routes** that return the created/updated entity — use a schema aligned with the list/get DTOs if those exist in `components/schemas`, or mirror the handler return type.
- **`application.deploy` / `application.redeploy`** — if the server returns a status object, model it explicitly instead of `{}`.
- **Routes where Crucible ignores the body** — you may still add a minimal accurate schema (e.g. `{ message: string }`) so generated types reflect reality; avoids `unknown`/`{}` confusion later.

Apply patches only to **`200`** unless codegen also needs other status bodies typed.

---

## Step 4 — Regenerate and validate

From [`packages/dokploy-api`](packages/dokploy-api):

- Run **`vp run codegen`** (see [`scripts/codegen.mjs`](packages/dokploy-api/scripts/codegen.mjs)).
- Commit **`openapi.codegen.patch.json`** and the regenerated **`src/generated/DokployClient.ts`**.

**Checks:**

- **`vp check`** and **`vp test`** at repo root (per [`AGENTS.md`](AGENTS.md)).
- In Crucible, search for **`as never`** on Dokploy payloads/responses; after stronger types, **remove casts** where the generator now matches.

---

## Step 5 — Crucible alignment

- **`includeResponse: true`** tuples should gain **typed JSON** in the second element where schemas are precise—update **local helpers** (`responseBodyJsonUnknown`, extractors) only if you want stricter parsing.
- **Bug triage:** `httpDeploy` and some delete paths reference **`sdk`** while other code uses **`api`** (`DokployApi` client). That is inconsistent with the surrounding `yield* DokployApi` pattern and will fail at runtime if `sdk` is not in scope. When touching those lines for types, **switch to the scoped client** (`const api = yield* DokployApi` / `api.applicationDeploy`) so behavior matches the rest of the engine.

---

## Maintenance and `build-openapi-patch.mjs`

- After **subtree updates** to `.repos/dokploy/openapi.json`, rerun **`node packages/dokploy-api/scripts/build-openapi-patch.mjs`** only for **security** rows. That script **overwrites** `openapi.codegen.patch.json` with **security-only** ops today — **do not run it blindly** if it would erase hand-written response patches.
- **Long-term:** extend the build script to **merge** auto-generated security patches with a **static file** (e.g. `openapi.codegen.response-patch.json`) or to **append** non-security ops from a second list.

---

## Definition of done

- For **each** `DokployApi` operation used in `DokployEngine.ts`, either the **`200` JSON schema** in the patched spec reflects the real response, or there is a documented exception (e.g. endpoint returns empty body and codegen should use `void`).
- **`vp run codegen`** produces an updated `DokployClient.ts` with **non-empty** return types where applicable.
- Tests and typecheck pass; Crucible uses fewer unsafe casts where the new types suffice.

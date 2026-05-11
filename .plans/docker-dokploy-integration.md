# Docker integration (Dokploy deploy + local dev)

Brainstorm aligned with vendored **Alchemy** (`.repos/alchemy`): Effect-based resources, `Provider` lifecycle (`diff` / `read` / `reconcile` / `delete`), and reuse of **`alchemy/Bundle/Docker`** helpers (`runDockerCommand`, `dockerBuild`, `dockerTag`, `pushImage`, `materializeDockerfile`, `DockerCommandError`).

## Design principle — maximum modularity with Effect

Prefer **small composable pieces** over one mega-resource:

- **`Layer`s per concern** — e.g. `DokployHttpLive` (base URL + auth), optional `RegistryPushLive`, shared `FetchHttpClient` / retries — merged at stack setup like other Alchemy providers.
- **`Effect.Service` / tagged services** where runtime varies — separate Dokploy client interface from Docker CLI wrapper so tests swap `HttpClient` mocks without touching providers.
- **Granular resources** — e.g. `Dokploy.Application` (or `Container`) as the atomic deploy unit; optional higher-level helpers that **compose** multiple resources in user land (`Effect.gen`), not hidden inside one god-provider.
- **Strategies as data** — deployment update mode (below), registry auth source, and “pull vs push” paths are **props or small modules**, not hard-coded branches inside one reconcile.
- **Pure helpers** — image ref normalization, label/tag builders, compose parsing → plain functions returning `Effect` where they touch IO.

This matches Alchemy’s existing split (providers collection + bindings + `HttpClient` injection) and keeps Alambic easy to extend (Compose, Dockerfile) without rewriting Phase A.

## Goals

| Horizon | Scope |
|--------|--------|
| **Now** | Plain Docker images only: reference by tag (`nginx:latest`) or digest; deploy to **Dokploy** via its HTTP API; **local** containers wired to **`alchemy dev` lifecycle** (auto start / stop / clean). |
| **Later** | **Docker Compose**: parse **and** exec paths as **optional modules** (see Phase C). |
| **Later** | **Dockerfile builds**: wrap existing `dockerBuild` + optional `pushImage` to produce tags Dokploy can pull (same pattern as Cloudflare `ContainerApplication` / AWS ECS `Task`). |

## Architecture layers

1. **Alambic package (`packages/alambic`)** — Dokploy + Docker-specific resources and providers (mirrors `alchemy/Neon`, `alchemy/Axiom`: `Providers.ts`, `Resource.ts` per resource).
2. **Official Alchemy bits to reuse** — import from published `alchemy` (or workspace alias): `Bundle/Docker` for CLI subprocesses; `HttpClient` + `HttpApi` patterns for Dokploy REST; `createInternalTags`-style labels on managed objects if Dokploy supports labels/metadata.
3. **Stack wiring** — user `alchemy.run.ts` merges providers (`Cloudflare.providers()`, `Dokploy.providers()`, `Docker.providers()`, …) and chooses **Layers** for each environment.

## Recorded product decisions (Q&A)

| Topic | Decision |
|-------|-----------|
| **Overall shape** | **As modular as possible using Effect** — Layers, tagged services, small resources, composable helpers (see above). |
| **Dokploy mapping** | **Granular first**: one primary resource per Dokploy *application* (or nearest atomic API entity). Optional docs/examples show composing many apps under one logical “project” using plain `Effect.gen` + naming conventions — no requirement for a single composite Alambic resource unless it pays for itself later. |
| **Environments** | **Configurable via Layers**, not a single global URL — e.g. `DOKPLOY_URL` / token from `ConfigProvider` or Profile per stage; support **multiple Dokploy backends** by providing different client Layers per stack or stage (same modular pattern as multi-account cloud). |
| **Private registry** | **Support both modularly**: (a) Dokploy-managed registry credentials on the server; (b) deploy-time **`pushImage`** + `RegistryAuth` from Alchemy/Alambic. User picks per app via props + optional Layers — providers stay thin. |
| **Local dev (lifecycle)** | **Yes — auto start / stop / clean**: local Docker resources participate in the **same session lifecycle** as the rest of `alchemy dev` (start when dev session starts, stop/clean when dev stops or cleans — align implementation with how Alchemy handles Sidecar/local processes today). No separate mandatory CLI beyond declaring resources in the stack. |
| **Ownership / adoption** | Use **deterministic naming** from stack + stage + logical id where Dokploy allows; implement **`read`** so foreign/unlabeled apps can return **`Unowned`** when metadata doesn’t match Alchemy ownership tags — gated behind `--adopt` like other providers (reconciler doctrine). |
| **Updates on image/config change** | **Both**: (1) **full recreate / redeploy** path when needed or requested; (2) **Dokploy-native rolling / in-place restart** when the API supports it and props select that strategy. Expose as explicit **`deploymentStrategy`** (or equivalent) on the resource **or** split **capabilities** — implementation follows Dokploy’s capabilities without collapsing into one behavior. |
| **Compose (future)** | **Keep both**: structured **parse** path (→ generate N atomic resources or data for Dokploy) and **`docker compose` exec** path for local dev — shipped as separate optional entrypoints/modules so non-Compose users pay nothing. |

## Phase A — Plain image → Dokploy

- **`Docker.Image` (logical)** — Prefer a **small typed input** (`PlainImageRef`) for v1; upgrade to a **thin Resource** only where reconcile adds value (`docker pull`, digest pin). Keeps modules orthogonal.
- **`Dokploy.Application` / `Dokploy.Container`** — Map to Dokploy’s API entity (application + deployment config). Provider responsibilities:
  - **Observe**: GET current app/deployment by stable id or name.
  - **Ensure**: create application if missing.
  - **Sync**: image ref, env, ports, volumes, restart policy, healthcheck — whatever the API exposes.
  - **Sync deployment**: honor **`deploymentStrategy`** — recreate vs rolling/in-place per recorded decision above.
  - **Delete**: remove app or scale to zero per Dokploy semantics (idempotent).

**Credentials**: Dokploy API token + base URL supplied via **Layer** / `Profile` / env (`DOKPLOY_URL`, `DOKPLOY_TOKEN`) — swappable per environment.

## Phase B — Local dev

1. **`Docker.LocalContainer`** (or equivalent) — **`docker run`** via **`runDockerCommand`**; outputs host URLs / container id.
2. **Lifecycle** — Register with **`alchemy dev`** so containers **start with dev**, **stop when dev stops**, and **are removed on clean** (same mental model as other dev-local infrastructure — investigate Sidecar/session hooks in Alchemy when implementing).

**Drift**: Local defaults still differ from Dokploy (secrets, TLS); document “parity hints” only — modular **optional** Layer can map env files.

## Phase C — Docker Compose

- **Module `compose/parse`** — `docker compose config` or YAML parse → list of services → user/Alambic maps to atomic Dokploy resources or data blobs.
- **Module `compose/dev`** — wraps `docker compose up/down` for local dev lifecycle (still tied to global dev start/stop/clean).
- Neither module required for Phase A/B users.

## Phase D — Dockerfile / build + push

- Reuse **`dockerBuild`** + **`getDockerImageId`** + **`pushImage`** (`RegistryAuth` for private).
- **`Docker.ImageFromBuild`** resource props: `context`, `dockerfile` path or inline string (`materializeDockerfile`), `tag`, optional `platform`, `buildArgs`.
- **Reconcile**: build when input digest changes; tag/push via **injectable** registry Layer.

## Testing strategy

- **Unit**: Mock `HttpClient` for Dokploy; mock or stub Docker CLI for local resources.
- **Integration** (optional CI): Dokploy test instance + ephemeral application; or recorded HTTP fixtures.

## Risks / constraints

- Dokploy API churn — generate client from OpenAPI if published, or maintain minimal hand-written endpoints behind one **`DokployClient` service**.
- **Effect discipline**: New code should follow AGENTS.md — `FileSystem`, `Path`, `HttpClient`, no raw `fs`/`fetch` in providers.
- **Docker daemon**: `runDockerCommand` requires Docker CLI on PATH for build/run paths.

## Implementation notes (v1 checklist)

- Wire **local containers** to dev session lifecycle early — defines UX for Q4; may require upstream Alchemy hook parity if not already exposed.
- Define **`deploymentStrategy`** (names + Dokploy API mapping) alongside Phase A so Phase B/C don’t bake in recreate-only behavior.

import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import { logger } from "../util/logger.ts";
import { poll } from "../util/poll.ts";
import { CloudflareApiError } from "./api-error.ts";
import { extractCloudflareResult } from "./api-response.ts";
import {
  createCloudflareApi,
  type CloudflareApi,
  type CloudflareApiOptions,
} from "./api.ts";

/**
 * Properties for creating or updating an AI Search Namespace
 */
export interface AiSearchNamespaceProps extends CloudflareApiOptions {
  /**
   * Name of the namespace.
   * Must match pattern: `^[a-z0-9]([a-z0-9-]{0,26}[a-z0-9])?$`
   *
   * @default `${app}-${stage}-${id}`
   */
  name?: string;

  /**
   * Optional description for the namespace (max 256 characters).
   *
   * Pass `null` to explicitly clear a previously-set description on update.
   * Leaving this field undefined (absent from props) will NOT touch the
   * existing description on update.
   */
  description?: string | null;

  /**
   * Whether to adopt an existing namespace with the same name if it exists
   *
   * @default false
   */
  adopt?: boolean;

  /**
   * Whether to delete the namespace when removed from Alchemy.
   * Namespace must be empty (no instances) to be deleted.
   *
   * @default true
   */
  delete?: boolean;
}

/**
 * Type guard for AiSearchNamespace
 */
export function isAiSearchNamespace(
  resource: unknown,
): resource is AiSearchNamespace {
  return (
    typeof resource === "object" &&
    resource !== null &&
    (resource as any)[ResourceKind] === "cloudflare::AiSearchNamespace"
  );
}

/**
 * Output returned after AI Search Namespace creation/update
 */
export type AiSearchNamespace = Omit<
  AiSearchNamespaceProps,
  "delete" | "adopt" | "description" | "name"
> & {
  /**
   * Resource type identifier for binding resolution
   */
  type: "ai_search_namespace";

  /**
   * The stable identifier of the namespace (equal to `namespace`).
   * Present because Alchemy's resource model expects every output to carry an `id`.
   */
  id: string;

  /**
   * The name of the namespace.
   */
  namespace: string;

  /**
   * Optional description of the namespace
   */
  description: string | null;

  /**
   * Time at which the namespace was created
   */
  createdAt: string;
};

/**
 * API response for AI Search namespace
 * @internal
 */
interface AiSearchNamespaceApiResponse {
  name: string;
  description: string | null;
  created_at: string;
}

/**
 * An AI Search Namespace groups AI Search instances together,
 * providing logical isolation and scoped access control.
 *
 * Namespaces are a first-class concept in the AI Search binding model.
 * Instance names are unique within their namespace: `UNIQUE(account_id, namespace, name)`.
 *
 * @see https://developers.cloudflare.com/ai-search/
 *
 * @example
 * ## Create a namespace
 *
 * ```ts
 * const ns = await AiSearchNamespace("production", {
 *   name: "production",
 * });
 * ```
 *
 * @example
 * ## Use as a Worker binding
 *
 * ```ts
 * const ns = await AiSearchNamespace("docs", {
 *   name: "docs",
 * });
 *
 * const worker = await Worker("my-worker", {
 *   bindings: {
 *     DOCS: ns,
 *   },
 *   // ...
 * });
 * ```
 *
 * @example
 * ## Adopt an existing namespace
 *
 * ```ts
 * const ns = await AiSearchNamespace("existing", {
 *   name: "production",
 *   adopt: true,
 * });
 * ```
 */
export const AiSearchNamespace = Resource(
  "cloudflare::AiSearchNamespace",
  async function (
    this: Context<AiSearchNamespace>,
    id: string,
    props: AiSearchNamespaceProps = {},
  ): Promise<AiSearchNamespace> {
    const adopt = props.adopt ?? this.scope.adopt;

    const namespace =
      props.name ??
      this.output?.namespace ??
      this.scope.createPhysicalName(id, "-", 28);

    // Validate namespace name against CF's documented pattern. We do this
    // before any API calls so users get a clear local error rather than a
    // generic API 400. Also guards against `createPhysicalName` truncation
    // producing a name that begins/ends with "-".
    //
    // Skip validation during delete: `this.output?.namespace` is always a
    // previously-accepted name (came from `toOutput(result)`), so there's
    // nothing to re-validate. Critically, this also prevents a failed
    // create (which throws from this guard without persisting state) from
    // tripping the same guard during scope teardown — destroy would have
    // nothing to delete anyway.
    if (
      this.phase !== "delete" &&
      !/^[a-z0-9]([a-z0-9-]{0,26}[a-z0-9])?$/.test(namespace)
    ) {
      throw new Error(
        `AI Search namespace name "${namespace}" is invalid. ` +
          "Must match pattern: ^[a-z0-9]([a-z0-9-]{0,26}[a-z0-9])?$ " +
          "(1-28 chars, lowercase alphanumerics and hyphens, cannot start or end with a hyphen).",
      );
    }

    // The `default` namespace is reserved by Cloudflare — it is created
    // automatically on every account and cannot be created, updated, or
    // deleted via the API. Only allow binding to it via `adopt: true`.
    if (namespace === "default" && !adopt && this.phase !== "delete") {
      throw new Error(
        'The "default" AI Search namespace is reserved by Cloudflare. ' +
          "Use `adopt: true` to bind to it (it cannot be created, renamed, or deleted via the API).",
      );
    }

    // NOTE: AI Search is an always-remote binding (no Miniflare-native
    // implementation). `alchemy dev` wires the worker binding via
    // `remote-binding-proxy`, which requires the namespace to actually exist
    // on Cloudflare at preview-token creation time — a locally mocked
    // resource would cause the Worker deploy to fail with error 10359
    // ("namespace … does not exist"). Follow the same pattern as Vectorize
    // and skip the `scope.local` mock branch entirely.
    const api = await createCloudflareApi(props);

    if (this.phase === "delete") {
      const namespaceName = this.output?.namespace;
      if (namespaceName && props.delete !== false) {
        await deleteAiSearchNamespace(api, namespaceName);
      }
      return this.destroy();
    }

    // Immutable name — replace if changed. We use the default
    // (pending-deletion) replace strategy: the old namespace is queued for
    // deletion and flushed at scope finalize, matching the convention used
    // by other Cloudflare resources in this repo. Forcing immediate
    // deletion (`replace(true)`) interacts poorly with Cloudflare's
    // namespace-delete consistency window and causes the old namespace to
    // still appear in subsequent GETs.
    if (this.phase === "update" && this.output?.namespace !== namespace) {
      return this.replace();
    }

    if (this.phase === "update" && this.output) {
      // Three-way semantics on `description`:
      //   - absent (undefined)  → do not touch (preserves out-of-band edits)
      //   - string              → set to that value
      //   - null                → clear (explicit opt-in to clearing)
      // We only PUT when the value differs from current state.
      const hasDescriptionProp = "description" in props;
      if (hasDescriptionProp && props.description !== this.output.description) {
        const updated = await updateAiSearchNamespace(api, namespace, {
          description: props.description,
        });
        return toOutput(updated);
      }
      return this.output;
    }

    // Adopting the reserved `default` namespace is a no-op creation: emit a
    // warn so the behavior is visible (delete is silently skipped later).
    if (namespace === "default" && adopt) {
      logger.warn(
        `Adopting the reserved AI Search "default" namespace. It will not be deleted on teardown.`,
      );
    }

    // Create (with adopt via pre-flight check when enabled)
    const hasDescriptionProp = "description" in props;
    let result: AiSearchNamespaceApiResponse;
    if (adopt) {
      // Pre-flight: if namespace exists, adopt it; otherwise create.
      // `getAiSearchNamespace` internally returns `undefined` on 404 and
      // rethrows all other errors (auth, 5xx, network) — no catch needed here.
      const existing = await getAiSearchNamespace(api, namespace);
      if (existing) {
        if (hasDescriptionProp && props.description !== existing.description) {
          result = await updateAiSearchNamespace(api, namespace, {
            description: props.description,
          });
        } else {
          result = existing;
        }
      } else if (namespace === "default") {
        // The `default` namespace is implicit — treat GET 404 as "exists but
        // not queryable" and return a synthetic adoption record. Use the
        // current timestamp rather than epoch 0 to avoid a misleading
        // "1970-01-01" createdAt in the state file.
        result = {
          name: "default",
          description: null,
          created_at: new Date().toISOString(),
        };
      } else {
        result = await createAiSearchNamespace(api, {
          name: namespace,
          description: props.description ?? undefined,
        });
      }
    } else {
      try {
        result = await createAiSearchNamespace(api, {
          name: namespace,
          description: props.description ?? undefined,
        });
      } catch (error) {
        // Wrap "already exists" errors with AGENTS.md-style messaging that
        // points at `adopt: true`.
        if (
          error instanceof CloudflareApiError &&
          (error.status === 400 || error.status === 409)
        ) {
          const existing = await getAiSearchNamespace(api, namespace);
          if (existing) {
            throw new Error(
              `AI Search namespace "${namespace}" already exists. Use \`adopt: true\` to adopt it.`,
              { cause: error },
            );
          }
        }
        throw error;
      }
    }

    return toOutput(result);
  },
);

function toOutput(result: AiSearchNamespaceApiResponse): AiSearchNamespace {
  return {
    type: "ai_search_namespace",
    id: result.name,
    namespace: result.name,
    description: result.description ?? null,
    createdAt: result.created_at,
  };
}

// ─── API Helper Functions ────────────────────────────────────────────────────

/**
 * Create an AI Search namespace
 */
export async function createAiSearchNamespace(
  api: CloudflareApi,
  payload: { name: string; description?: string | null },
): Promise<AiSearchNamespaceApiResponse> {
  return await extractCloudflareResult<AiSearchNamespaceApiResponse>(
    `create AI Search namespace "${payload.name}"`,
    api.post(`/accounts/${api.accountId}/ai-search/namespaces`, payload),
  );
}

/**
 * Get an AI Search namespace by name
 */
export async function getAiSearchNamespace(
  api: CloudflareApi,
  name: string,
): Promise<AiSearchNamespaceApiResponse | undefined> {
  try {
    return await extractCloudflareResult<AiSearchNamespaceApiResponse>(
      `get AI Search namespace "${name}"`,
      api.get(`/accounts/${api.accountId}/ai-search/namespaces/${name}`),
    );
  } catch (error) {
    if (error instanceof CloudflareApiError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Update an AI Search namespace.
 *
 * `description: null` clears a previously-set description. `description`
 * absent from the payload leaves the current value untouched.
 */
export async function updateAiSearchNamespace(
  api: CloudflareApi,
  name: string,
  payload: { description?: string | null },
): Promise<AiSearchNamespaceApiResponse> {
  return await extractCloudflareResult<AiSearchNamespaceApiResponse>(
    `update AI Search namespace "${name}"`,
    api.put(`/accounts/${api.accountId}/ai-search/namespaces/${name}`, payload),
  );
}

/**
 * Delete an AI Search namespace. Namespace must be empty (no instances).
 * The reserved `default` namespace cannot be deleted and is skipped.
 */
export async function deleteAiSearchNamespace(
  api: CloudflareApi,
  name: string,
): Promise<void> {
  // The `default` namespace is reserved and cannot be deleted by the API.
  // Skip silently to allow clean teardown of resources that adopted it.
  if (name === "default") {
    return;
  }
  try {
    await extractCloudflareResult(
      `delete AI Search namespace "${name}"`,
      api.delete(`/accounts/${api.accountId}/ai-search/namespaces/${name}`),
    );
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      if (error.status === 404) {
        return;
      }
      // Namespace is likely non-empty — wrap with a clearer message.
      if (error.status === 400 || error.status === 409) {
        throw new Error(
          `Cannot delete AI Search namespace "${name}". ` +
            "The namespace may contain instances — delete all instances first, " +
            "or use { delete: false } on the AiSearchNamespace resource to preserve it.",
          { cause: error },
        );
      }
    }
    throw error;
  }

  // Cloudflare's namespace DELETE is eventually consistent — same-colo
  // GETs are invalidated immediately via the edge cache, cross-colo GETs
  // can surface the stale row for up to 60s (KV TTL). Wait until the
  // namespace is truly gone so destroy phase presents a strongly-
  // consistent contract to callers (user teardown assertions,
  // downstream resources, rename-triggered replace flows).
  await poll({
    description: `wait for AI Search namespace "${name}" deletion to propagate`,
    fn: () =>
      api.get(`/accounts/${api.accountId}/ai-search/namespaces/${name}`),
    predicate: (res) => res.status === 404,
    initialDelay: 500,
    maxDelay: 3000,
    timeout: 90_000,
  });
}

/**
 * List all AI Search namespaces in an account
 */
export async function listAiSearchNamespaces(
  api: CloudflareApi,
): Promise<AiSearchNamespaceApiResponse[]> {
  return await extractCloudflareResult<AiSearchNamespaceApiResponse[]>(
    "list AI Search namespaces",
    api.get(`/accounts/${api.accountId}/ai-search/namespaces`),
  );
}

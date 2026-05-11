import { alchemy } from "../alchemy.ts";
import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import { isCloudflareApiError } from "./api-error.ts";
import {
  extractCloudflareResult,
  type CloudflareApiListResponse,
} from "./api-response.ts";
import {
  createCloudflareApi,
  type CloudflareApi,
  type CloudflareApiOptions,
} from "./api.ts";

/**
 * Properties for creating or updating an {@link AccessServiceToken}.
 */
export interface AccessServiceTokenProps extends CloudflareApiOptions {
  /**
   * Display name of the service token.
   *
   * @default ${app}-${stage}-${id}
   */
  name?: string;

  /**
   * How long the token is valid for. Format: a Cloudflare duration string
   * such as `"24h"`, `"30d"`, or `"8760h"` (one year).
   *
   * @default "8760h"
   */
  duration?: string;

  /**
   * Adopt an existing service token with the same name instead of failing
   * with a duplicate-name error.
   *
   * Note: when adopting, the `clientSecret` cannot be recovered — the output
   * `clientSecret` will be `undefined`. Recreate the resource (or rotate via
   * the Cloudflare dashboard) if you need a new secret.
   *
   * @default false
   */
  adopt?: boolean;

  /**
   * Whether to delete the token when removed from Alchemy.
   *
   * @default true
   */
  delete?: boolean;
}

/**
 * Output for an {@link AccessServiceToken}.
 */
export type AccessServiceToken = Omit<
  AccessServiceTokenProps,
  "delete" | "adopt"
> & {
  /** Cloudflare-assigned token UUID. */
  id: string;
  /** Display name of the token. */
  name: string;
  /**
   * Value sent in the `CF-Access-Client-Id` header when authenticating.
   */
  clientId: string;
  /**
   * Value sent in the `CF-Access-Client-Secret` header when authenticating.
   * **Returned only on creation** — `undefined` for adopted tokens.
   */
  clientSecret?: Secret;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-update timestamp. */
  updatedAt: string;
};

/**
 * Type guard for {@link AccessServiceToken}.
 */
export function isAccessServiceToken(
  resource: any,
): resource is AccessServiceToken {
  return resource?.[ResourceKind] === "cloudflare::AccessServiceToken";
}

interface CloudflareAccessServiceToken {
  id: string;
  name: string;
  client_id: string;
  client_secret?: string;
  duration?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Creates a Cloudflare Zero Trust [Access service token](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)
 * for machine-to-machine authentication against Access-protected applications.
 *
 * The returned `clientSecret` is only available on creation — store it
 * immediately. Adopted tokens have `clientSecret: undefined`.
 *
 * @example
 * // Basic service token (defaults to 1 year duration)
 * const token = await AccessServiceToken("ci-token", {
 *   name: "ci-runner",
 * });
 *
 * @example
 * // Custom duration
 * const shortLived = await AccessServiceToken("preview", {
 *   name: "preview-deploy-token",
 *   duration: "720h", // 30 days
 * });
 */
export const AccessServiceToken = Resource(
  "cloudflare::AccessServiceToken",
  async function (
    this: Context<AccessServiceToken>,
    id: string,
    props: AccessServiceTokenProps,
  ): Promise<AccessServiceToken> {
    const api = await createCloudflareApi(props);
    const name = props.name ?? this.scope.createPhysicalName(id);
    const basePath = `/accounts/${api.accountId}/access/service_tokens`;

    if (this.phase === "delete") {
      if (this.output?.id && props.delete !== false) {
        await deleteAccessServiceToken(api, this.output.id);
      }
      return this.destroy();
    }

    const body: Record<string, unknown> = { name };
    if (props.duration) body.duration = props.duration;

    let token: CloudflareAccessServiceToken;
    if (this.phase === "update" && this.output?.id) {
      token = await extractCloudflareResult<CloudflareAccessServiceToken>(
        `update access service token "${name}"`,
        api.put(`${basePath}/${this.output.id}`, body),
      );
    } else {
      const adopt = props.adopt ?? this.scope.adopt;
      try {
        token = await extractCloudflareResult<CloudflareAccessServiceToken>(
          `create access service token "${name}"`,
          api.post(basePath, body),
        );
      } catch (err) {
        if (adopt && isAccessDuplicateNameError(err)) {
          const existing = await findAccessServiceTokenByName(api, name);
          if (!existing) {
            throw new Error(
              `Service token "${name}" already exists but could not be found for adoption.`,
              { cause: err },
            );
          }
          logger.log(
            `Adopting existing access service token "${name}" (${existing.id})`,
          );
          token = await extractCloudflareResult<CloudflareAccessServiceToken>(
            `adopt access service token "${name}"`,
            api.put(`${basePath}/${existing.id}`, body),
          );
        } else {
          throw err;
        }
      }
    }

    // clientSecret is only returned on creation; retain on subsequent updates.
    const clientSecret = token.client_secret
      ? alchemy.secret(token.client_secret)
      : this.output?.clientSecret;

    return {
      id: token.id,
      name: token.name,
      clientId: token.client_id,
      clientSecret,
      duration: token.duration,
      createdAt: token.created_at,
      updatedAt: token.updated_at,
    };
  },
);

/**
 * Cloudflare returns error code 12132 ("Access service token already exists")
 * for duplicate names.
 */
function isAccessDuplicateNameError(err: unknown): boolean {
  if (
    isCloudflareApiError(err, { status: 409 }) ||
    isCloudflareApiError(err, { status: 400 })
  ) {
    const data = err.errorData;
    if (
      Array.isArray(data) &&
      data.some(
        (e) => "message" in e && /already exists/i.test(String(e.message)),
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Look up an existing service token by name across paginated results.
 */
async function findAccessServiceTokenByName(
  api: CloudflareApi,
  name: string,
): Promise<CloudflareAccessServiceToken | null> {
  let page = 1;
  const perPage = 50;
  while (true) {
    const response = await api.get(
      `/accounts/${api.accountId}/access/service_tokens?page=${page}&per_page=${perPage}`,
    );
    if (!response.ok) return null;
    const data =
      (await response.json()) as CloudflareApiListResponse<CloudflareAccessServiceToken>;
    const match = data.result.find((t) => t.name === name);
    if (match) return match;
    const info = data.result_info;
    if (!info || info.page * info.per_page >= info.total_count) return null;
    page++;
  }
}

/**
 * Delete a service token. No-op on 404.
 */
async function deleteAccessServiceToken(
  api: CloudflareApi,
  tokenId: string,
): Promise<void> {
  const response = await api.delete(
    `/accounts/${api.accountId}/access/service_tokens/${tokenId}`,
  );
  if (!response.ok && response.status !== 404) {
    logger.error(
      `Error deleting access service token ${tokenId}: ${response.status} ${response.statusText}`,
    );
  }
}

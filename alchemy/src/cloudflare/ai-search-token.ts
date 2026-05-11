import { alchemy } from "../alchemy.ts";
import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { AccountApiToken } from "./account-api-token.ts";
import { CloudflareApiError } from "./api-error.ts";
import { extractCloudflareResult } from "./api-response.ts";
import {
  CloudflareApi,
  createCloudflareApi,
  type CloudflareApiOptions,
} from "./api.ts";

/**
 * Properties for creating an AI Search Token
 */
export interface AiSearchTokenProps extends CloudflareApiOptions {
  /**
   * Name of the token
   * @default Uses the resource ID
   */
  name?: string;

  /**
   * Whether to adopt an existing token if one with the same name exists
   * @default false
   */
  adopt?: boolean;

  /**
   * Whether to delete the token when removed from Alchemy
   * @default true
   */
  delete?: boolean;
}

/**
 * AI Search Token output
 */
export type AiSearchToken = {
  /**
   * Resource type identifier for binding
   * @internal
   */
  type: "ai_search_token";

  /**
   * The AI Search token ID (UUID)
   */
  tokenId: string;

  /**
   * The underlying account API token ID (for lifecycle management)
   */
  accountTokenId: string;

  /**
   * The account ID
   */
  accountId: string;

  /**
   * The account tag
   */
  accountTag: string;

  /**
   * Name of the token
   */
  name: string;

  /**
   * The CF API ID for this token
   */
  cfApiId: string;

  /**
   * The CF API key for this token (stored as Secret)
   */
  cfApiKey: Secret;

  /**
   * Whether the token is enabled
   */
  enabled: boolean;

  /**
   * When the token was created
   */
  createdAt: string;

  /**
   * When the token was last modified
   */
  modifiedAt: string;
};

/**
 * API response for AI Search token
 * @internal
 */
interface AiSearchTokenApiResponse {
  id: string;
  account_id: string;
  account_tag: string;
  name: string;
  cf_api_id: string;
  cf_api_key: string;
  enabled: boolean;
  legacy: boolean;
  created_at: string;
  modified_at: string;
}

/**
 * Type guard for AiSearchToken
 */
export function isAiSearchToken(resource: unknown): resource is AiSearchToken {
  return (
    typeof resource === "object" &&
    resource !== null &&
    ((resource as any)[ResourceKind] === "cloudflare::AiSearchToken" ||
      (resource as any).type === "ai_search_token")
  );
}

/**
 * Creates an AI Search token for accessing AI Search instances.
 *
 * AI Search tokens are used to authenticate with the AI Search API and provide
 * access to R2 buckets or other data sources for indexing.
 *
 * This resource automatically:
 * 1. Creates an account API token with AI Search Index Engine and R2 Storage Write permissions
 * 2. Registers that token with the AI Search service
 *
 * @example
 * // Create an AI Search token
 * const token = await AiSearchToken("my-token", {
 *   name: "docs-search-token",
 * });
 *
 * // Use the token with an AI Search instance
 * const search = await AiSearch("docs-search", {
 *   source: {
 *     type: "r2",
 *     bucket: myBucket,
 *     token: token,
 *   },
 * });
 *
 * @example
 * // Let AiSearch auto-create a token (recommended)
 * const search = await AiSearch("docs-search", {
 *   source: {
 *     type: "r2",
 *     bucket: myBucket,
 *   },
 * });
 */
export const AiSearchToken = Resource(
  "cloudflare::AiSearchToken",
  async function (
    this: Context<AiSearchToken>,
    id: string,
    props: AiSearchTokenProps,
  ): Promise<AiSearchToken> {
    const api = await createCloudflareApi(props);
    const tokenName = props.name ?? this.scope.createPhysicalName(id);

    if (this.phase === "delete") {
      if (this.output?.tokenId && props.delete !== false) {
        await deleteAiSearchToken(api, this.output.tokenId);
      }

      // The AccountApiToken will be cleaned up automatically by Alchemy's
      // resource lifecycle management since it's a child resource

      return this.destroy();
    }

    // For update, we can't really update tokens - just return existing
    if (this.phase === "update" && this.output?.tokenId) {
      return this.output;
    }

    // Create an account API token with AI Search + R2 permissions
    const accountToken = await AccountApiToken("account-token", {
      name: `${tokenName} (AI Search Service Token)`,
      policies: [
        {
          effect: "allow",
          permissionGroups: [
            "AI Search Index Engine",
            "Workers R2 Storage Write",
          ],
          resources: {
            "com.cloudflare.api.account": "*",
          },
        },
      ],
      baseUrl: props.baseUrl,
      profile: props.profile,
      apiKey: props.apiKey,
      apiToken: props.apiToken,
      accountId: props.accountId,
      email: props.email,
      delete: props.delete,
    });

    if (!accountToken.value) {
      throw new Error(
        "Failed to create account API token for AI Search - no token value returned",
      );
    }

    const cfApiId = accountToken.id;
    const cfApiKey = accountToken.value.unencrypted;

    // Register the token with AI Search
    try {
      const result = await createAiSearchToken(api, {
        name: tokenName,
        cf_api_id: cfApiId,
        cf_api_key: cfApiKey,
      });

      return {
        type: "ai_search_token" as const,
        tokenId: result.id,
        accountTokenId: accountToken.id,
        accountId: result.account_id,
        accountTag: result.account_tag,
        name: result.name,
        cfApiId: result.cf_api_id,
        cfApiKey: alchemy.secret(cfApiKey),
        enabled: result.enabled,
        createdAt: result.created_at,
        modifiedAt: result.modified_at,
      };
    } catch (error) {
      // Check if token already exists and we should adopt it
      if (error instanceof CloudflareApiError && props.adopt) {
        // List tokens and find by name
        const tokens = await listAiSearchTokens(api);
        const existing = tokens.find((t) => t.name === tokenName);
        if (existing) {
          return {
            type: "ai_search_token" as const,
            tokenId: existing.id,
            accountTokenId: accountToken.id,
            accountId: existing.account_id,
            accountTag: existing.account_tag,
            name: existing.name,
            cfApiId: existing.cf_api_id,
            cfApiKey: alchemy.secret(cfApiKey),
            enabled: existing.enabled,
            createdAt: existing.created_at,
            modifiedAt: existing.modified_at,
          };
        }
      }
      throw error;
    }
  },
);

/**
 * Create an AI Search token
 */
export async function createAiSearchToken(
  api: CloudflareApi,
  payload: { name: string; cf_api_id: string; cf_api_key: string },
): Promise<AiSearchTokenApiResponse> {
  return await extractCloudflareResult<AiSearchTokenApiResponse>(
    `create AI Search token "${payload.name}"`,
    api.post(`/accounts/${api.accountId}/ai-search/tokens`, payload),
  );
}

/**
 * List all AI Search tokens in an account
 */
export async function listAiSearchTokens(
  api: CloudflareApi,
): Promise<AiSearchTokenApiResponse[]> {
  return await extractCloudflareResult<AiSearchTokenApiResponse[]>(
    `list AI Search tokens`,
    api.get(`/accounts/${api.accountId}/ai-search/tokens`),
  );
}

/**
 * Delete an AI Search token.
 *
 * Retries briefly on `7076 token_in_use_by_instances` to cover residual
 * cross-colo lag (CF's server retries the guard internally once after
 * 500ms; the spurious-409 window is typically sub-second). We layer two
 * client-side retries with 1s + 2s delays on top.
 *
 * A persistent 409 after the short retry window means the token is
 * genuinely still referenced by another AI Search instance. We throw an
 * actionable error rather than silently leaking the token — shared tokens
 * should be modeled explicitly via an `AiSearchToken` resource.
 */
export async function deleteAiSearchToken(
  api: CloudflareApi,
  tokenId: string,
): Promise<void> {
  const retryDelaysMs = [1000, 2000]; // 2 retries, ~3s total
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    try {
      await extractCloudflareResult(
        `delete AI Search token "${tokenId}"`,
        api.delete(`/accounts/${api.accountId}/ai-search/tokens/${tokenId}`),
      );
      return;
    } catch (error) {
      if (error instanceof CloudflareApiError && error.status === 404) {
        return;
      }
      const isTokenInUse =
        error instanceof CloudflareApiError &&
        error.status === 409 &&
        Array.isArray(error.errorData) &&
        error.errorData.some((e: { code?: number }) => e?.code === 7076);
      if (isTokenInUse && attempt < retryDelaysMs.length) {
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelaysMs[attempt]),
        );
        continue;
      }
      if (isTokenInUse) {
        throw new Error(
          `AI Search token "${tokenId}" is still referenced by another instance. ` +
            "If the token is intentionally shared across instances, manage it " +
            "explicitly via an `AiSearchToken` resource with `delete: false`, " +
            "or delete all referencing instances before deleting the token.",
          { cause: error },
        );
      }
      throw error;
    }
  }
}

/**
 * Get an AI Search token
 */
export async function getAiSearchToken(
  api: CloudflareApi,
  tokenId: string,
): Promise<AiSearchTokenApiResponse> {
  return await extractCloudflareResult<AiSearchTokenApiResponse>(
    `get AI Search token "${tokenId}"`,
    api.get(`/accounts/${api.accountId}/ai-search/tokens/${tokenId}`),
  );
}

import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import { logger } from "../util/logger.ts";
import { serializeAccessRule, type AccessRule } from "./access-rule.ts";
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
 * Properties for creating or updating an {@link AccessGroup}.
 */
export interface AccessGroupProps extends CloudflareApiOptions {
  /**
   * Display name of the group.
   *
   * @default ${app}-${stage}-${id}
   */
  name?: string;

  /**
   * Rules that grant membership (OR logic — any match includes the user).
   */
  include?: AccessRule[];

  /**
   * Rules that revoke membership when matched.
   */
  exclude?: AccessRule[];

  /**
   * Rules that must additionally match for membership (AND logic).
   */
  require?: AccessRule[];

  /**
   * Mark this group as the account default. Default groups apply to every
   * Access application unless explicitly overridden.
   *
   * @default false
   */
  isDefault?: boolean;

  /**
   * Adopt an existing group with the same name instead of failing.
   *
   * @default false
   */
  adopt?: boolean;

  /**
   * Whether to delete the group when removed from Alchemy.
   *
   * @default true
   */
  delete?: boolean;
}

/**
 * Output for an {@link AccessGroup}.
 */
export type AccessGroup = Omit<AccessGroupProps, "adopt" | "delete"> & {
  /** Cloudflare-assigned group UUID. */
  id: string;
  /** Display name. */
  name: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-update timestamp. */
  updatedAt: string;
};

/**
 * Type guard for {@link AccessGroup}.
 */
export function isAccessGroup(resource: any): resource is AccessGroup {
  return resource?.[ResourceKind] === "cloudflare::AccessGroup";
}

interface CloudflareAccessGroup {
  id: string;
  name: string;
  include?: Record<string, unknown>[];
  exclude?: Record<string, unknown>[];
  require?: Record<string, unknown>[];
  is_default?: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Creates a Cloudflare Zero Trust [Access group](https://developers.cloudflare.com/cloudflare-one/identity/users/groups/),
 * a reusable bundle of rules that can be referenced by Access policies.
 *
 * @example
 * // Engineering team by email domain.
 * const engineering = await AccessGroup("engineering", {
 *   name: "Engineering",
 *   include: [{ email_domain: { domain: "acme.com" } }],
 * });
 *
 * @example
 * // Allow a managed IP list, exclude one specific IP.
 * const officeIps = await AccessGroup("office", {
 *   name: "Office IPs",
 *   include: [{ ip_list: { id: "<list-uuid>" } }],
 *   exclude: [{ ip: { ip: "203.0.113.99/32" } }],
 * });
 *
 * @example
 * // Compose groups: admins are engineers who are also on-call. Resources
 * // can be passed directly — Alchemy lifts `.id` at the wire boundary.
 * const onCall = await AccessGroup("on-call", {
 *   include: [{ email_domain: { domain: "acme.com" } }],
 * });
 * const admins = await AccessGroup("admins", {
 *   include: [{ group: { id: engineering } }],
 *   require: [{ group: { id: onCall } }],
 * });
 *
 * @example
 * // IdP-bound rules — match Okta groups via an AccessIdentityProvider.
 * const okta = await AccessIdentityProvider("okta", {
 *   type: "okta",
 *   name: "Acme Okta",
 *   oktaAccount: "acme.okta.com",
 *   clientId: "...",
 *   clientSecret: alchemy.secret.env.OKTA_SECRET,
 * });
 * const sre = await AccessGroup("sre", {
 *   include: [{ okta: { name: "sre", identity_provider_id: okta } }],
 * });
 *
 * @example
 * // Account default — applied implicitly to every Access application.
 * await AccessGroup("default-deny", {
 *   isDefault: true,
 *   include: [{ everyone: {} }],
 *   exclude: [{ email_domain: { domain: "acme.com" } }],
 * });
 */
export const AccessGroup = Resource(
  "cloudflare::AccessGroup",
  async function (
    this: Context<AccessGroup>,
    id: string,
    props: AccessGroupProps,
  ): Promise<AccessGroup> {
    const api = await createCloudflareApi(props);
    const name = props.name ?? this.scope.createPhysicalName(id);
    const basePath = `/accounts/${api.accountId}/access/groups`;

    if (this.phase === "delete") {
      if (this.output?.id && props.delete !== false) {
        await deleteAccessGroup(api, this.output.id);
      }
      return this.destroy();
    }

    const body: Record<string, unknown> = {
      name,
      include: (props.include ?? []).map(serializeAccessRule),
      exclude: (props.exclude ?? []).map(serializeAccessRule),
      require: (props.require ?? []).map(serializeAccessRule),
      is_default: props.isDefault ?? false,
    };

    let group: CloudflareAccessGroup;
    if (this.phase === "update" && this.output?.id) {
      group = await extractCloudflareResult<CloudflareAccessGroup>(
        `update access group "${name}"`,
        api.put(`${basePath}/${this.output.id}`, body),
      );
    } else {
      const adopt = props.adopt ?? this.scope.adopt;
      try {
        group = await extractCloudflareResult<CloudflareAccessGroup>(
          `create access group "${name}"`,
          api.post(basePath, body),
        );
      } catch (err) {
        if (adopt && isAccessDuplicateNameError(err)) {
          const existing = await findAccessGroupByName(api, name);
          if (!existing) {
            throw new Error(
              `Access group "${name}" already exists but could not be found for adoption.`,
              { cause: err },
            );
          }
          logger.log(
            `Adopting existing access group "${name}" (${existing.id})`,
          );
          group = await extractCloudflareResult<CloudflareAccessGroup>(
            `adopt access group "${name}"`,
            api.put(`${basePath}/${existing.id}`, body),
          );
        } else {
          throw err;
        }
      }
    }

    return {
      id: group.id,
      name: group.name,
      include: props.include,
      exclude: props.exclude,
      require: props.require,
      isDefault: group.is_default,
      createdAt: group.created_at,
      updatedAt: group.updated_at,
    };
  },
);

function isAccessDuplicateNameError(err: unknown): boolean {
  if (
    isCloudflareApiError(err, { status: 409 }) ||
    isCloudflareApiError(err, { status: 400 })
  ) {
    const data = err.errorData;
    return (
      Array.isArray(data) &&
      data.some(
        (e) => "message" in e && /already exists/i.test(String(e.message)),
      )
    );
  }
  return false;
}

async function findAccessGroupByName(
  api: CloudflareApi,
  name: string,
): Promise<CloudflareAccessGroup | null> {
  let page = 1;
  const perPage = 50;
  while (true) {
    const response = await api.get(
      `/accounts/${api.accountId}/access/groups?page=${page}&per_page=${perPage}`,
    );
    if (!response.ok) return null;
    const data =
      (await response.json()) as CloudflareApiListResponse<CloudflareAccessGroup>;
    const match = data.result.find((g) => g.name === name);
    if (match) return match;
    const info = data.result_info;
    if (!info || info.page * info.per_page >= info.total_count) return null;
    page++;
  }
}

async function deleteAccessGroup(
  api: CloudflareApi,
  groupId: string,
): Promise<void> {
  const response = await api.delete(
    `/accounts/${api.accountId}/access/groups/${groupId}`,
  );
  if (!response.ok && response.status !== 404) {
    logger.error(
      `Error deleting access group ${groupId}: ${response.status} ${response.statusText}`,
    );
  }
}

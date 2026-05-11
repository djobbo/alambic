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
 * Access decision a policy applies when its rules match.
 * - `allow`: grant access when an authenticated user matches `include`.
 * - `deny`: deny access when matched.
 * - `non_identity`: allow without identity (e.g. service tokens, IP allowlists).
 * - `bypass`: skip Access entirely (no auth required).
 */
export type AccessPolicyDecision = "allow" | "deny" | "non_identity" | "bypass";

/**
 * An approval group authorising an access request when
 * `approvalRequired: true`.
 */
export interface AccessPolicyApprovalGroup {
  /** Number of approvals required from this group. */
  approvalsNeeded: number;
  /** Email addresses of approvers. */
  emailAddresses?: string[];
  /** UUID of an Access email list. */
  emailListUuid?: string;
}

/**
 * Optional MFA enforcement on top of the IdP's authentication.
 */
export interface AccessPolicyMfaConfig {
  allowedAuthenticators?: string[];
  mfaDisabled?: boolean;
  /** Cloudflare duration string, e.g. `"30m"`. */
  sessionDuration?: string;
}

/**
 * Connection-protocol-specific options (currently only RDP clipboard
 * formats are supported by Cloudflare).
 */
export interface AccessPolicyConnectionRules {
  rdp?: {
    allowedClipboardFormats?: ("text" | "image" | "files")[];
  };
}

/**
 * Properties for creating or updating an {@link AccessPolicy}.
 */
export interface AccessPolicyProps extends CloudflareApiOptions {
  /**
   * Display name of the policy.
   *
   * @default ${app}-${stage}-${id}
   */
  name?: string;

  /**
   * Decision the policy applies. **Immutable** — changing the decision will
   * trigger replacement of the underlying Cloudflare resource.
   */
  decision: AccessPolicyDecision;

  /**
   * Rules a request must match to be considered (OR logic). Must be
   * non-empty — Cloudflare rejects policies with no include rules.
   */
  include: AccessRule[];

  /**
   * Rules that, when matched, exclude the request from this policy.
   */
  exclude?: AccessRule[];

  /**
   * Rules that must additionally match (AND logic).
   */
  require?: AccessRule[];

  /**
   * Require explicit approval before granting access.
   */
  approvalRequired?: boolean;

  /**
   * Approver groups consulted when `approvalRequired: true`.
   */
  approvalGroups?: AccessPolicyApprovalGroup[];

  /**
   * Prompt the user for a purpose justification on each access.
   */
  purposeJustificationRequired?: boolean;

  /**
   * Prompt text shown when `purposeJustificationRequired` is true.
   */
  purposeJustificationPrompt?: string;

  /**
   * Force isolated browser rendering for this policy.
   */
  isolationRequired?: boolean;

  /**
   * Optional MFA enforcement.
   */
  mfaConfig?: AccessPolicyMfaConfig;

  /**
   * Override the default Access session duration (Cloudflare duration string).
   */
  sessionDuration?: string;

  /**
   * Per-protocol connection rules (e.g. RDP clipboard restrictions).
   */
  connectionRules?: AccessPolicyConnectionRules;

  /**
   * Adopt an existing policy with the same name instead of failing.
   *
   * @default false
   */
  adopt?: boolean;

  /**
   * Whether to delete the policy when removed from Alchemy.
   *
   * @default true
   */
  delete?: boolean;
}

/**
 * Output for an {@link AccessPolicy}.
 */
export type AccessPolicy = Omit<AccessPolicyProps, "adopt" | "delete"> & {
  /** Cloudflare-assigned policy UUID. */
  id: string;
  /** Display name. */
  name: string;
  /** Number of applications currently referencing this policy. */
  appCount: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-update timestamp. */
  updatedAt: string;
};

/**
 * Type guard for {@link AccessPolicy}.
 */
export function isAccessPolicy(resource: any): resource is AccessPolicy {
  return resource?.[ResourceKind] === "cloudflare::AccessPolicy";
}

interface CloudflareAccessPolicy {
  id: string;
  name: string;
  decision: AccessPolicyDecision;
  include: Record<string, unknown>[];
  exclude?: Record<string, unknown>[];
  require?: Record<string, unknown>[];
  app_count?: number;
  reusable?: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Creates a reusable Cloudflare Zero Trust [Access policy](https://developers.cloudflare.com/cloudflare-one/policies/access/)
 * that can be attached to one or more {@link AccessApplication} resources.
 *
 * @example
 * // Allow employees from a specific email domain.
 * const employees = await AccessPolicy("employees", {
 *   name: "Employees",
 *   decision: "allow",
 *   include: [{ email_domain: { domain: "acme.com" } }],
 * });
 *
 * @example
 * // Bypass Access for an office IP range.
 * const officeBypass = await AccessPolicy("office-bypass", {
 *   name: "Office Bypass",
 *   decision: "bypass",
 *   include: [{ ip: { ip: "203.0.113.0/24" } }],
 * });
 *
 * @example
 * // Reference an AccessGroup and require approval.
 * const sensitive = await AccessPolicy("sensitive", {
 *   name: "Sensitive admin access",
 *   decision: "allow",
 *   include: [{ group: { id: adminGroup } }],
 *   approvalRequired: true,
 *   approvalGroups: [
 *     { approvalsNeeded: 2, emailAddresses: ["security@acme.com"] },
 *   ],
 *   isolationRequired: true,
 * });
 */
export const AccessPolicy = Resource(
  "cloudflare::AccessPolicy",
  async function (
    this: Context<AccessPolicy>,
    id: string,
    props: AccessPolicyProps,
  ): Promise<AccessPolicy> {
    const api = await createCloudflareApi(props);
    const name = props.name ?? this.scope.createPhysicalName(id);
    const basePath = `/accounts/${api.accountId}/access/policies`;

    if (this.phase === "delete") {
      if (this.output?.id && props.delete !== false) {
        await deleteAccessPolicy(api, this.output.id);
      }
      return this.destroy();
    }

    if (!props.include || props.include.length === 0) {
      throw new Error(
        `AccessPolicy "${name}" requires at least one rule in 'include'.`,
      );
    }

    // decision is immutable — recreate if it changed.
    if (
      this.phase === "update" &&
      this.output &&
      this.output.decision !== props.decision
    ) {
      this.replace(true);
    }

    const body: Record<string, unknown> = {
      name,
      decision: props.decision,
      reusable: true,
      include: props.include.map(serializeAccessRule),
      exclude: (props.exclude ?? []).map(serializeAccessRule),
      require: (props.require ?? []).map(serializeAccessRule),
    };
    if (props.approvalRequired !== undefined)
      body.approval_required = props.approvalRequired;
    if (props.approvalGroups)
      body.approval_groups = props.approvalGroups.map((g) => ({
        approvals_needed: g.approvalsNeeded,
        email_addresses: g.emailAddresses,
        email_list_uuid: g.emailListUuid,
      }));
    if (props.purposeJustificationRequired !== undefined)
      body.purpose_justification_required = props.purposeJustificationRequired;
    if (props.purposeJustificationPrompt !== undefined)
      body.purpose_justification_prompt = props.purposeJustificationPrompt;
    if (props.isolationRequired !== undefined)
      body.isolation_required = props.isolationRequired;
    if (props.sessionDuration !== undefined)
      body.session_duration = props.sessionDuration;
    if (props.mfaConfig)
      body.mfa_config = {
        allowed_authenticators: props.mfaConfig.allowedAuthenticators,
        mfa_disabled: props.mfaConfig.mfaDisabled,
        session_duration: props.mfaConfig.sessionDuration,
      };
    if (props.connectionRules?.rdp)
      body.connection_rules = {
        rdp: {
          allowed_clipboard_formats:
            props.connectionRules.rdp.allowedClipboardFormats,
        },
      };

    let policy: CloudflareAccessPolicy;
    if (this.phase === "update" && this.output?.id) {
      policy = await extractCloudflareResult<CloudflareAccessPolicy>(
        `update access policy "${name}"`,
        api.put(`${basePath}/${this.output.id}`, body),
      );
    } else {
      const adopt = props.adopt ?? this.scope.adopt;
      try {
        policy = await extractCloudflareResult<CloudflareAccessPolicy>(
          `create access policy "${name}"`,
          api.post(basePath, body),
        );
      } catch (err) {
        if (adopt && isAccessDuplicateNameError(err)) {
          const existing = await findAccessPolicyByName(api, name);
          if (!existing) {
            throw new Error(
              `Access policy "${name}" already exists but could not be found for adoption.`,
              { cause: err },
            );
          }
          logger.log(
            `Adopting existing access policy "${name}" (${existing.id})`,
          );
          policy = await extractCloudflareResult<CloudflareAccessPolicy>(
            `adopt access policy "${name}"`,
            api.put(`${basePath}/${existing.id}`, body),
          );
        } else {
          throw err;
        }
      }
    }

    return {
      id: policy.id,
      name: policy.name,
      decision: policy.decision,
      include: props.include,
      exclude: props.exclude,
      require: props.require,
      approvalRequired: props.approvalRequired,
      approvalGroups: props.approvalGroups,
      purposeJustificationRequired: props.purposeJustificationRequired,
      purposeJustificationPrompt: props.purposeJustificationPrompt,
      isolationRequired: props.isolationRequired,
      mfaConfig: props.mfaConfig,
      sessionDuration: props.sessionDuration,
      connectionRules: props.connectionRules,
      appCount: policy.app_count ?? 0,
      createdAt: policy.created_at,
      updatedAt: policy.updated_at,
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

async function findAccessPolicyByName(
  api: CloudflareApi,
  name: string,
): Promise<CloudflareAccessPolicy | null> {
  let page = 1;
  const perPage = 50;
  while (true) {
    const response = await api.get(
      `/accounts/${api.accountId}/access/policies?page=${page}&per_page=${perPage}`,
    );
    if (!response.ok) return null;
    const data =
      (await response.json()) as CloudflareApiListResponse<CloudflareAccessPolicy>;
    const match = data.result.find((p) => p.name === name);
    if (match) return match;
    const info = data.result_info;
    if (!info || info.page * info.per_page >= info.total_count) return null;
    page++;
  }
}

async function deleteAccessPolicy(
  api: CloudflareApi,
  policyId: string,
): Promise<void> {
  const response = await api.delete(
    `/accounts/${api.accountId}/access/policies/${policyId}`,
  );
  if (!response.ok && response.status !== 404) {
    logger.error(
      `Error deleting access policy ${policyId}: ${response.status} ${response.statusText}`,
    );
  }
}

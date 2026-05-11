import { alchemy } from "../alchemy.ts";
import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import type { AccessIdentityProvider } from "./access-identity-provider.ts";
import type { AccessPolicy } from "./access-policy.ts";
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
import { findZoneForHostname, type Zone } from "./zone.ts";

/**
 * Cloudflare Access application types. Three are strictly typed below;
 * everything else falls back to {@link OtherAccessApplicationProps}.
 *
 * @see https://developers.cloudflare.com/cloudflare-one/applications/
 */
export type AccessApplicationType =
  | "self_hosted"
  | "saas"
  | "bookmark"
  | "ssh"
  | "vnc"
  | "rdp"
  | "app_launcher"
  | "warp"
  | "biso"
  | "dash_sso"
  | "infrastructure"
  | "mcp"
  | "mcp_portal"
  | "proxy_endpoint"
  | (string & {});

interface BaseAccessApplicationProps extends CloudflareApiOptions {
  /**
   * Display name shown in the Access dashboard.
   *
   * @default ${app}-${stage}-${id}
   */
  name?: string;

  /**
   * Identity providers permitted to authenticate to this application.
   * If unset, all account IdPs are allowed.
   */
  allowedIdps?: (string | AccessIdentityProvider)[];

  /**
   * Reusable Access policies attached to this application, in priority order.
   */
  policies?: (string | AccessPolicy)[];

  /** Cloudflare duration string, e.g. `"24h"`. */
  sessionDuration?: string;

  /** Show this app in the user-facing App Launcher. */
  appLauncherVisible?: boolean;

  /** Skip the IdP-selection screen when only one IdP applies. */
  autoRedirectToIdentity?: boolean;

  /** Custom message shown to denied users. */
  customDenyMessage?: string;

  /** URL users are redirected to when denied. */
  customDenyUrl?: string;

  /** URL non-identity users (e.g. service tokens) are redirected to when denied. */
  customNonIdentityDenyUrl?: string;

  /** Free-form labels for grouping applications. */
  tags?: string[];

  /** Skip the Access interstitial page on first load. */
  skipInterstitial?: boolean;

  /**
   * For service-token authenticated requests, return 401 on failure
   * (instead of redirecting).
   */
  serviceAuth401Redirect?: boolean;

  /**
   * Adopt an existing application with the same name instead of failing.
   *
   * @default false
   */
  adopt?: boolean;

  /**
   * Whether to delete the application when removed from Alchemy.
   *
   * @default true
   */
  delete?: boolean;
}

/**
 * A self-hosted application protected by Access at a specific domain.
 */
export interface SelfHostedAccessApplicationProps extends BaseAccessApplicationProps {
  type: "self_hosted";
  /** Hostname (or hostname/path prefix) the application lives at. */
  domain: string;
  /**
   * Bind the application to a specific zone. If omitted, the application
   * is account-scoped. Moving between scopes triggers replacement.
   */
  zone?: string | Zone;
}

/**
 * SaaS OIDC integration configuration.
 */
export interface SaasOidcConfig {
  authType: "oidc";
  redirectUris: string[];
  scopes?: ("openid" | "groups" | "email" | "profile")[];
  groupFilterRegex?: string;
}

/**
 * SaaS SAML 2.0 integration configuration.
 */
export interface SaasSamlConfig {
  authType: "saml";
  spEntityId: string;
  consumerServiceUrl: string;
  nameIdFormat?: string;
  defaultRelayState?: string;
}

/**
 * A SaaS application — Cloudflare brokers SSO between your IdP and the SaaS
 * vendor over either OIDC or SAML.
 */
export interface SaasAccessApplicationProps extends BaseAccessApplicationProps {
  type: "saas";
  saas: SaasOidcConfig | SaasSamlConfig;
}

/**
 * A bookmark — a vanity link in the Access launcher with no policy
 * enforcement.
 */
export interface BookmarkAccessApplicationProps extends BaseAccessApplicationProps {
  type: "bookmark";
  /** URL the bookmark points to. */
  domain: string;
  /**
   * Bind the bookmark to a zone. If omitted, the bookmark is account-scoped.
   */
  zone?: string | Zone;
}

/**
 * Catch-all variant for application types not covered by a strict variant
 * (`ssh`, `vnc`, `rdp`, `app_launcher`, `warp`, `biso`, `dash_sso`,
 * `infrastructure`, `mcp`, `mcp_portal`, `proxy_endpoint`, or future types).
 */
export interface OtherAccessApplicationProps extends BaseAccessApplicationProps {
  type: Exclude<AccessApplicationType, "self_hosted" | "saas" | "bookmark">;
  /** Required for `ssh`, `vnc`, `rdp`, `proxy_endpoint`. */
  domain?: string;
  /** Zone-scope the application where supported by the type. */
  zone?: string | Zone;
}

/**
 * Properties for creating or updating an {@link AccessApplication}.
 */
export type AccessApplicationProps =
  | SelfHostedAccessApplicationProps
  | SaasAccessApplicationProps
  | BookmarkAccessApplicationProps
  | OtherAccessApplicationProps;

/**
 * Output for an {@link AccessApplication}.
 */
export type AccessApplication = Omit<
  AccessApplicationProps,
  "adopt" | "delete" | "zone"
> & {
  /** Cloudflare-assigned application UUID. */
  id: string;
  /** Display name. */
  name: string;
  /**
   * Audience tag (used to validate Access JWTs at your origin).
   */
  aud: string;
  /**
   * Resolved zone ID, if the application is zone-scoped.
   */
  zoneId?: string;
  /**
   * SaaS OIDC client identifier (only set for SaaS OIDC apps).
   */
  clientId?: string;
  /**
   * SaaS OIDC client secret (only returned on creation; retained on update).
   */
  clientSecret?: Secret;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-update timestamp. */
  updatedAt: string;
};

/**
 * Type guard for {@link AccessApplication}.
 */
export function isAccessApplication(
  resource: any,
): resource is AccessApplication {
  return resource?.[ResourceKind] === "cloudflare::AccessApplication";
}

interface CloudflareAccessApplication {
  id: string;
  name: string;
  type: string;
  domain?: string;
  aud: string;
  client_id?: string;
  client_secret?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Creates a Cloudflare Zero Trust [Access application](https://developers.cloudflare.com/cloudflare-one/applications/)
 * — a protected resource users authenticate to via Access.
 *
 * @example
 * // Self-hosted application protected by an Access policy.
 * const app = await AccessApplication("admin", {
 *   type: "self_hosted",
 *   name: "Internal Admin",
 *   domain: "admin.acme.com",
 *   policies: [employeesPolicy],
 *   sessionDuration: "8h",
 * });
 *
 * @example
 * // Bookmark in the Access launcher.
 * const wiki = await AccessApplication("wiki", {
 *   type: "bookmark",
 *   name: "Internal Wiki",
 *   domain: "https://wiki.acme.com",
 *   appLauncherVisible: true,
 * });
 *
 * @example
 * // SaaS OIDC integration.
 * const slack = await AccessApplication("slack-saas", {
 *   type: "saas",
 *   name: "Slack",
 *   saas: {
 *     authType: "oidc",
 *     redirectUris: ["https://acme.slack.com/oidc/callback"],
 *     scopes: ["openid", "email", "profile"],
 *   },
 *   policies: [employeesPolicy],
 * });
 */
export const AccessApplication = Resource(
  "cloudflare::AccessApplication",
  async function (
    this: Context<AccessApplication>,
    id: string,
    props: AccessApplicationProps,
  ): Promise<AccessApplication> {
    const api = await createCloudflareApi(props);
    const name = props.name ?? this.scope.createPhysicalName(id);

    const zoneId =
      "zone" in props && props.zone
        ? typeof props.zone === "string"
          ? (await findZoneForHostname(api, props.zone)).zoneId
          : props.zone.id
        : undefined;

    const basePath = zoneId
      ? `/zones/${zoneId}/access/apps`
      : `/accounts/${api.accountId}/access/apps`;

    if (this.phase === "delete") {
      if (this.output?.id && props.delete !== false) {
        const deletePath = this.output.zoneId
          ? `/zones/${this.output.zoneId}/access/apps/${this.output.id}`
          : `/accounts/${api.accountId}/access/apps/${this.output.id}`;
        await deleteAccessApplication(api, deletePath);
      }
      return this.destroy();
    }

    // type and zone are immutable — recreate if either changed.
    if (this.phase === "update" && this.output) {
      if (
        this.output.type !== props.type ||
        (this.output.zoneId ?? undefined) !== (zoneId ?? undefined)
      ) {
        this.replace(true);
      }
    }

    if (
      props.type === "self_hosted" &&
      !(props as SelfHostedAccessApplicationProps).domain
    ) {
      throw new Error(
        `AccessApplication "${name}": 'domain' is required for self_hosted applications.`,
      );
    }

    const body: Record<string, unknown> = {
      name,
      type: props.type,
    };
    if ("domain" in props && props.domain) body.domain = props.domain;
    if (props.allowedIdps)
      body.allowed_idps = props.allowedIdps.map((idp) =>
        typeof idp === "string" ? idp : idp.id,
      );
    if (props.policies)
      body.policies = props.policies.map((p) =>
        typeof p === "string" ? p : p.id,
      );
    if (props.sessionDuration !== undefined)
      body.session_duration = props.sessionDuration;
    if (props.appLauncherVisible !== undefined)
      body.app_launcher_visible = props.appLauncherVisible;
    if (props.autoRedirectToIdentity !== undefined)
      body.auto_redirect_to_identity = props.autoRedirectToIdentity;
    if (props.customDenyMessage !== undefined)
      body.custom_deny_message = props.customDenyMessage;
    if (props.customDenyUrl !== undefined)
      body.custom_deny_url = props.customDenyUrl;
    if (props.customNonIdentityDenyUrl !== undefined)
      body.custom_non_identity_deny_url = props.customNonIdentityDenyUrl;
    if (props.tags) body.tags = props.tags;
    if (props.skipInterstitial !== undefined)
      body.skip_interstitial = props.skipInterstitial;
    if (props.serviceAuth401Redirect !== undefined)
      body.service_auth_401_redirect = props.serviceAuth401Redirect;
    if (props.type === "saas" && (props as SaasAccessApplicationProps).saas) {
      const saas = (props as SaasAccessApplicationProps).saas;
      body.saas =
        saas.authType === "oidc"
          ? {
              auth_type: "oidc",
              redirect_uris: saas.redirectUris,
              scopes: saas.scopes,
              group_filter_regex: saas.groupFilterRegex,
            }
          : {
              auth_type: "saml",
              sp_entity_id: saas.spEntityId,
              consumer_service_url: saas.consumerServiceUrl,
              name_id_format: saas.nameIdFormat,
              default_relay_state: saas.defaultRelayState,
            };
    }

    let app: CloudflareAccessApplication;
    if (this.phase === "update" && this.output?.id) {
      const updatePath = this.output.zoneId
        ? `/zones/${this.output.zoneId}/access/apps/${this.output.id}`
        : `/accounts/${api.accountId}/access/apps/${this.output.id}`;
      app = await extractCloudflareResult<CloudflareAccessApplication>(
        `update access application "${name}"`,
        api.put(updatePath, body),
      );
    } else {
      const adopt = props.adopt ?? this.scope.adopt;
      try {
        app = await extractCloudflareResult<CloudflareAccessApplication>(
          `create access application "${name}"`,
          api.post(basePath, body),
        );
      } catch (err) {
        if (adopt && isAccessDuplicateNameError(err)) {
          const existing = await findAccessApplicationByName(
            api,
            basePath,
            name,
          );
          if (!existing) {
            throw new Error(
              `Access application "${name}" already exists but could not be found for adoption.`,
              { cause: err },
            );
          }
          logger.log(
            `Adopting existing access application "${name}" (${existing.id})`,
          );
          app = await extractCloudflareResult<CloudflareAccessApplication>(
            `adopt access application "${name}"`,
            api.put(`${basePath}/${existing.id}`, body),
          );
        } else {
          throw err;
        }
      }
    }

    // SaaS OIDC client_secret is only returned on POST — retain on update.
    const clientSecret = app.client_secret
      ? alchemy.secret(app.client_secret)
      : this.output?.clientSecret;

    const rest: Record<string, unknown> = { ...props };
    delete rest.adopt;
    delete rest.delete;
    delete rest.zone;
    return {
      ...rest,
      id: app.id,
      name: app.name,
      aud: app.aud,
      zoneId,
      clientId: app.client_id,
      clientSecret,
      createdAt: app.created_at,
      updatedAt: app.updated_at,
    } as AccessApplication;
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

async function findAccessApplicationByName(
  api: CloudflareApi,
  basePath: string,
  name: string,
): Promise<CloudflareAccessApplication | null> {
  let page = 1;
  const perPage = 50;
  while (true) {
    const response = await api.get(
      `${basePath}?page=${page}&per_page=${perPage}`,
    );
    if (!response.ok) return null;
    const data =
      (await response.json()) as CloudflareApiListResponse<CloudflareAccessApplication>;
    const match = data.result.find((a) => a.name === name);
    if (match) return match;
    const info = data.result_info;
    if (!info || info.page * info.per_page >= info.total_count) return null;
    page++;
  }
}

async function deleteAccessApplication(
  api: CloudflareApi,
  path: string,
): Promise<void> {
  const response = await api.delete(path);
  if (!response.ok && response.status !== 404) {
    logger.error(
      `Error deleting access application at ${path}: ${response.status} ${response.statusText}`,
    );
  }
}

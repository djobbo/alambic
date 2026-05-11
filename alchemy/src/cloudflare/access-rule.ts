import { ResourceKind } from "../resource.ts";
import type { AccessGroup } from "./access-group.ts";
import type { AccessIdentityProvider } from "./access-identity-provider.ts";
import type { AccessServiceToken } from "./access-service-token.ts";

/**
 * Match anyone with this email address.
 */
export interface EmailAccessRule {
  email: { email: string };
}

/**
 * Match anyone with an email address ending in this domain.
 */
export interface EmailDomainAccessRule {
  email_domain: { domain: string };
}

/**
 * Match a single IP address (IPv4 or IPv6) or CIDR.
 */
export interface IpAccessRule {
  ip: { ip: string };
}

/**
 * Match an IP from a managed Cloudflare IP list.
 */
export interface IpListAccessRule {
  ip_list: { id: string };
}

/**
 * Match every user. Rarely useful in `include` — typical in `exclude` or as a fallback.
 */
export interface EveryoneAccessRule {
  everyone: Record<string, never>;
}

/**
 * Match a member of the referenced Access group.
 */
export interface GroupAccessRule {
  group: { id: string | AccessGroup };
}

/**
 * Match requests authenticating with a specific service token.
 */
export interface ServiceTokenAccessRule {
  service_token: { token_id: string | AccessServiceToken };
}

/**
 * Match any valid service token in the account.
 */
export interface AnyValidServiceTokenAccessRule {
  any_valid_service_token: Record<string, never>;
}

/**
 * Match an Azure AD group by object ID.
 */
export interface AzureGroupAccessRule {
  azure: {
    id: string;
    identity_provider_id: string | AccessIdentityProvider;
  };
}

/**
 * Match an Okta group by name.
 */
export interface OktaGroupAccessRule {
  okta: {
    name: string;
    identity_provider_id: string | AccessIdentityProvider;
  };
}

/**
 * Match a SAML attribute returned by the IdP.
 */
export interface SamlAttributeAccessRule {
  saml: {
    attribute_name: string;
    attribute_value: string;
    identity_provider_id: string | AccessIdentityProvider;
  };
}

/**
 * Match a Google Workspace group by email.
 */
export interface GsuiteGroupAccessRule {
  gsuite: {
    email: string;
    identity_provider_id: string | AccessIdentityProvider;
  };
}

/**
 * Match a member of a GitHub organization or team.
 */
export interface GithubOrganizationAccessRule {
  github_organization: {
    name: string;
    team?: string;
    identity_provider_id: string | AccessIdentityProvider;
  };
}

/**
 * Match any client presenting a valid mTLS certificate.
 */
export interface CertificateAccessRule {
  certificate: Record<string, never>;
}

/**
 * Match an mTLS certificate with the given Common Name.
 */
export interface CommonNameAccessRule {
  common_name: { common_name: string };
}

/**
 * Match a device that satisfies a configured posture check.
 */
export interface DevicePostureAccessRule {
  device_posture: { integration_uid: string };
}

/**
 * Match by authentication method (e.g., `mfa`, `pwd`).
 */
export interface AuthMethodAccessRule {
  auth_method: { auth_method: string };
}

/**
 * Match users who logged in via a specific identity provider.
 */
export interface LoginMethodAccessRule {
  login_method: { id: string | AccessIdentityProvider };
}

/**
 * Match an authentication context (e.g., Azure AD CA).
 */
export interface AuthenticationContextAccessRule {
  authentication_context: {
    id: string;
    ac_id: string;
    identity_provider_id: string | AccessIdentityProvider;
  };
}

/**
 * Match an OIDC claim returned by the IdP.
 */
export interface OidcClaimAccessRule {
  oidc_claim: {
    name: string;
    value: string;
    identity_provider_id: string | AccessIdentityProvider;
  };
}

/**
 * Match users at or above the given Cloudflare user-risk score.
 */
export interface UserRiskScoreAccessRule {
  user_risk_score: {
    provider: string;
    risk_level: "low" | "medium" | "high";
  };
}

/**
 * Delegate evaluation to an external endpoint.
 */
export interface ExternalEvaluationAccessRule {
  external_evaluation: { evaluate_url: string; keys_url: string };
}

/**
 * Match by ISO 3166 country code (legacy alias of `geo`).
 */
export interface CountryAccessRule {
  country: { country_code: string };
}

/**
 * Match by ISO 3166 country code.
 */
export interface GeoAccessRule {
  geo: { country_code: string };
}

/**
 * Match a hostname/domain.
 */
export interface DomainAccessRule {
  domain: { domain: string };
}

/**
 * Match a token issued by a linked Access application.
 */
export interface LinkedAppTokenAccessRule {
  linked_app_token: { app_uid: string };
}

/**
 * Match an SSO authentication context (Azure AD CA equivalent).
 */
export interface AccessAuthContextAccessRule {
  access_auth_context: {
    id: string;
    ac_id: string;
    identity_provider_id: string | AccessIdentityProvider;
  };
}

/**
 * A single Access rule expression, used in `include`, `exclude`, and `require`
 * arrays of {@link AccessPolicy} and {@link AccessGroup}.
 *
 * Each rule is a single-key object whose key is the rule type and whose value
 * is the rule-specific configuration. Mirrors Cloudflare's wire format so
 * expressions can be copy-pasted directly from the Cloudflare docs.
 *
 * @see https://developers.cloudflare.com/cloudflare-one/policies/access/
 */
export type AccessRule =
  | EmailAccessRule
  | EmailDomainAccessRule
  | IpAccessRule
  | IpListAccessRule
  | EveryoneAccessRule
  | GroupAccessRule
  | ServiceTokenAccessRule
  | AnyValidServiceTokenAccessRule
  | AzureGroupAccessRule
  | OktaGroupAccessRule
  | SamlAttributeAccessRule
  | GsuiteGroupAccessRule
  | GithubOrganizationAccessRule
  | CertificateAccessRule
  | CommonNameAccessRule
  | DevicePostureAccessRule
  | AuthMethodAccessRule
  | LoginMethodAccessRule
  | AuthenticationContextAccessRule
  | OidcClaimAccessRule
  | UserRiskScoreAccessRule
  | ExternalEvaluationAccessRule
  | CountryAccessRule
  | GeoAccessRule
  | DomainAccessRule
  | LinkedAppTokenAccessRule
  | AccessAuthContextAccessRule;

/**
 * Serialize an {@link AccessRule} to its wire JSON shape, replacing any lifted
 * Resource references (`group.id`, `service_token.token_id`,
 * `*.identity_provider_id`, `login_method.id`) with the resource's `id`.
 *
 * @internal
 */
export function serializeAccessRule(rule: AccessRule): Record<string, unknown> {
  const entries = Object.entries(rule);
  if (entries.length !== 1) {
    throw new Error(
      `Invalid AccessRule: expected exactly one key, got ${entries.length}`,
    );
  }
  const [key, value] = entries[0];
  if (typeof value !== "object" || value === null) {
    return { [key]: value };
  }
  const serialized: Record<string, unknown> = {};
  for (const [field, fieldValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    serialized[field] = isResourceRef(fieldValue)
      ? (fieldValue as { id: string }).id
      : fieldValue;
  }
  return { [key]: serialized };
}

/**
 * True for Alchemy Resource objects (carry the {@link ResourceKind} symbol),
 * false for plain literal values — including future rule shapes that may nest
 * literal config objects.
 */
function isResourceRef(value: unknown): value is { id: string } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<symbol, unknown>)[ResourceKind] !== undefined
  );
}

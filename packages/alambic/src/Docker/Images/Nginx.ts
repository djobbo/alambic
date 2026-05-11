import { ImageTag } from "../Image.ts";

/**
 * Image-flavor for the official `nginx` image.
 *
 * - `"alpine"` / `"alpine-slim"` — Alpine-based (smallest); slim drops the perl module.
 * - `"perl"` — Debian-based with the perl module.
 * - `"alpine-perl"` — Alpine-based with the perl module.
 * - `"debian"` — vanilla Debian-based image (the unsuffixed tag, e.g. `nginx:mainline`).
 */
export type NginxImageVariant = "alpine" | "alpine-slim" | "perl" | "alpine-perl" | "debian";

/** Release line for unpinned tags. `"mainline"` tracks the latest series; `"stable"` tracks the LTS series. */
export type NginxImageRelease = "mainline" | "stable";

export type NginxImageTagOptions = {
  /** Image flavor. Defaults to {@link NginxImageVariant `"alpine"`}. */
  readonly variant?: NginxImageVariant;
  /** Release line when {@link NginxImageTagOptions.version} is omitted. Defaults to {@link NginxImageRelease `"mainline"`}. */
  readonly release?: NginxImageRelease;
  /**
   * Pin a specific upstream version (e.g. `"1.27"` or `"1.27.5"`). When set this overrides `release`
   * and produces tags like `nginx:1.27.5-alpine`.
   */
  readonly version?: string;
};

/**
 * Pure formatter producing the `nginx:<…>` reference for a given options shape.
 *
 * Exposed for callers who only need the string form (e.g. logging, doc generation, tests).
 * Use {@link NginxImageTag} when you want a registered Docker image resource.
 */
export const nginxImageRef = ({
  variant = "alpine",
  release = "mainline",
  version,
}: NginxImageTagOptions = {}): string => {
  const isDebian = variant === "debian";
  if (version !== undefined) {
    return isDebian ? `nginx:${version}` : `nginx:${version}-${variant}`;
  }
  if (release === "stable") {
    return isDebian ? "nginx:stable" : `nginx:stable-${variant}`;
  }
  return isDebian ? "nginx:mainline" : `nginx:${variant}`;
};

/**
 * Typed helper for official `nginx` tags.
 *
 * @example
 * const image = yield* NginxImageTag({ variant: "alpine" });
 * // resolves to nginx:alpine (latest mainline alpine)
 *
 * @example
 * const stable = yield* NginxImageTag({ release: "stable", variant: "alpine-slim" });
 * // resolves to nginx:stable-alpine-slim
 *
 * @example
 * const pinned = yield* NginxImageTag({ version: "1.27.5", variant: "alpine" });
 * // resolves to nginx:1.27.5-alpine
 */
export const NginxImageTag = (options?: NginxImageTagOptions) => ImageTag(nginxImageRef(options));

/**
 * Typed shape for the well-known env vars consumed by the official `nginx` image's
 * `envsubst` template entrypoint.
 *
 * The image renders `${VAR}` references inside files under
 * {@link NginxEnvironment.NGINX_ENVSUBST_TEMPLATE_DIR `NGINX_ENVSUBST_TEMPLATE_DIR`}
 * (default `/etc/nginx/templates`) using these values, then writes the result into
 * {@link NginxEnvironment.NGINX_ENVSUBST_OUTPUT_DIR `NGINX_ENVSUBST_OUTPUT_DIR`} (default `/etc/nginx/conf.d`).
 *
 * Arbitrary template variables that aren't in this shape can be supplied via
 * {@link NginxEnvironment.extra}.
 */
export type NginxEnvironment = {
  /** Conventional upstream host used by templates (e.g. `${NGINX_HOST}`). */
  readonly NGINX_HOST?: string;
  /** Conventional listen port used by templates (e.g. `${NGINX_PORT}`). */
  readonly NGINX_PORT?: string;
  /** Override the directory scanned for `*.template` files. */
  readonly NGINX_ENVSUBST_TEMPLATE_DIR?: string;
  /** Override the template suffix (default `.template`). */
  readonly NGINX_ENVSUBST_TEMPLATE_SUFFIX?: string;
  /** Override the directory templates are rendered into. */
  readonly NGINX_ENVSUBST_OUTPUT_DIR?: string;
  /** Regex restricting which env vars are eligible for substitution. */
  readonly NGINX_ENVSUBST_FILTER?: string;
  /** Additional template variables (any key — typically `NGINX_*`). Merged after the typed fields. */
  readonly extra?: Readonly<Record<string, string>>;
};

/**
 * Normalize a typed {@link NginxEnvironment} into a compose/app environment map.
 *
 * Unset typed fields are omitted so callers can compose this with other env sources without
 * accidentally clobbering them with empty strings.
 */
export const nginxEnvironment = (env: NginxEnvironment): Readonly<Record<string, string>> => {
  const vars: Record<string, string> = {};
  if (env.NGINX_HOST !== undefined) vars.NGINX_HOST = env.NGINX_HOST;
  if (env.NGINX_PORT !== undefined) vars.NGINX_PORT = env.NGINX_PORT;
  if (env.NGINX_ENVSUBST_TEMPLATE_DIR !== undefined) {
    vars.NGINX_ENVSUBST_TEMPLATE_DIR = env.NGINX_ENVSUBST_TEMPLATE_DIR;
  }
  if (env.NGINX_ENVSUBST_TEMPLATE_SUFFIX !== undefined) {
    vars.NGINX_ENVSUBST_TEMPLATE_SUFFIX = env.NGINX_ENVSUBST_TEMPLATE_SUFFIX;
  }
  if (env.NGINX_ENVSUBST_OUTPUT_DIR !== undefined) {
    vars.NGINX_ENVSUBST_OUTPUT_DIR = env.NGINX_ENVSUBST_OUTPUT_DIR;
  }
  if (env.NGINX_ENVSUBST_FILTER !== undefined) {
    vars.NGINX_ENVSUBST_FILTER = env.NGINX_ENVSUBST_FILTER;
  }
  if (env.extra !== undefined) {
    for (const [k, v] of Object.entries(env.extra)) vars[k] = v;
  }
  return vars;
};

export const NGINX_DEFAULT_HTTP_PORT = 80;
export const NGINX_DEFAULT_HTTPS_PORT = 443;

export type NginxUrlScheme = "http" | "https";

export type NginxUrlOptions = {
  /**
   * Optional typed env (same shape passed to {@link nginxEnvironment}); when provided, its
   * `NGINX_PORT` is used as the fallback for {@link NginxUrlOptions.port}.
   */
  readonly env?: NginxEnvironment;
  /** Hostname/IP/service name reachable by the client (e.g. compose service name, Dokploy app name). */
  readonly host: string;
  /**
   * TCP port. Resolution order:
   * 1. Explicit `port` argument
   * 2. `env.NGINX_PORT` (parsed as an integer) when {@link NginxUrlOptions.env} is provided
   * 3. Scheme default — {@link NGINX_DEFAULT_HTTP_PORT} for `http`, {@link NGINX_DEFAULT_HTTPS_PORT} for `https`
   *
   * The port is omitted from the URL when it equals the scheme default.
   */
  readonly port?: number;
  /** URL scheme. Defaults to `"http"`. */
  readonly scheme?: NginxUrlScheme;
  /** URL path. Defaults to `"/"`. A leading slash is added when missing. */
  readonly path?: string;
};

const parseEnvPort = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Derive the HTTP URL the nginx image will be reachable at, given its typed env + network coords.
 *
 * @example
 * nginxUrl({ host: "nginx" });
 * // => "http://nginx/"
 *
 * @example
 * nginxUrl({
 *   env: { NGINX_HOST: "api.example.com", NGINX_PORT: "8080" },
 *   host: "nginx",
 * });
 * // => "http://nginx:8080/"
 *
 * @example
 * nginxUrl({ host: "nginx", scheme: "https", path: "/healthz" });
 * // => "https://nginx/healthz"
 */
export const nginxUrl = ({
  env,
  host,
  port,
  scheme = "http",
  path = "/",
}: NginxUrlOptions): string => {
  const defaultPort = scheme === "https" ? NGINX_DEFAULT_HTTPS_PORT : NGINX_DEFAULT_HTTP_PORT;
  const resolvedPort = port ?? parseEnvPort(env?.NGINX_PORT) ?? defaultPort;
  const portSegment = resolvedPort === defaultPort ? "" : `:${resolvedPort}`;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${scheme}://${host}${portSegment}${normalizedPath}`;
};

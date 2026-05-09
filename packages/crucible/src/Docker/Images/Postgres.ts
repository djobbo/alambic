import { ImageTag } from "../Image.ts";

export type PostgresMajorVersion = 16 | 17 | 18;
export type PostgresImageVariant = "alpine" | "bookworm" | "bullseye" | "trixie";

export type PostgresImageTagOptions = {
  readonly major?: PostgresMajorVersion;
  readonly variant?: PostgresImageVariant;
};

const postgresTag = ({ major = 16, variant = "alpine" }: PostgresImageTagOptions = {}): string =>
  `postgres:${major}-${variant}`;

/**
 * Typed helper for official Postgres tags.
 *
 * @example
 * const image = yield* PostgresImageTag({ major: 17, variant: "alpine" })
 */
export const PostgresImageTag = (options?: PostgresImageTagOptions) =>
  ImageTag(postgresTag(options));

type PostgresAuthPassword = {
  readonly POSTGRES_PASSWORD: string;
  readonly POSTGRES_HOST_AUTH_METHOD?: Exclude<string, "trust">;
};

type PostgresAuthTrust = {
  readonly POSTGRES_HOST_AUTH_METHOD: "trust";
  readonly POSTGRES_PASSWORD?: string;
};

export type PostgresEnvironment = (PostgresAuthPassword | PostgresAuthTrust) & {
  readonly POSTGRES_USER?: string;
  readonly POSTGRES_DB?: string;
  readonly POSTGRES_INITDB_ARGS?: string;
  readonly POSTGRES_INITDB_WALDIR?: string;
  readonly PGDATA?: string;
};

/**
 * Normalize typed Postgres env config into a compose/app environment map.
 */
export const postgresEnvironment = (env: PostgresEnvironment): Readonly<Record<string, string>> => {
  const vars: Record<string, string> = {};
  if (env.POSTGRES_USER !== undefined) vars.POSTGRES_USER = env.POSTGRES_USER;
  if (env.POSTGRES_DB !== undefined) vars.POSTGRES_DB = env.POSTGRES_DB;
  if (env.POSTGRES_PASSWORD !== undefined) vars.POSTGRES_PASSWORD = env.POSTGRES_PASSWORD;
  if (env.POSTGRES_HOST_AUTH_METHOD !== undefined) {
    vars.POSTGRES_HOST_AUTH_METHOD = env.POSTGRES_HOST_AUTH_METHOD;
  }
  if (env.POSTGRES_INITDB_ARGS !== undefined) vars.POSTGRES_INITDB_ARGS = env.POSTGRES_INITDB_ARGS;
  if (env.POSTGRES_INITDB_WALDIR !== undefined) {
    vars.POSTGRES_INITDB_WALDIR = env.POSTGRES_INITDB_WALDIR;
  }
  if (env.PGDATA !== undefined) vars.PGDATA = env.PGDATA;
  return vars;
};

export const POSTGRES_DEFAULT_PORT = 5432;

export type PostgresDatabaseUrlOptions = {
  /** Typed Postgres env (same shape passed to {@link postgresEnvironment}). */
  readonly env: PostgresEnvironment;
  /** Hostname/IP/service name reachable by the client (e.g. compose service name, Dokploy app name). */
  readonly host: string;
  /** TCP port. Defaults to {@link POSTGRES_DEFAULT_PORT} (5432). */
  readonly port?: number;
  /**
   * URL scheme. Defaults to `"postgresql"`. Use `"postgres"` for libraries that prefer the short form.
   */
  readonly scheme?: "postgresql" | "postgres";
};

const POSTGRES_DEFAULT_USER = "postgres";

/**
 * Derive a canonical Postgres connection URL from a {@link PostgresEnvironment} + network coordinates.
 *
 * Defaults follow the official `postgres` image: `POSTGRES_USER` falls back to `"postgres"` and
 * `POSTGRES_DB` falls back to `POSTGRES_USER`. Trust auth omits the password segment. User, password,
 * and database names are URL-encoded so values containing `@`, `:`, `/`, etc. produce a valid URL.
 *
 * @example
 * const env = { POSTGRES_USER: "app", POSTGRES_PASSWORD: "s3cret", POSTGRES_DB: "app" } as const;
 * postgresDatabaseUrl({ env, host: "db" });
 * // => "postgresql://app:s3cret@db:5432/app"
 */
export const postgresDatabaseUrl = ({
  env,
  host,
  port = POSTGRES_DEFAULT_PORT,
  scheme = "postgresql",
}: PostgresDatabaseUrlOptions): string => {
  const user = env.POSTGRES_USER ?? POSTGRES_DEFAULT_USER;
  const database = env.POSTGRES_DB ?? user;
  const isTrust = env.POSTGRES_HOST_AUTH_METHOD === "trust";
  const password = isTrust ? undefined : env.POSTGRES_PASSWORD;
  const auth =
    password === undefined
      ? encodeURIComponent(user)
      : `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
  return `${scheme}://${auth}@${host}:${port}/${encodeURIComponent(database)}`;
};

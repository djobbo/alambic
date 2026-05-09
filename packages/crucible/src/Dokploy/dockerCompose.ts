/**
 * Compose-adjacent service options for Dokploy Docker applications — mapped to Dokploy REST/tRPC-backed routes
 * (see {@link https://docs.dokploy.com/docs/api/application | Dokploy application API}), not interpreted as Docker Compose files.
 */

/** Compose `restart` → Dokploy application `restartPolicySwarm` JSON. */
export type DockerComposeRestart = "no" | "always" | "unless-stopped" | "on-failure";

export interface DockerComposePort {
  readonly published: number;
  readonly target: number;
  readonly protocol?: "tcp" | "udp";
  readonly publishMode?: "ingress" | "host";
}

export type DockerComposeVolume =
  | { readonly type: "bind"; readonly source: string; readonly target: string }
  | { readonly type: "volume"; readonly volumeName: string; readonly target: string }
  | {
      readonly type: "file";
      readonly filePath: string;
      /**
       * Embedded at deploy time after blue/green slot expansion —
       * see {@link CRUCIBLE_BLUE_GREEN_SLOT_PLACEHOLDER}.
       */
      readonly content: string;
      readonly mountPath: string;
    };

/**
 * In **file** mounts, {@link expandComposeBlueGreenPlaceholder} replaces this token per slot when the
 * HTTP engine applies compose for a blue/green application (`blue` vs `green`), or with `native`
 * for a single (non-blue/green) Docker app.
 *
 * Keep the token in stack source so {@link normalizeComposeFingerprint} stays stable across cutovers.
 */
export const CRUCIBLE_BLUE_GREEN_SLOT_PLACEHOLDER = "{{CRUCIBLE_BLUE_GREEN_SLOT}}" as const;

/**
 * Expands {@link CRUCIBLE_BLUE_GREEN_SLOT_PLACEHOLDER} inside `type: "file"` volume `content` only.
 * No-op when the placeholder is absent (returns the same `compose` reference).
 */
export const expandComposeBlueGreenPlaceholder = (
  compose: DockerComposeService | undefined,
  slot: "blue" | "green" | undefined,
): DockerComposeService | undefined => {
  if (compose === undefined) return undefined;
  const label = slot ?? "native";
  const { volumes } = compose;
  if (volumes === undefined) return compose;
  let hit = false;
  const next = volumes.map((v) => {
    if (v.type !== "file") return v;
    if (!v.content.includes(CRUCIBLE_BLUE_GREEN_SLOT_PLACEHOLDER)) return v;
    hit = true;
    return {
      ...v,
      content: v.content.split(CRUCIBLE_BLUE_GREEN_SLOT_PLACEHOLDER).join(label),
    };
  });
  return hit ? { ...compose, volumes: next } : compose;
};

/**
 * Opinionated compose-like shape for Docker services on Dokploy.
 *
 * See {@link https://docs.dokploy.com/docs/api/application | Dokploy application API}.
 */
export interface DockerComposeService {
  /**
   * Vars serialized as KEY=value lines; applied after optional {@link DockerComposeService.env}
   * so keys here win on duplicates.
   */
  readonly environment?: Readonly<Record<string, string>>;
  /** Raw dotenv/multiline snippet (prepended base; overridden by {@link DockerComposeService.environment}). */
  readonly env?: string;
  readonly command?: string;
  readonly args?: ReadonlyArray<string>;
  readonly restart?: DockerComposeRestart;
  readonly replicas?: number;
  /**
   * Forwarded to `application.saveEnvironment` (`createEnvFile` column).
   * @default true
   */
  readonly createEnvFile?: boolean;
  /** Host → container mappings (synced vs `application.one` ports). */
  readonly ports?: ReadonlyArray<DockerComposePort>;
  /** Declarative mounts (synced vs `application.one` mounts for this application). */
  readonly volumes?: ReadonlyArray<DockerComposeVolume>;
  /**
   * Merged last into Dokploy `application.update` — escape hatch for advanced swarm fields (`healthCheckSwarm`, …).
   */
  readonly rawUpdate?: Readonly<Record<string, unknown>>;
}

/** Swarm-ish restart policy Dokploy persists on applications. */
export type RestartPolicySwarm = Readonly<{
  Condition?: string;
  Delay?: number;
  MaxAttempts?: number;
  Window?: number;
}>;

export const restartComposeToSwarm = (restart: DockerComposeRestart): RestartPolicySwarm => {
  switch (restart) {
    case "no":
      return { Condition: "none" };
    case "always":
      return { Condition: "any" };
    case "unless-stopped":
      return { Condition: "any" };
    case "on-failure":
      return { Condition: "on-failure" };
  }
};

const newlineEsc = /^[\s#\n"'\\]|[=]$/u;

const quoteEnvValue = (v: string): string => {
  if (v.includes("\n") || newlineEsc.test(v)) {
    const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    return `"${escaped}"`;
  }
  return v;
};

export const formatEnvironmentRecord = (env: Readonly<Record<string, string>>): string =>
  Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${quoteEnvValue(v)}`)
    .join("\n");

/**
 * Compose `environment` overrides duplicate keys after `baseEnv` snippet.
 */
export const mergeComposeEnvParts = (
  baseEnv?: string,
  vars?: Readonly<Record<string, string>>,
): string =>
  [[baseEnv?.trim()].filter(Boolean).join("\n"), vars ? formatEnvironmentRecord(vars) : ""]
    .filter((s) => s.length > 0)
    .join("\n");

export const normalizeComposeFingerprint = (compose: DockerComposeService | undefined): string => {
  if (compose === undefined) return "{}";
  const normalized = {
    environment:
      compose.environment === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(compose.environment).sort(([a], [b]) => a.localeCompare(b)),
          ),
    env: compose.env?.trim() || undefined,
    command: compose.command,
    args: compose.args ?? undefined,
    restart: compose.restart,
    replicas: compose.replicas,
    createEnvFile: compose.createEnvFile,
    ports:
      compose.ports === undefined
        ? undefined
        : [...compose.ports]
            .map((p) => ({
              published: p.published,
              target: p.target,
              protocol: p.protocol ?? "tcp",
              publishMode: p.publishMode ?? "host",
            }))
            .sort((a, b) => a.published - b.published || a.target - b.target),
    volumes:
      compose.volumes === undefined
        ? undefined
        : [...compose.volumes]
            .slice()
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    rawUpdateJson: compose.rawUpdate === undefined ? undefined : JSON.stringify(compose.rawUpdate),
  };
  return JSON.stringify(normalized);
};

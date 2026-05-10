import * as Effect from "effect/Effect";
import type { DokployApplicationDomainSnapshot, DokployEngineShape } from "./DokployEngine.ts";

/**
 * Dokploy **application** domain (API `domain.create`), aligned with UI / DB schema.
 *
 * Maps to Dokploy REST: `/api/domain.create`, `domain.update`, `domain.delete`, `domain.byApplicationId`.
 */
export type DokployCertificateType = "none" | "letsencrypt" | "custom";

export type ApplicationDomainProps = {
  /**
   * Stable correlate for reconcile (defaults to `host + path`).
   * Use when hostname or path overlap would collide.
   */
  readonly id?: string;
  /** Public hostname (`Host(...)` Traefik matcher). */
  readonly host: string;
  /** URL path segment (defaults `/`). Passed to Dokploy `path`. */
  readonly path?: string | null;
  /**
   * Path inside the container (Dokploy `internalPath`; strip/add prefix middleware when needed).
   * @default "/"
   */
  readonly internalPath?: string | null;
  /** Strip public path prefix before forwarding (Dokploy `stripPath`). @default false */
  readonly stripPath?: boolean;
  /**
   * Container listen port Dokploy proxies to (`port` column — same as UI “Container port”).
   * @default 3000 (matches Dokploy DB default).
   */
  readonly containerPort?: number;
  /** Enable HTTPS router + certs when allowed by certificateType / UI. */
  readonly https?: boolean;
  readonly certificateType?: DokployCertificateType;
  readonly customCertResolver?: string | null;
  readonly customEntrypoint?: string | null;
  readonly serviceName?: string | null;
  readonly middlewares?: ReadonlyArray<string>;
};

export interface ApplicationDomainBinding {
  readonly key: string;
  readonly domainId: string;
  readonly applicationId: string;
}

export const applicationDomainCorrelationKey = (spec: ApplicationDomainProps): string => {
  const path = spec.path ?? "/";
  return spec.id?.trim() || `${spec.host.trim()}::${path}`;
};

const normalizeSpecForFingerprint = (
  key: string,
  spec: ApplicationDomainProps,
): Record<string, unknown> => ({
  key,
  host: spec.host.trim(),
  path: spec.path ?? "/",
  internalPath: spec.internalPath ?? "/",
  stripPath: spec.stripPath ?? false,
  containerPort: spec.containerPort ?? 3000,
  https: spec.https ?? false,
  certificateType: spec.certificateType ?? ((spec.https ?? false) ? "letsencrypt" : "none"),
  customCertResolver: spec.customCertResolver ?? undefined,
  customEntrypoint: spec.customEntrypoint ?? undefined,
  serviceName: spec.serviceName ?? undefined,
  middlewares:
    spec.middlewares === undefined
      ? []
      : [...spec.middlewares].slice().sort((a, b) => a.localeCompare(b)),
});

export const applicationDomainsFingerprint = (
  domains: ReadonlyArray<ApplicationDomainProps> | undefined,
) => Effect.gen(function* () {
  if (domains === undefined || domains.length === 0) return "[]";
  const normalized = [...domains].map((d) =>
    normalizeSpecForFingerprint(applicationDomainCorrelationKey(d), d),
  );
  normalized.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return JSON.stringify(normalized);
});

export const toDomainCreatePayload = (
  applicationId: string,
  spec: ApplicationDomainProps,
): Record<string, unknown> => {
  const https = spec.https ?? false;
  const certificateType =
    spec.certificateType ?? (https ? ("letsencrypt" as const) : ("none" as const));
  return {
    host: spec.host.trim(),
    path: spec.path ?? "/",
    port: spec.containerPort ?? 3000,
    internalPath: spec.internalPath ?? "/",
    stripPath: spec.stripPath ?? false,
    https,
    certificateType,
    customCertResolver: spec.customCertResolver ?? undefined,
    customEntrypoint: spec.customEntrypoint ?? undefined,
    serviceName: spec.serviceName ?? undefined,
    middlewares: spec.middlewares ?? [],
    applicationId,
    domainType: "application",
  };
};

export const snapshotMatchesDesired = (
  snap: DokployApplicationDomainSnapshot,
  spec: ApplicationDomainProps,
): boolean => {
  const wantHttps = spec.https ?? false;
  const wantCert = spec.certificateType ?? (wantHttps ? "letsencrypt" : "none");
  return (
    snap.host === spec.host.trim() &&
    (snap.path ?? "/") === (spec.path ?? "/") &&
    (snap.port ?? 3000) === (spec.containerPort ?? 3000) &&
    (snap.internalPath ?? "/") === (spec.internalPath ?? "/") &&
    snap.stripPath === (spec.stripPath ?? false) &&
    snap.https === wantHttps &&
    (snap.certificateType ?? "none") === (wantCert ?? "none") &&
    (snap.customCertResolver ?? undefined) === (spec.customCertResolver ?? undefined) &&
    (snap.customEntrypoint ?? undefined) === (spec.customEntrypoint ?? undefined) &&
    (snap.serviceName ?? undefined) === (spec.serviceName ?? undefined) &&
    JSON.stringify([...(snap.middlewares ?? [])].sort()) ===
      JSON.stringify([...(spec.middlewares ?? [])].sort())
  );
};

export const toDomainUpdatePayload = (
  domainId: string,
  spec: ApplicationDomainProps,
): Record<string, unknown> => {
  const https = spec.https ?? false;
  const certificateType =
    spec.certificateType ?? (https ? ("letsencrypt" as const) : ("none" as const));
  return {
    domainId,
    host: spec.host.trim(),
    path: spec.path ?? "/",
    port: spec.containerPort ?? 3000,
    internalPath: spec.internalPath ?? "/",
    stripPath: spec.stripPath ?? false,
    https,
    certificateType,
    customCertResolver: spec.customCertResolver ?? undefined,
    customEntrypoint: spec.customEntrypoint ?? undefined,
    serviceName: spec.serviceName ?? undefined,
    middlewares: spec.middlewares ?? [],
    domainType: "application",
  };
};

/**
 * Reconcile Dokploy domains for **`attachApplicationId`** (typically the logical “active”
 * application returned from {@link DokployEngineShape.upsertDockerApplication}).
 */
export const syncApplicationDomains = (input: {
  readonly engine: DokployEngineShape;
  readonly desired: ReadonlyArray<ApplicationDomainProps>;
  readonly previous: ReadonlyArray<ApplicationDomainBinding> | undefined;
  readonly attachApplicationId: string;
}) =>
  Effect.gen(function* () {
    const desiredKeys = new Set(input.desired.map(applicationDomainCorrelationKey));
    const previous = input.previous ?? [];
    const prevByKey = new Map(previous.map((b) => [b.key, b] as const));

    for (const p of previous) {
      if (!desiredKeys.has(p.key)) {
        yield* input.engine.deleteDomain(p.domainId);
      }
    }

    const listed = yield* input.engine.listDomainsByApplicationId(input.attachApplicationId);
    const snapshotByDomainId = new Map(listed.map((d) => [d.domainId, d] as const));

    const next: ApplicationDomainBinding[] = [];

    for (const spec of input.desired) {
      const key = applicationDomainCorrelationKey(spec);
      let binding = prevByKey.get(key);

      if (binding !== undefined && binding.applicationId !== input.attachApplicationId) {
        yield* input.engine.deleteDomain(binding.domainId);
        binding = undefined;
      }

      if (binding === undefined) {
        const row = yield* input.engine.createApplicationDomain(
          toDomainCreatePayload(input.attachApplicationId, spec),
        );
        next.push({ key, domainId: row.domainId, applicationId: input.attachApplicationId });
        continue;
      }

      const snap = snapshotByDomainId.get(binding.domainId);
      if (snap === undefined || !snapshotMatchesDesired(snap, spec)) {
        yield* input.engine.updateApplicationDomain(toDomainUpdatePayload(binding.domainId, spec));
      }
      next.push({ key, domainId: binding.domainId, applicationId: input.attachApplicationId });
    }

    return next;
  });

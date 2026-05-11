import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { isResource, Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import {
  applicationDomainCorrelationKey,
  applicationDomainsFingerprint,
  type ApplicationDomainProps,
  type DokployCertificateType,
} from "./applicationDomain.ts";
import type { Providers } from "./Providers.ts";

/** Normalized Dokploy routing spec — materialized outputs for referencing from {@link Application}. */
export interface DomainAttrs {
  readonly key: string;
  readonly id: string | undefined;
  readonly host: string;
  readonly path: string;
  readonly internalPath: string;
  readonly stripPath: boolean;
  readonly containerPort: number;
  readonly https: boolean;
  readonly certificateType: DokployCertificateType;
  readonly customCertResolver: string | undefined;
  readonly customEntrypoint: string | undefined;
  readonly serviceName: string | undefined;
  readonly middlewares: ReadonlyArray<string>;
}

export const domainAttrsToSpec = (o: DomainAttrs): ApplicationDomainProps => ({
  ...(o.id !== undefined ? { id: o.id } : {}),
  host: o.host,
  path: o.path,
  internalPath: o.internalPath,
  stripPath: o.stripPath,
  containerPort: o.containerPort,
  https: o.https,
  certificateType: o.certificateType,
  customCertResolver: o.customCertResolver ?? null,
  customEntrypoint: o.customEntrypoint ?? null,
  serviceName: o.serviceName ?? null,
  middlewares: [...o.middlewares],
});

export const normalizeDomainAttrs = (props: ApplicationDomainProps): DomainAttrs => {
  const https = props.https ?? false;
  const certificateType =
    props.certificateType ?? (https ? ("letsencrypt" as const) : ("none" as const));
  return {
    key: applicationDomainCorrelationKey(props),
    id: props.id,
    host: props.host.trim(),
    path: props.path ?? "/",
    internalPath: props.internalPath ?? "/",
    stripPath: props.stripPath ?? false,
    containerPort: props.containerPort ?? 3000,
    https,
    certificateType,
    customCertResolver: props.customCertResolver ?? undefined,
    customEntrypoint: props.customEntrypoint ?? undefined,
    serviceName: props.serviceName ?? undefined,
    middlewares: props.middlewares ?? [],
  };
};

/** Read normalized attrs from another `Domain` resource (for downstream consumers). */
export const readDomainAttrs = (domain: Domain): Effect.Effect<DomainAttrs> =>
  Effect.gen(function* () {
    const key = yield* yield* domain.key;
    const host = yield* yield* domain.host;
    const path = yield* yield* domain.path;
    const internalPath = yield* yield* domain.internalPath;
    const stripPath = yield* yield* domain.stripPath;
    const containerPort = yield* yield* domain.containerPort;
    const https = yield* yield* domain.https;
    const certificateType = yield* yield* domain.certificateType;
    const customCertResolver = yield* yield* domain.customCertResolver;
    const customEntrypoint = yield* yield* domain.customEntrypoint;
    const serviceName = yield* yield* domain.serviceName;
    const middlewares = yield* yield* domain.middlewares;
    const domId = yield* yield* domain.id;
    return {
      key,
      id: domId,
      host,
      path,
      internalPath,
      stripPath,
      containerPort,
      https,
      certificateType,
      customCertResolver,
      customEntrypoint,
      serviceName,
      middlewares,
    };
  });

export type Domain = Resource<
  "Crucible.Dokploy.Domain",
  ApplicationDomainProps,
  DomainAttrs,
  never,
  Providers
>;

export const Domain = Resource<Domain>("Crucible.Dokploy.Domain");

/** Collect Dokploy-compatible domain specs produced by sibling {@link Domain} resources. */
export const collectDomainSpecs = (
  domains: ReadonlyArray<Domain> | undefined,
): Effect.Effect<ApplicationDomainProps[]> =>
  Effect.gen(function* () {
    if (domains === undefined || domains.length === 0) return [];
    const specs: ApplicationDomainProps[] = [];
    for (const d of domains) {
      specs.push(domainAttrsToSpec(isResource(d) ? yield* readDomainAttrs(d) : (d as DomainAttrs)));
    }
    return specs;
  });

export const domainSpecsFingerprintForApplication = (domains: ReadonlyArray<Domain> | undefined) =>
  Effect.gen(function* () {
    const specs = yield* collectDomainSpecs(domains);
    return yield* applicationDomainsFingerprint(specs);
  });

export const DomainProvider = () =>
  Provider.effect(
    Domain,
    Effect.sync(() => ({
      stables: ["key"],
      diff: Effect.fn(function* ({ olds, news }) {
        if (!news || !isResolved(news)) return;
        if (!olds || !isResolved(olds)) return;
        const next = normalizeDomainAttrs(news);
        const prev = normalizeDomainAttrs(olds);
        if (JSON.stringify(prev) !== JSON.stringify(next)) return { action: "update" } as const;
      }),
      read: Effect.fn(function* ({ output }) {
        if (!output) return;
        return output;
      }),
      reconcile: Effect.fn(function* ({ news }) {
        if (!news || !isResolved(news)) {
          return yield* Effect.die(
            new Error("Crucible.Dokploy.Domain: unresolved props at reconcile"),
          );
        }
        return normalizeDomainAttrs(news);
      }),
      delete: Effect.fn(function* () {
        yield* Effect.void;
      }),
    })),
  );

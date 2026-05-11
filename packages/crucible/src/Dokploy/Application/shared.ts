import type { ComposeOutput, ComposeServiceResolved, DockerCompose } from "../../Docker/Compose.ts";
import { isResource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { syncApplicationDomains, type ApplicationDomainBinding } from "../applicationDomain.ts";
import {
  collectDomainSpecs,
  domainSpecsFingerprintForApplication,
  type Domain,
} from "../Domain.ts";
import { Dokploy, type DokployDomainsClient } from "../Dokploy.ts";
import type { Environment } from "../Environment.ts";
import { normalizeComposeFingerprint, type DockerComposeService } from "../dockerCompose.ts";

export type ApplicationShared = {
  readonly environment: Environment;
  readonly serverId?: string;
  /** Display name; defaults to logical id. */
  readonly name?: string;
  /** Container slug; defaults to Alchemy physical name. */
  readonly appName?: string;
  /** Traefik domains synced via Dokploy `domain.*` (one backend URL per hostname). */
  readonly domains?: ReadonlyArray<Domain>;
  readonly registry?: {
    readonly username?: string;
    readonly password?: Redacted.Redacted<string>;
    readonly registryUrl?: string;
  };
};

export type ApplicationOutputs = {
  applicationId: string;
  name: string;
  appName: string;
  dockerImage: string;
  environmentId: string;
  serverId: string | undefined;
  composeFingerprint: string;
  domainsFingerprint: string;
  domainBindings: ReadonlyArray<ApplicationDomainBinding>;
};

export const pickComposeService = (
  manifest: ComposeOutput,
  logicalId: string,
  appName: string | undefined,
): Effect.Effect<Option.Option<ComposeServiceResolved>, never, never> => {
  const want = appName ?? logicalId;
  const chosen = manifest.services.find((s) => s.name === want) ?? manifest.services[0];
  return Effect.succeed(Option.fromNullOr(chosen ?? null));
};

const fingerprintFromCompose = Effect.fn(function* (
  logicalId: string,
  manifest: ComposeOutput,
  appName: string | undefined,
) {
  const pick = yield* pickComposeService(manifest, logicalId, appName);
  if (Option.isNone(pick)) return "{}";
  return `${manifest.fingerprint}::${pick.value.name}::${normalizeComposeFingerprint(pick.value.service)}`;
});

const fingerprintFromImage = (service: DockerComposeService | undefined) =>
  Effect.succeed(normalizeComposeFingerprint(service));

export const deployComposePayload = Effect.fn(function* (
  logicalId: string,
  appName: string | undefined,
  manifest: ComposeOutput,
) {
  const pick = yield* pickComposeService(manifest, logicalId, appName);
  if (Option.isNone(pick)) {
    return yield* Effect.die(
      new Error("Crucible.Dokploy.Application.Compose: no matching compose service in manifest"),
    );
  }
  return { dockerImage: pick.value.dockerImage, compose: pick.value.service };
});

export const resolvedFingerprint = Effect.fn(function* (
  logicalId: string,
  composeManifest: ComposeOutput | undefined,
  appName: string | undefined,
  imageSource: DockerComposeService | undefined,
) {
  return composeManifest
    ? yield* fingerprintFromCompose(logicalId, composeManifest, appName)
    : yield* fingerprintFromImage(imageSource);
});

export const composeManifestResolved = (
  compose: DockerCompose | ComposeOutput,
): Effect.Effect<ComposeOutput> =>
  isResource(compose)
    ? Effect.gen(function* () {
        const fingerprint = yield* yield* compose.fingerprint;
        const services = yield* yield* compose.services;
        return { fingerprint, services };
      })
    : Effect.succeed(compose);

export type UpsertSnap = {
  applicationId: string;
  name: string;
  appName: string;
  dockerImage: string;
  environmentId: string;
  serverId: string | undefined;
};

export const finalizeApplicationReconcile = Effect.fn(function* (input: {
  readonly domains: DokployDomainsClient;
  readonly snap: UpsertSnap;
  readonly id: string;
  readonly composeManifest: ComposeOutput | undefined;
  readonly news: ApplicationShared;
  readonly payloadCompose: DockerComposeService | undefined;
  readonly output:
    | { readonly domainBindings?: ReadonlyArray<ApplicationDomainBinding> }
    | undefined;
}) {
  const desiredDomainSpecs = yield* collectDomainSpecs(input.news.domains);
  const domainBindings = yield* syncApplicationDomains({
    domains: input.domains,
    desired: desiredDomainSpecs,
    previous: input.output?.domainBindings,
    attachApplicationId: input.snap.applicationId,
  });

  return {
    applicationId: input.snap.applicationId,
    name: input.snap.name,
    appName: input.snap.appName,
    dockerImage: input.snap.dockerImage,
    environmentId: input.snap.environmentId,
    serverId: input.snap.serverId,
    composeFingerprint: yield* resolvedFingerprint(
      input.id,
      input.composeManifest,
      input.news.appName,
      input.payloadCompose,
    ),
    domainsFingerprint: yield* domainSpecsFingerprintForApplication(input.news.domains),
    domainBindings,
  };
});

export const readShared = Effect.fn(function* ({
  output,
}: {
  output:
    | {
        applicationId?: string;
        composeFingerprint?: string;
        domainsFingerprint?: string;
        domainBindings?: ReadonlyArray<ApplicationDomainBinding>;
      }
    | undefined;
}) {
  if (!output?.applicationId) return;
  const dokploy = yield* Dokploy;
  const snap = yield* dokploy.applications.findById(output.applicationId);
  if (Option.isNone(snap)) return;
  const cloud = snap.value;
  return {
    applicationId: cloud.applicationId,
    name: cloud.name,
    appName: cloud.appName,
    dockerImage: cloud.dockerImage,
    environmentId: cloud.environmentId,
    serverId: cloud.serverId,
    composeFingerprint: output.composeFingerprint ?? "{}",
    domainsFingerprint: output.domainsFingerprint ?? "[]",
    domainBindings: output.domainBindings ?? [],
  };
});

export const deleteShared = Effect.fn(function* ({
  output,
}: {
  output:
    | { applicationId?: string; domainBindings?: ReadonlyArray<ApplicationDomainBinding> }
    | undefined;
}) {
  if (!output?.applicationId) return;
  const dokploy = yield* Dokploy;
  for (const b of output.domainBindings ?? []) {
    yield* dokploy.domains.deleteDomain(b.domainId);
  }
  yield* dokploy.applications.delete(output.applicationId);
});

import { hasUnresolvedInputs } from "alchemy/Diff";
import type * as AlcInput from "alchemy/Input";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { DockerComposeService } from "../Dokploy/dockerCompose.ts";
import { normalizeComposeFingerprint } from "../Dokploy/dockerCompose.ts";
import type { Providers } from "../Dokploy/Providers.ts";

/** Image ref for a compose service — typically `yield*` `ImageTag()` from `crucible/Docker`. */
export type ComposeServiceImage = AlcInput.Input<{ readonly dockerImage: string }>;

/**
 * One service in a {@link DockerCompose} manifest (image + optional Dokploy/compose-shaped options).
 */
export type ComposeServiceDefinition = {
  readonly name: string;
  readonly image: ComposeServiceImage;
} & DockerComposeService;

export type ComposeProps = {
  readonly services: ReadonlyArray<ComposeServiceDefinition>;
};

export type ComposeServiceResolved = {
  readonly name: string;
  readonly dockerImage: string;
  readonly service: DockerComposeService;
};

export type ComposeOutput = {
  readonly services: ReadonlyArray<ComposeServiceResolved>;
  /** Canonical fingerprint for diffs (names + images + normalized service options). */
  readonly fingerprint: string;
};

const serviceBody = (s: ComposeServiceDefinition): DockerComposeService => ({
  environment: s.environment,
  env: s.env,
  command: s.command,
  args: s.args,
  restart: s.restart,
  replicas: s.replicas,
  createEnvFile: s.createEnvFile,
  ports: s.ports,
  volumes: s.volumes,
  rawUpdate: s.rawUpdate,
});

const resolvedFingerprint = (services: ReadonlyArray<ComposeServiceResolved>): string =>
  JSON.stringify(
    services.map((s) => ({
      name: s.name,
      dockerImage: s.dockerImage,
      fp: normalizeComposeFingerprint(s.service),
    })),
  );

/** Logical multi-service manifest; use with {@link Application.Compose}. */
export type DockerCompose = Resource<
  "Crucible.Docker.Compose",
  ComposeProps,
  ComposeOutput,
  never,
  Providers
>;

export const DockerCompose = Resource<DockerCompose>("Crucible.Docker.Compose");

export const ComposeProvider = () =>
  Provider.effect(
    DockerCompose,
    Effect.sync(() => ({
      stables: ["fingerprint"],
      diff: Effect.fn(function* ({ news, output }) {
        yield* Effect.void;
        if (news === undefined || hasUnresolvedInputs(news)) return undefined;
        const n = news as ComposeProps;
        const resolved = n.services.map((s) => ({
          name: s.name,
          dockerImage: (s.image as { dockerImage: string }).dockerImage,
          service: serviceBody(s),
        }));
        const fp = resolvedFingerprint(resolved);
        if (output !== undefined && fp !== output.fingerprint) return { action: "update" } as const;
        return undefined;
      }),
      read: Effect.fn(function* ({ output }) {
        yield* Effect.void;
        return output ?? undefined;
      }),
      reconcile: Effect.fn(function* ({ news }) {
        if (news === undefined || hasUnresolvedInputs(news)) {
          return yield* Effect.die(
            new Error("Crucible.Docker.Compose: unresolved props at reconcile"),
          );
        }
        const n = news as ComposeProps;
        const services: ComposeServiceResolved[] = [];
        for (const s of n.services) {
          const img = s.image as { dockerImage: string };
          services.push({
            name: s.name,
            dockerImage: img.dockerImage,
            service: serviceBody(s),
          });
        }
        return { services, fingerprint: resolvedFingerprint(services) };
      }),
      delete: Effect.fn(function* () {
        yield* Effect.void;
      }),
    })),
  );

/**
 * Declarative compose manifest (one or more services). Pass the yield result to
 * {@link Application.Compose}.
 */
export const Compose = (id: string, services: ReadonlyArray<ComposeServiceDefinition>) =>
  DockerCompose(id, { services });

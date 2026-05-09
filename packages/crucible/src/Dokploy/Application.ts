import { hasUnresolvedInputs } from "alchemy/Diff";
import type * as AlcInput from "alchemy/Input";
import { createPhysicalName } from "alchemy/PhysicalName";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import type { ComposeOutput } from "../Docker/Compose.ts";
import { DokployEngine } from "./DokployEngine.ts";
import { normalizeComposeFingerprint, type DockerComposeService } from "./dockerCompose.ts";
import type { Providers } from "./Providers.ts";
import type { DeploymentStrategy } from "./types.ts";

/** Resolved image — typically `yield*` `Docker.ImageTag` from `crucible/Docker`. */
export type ApplicationDockerImage = AlcInput.Input<{ readonly dockerImage: string }>;

/** Resolved environment selection — typically `yield*` an {@link Environment} resource here. */
export type ApplicationEnvironment = AlcInput.Input<{ readonly environmentId: string }>;

type ApplicationShared = {
  readonly environment: ApplicationEnvironment;
  readonly serverId?: string;
  /** Display name; defaults to logical id. */
  readonly name?: string;
  /** Container slug; defaults to Alchemy physical name. */
  readonly appName?: string;
  readonly registry?: {
    readonly username?: string;
    readonly password?: Redacted.Redacted<string>;
    readonly registryUrl?: string;
  };
  readonly deployment?: DeploymentStrategy;
};

/** Docker application from image + optional inline service options (Compose-shaped). */
export type ApplicationImageProps = ApplicationShared & {
  readonly image: ApplicationDockerImage;
  /** Environment, ports, restart, mounts, … — same shape as Compose service options. */
  readonly service?: DockerComposeService;
};

/** Dokploy Docker app wired from a {@link Compose} manifest; picks service by {@link appName} or logical resource id. */
export type ApplicationComposeProps = ApplicationShared & {
  readonly compose: AlcInput.Input<ComposeOutput>;
};

export type ApplicationProps = ApplicationImageProps | ApplicationComposeProps;

type ResolvedFromImage = Omit<ApplicationImageProps, "environment"> & {
  readonly environment: { readonly environmentId: string };
  readonly image: { readonly dockerImage: string };
};

type ResolvedFromCompose = Omit<ApplicationComposeProps, "environment" | "compose"> & {
  readonly environment: { readonly environmentId: string };
  readonly compose: ComposeOutput;
};

type ResolvedApplicationProps = ResolvedFromImage | ResolvedFromCompose;

const pickComposeService = (
  manifest: ComposeOutput,
  logicalId: string,
  appName: string | undefined,
) => {
  const want = appName ?? logicalId;
  const byName = manifest.services.find((s) => s.name === want);
  return byName ?? manifest.services[0];
};

const fingerprintFromCompose = (logicalId: string, resolved: ResolvedFromCompose): string => {
  const pick = pickComposeService(resolved.compose, logicalId, resolved.appName);
  if (!pick) return "{}";
  return `${resolved.compose.fingerprint}::${pick.name}::${normalizeComposeFingerprint(pick.service)}`;
};

const fingerprintFromImage = (resolved: ResolvedFromImage): string =>
  normalizeComposeFingerprint(resolved.service);

const isComposeProps = (props: ResolvedApplicationProps): props is ResolvedFromCompose =>
  "compose" in props && props.compose !== undefined;

const deployPayloadOrThrow = (logicalId: string, resolved: ResolvedApplicationProps) => {
  if (isComposeProps(resolved)) {
    const pick = pickComposeService(resolved.compose, logicalId, resolved.appName);
    if (!pick) {
      throw new Error(
        `Crucible.Dokploy.Application: compose manifest "${logicalId}" has no services`,
      );
    }
    return { dockerImage: pick.dockerImage, compose: pick.service };
  }
  return {
    dockerImage: resolved.image.dockerImage,
    compose: resolved.service,
  };
};

export type Application = Resource<
  "Crucible.Dokploy.Application",
  ApplicationProps,
  {
    applicationId: string;
    name: string;
    appName: string;
    dockerImage: string;
    environmentId: string;
    serverId: string | undefined;
    composeFingerprint: string;
  },
  never,
  Providers
>;

const ApplicationResource = Resource<Application>("Crucible.Dokploy.Application");

/** Underlying Alchemy resource (`Application.Image` / `Application.Compose`). */
export { ApplicationResource };

export const Application = Object.assign(ApplicationResource, {
  Image: (id: string, props: ApplicationImageProps) => ApplicationResource(id, props),
  Compose: (id: string, props: ApplicationComposeProps) => ApplicationResource(id, props),
});

const defaultDeployment = (): DeploymentStrategy => ({
  mode: "native",
  kind: "restart",
});

const resolvedFingerprint = (logicalId: string, resolved: ResolvedApplicationProps): string =>
  isComposeProps(resolved)
    ? fingerprintFromCompose(logicalId, resolved)
    : fingerprintFromImage(resolved);

export const ApplicationProvider = () =>
  Provider.effect(
    ApplicationResource,
    Effect.sync(() => ({
      stables: ["applicationId", "environmentId"],
      diff: Effect.fn(function* ({ id, olds, news, output }) {
        if (news === undefined || hasUnresolvedInputs(news)) return undefined;
        const n = news as ResolvedApplicationProps;

        const physical = yield* createPhysicalName({ id });
        const environmentId = n.environment.environmentId;

        let dockerImage: string;
        let fpExpect: string;
        try {
          const p = deployPayloadOrThrow(id, n);
          dockerImage = p.dockerImage;
          fpExpect = resolvedFingerprint(id, n);
        } catch {
          return undefined;
        }

        if (output !== undefined) {
          if (environmentId !== output.environmentId) return { action: "replace" } as const;
          if ((n.serverId ?? undefined) !== (output.serverId ?? undefined))
            return { action: "replace" } as const;
          if (dockerImage !== output.dockerImage) return { action: "update" } as const;
          const nameNew = n.name ?? id;
          if (nameNew !== output.name) return { action: "update" } as const;
          const appSlugNew = n.appName ?? physical;
          if (appSlugNew !== output.appName) return { action: "update" } as const;
          if (fpExpect !== (output.composeFingerprint ?? "{}")) {
            return { action: "update" } as const;
          }
          return undefined;
        }

        if (olds !== undefined && !hasUnresolvedInputs(olds)) {
          const o = olds as ResolvedApplicationProps;

          let oldDockerImage: string;
          let oldFp: string;
          try {
            const op = deployPayloadOrThrow(id, o);
            oldDockerImage = op.dockerImage;
            oldFp = resolvedFingerprint(id, o);
          } catch {
            return undefined;
          }

          if (environmentId !== o.environment.environmentId) return { action: "replace" } as const;
          if ((n.serverId ?? undefined) !== (o.serverId ?? undefined))
            return { action: "replace" } as const;

          if (dockerImage !== oldDockerImage) return { action: "update" } as const;

          const nameNew = n.name ?? id;
          const slugNew = n.appName ?? physical;
          const nameOld = o.name ?? id;
          const slugOld = o.appName ?? physical;
          if (nameNew !== nameOld || slugNew !== slugOld) return { action: "update" } as const;

          if (fpExpect !== oldFp) return { action: "update" } as const;
        }

        return undefined;
      }),
      read: Effect.fn(function* ({ output }) {
        if (!output?.applicationId) return undefined;
        const engine = yield* DokployEngine;
        const snap = yield* engine.findByApplicationId(output.applicationId);
        const cloud = Option.getOrUndefined(snap);
        if (cloud === undefined) return undefined;
        return {
          applicationId: cloud.applicationId,
          name: cloud.name,
          appName: cloud.appName,
          dockerImage: cloud.dockerImage,
          environmentId: cloud.environmentId,
          serverId: cloud.serverId,
          composeFingerprint: output.composeFingerprint ?? "{}",
        };
      }),
      reconcile: Effect.fn(function* ({ id, news, output }) {
        if (news === undefined || hasUnresolvedInputs(news)) {
          return yield* Effect.die(
            new Error("Crucible.Dokploy.Application: unresolved props at reconcile"),
          );
        }
        const propsResolved = news as ResolvedApplicationProps;
        const props = propsResolved;

        let payload;
        try {
          payload = deployPayloadOrThrow(id, propsResolved);
        } catch (e) {
          return yield* Effect.die(
            e instanceof Error
              ? e
              : new Error("Crucible.Dokploy.Application: invalid compose props"),
          );
        }

        const engine = yield* DokployEngine;
        const physicalAppName = props.appName ?? (yield* createPhysicalName({ id }));
        const displayName = props.name ?? id;
        const deployment = props.deployment ?? defaultDeployment();
        const environmentId = props.environment.environmentId;

        const snap = yield* engine.upsertDockerApplication({
          applicationId: output?.applicationId,
          environmentId,
          serverId: props.serverId,
          name: displayName,
          appName: physicalAppName,
          dockerImage: payload.dockerImage,
          registry: props.registry,
          deployment,
          compose: payload.compose,
        });

        return {
          applicationId: snap.applicationId,
          name: snap.name,
          appName: snap.appName,
          dockerImage: snap.dockerImage,
          environmentId: snap.environmentId,
          serverId: snap.serverId,
          composeFingerprint: resolvedFingerprint(id, propsResolved),
        };
      }),
      delete: Effect.fn(function* ({ output }) {
        if (!output?.applicationId) return;
        const engine = yield* DokployEngine;
        yield* engine.deleteApplication(output.applicationId);
      }),
    })),
  );

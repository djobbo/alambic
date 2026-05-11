import { isResolved } from "alchemy/Diff";
import { createPhysicalName } from "alchemy/PhysicalName";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import type { DockerImage } from "../../Docker/Image.ts";
import * as Effect from "effect/Effect";
import { domainSpecsFingerprintForApplication } from "../Domain.ts";
import type { Providers } from "../Providers.ts";
import type { DockerComposeService } from "../dockerCompose.ts";
import { Dokploy } from "../Dokploy.ts";
import {
  deleteShared,
  finalizeApplicationReconcile,
  readShared,
  resolvedFingerprint,
  type ApplicationOutputs,
  type ApplicationShared,
} from "./shared.ts";

/** Docker application from image + optional inline service options (Compose-shaped). */
export type ApplicationImageProps = ApplicationShared & {
  readonly image: DockerImage;
  /** Environment, ports, restart, mounts, … — same shape as Compose service options. */
  readonly service?: DockerComposeService;
};

export type ApplicationImage = Resource<
  "Crucible.Dokploy.Application.Image",
  ApplicationImageProps,
  ApplicationOutputs,
  never,
  Providers
>;

export const ApplicationImage = Resource<ApplicationImage>("Crucible.Dokploy.Application.Image");

export const ApplicationImageProvider = () =>
  Provider.effect(
    ApplicationImage,
    Effect.sync(() => ({
      stables: ["applicationId", "environmentId"],
      diff: Effect.fn(function* ({ id, olds, news, output }) {
        if (!news || !isResolved(news)) return;

        const environmentId = news.environment.environmentId;
        const physical = yield* createPhysicalName({ id });

        const dockerImageNew = news.image.dockerImage;
        const svcNew = news.service;
        const fpExpect = yield* resolvedFingerprint(id, undefined, news.appName, svcNew);
        const domFpNew = yield* domainSpecsFingerprintForApplication(news.domains);

        if (output) {
          if (environmentId !== output.environmentId) return { action: "replace" } as const;
          if ((news.serverId ?? undefined) !== (output.serverId ?? undefined))
            return { action: "replace" } as const;
          if (dockerImageNew !== output.dockerImage) return { action: "update" } as const;
          const nameNew = news.name ?? id;
          if (nameNew !== output.name) return { action: "update" } as const;
          const appSlugNew = news.appName ?? physical;
          if (appSlugNew !== output.appName) return { action: "update" } as const;
          if (fpExpect !== (output.composeFingerprint ?? "{}"))
            return { action: "update" } as const;
          if (domFpNew !== (output.domainsFingerprint ?? "[]"))
            return { action: "update" } as const;
          return;
        }

        if (!olds || !isResolved(olds)) return;

        const oldEnvironmentId = olds.environment?.environmentId;
        const dockerImageOld = olds.image?.dockerImage;
        const svcOld = olds.service;

        if (environmentId !== oldEnvironmentId) return { action: "replace" } as const;
        if ((news.serverId ?? undefined) !== (olds.serverId ?? undefined))
          return { action: "replace" } as const;
        if (dockerImageNew !== dockerImageOld) return { action: "update" } as const;

        const nameNew = news.name ?? id;
        const slugNew = news.appName ?? physical;
        const nameOld = olds.name ?? id;
        const slugOld = olds.appName ?? physical;
        if (nameNew !== nameOld || slugNew !== slugOld) return { action: "update" } as const;

        const fpOld = yield* resolvedFingerprint(id, undefined, olds.appName, svcOld);
        if (fpExpect !== fpOld) return { action: "update" } as const;
        const domOld = yield* domainSpecsFingerprintForApplication(olds.domains);
        if (domFpNew !== domOld) return { action: "update" } as const;
      }),
      read: readShared,
      reconcile: Effect.fn(function* ({ id, news, output }) {
        if (!news || !isResolved(news)) {
          return yield* Effect.die(
            new Error("Crucible.Dokploy.Application.Image: unresolved props at reconcile"),
          );
        }

        const dokploy = yield* Dokploy;
        const physicalAppName = news.appName ?? (yield* createPhysicalName({ id }));
        const displayName = news.name ?? id;
        const environmentId = news.environment.environmentId;

        let payloadCompose: DockerComposeService | undefined;
        let dockerImage: string;
        try {
          dockerImage = news.image.dockerImage;
          payloadCompose = news.service;
        } catch (e) {
          return yield* Effect.die(
            e instanceof Error
              ? e
              : new Error("Crucible.Dokploy.Application.Image: invalid image props"),
          );
        }

        const snap = yield* dokploy.applications.upsertDocker({
          applicationId: output?.applicationId,
          environmentId,
          serverId: news.serverId,
          name: displayName,
          appName: physicalAppName,
          dockerImage,
          registry: news.registry,
          compose: payloadCompose,
        });

        return yield* finalizeApplicationReconcile({
          domains: dokploy.domains,
          snap,
          id,
          composeManifest: undefined,
          news,
          payloadCompose,
          output,
        });
      }),
      delete: deleteShared,
    })),
  );

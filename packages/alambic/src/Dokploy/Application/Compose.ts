import { isResolved } from "alchemy/Diff";
import { createPhysicalName } from "alchemy/PhysicalName";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import type { DockerCompose } from "../../Docker/Compose.ts";
import * as Effect from "effect/Effect";
import { domainSpecsFingerprintForApplication } from "../Domain.ts";
import { Dokploy } from "../Dokploy.ts";
import type { Providers } from "../Providers.ts";
import type { DockerComposeService } from "../dockerCompose.ts";
import {
  composeManifestResolved,
  deleteShared,
  deployComposePayload,
  finalizeApplicationReconcile,
  readShared,
  resolvedFingerprint,
  type ApplicationOutputs,
  type ApplicationShared,
} from "./shared.ts";

/** Dokploy Docker app wired from a {@link DockerCompose} manifest; picks service by {@link appName} or logical resource id. */
export type ApplicationComposeProps = ApplicationShared & {
  readonly compose: DockerCompose;
};

export type ApplicationCompose = Resource<
  "Alambic.Dokploy.Application.Compose",
  ApplicationComposeProps,
  ApplicationOutputs,
  never,
  Providers
>;

export const ApplicationCompose = Resource<ApplicationCompose>(
  "Alambic.Dokploy.Application.Compose",
);

export const ApplicationComposeProvider = () =>
  Provider.effect(
    ApplicationCompose,
    Effect.sync(() => ({
      stables: ["applicationId", "environmentId"],
      diff: Effect.fn(function* ({ id, olds, news, output }) {
        if (!news || !isResolved(news)) return;

        const environmentId = news.environment.environmentId;
        const physical = yield* createPhysicalName({ id });

        const manifest = yield* composeManifestResolved(news.compose);
        const payload = yield* deployComposePayload(id, news.appName, manifest);
        const dockerImageNew = payload.dockerImage;
        const svcNew = payload.compose;

        const fpExpect = yield* resolvedFingerprint(id, manifest, news.appName, svcNew);
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

        const manifestOld = yield* composeManifestResolved(olds.compose);
        const pOld = yield* deployComposePayload(id, olds.appName, manifestOld);
        const dockerImageOld = pOld.dockerImage;
        const svcOld = pOld.compose;

        if (environmentId !== oldEnvironmentId) return { action: "replace" } as const;
        if ((news.serverId ?? undefined) !== (olds.serverId ?? undefined))
          return { action: "replace" } as const;
        if (dockerImageNew !== dockerImageOld) return { action: "update" } as const;

        const nameNew = news.name ?? id;
        const slugNew = news.appName ?? physical;
        const nameOld = olds.name ?? id;
        const slugOld = olds.appName ?? physical;
        if (nameNew !== nameOld || slugNew !== slugOld) return { action: "update" } as const;

        const fpOld = yield* resolvedFingerprint(id, manifestOld, olds.appName, svcOld);
        if (fpExpect !== fpOld) return { action: "update" } as const;
        const domOld = yield* domainSpecsFingerprintForApplication(olds.domains);
        if (domFpNew !== domOld) return { action: "update" } as const;
      }),
      read: readShared,
      reconcile: Effect.fn(function* ({ id, news, output }) {
        if (!news || !isResolved(news)) {
          return yield* Effect.die(
            new Error("Alambic.Dokploy.Application.Compose: unresolved props at reconcile"),
          );
        }

        const composeManifest = yield* composeManifestResolved(news.compose);

        let payload: { dockerImage: string; compose: DockerComposeService | undefined };
        try {
          payload = yield* deployComposePayload(id, news.appName, composeManifest);
        } catch (e) {
          return yield* Effect.die(
            e instanceof Error
              ? e
              : new Error("Alambic.Dokploy.Application.Compose: invalid compose props"),
          );
        }

        const dokploy = yield* Dokploy;
        const physicalAppName = news.appName ?? (yield* createPhysicalName({ id }));
        const displayName = news.name ?? id;
        const environmentId = news.environment.environmentId;

        const snap = yield* dokploy.applications.upsertDocker({
          applicationId: output?.applicationId,
          environmentId,
          serverId: news.serverId,
          name: displayName,
          appName: physicalAppName,
          dockerImage: payload.dockerImage,
          registry: news.registry,
          compose: payload.compose,
        });

        return yield* finalizeApplicationReconcile({
          domains: dokploy.domains,
          snap,
          id,
          composeManifest,
          news,
          payloadCompose: payload.compose,
          output,
        });
      }),
      delete: deleteShared,
    })),
  );

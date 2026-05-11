import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "./Providers.ts";
import type { Project } from "./Project.ts";
import { Dokploy } from "./Dokploy.ts";
import * as Option from "effect/Option";

export interface EnvironmentProps {
  readonly project: Project;
  /** Dokploy environment name (`production` is reserved by Dokploy — use another name here). */
  readonly name?: string;
  readonly description?: string;
}

export type Environment = Resource<
  "Alambic.Dokploy.Environment",
  EnvironmentProps,
  {
    environmentId: string;
    projectId: string;
    name: string;
    description: string | undefined;
  },
  never,
  Providers
>;

export const Environment = Resource<Environment>("Alambic.Dokploy.Environment");

export const EnvironmentProvider = () =>
  Provider.effect(
    Environment,
    Effect.sync(() => ({
      stables: ["environmentId", "projectId"],
      diff: Effect.fn(function* ({ id, olds, news, output }) {
        if (!news || !isResolved(news)) return;

        const envName = news.name ?? id;
        const projectId = news.project.projectId;

        if (output) {
          if (projectId !== output.projectId) return { action: "replace" } as const;
          if ((news.description ?? undefined) !== (output.description ?? undefined))
            return { action: "update" } as const;
          if (envName !== output.name) return { action: "update" } as const;
          return;
        }

        if (!olds || !isResolved(olds)) return;

        const oldProjectId = olds.project.projectId;

        if (projectId !== oldProjectId) {
          return { action: "replace" } as const;
        }
      }),
      read: Effect.fn(function* ({ output }) {
        if (!output) return;
        const dokploy = yield* Dokploy;
        const snap = yield* dokploy.environments.findById(output.environmentId);
        if (Option.isNone(snap)) return;

        return {
          environmentId: snap.value.environmentId,
          projectId: snap.value.projectId,
          name: snap.value.name,
          description: snap.value.description ?? undefined,
        };
      }),
      reconcile: Effect.fn(function* ({ id, news, output }) {
        if (!news || !isResolved(news)) {
          return yield* Effect.die(
            new Error("Alambic.Dokploy.Environment: unresolved props at reconcile"),
          );
        }
        const dokploy = yield* Dokploy;
        const envName = news.name ?? id;
        const projectId = news.project.projectId;

        const updated = yield* dokploy.environments.upsert({
          environmentId: output?.environmentId,
          projectId: projectId,
          name: envName,
          description: news.description,
        });

        if (Option.isNone(updated)) {
          return yield* Effect.die(
            new Error("Alambic.Dokploy.Environment: failed to update environment"),
          );
        }

        return {
          environmentId: updated.value.environmentId,
          projectId: updated.value.projectId,
          name: updated.value.name,
          description: updated.value.description ?? undefined,
        };
      }),
      delete: Effect.fn(function* ({ output }) {
        if (!output?.environmentId) return;
        const dokploy = yield* Dokploy;
        yield* dokploy.environments.delete(output.environmentId);
      }),
    })),
  );

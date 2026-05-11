import { isResolved } from "alchemy/Diff";
import { createPhysicalName } from "alchemy/PhysicalName";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "./Providers.ts";
import { Dokploy } from "./Dokploy.ts";
import * as Option from "effect/Option";

export interface ProjectProps {
  /** Display name in Dokploy; defaults to a stable physical name from the logical id. */
  readonly name?: string;
  readonly description?: string | null;
}

export type Project = Resource<
  "Crucible.Dokploy.Project",
  ProjectProps,
  {
    projectId: string;
    name: string;
    description: string | undefined;
  },
  never,
  Providers
>;

export const Project = Resource<Project>("Crucible.Dokploy.Project");

export const ProjectProvider = () =>
  Provider.effect(
    Project,
    Effect.sync(() => ({
      stables: ["projectId"],
      diff: Effect.fn(function* ({ id, news, output }) {
        const next = news ?? {};
        if (!isResolved(next)) return;
        if (!output) return;

        if ((next.description ?? undefined) !== (output.description ?? undefined)) {
          return { action: "update" } as const;
        }

        const displayName = next.name ?? (yield* createPhysicalName({ id }));
        if (displayName !== output.name) {
          return { action: "update" } as const;
        }
      }),
      read: Effect.fn(function* ({ output }) {
        if (!output) return;
        const dokploy = yield* Dokploy;
        const project = yield* dokploy.projects.findById(output.projectId);
        if (Option.isNone(project)) return;

        return {
          projectId: project.value.projectId,
          name: project.value.name,
          description: project.value.description ?? undefined,
        };
      }),
      reconcile: Effect.fn(function* ({ id, news, output }) {
        const next = news ?? {};
        if (!isResolved(next)) {
          return yield* Effect.die(
            new Error("Crucible.Dokploy.Project: unresolved props at reconcile"),
          );
        }
        const dokploy = yield* Dokploy;
        const displayName = next.name ?? (yield* createPhysicalName({ id }));

        const updated = yield* dokploy.projects.upsert({
          projectId: output?.projectId,
          name: displayName,
          description: next.description,
        });

        if (Option.isNone(updated)) {
          return yield* Effect.die(new Error("Crucible.Dokploy.Project: failed to update project"));
        }
        return {
          projectId: updated.value.projectId,
          name: updated.value.name,
          description: updated.value.description ?? undefined,
        };
      }),
      delete: Effect.fn(function* ({ output }) {
        if (!output?.projectId) return;
        const dokploy = yield* Dokploy;
        yield* dokploy.projects.delete(output.projectId);
      }),
    })),
  );

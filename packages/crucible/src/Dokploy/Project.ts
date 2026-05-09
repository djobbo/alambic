import { hasUnresolvedInputs } from "alchemy/Diff";
import { createPhysicalName } from "alchemy/PhysicalName";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { DokployEngine } from "./DokployEngine.ts";
import type { Providers } from "./Providers.ts";

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
        if (news === undefined || hasUnresolvedInputs(news)) return undefined;
        const n = news as ProjectProps;

        const displayName = n.name ?? (yield* createPhysicalName({ id }));

        if (output !== undefined) {
          if ((n.description ?? undefined) !== (output.description ?? undefined))
            return { action: "update" } as const;
          if (displayName !== output.name) return { action: "update" } as const;
          return undefined;
        }

        return undefined;
      }),
      read: Effect.fn(function* ({ output }) {
        if (!output?.projectId) return undefined;
        const engine = yield* DokployEngine;
        const snap = yield* engine.findByProjectId(output.projectId);
        return Option.getOrUndefined(snap);
      }),
      reconcile: Effect.fn(function* ({ id, news, output }) {
        const incoming = news ?? {};
        if (hasUnresolvedInputs(incoming)) {
          return yield* Effect.die(
            new Error("Crucible.Dokploy.Project: unresolved props at reconcile"),
          );
        }
        const props = incoming as ProjectProps;
        const engine = yield* DokployEngine;
        const displayName = props.name ?? (yield* createPhysicalName({ id }));

        return yield* engine.upsertProject({
          projectId: output?.projectId,
          name: displayName,
          description: props.description,
        });
      }),
      delete: Effect.fn(function* ({ output }) {
        if (!output?.projectId) return;
        const engine = yield* DokployEngine;
        yield* engine.deleteProject(output.projectId);
      }),
    })),
  );

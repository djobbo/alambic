import { hasUnresolvedInputs } from "alchemy/Diff";
import type * as AlcInput from "alchemy/Input";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { DokployEngine } from "./DokployEngine.ts";
import type { Providers } from "./Providers.ts";

/** Parent {@link Project} output — pass a `Project` resource to satisfy this. */
export type EnvironmentProject = AlcInput.Input<{ readonly projectId: string }>;

export interface EnvironmentProps {
  readonly project: EnvironmentProject;
  /** Dokploy environment name (`production` is reserved by Dokploy — use another name here). */
  readonly name?: string;
  readonly description?: string;
}

/** After plan resolution, refs are plain attribute objects. */
type ResolvedEnvironmentProps = Omit<EnvironmentProps, "project"> & {
  readonly project: { readonly projectId: string };
};

export type Environment = Resource<
  "Crucible.Dokploy.Environment",
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

export const Environment = Resource<Environment>("Crucible.Dokploy.Environment");

export const EnvironmentProvider = () =>
  Provider.effect(
    Environment,
    Effect.sync(() => ({
      stables: ["environmentId", "projectId"],
      diff: Effect.fn(function* ({ id, olds, news, output }) {
        yield* Effect.void;
        if (news === undefined || hasUnresolvedInputs(news)) return undefined;
        const n = news as ResolvedEnvironmentProps;

        const envName = n.name ?? id;
        const projectId = n.project.projectId;

        if (output !== undefined) {
          if (projectId !== output.projectId) return { action: "replace" } as const;
          if ((n.description ?? undefined) !== (output.description ?? undefined))
            return { action: "update" } as const;
          if (envName !== output.name) return { action: "update" } as const;
          return undefined;
        }

        if (olds !== undefined && hasUnresolvedInputs(olds)) return undefined;

        if (
          olds !== undefined &&
          !hasUnresolvedInputs(olds) &&
          projectId !== (olds as ResolvedEnvironmentProps).project.projectId
        ) {
          return { action: "replace" } as const;
        }

        return undefined;
      }),
      read: Effect.fn(function* ({ output }) {
        if (!output?.environmentId) return undefined;
        const engine = yield* DokployEngine;
        const snap = yield* engine.findByEnvironmentId(output.environmentId);
        return Option.getOrUndefined(snap);
      }),
      reconcile: Effect.fn(function* ({ id, news, output }) {
        if (news === undefined || hasUnresolvedInputs(news)) {
          return yield* Effect.die(
            new Error("Crucible.Dokploy.Environment: unresolved props at reconcile"),
          );
        }
        const props = news as ResolvedEnvironmentProps;
        const engine = yield* DokployEngine;
        const envName = props.name ?? id;

        return yield* engine.upsertEnvironment({
          environmentId: output?.environmentId,
          projectId: props.project.projectId,
          name: envName,
          description: props.description,
        });
      }),
      delete: Effect.fn(function* ({ output }) {
        if (!output?.environmentId) return;
        const engine = yield* DokployEngine;
        yield* engine.deleteEnvironment(output.environmentId);
      }),
    })),
  );

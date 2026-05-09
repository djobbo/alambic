import { hasUnresolvedInputs } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "./Providers.ts";
import type { DeploymentStrategy } from "./types.ts";

export type DeploymentProps = DeploymentStrategy;

export type Deployment = Resource<
  "Crucible.Dokploy.Deployment",
  DeploymentProps,
  DeploymentStrategy,
  never,
  Providers
>;

const DeploymentResource = Resource<Deployment>("Crucible.Dokploy.Deployment");

export { DeploymentResource };

export const Deployment = Object.assign(DeploymentResource, {
  BlueGreen: (
    id: string,
    props?: {
      readonly cutover?: "automatic" | "manual";
      readonly initialSlot?: "blue" | "green";
    },
  ) =>
    DeploymentResource(id, {
      mode: "blue-green",
      ...(props ?? {}),
    } satisfies DeploymentStrategy),
  Native: (id: string, props?: { readonly kind?: "rolling" | "restart" }) =>
    DeploymentResource(id, {
      mode: "native",
      kind: props?.kind ?? "restart",
    } satisfies DeploymentStrategy),
  Recreate: (id: string) =>
    DeploymentResource(id, {
      mode: "recreate",
    } satisfies DeploymentStrategy),
});

/**
 * Logical Dokploy deployment policy resource.
 * Persists blue-green/native/recreate strategy in stack state so applications can reference it.
 */
export const DeploymentProvider = () =>
  Provider.effect(
    DeploymentResource,
    Effect.sync(() => ({
      stables: [],
      diff: Effect.fn(function* ({ olds, news }) {
        if (news === undefined || hasUnresolvedInputs(news)) return undefined;
        const n = news as DeploymentStrategy;
        if (olds === undefined || hasUnresolvedInputs(olds)) return undefined;
        const o = olds as DeploymentStrategy;
        return JSON.stringify(o) === JSON.stringify(n)
          ? undefined
          : ({ action: "update" } as const);
      }),
      read: Effect.fn(function* ({ output }) {
        yield* Effect.void;
        return output;
      }),
      reconcile: Effect.fn(function* ({ news }) {
        if (news === undefined || hasUnresolvedInputs(news)) {
          return yield* Effect.die(
            new Error("Crucible.Dokploy.Deployment: unresolved props at reconcile"),
          );
        }
        return news as DeploymentStrategy;
      }),
      delete: Effect.fn(function* () {
        yield* Effect.void;
      }),
    })),
  );

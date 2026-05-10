import { isResolved } from "alchemy/Diff";
import type { InputProps } from "alchemy/Input";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "./Providers.ts";
import type { DeploymentStrategy, TraefikBlueGreenWeightedConfig } from "./types.ts";

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
      readonly traefik?: TraefikBlueGreenWeightedConfig;
    },
  ) => DeploymentResource(id, { mode: "blue-green", ...props } as InputProps<DeploymentProps>),
  Native: (id: string, props?: { readonly kind?: "rolling" | "restart" }) => {
    const kind: "rolling" | "restart" = props?.kind ?? "restart";
    return DeploymentResource(id, { mode: "native", kind } as InputProps<DeploymentProps>);
  },
  Recreate: (id: string) =>
    DeploymentResource(id, { mode: "recreate" } as InputProps<DeploymentProps>),
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
        if (!isResolved(news)) return;
        if (!isResolved(olds)) return;
        if (JSON.stringify(olds) === JSON.stringify(news)) return;
        return { action: "update" } as const;
      }),
      read: Effect.fn(function* ({ output }) {
        return output;
      }),
      reconcile: Effect.fn(function* ({ news }) {
        if (!isResolved(news)) {
          return yield* Effect.die(
            new Error("Crucible.Dokploy.Deployment: unresolved props at reconcile"),
          );
        }
        return news;
      }),
      delete: Effect.fn(function* () {
        yield* Effect.void;
      }),
    })),
  );

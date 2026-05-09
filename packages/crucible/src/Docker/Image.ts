import { hasUnresolvedInputs } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import type { Providers } from "../Dokploy/Providers.ts";

export type ImageProps = {
  readonly kind: "tag" | "digest";
  /** Full reference, e.g. `postgres:16-alpine` or `repo/app@sha256:…`. */
  readonly value: string;
};

const formatDockerImageRef = (p: ImageProps): string => (p.kind === "tag" ? p.value : p.value);

const slugLogicalId = (ref: string) =>
  ref
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "image";

/** Logical resource backing Docker image refs. */
export type DockerImageShape = Resource<
  "Crucible.Docker.Image",
  ImageProps,
  { readonly dockerImage: string },
  never,
  Providers
>;

/** Register with {@link ImageProvider}. */
export const DockerImage = Resource<DockerImageShape>("Crucible.Docker.Image");

export const ImageProvider = () =>
  Provider.effect(
    DockerImage,
    Effect.sync(() => ({
      stables: ["dockerImage"],
      diff: Effect.fn(function* ({ news, output }) {
        yield* Effect.void;
        if (news === undefined || hasUnresolvedInputs(news)) return undefined;
        const n = news as ImageProps;
        const resolved = formatDockerImageRef(n);
        if (output !== undefined && resolved !== output.dockerImage)
          return { action: "update" } as const;
        return undefined;
      }),
      read: Effect.fn(function* ({ output }) {
        yield* Effect.void;
        return output ?? undefined;
      }),
      reconcile: Effect.fn(function* ({ news }) {
        if (news === undefined || hasUnresolvedInputs(news)) {
          return yield* Effect.die(
            new Error("Crucible.Docker.Image: unresolved props at reconcile"),
          );
        }
        const n = news as ImageProps;
        return { dockerImage: formatDockerImageRef(n) };
      }),
      delete: Effect.fn(function* () {
        yield* Effect.void;
      }),
    })),
  );

export const ImageTag = (value: string) =>
  DockerImage(slugLogicalId(`tag-${value}`), { kind: "tag", value });

export const ImageDigest = (value: string) =>
  DockerImage(slugLogicalId(`digest-${value.slice(0, 48)}`), { kind: "digest", value });

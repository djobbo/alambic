import { ImageTag } from "../Docker/index.ts";
import { ApplicationImage, type ApplicationImageProps } from "./Application/Image.ts";
import type { ApplicationShared } from "./Application/shared.ts";
import * as Effect from "effect/Effect";
import * as NodePath from "node:path";
import { rolldown } from "rolldown";

export type WorkerProps = ApplicationShared & {
  /**
   * Path to a local module exporting a `fetch` handler for workerd.
   *
   * Example:
   * `export default { fetch() { return new Response("ok") } }`
   */
  readonly main: string;
  /** Container listen port for workerd HTTP socket. @default 8080 */
  readonly port?: number;
  /** Node image used to install/run `workerd`. @default node:24-bookworm */
  readonly image?: string;
  /**
   * Optional compatibility date written to workerd config.
   * @default 2025-01-01
   */
  readonly compatibilityDate?: string;
  /**
   * Optional extra compose-style overrides merged into the generated service.
   * Use this for env/restart/replicas/custom mounts.
   */
  readonly service?: NonNullable<ApplicationImageProps["service"]>;
};

const defaultWorkerdConfig = (entrypointFile: string, port: number, compatibilityDate: string) =>
  `
using Workerd = import "/workerd/workerd.capnp";

const app :Workerd.Worker = (
  modules = [
    (name = "worker", esModule = embed "${entrypointFile}"),
  ],
  compatibilityDate = "${compatibilityDate}",
);

const config :Workerd.Config = (
  services = [
    (name = "app", worker = .app),
  ],
  sockets = [
    (name = "http", address = "*:${port}", service = "app", http = ()),
  ],
);
`.trimStart();

type BundledOutput = {
  readonly fileName: string;
  /** UTF-8 source written via Dokploy file mounts (one API call per file avoids huge single payloads). */
  readonly content: string;
};

const bundleOutputContent = (
  output: { type: "chunk"; code: string } | { type: "asset"; source: string | Uint8Array },
): string => {
  if (output.type === "chunk") return output.code;
  const src = output.source;
  if (typeof src === "string") return src;
  return Buffer.from(src).toString("utf8");
};

const runWorkerScript = `
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status === 0) return;
  throw new Error(
    \`Alambic.Dokploy.Worker: command failed (\${command}) code=\${result.status ?? "null"} signal=\${result.signal ?? "null"}\`,
  );
};

const prefix = "/tmp/workerd-runtime";
await fs.mkdir(prefix, { recursive: true });
run("npm", [
  "install",
  "--prefix",
  prefix,
  "--no-package-lock",
  "--no-save",
  "workerd",
]);
run(prefix + "/node_modules/.bin/workerd", ["serve", "/app/workerd.capnp"]);
`.trimStart();

const bundleMain = Effect.fn(function* (main: string) {
  const bundle = yield* Effect.tryPromise({
    try: () =>
      rolldown({
        input: NodePath.resolve(main),
        platform: "browser",
        treeshake: true,
      }),
    catch: (cause) =>
      cause instanceof Error
        ? cause
        : new Error("Alambic.Dokploy.Worker: failed to initialize rolldown"),
  }).pipe(Effect.orDie);

  try {
    const generated = yield* Effect.tryPromise({
      try: () =>
        bundle.generate({
          format: "esm",
          sourcemap: false,
          exports: "named",
          entryFileNames: "worker.mjs",
          chunkFileNames: "chunks/[name]-[hash].mjs",
        }),
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : new Error("Alambic.Dokploy.Worker: failed to bundle worker main"),
    }).pipe(Effect.orDie);

    const entry = generated.output.find(
      (output): output is Extract<(typeof generated.output)[number], { type: "chunk" }> =>
        output.type === "chunk" && output.isEntry,
    );
    if (!entry) {
      return yield* Effect.die(
        new Error("Alambic.Dokploy.Worker: rolldown did not produce an entry chunk"),
      );
    }

    const files: BundledOutput[] = [];
    for (const output of generated.output) {
      if (output.type === "chunk") {
        files.push({ fileName: output.fileName, content: output.code });
      } else if (output.type === "asset") {
        files.push({ fileName: output.fileName, content: bundleOutputContent(output) });
      } else {
        return yield* Effect.die(
          new Error(
            `Alambic.Dokploy.Worker: unsupported rolldown output type: ${String((output as { type?: string }).type)}`,
          ),
        );
      }
    }

    return {
      entryFileName: entry.fileName,
      files,
    };
  } finally {
    yield* Effect.tryPromise({
      try: () => bundle.close(),
      catch: (cause) =>
        cause instanceof Error
          ? cause
          : new Error("Alambic.Dokploy.Worker: failed to close rolldown bundle"),
    }).pipe(Effect.orDie);
  }
});

/**
 * Convenience helper for deploying a local Workers-style fetch module on Dokploy via `workerd`.
 *
 * This is intentionally minimal and delegates to {@link ApplicationImage}.
 */
export const Worker = Effect.fn(function* (id: string, props: WorkerProps) {
  const bundled = yield* bundleMain(props.main);

  const port = props.port ?? 8080;
  const compatibilityDate = props.compatibilityDate ?? "2025-01-01";
  const entrypointFile = `src/${bundled.entryFileName}`;
  const workerdConfig = defaultWorkerdConfig(entrypointFile, port, compatibilityDate);
  const image = yield* ImageTag(props.image ?? "node:24-bookworm");

  const bundleVolumeMounts = bundled.files.map((f) => {
    const rel = NodePath.posix.join("src", f.fileName.split(NodePath.sep).join(NodePath.posix.sep));
    return {
      type: "file" as const,
      filePath: rel,
      content: f.content,
      mountPath: `/app/${rel}`,
    };
  });

  const baseService = {
    command: "node /app/run-worker.mjs",
    volumes: [
      {
        type: "file",
        filePath: "run-worker.mjs",
        content: runWorkerScript,
        mountPath: "/app/run-worker.mjs",
      },
      {
        type: "file",
        filePath: "workerd.capnp",
        content: workerdConfig,
        mountPath: "/app/workerd.capnp",
      },
      ...bundleVolumeMounts,
    ],
  } satisfies NonNullable<ApplicationImageProps["service"]>;

  return yield* ApplicationImage(id, {
    environment: props.environment,
    serverId: props.serverId,
    name: props.name,
    appName: props.appName,
    domains: props.domains,
    registry: props.registry,
    image,
    service: {
      ...baseService,
      ...props.service,
      volumes: [...baseService.volumes, ...(props.service?.volumes ?? [])],
    },
  });
});

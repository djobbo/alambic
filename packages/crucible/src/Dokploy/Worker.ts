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

type BundledFile = {
  readonly fileName: string;
  readonly contentBase64: string;
};

const toBase64 = (source: string | Uint8Array): string =>
  Buffer.from(typeof source === "string" ? source : source).toString("base64");

const bootstrapBundleScript = `
import fs from "node:fs/promises";
import path from "node:path";

const root = "/app/src";
const manifestPath = "/app/bundle-manifest.json";

const main = async () => {
  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);
  if (!manifest || !Array.isArray(manifest.files)) {
    throw new Error("Crucible.Dokploy.Worker: invalid bundle manifest");
  }

  for (const file of manifest.files) {
    if (!file || typeof file.fileName !== "string" || typeof file.contentBase64 !== "string") {
      throw new Error("Crucible.Dokploy.Worker: invalid bundled file entry");
    }
    const absPath = path.join(root, file.fileName);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, Buffer.from(file.contentBase64, "base64"));
  }
};

await main();
`.trimStart();

const runWorkerScript = `
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status === 0) return;
  throw new Error(
    \`Crucible.Dokploy.Worker: command failed (\${command}) code=\${result.status ?? "null"} signal=\${result.signal ?? "null"}\`,
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
run("node", ["/app/bootstrap-bundle.mjs"]);
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
        : new Error("Crucible.Dokploy.Worker: failed to initialize rolldown"),
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
          : new Error("Crucible.Dokploy.Worker: failed to bundle worker main"),
    }).pipe(Effect.orDie);

    const entry = generated.output.find(
      (output): output is Extract<(typeof generated.output)[number], { type: "chunk" }> =>
        output.type === "chunk" && output.isEntry,
    );
    if (!entry) {
      return yield* Effect.die(
        new Error("Crucible.Dokploy.Worker: rolldown did not produce an entry chunk"),
      );
    }

    const files: BundledFile[] = generated.output.map((output) => {
      if (output.type === "chunk") {
        return {
          fileName: output.fileName,
          contentBase64: toBase64(output.code),
        };
      }
      return {
        fileName: output.fileName,
        contentBase64: toBase64(output.source),
      };
    });

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
          : new Error("Crucible.Dokploy.Worker: failed to close rolldown bundle"),
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

  const bundleManifest = JSON.stringify({ files: bundled.files });

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
        filePath: "bootstrap-bundle.mjs",
        content: bootstrapBundleScript,
        mountPath: "/app/bootstrap-bundle.mjs",
      },
      {
        type: "file",
        filePath: "bundle-manifest.json",
        content: bundleManifest,
        mountPath: "/app/bundle-manifest.json",
      },
      {
        type: "file",
        filePath: "workerd.capnp",
        content: workerdConfig,
        mountPath: "/app/workerd.capnp",
      },
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

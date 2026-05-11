import * as Core from "alchemy/Test/Core";
import type { StackServices } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { describe, expect, test } from "vite-plus/test";

import { ImageTag } from "../src/Docker/index.ts";
import {
  Application,
  Domain,
  Environment,
  Project,
  Worker,
  testProviders,
} from "../src/Dokploy/index.ts";

/**
 * Same lifecycle as `Test.make(...).test.provider`, but routed through
 * {@link Core.run} so we avoid `@effect/vitest`'s `it.live` (Vitest + Vite+
 * collection can throw “failed to find the current suite”).
 */
const testOptions = {
  providers: testProviders() as Layer.Layer<
    Layer.Success<ReturnType<typeof testProviders>>,
    never,
    StackServices
  >,
};

describe("Crucible.Dokploy.Application", () => {
  test("create project + env + app, update image, destroy", async () => {
    const scratch = Core.scratchStack(testOptions, "project env application lifecycle");

    const program = Effect.gen(function* () {
      const v1 = yield* scratch.deploy(
        Effect.gen(function* () {
          const proj = yield* Project("infra");
          const env = yield* Environment("staging", {
            project: proj,
          });

          const image = yield* ImageTag("nginx:alpine");
          return yield* Application.Image("web", {
            environment: env,
            image,
          });
        }),
      );

      expect(v1.dockerImage).toBe("nginx:alpine");
      expect(v1.applicationId.startsWith("mem-")).toBe(true);

      const v2 = yield* scratch.deploy(
        Effect.gen(function* () {
          const proj = yield* Project("infra");
          const env = yield* Environment("staging", {
            project: proj,
          });

          const image = yield* ImageTag("nginx:1.27");
          return yield* Application.Image("web", {
            environment: env,
            image,
          });
        }),
      );

      expect(v2.applicationId).toBe(v1.applicationId);
      expect(v2.dockerImage).toBe("nginx:1.27");
      expect(v2.environmentId).toBe(v1.environmentId);

      yield* scratch.destroy();
    });

    await Core.run(Core.withProviders(program, testOptions, scratch.name), {
      ...testOptions,
      state: scratch.state,
    });
  });

  test("domains reconcile via Application props", async () => {
    const scratch = Core.scratchStack(testOptions, "application domains provider");

    const program = Effect.gen(function* () {
      const v1 = yield* scratch.deploy(
        Effect.gen(function* () {
          const proj = yield* Project("infra-domains");
          const env = yield* Environment("staging-domains", { project: proj });
          const image = yield* ImageTag("nginx:alpine");
          const appHost = yield* Domain("app-example-local", {
            host: "app.example.local",
            containerPort: 80,
            https: true,
          });
          return yield* Application.Image("web-domains", {
            environment: env,
            image,
            domains: [appHost],
          });
        }),
      );

      expect(v1.domainBindings.length).toBe(1);
      expect(v1.domainBindings[0]!.applicationId).toBe(v1.applicationId);

      const v2 = yield* scratch.deploy(
        Effect.gen(function* () {
          const proj = yield* Project("infra-domains");
          const env = yield* Environment("staging-domains", { project: proj });
          const image = yield* ImageTag("nginx:alpine");
          return yield* Application.Image("web-domains", {
            environment: env,
            image,
          });
        }),
      );

      expect(v2.domainBindings).toHaveLength(0);

      yield* scratch.destroy();
    });

    await Core.run(Core.withProviders(program, testOptions, scratch.name), {
      ...testOptions,
      state: scratch.state,
    });
  });

  test("worker helper deploys via Application.Image", async () => {
    const scratch = Core.scratchStack(testOptions, "dokploy worker helper");

    const tmpDir = await NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "crucible-worker-"));
    const workerMain = NodePath.join(tmpDir, "worker.mjs");
    await NodeFs.writeFile(
      workerMain,
      `export default { fetch() { return new Response("ok from dokploy worker"); } };`,
      "utf8",
    );

    const program = Effect.gen(function* () {
      const deployed = yield* scratch.deploy(
        Effect.gen(function* () {
          const project = yield* Project("infra-worker");
          const environment = yield* Environment("staging-worker", { project });
          return yield* Worker("edge-worker", {
            environment,
            main: workerMain,
          });
        }),
      );

      expect(deployed.applicationId.startsWith("mem-")).toBe(true);
      expect(deployed.dockerImage).toBe("node:24-bookworm");
      const compose = JSON.parse(deployed.composeFingerprint) as {
        readonly command?: string;
        readonly volumes?: ReadonlyArray<{ readonly filePath?: string; readonly content?: string }>;
      };
      expect(compose.command).toBe("node /app/run-worker.mjs");
      const workerdConfig =
        compose.volumes?.find((v) => v.filePath === "workerd.capnp")?.content ?? "";
      expect(workerdConfig).toContain(`service = "app", http = ()`);

      yield* scratch.destroy();
    });

    await Core.run(Core.withProviders(program, testOptions, scratch.name), {
      ...testOptions,
      state: scratch.state,
    });
  });
});

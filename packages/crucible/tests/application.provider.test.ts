import * as Core from "alchemy/Test/Core";
import type { StackServices } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, test } from "vite-plus/test";

import { ImageTag } from "../src/Docker/index.ts";
import {
  Application,
  Deployment,
  Environment,
  Project,
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

  test("blue-green deployment tracks slot ids and cutover", async () => {
    const scratch = Core.scratchStack(testOptions, "project env application blue-green lifecycle");

    const program = Effect.gen(function* () {
      const v1 = yield* scratch.deploy(
        Effect.gen(function* () {
          const proj = yield* Project("infra-bg");
          const env = yield* Environment("staging-bg", {
            project: proj,
          });
          const deployment = yield* Deployment.BlueGreen("bg-policy", {
            cutover: "automatic",
            initialSlot: "blue",
          });
          const image = yield* ImageTag("nginx:alpine");
          return yield* Application.Image("web-bg", {
            environment: env,
            image,
            deployment,
          });
        }),
      );

      const v2 = yield* scratch.deploy(
        Effect.gen(function* () {
          const proj = yield* Project("infra-bg");
          const env = yield* Environment("staging-bg", {
            project: proj,
          });
          const deployment = yield* Deployment.BlueGreen("bg-policy", {
            cutover: "automatic",
            initialSlot: "blue",
          });
          const image = yield* ImageTag("nginx:1.27");
          return yield* Application.Image("web-bg", {
            environment: env,
            image,
            deployment,
          });
        }),
      );

      expect(v1.activeSlot).toBe("green");
      expect(v2.activeSlot).toBe("blue");
      expect(v2.blueApplicationId).toBeDefined();
      expect(v2.greenApplicationId).toBeDefined();
      expect(v2.dockerImage).toBe("nginx:1.27");

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
          return yield* Application.Image("web-domains", {
            environment: env,
            image,
            domains: [{ host: "app.example.local", containerPort: 80, https: true }],
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
});

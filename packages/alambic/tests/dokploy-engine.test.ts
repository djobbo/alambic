import { describe, expect, test } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { DokployEngine, DokployEngineInMemoryLive } from "../src/Dokploy/DokployEngine.ts";
import { DokployConnection } from "@alambic/dokploy-api";

/** Provides HTTP client + connection stubs so engine effects satisfy their declared requirements. */
const dokployInMemoryTestLayer = Layer.mergeAll(
  DokployEngineInMemoryLive,
  FetchHttpClient.layer,
  Layer.succeed(DokployConnection, {
    baseUrl: "http://127.0.0.1:9",
    apiKey: Redacted.make("unused"),
  }),
);

describe("DokployEngine in-memory", () => {
  test("creates with mem- app id and finds snapshot", async () => {
    const program = Effect.gen(function* () {
      const engine = yield* DokployEngine;
      const created = yield* engine.upsertDockerApplication({
        applicationId: undefined,
        environmentId: "env-a",
        serverId: undefined,
        name: "web",
        appName: "web-app",
        dockerImage: "nginx:alpine",
        registry: undefined,
      });
      const found = yield* engine.findByApplicationId(created.applicationId);
      return { created, found };
    });

    const out = await Effect.runPromise(program.pipe(Effect.provide(dokployInMemoryTestLayer)));

    expect(out.created.applicationId).toBe("mem-web-app");
    expect(out.created.dockerImage).toBe("nginx:alpine");
    expect(Option.isSome(out.found)).toBe(true);
    if (Option.isSome(out.found)) {
      expect(out.found.value.dockerImage).toBe("nginx:alpine");
      expect(out.found.value.environmentId).toBe("env-a");
    }
  });

  test("updates existing application id in place", async () => {
    const program = Effect.gen(function* () {
      const engine = yield* DokployEngine;
      const v1 = yield* engine.upsertDockerApplication({
        applicationId: undefined,
        environmentId: "env-a",
        serverId: undefined,
        name: "web",
        appName: "svc",
        dockerImage: "nginx:alpine",
        registry: undefined,
      });
      const v2 = yield* engine.upsertDockerApplication({
        applicationId: v1.applicationId,
        environmentId: "env-a",
        serverId: undefined,
        name: "web",
        appName: "svc",
        dockerImage: "nginx:1.27",
        registry: undefined,
      });
      return { v1, v2 };
    });

    const out = await Effect.runPromise(program.pipe(Effect.provide(dokployInMemoryTestLayer)));

    expect(out.v2.applicationId).toBe(out.v1.applicationId);
    expect(out.v2.dockerImage).toBe("nginx:1.27");
  });

  test("delete removes snapshot", async () => {
    const program = Effect.gen(function* () {
      const engine = yield* DokployEngine;
      const created = yield* engine.upsertDockerApplication({
        applicationId: undefined,
        environmentId: "env-a",
        serverId: undefined,
        name: "x",
        appName: "gone",
        dockerImage: "alpine:3",
        registry: undefined,
      });
      yield* engine.deleteApplication(created.applicationId);
      return yield* engine.findByApplicationId(created.applicationId);
    });

    const found = await Effect.runPromise(program.pipe(Effect.provide(dokployInMemoryTestLayer)));

    expect(Option.isNone(found)).toBe(true);
  });

  test("project and environment upserts are stable by stored id", async () => {
    const program = Effect.gen(function* () {
      const engine = yield* DokployEngine;
      const p = yield* engine.upsertProject({
        projectId: undefined,
        name: "my-proj",
        description: "a",
      });
      const e1 = yield* engine.upsertEnvironment({
        environmentId: undefined,
        projectId: p.projectId,
        name: "staging",
      });
      const e2 = yield* engine.upsertEnvironment({
        environmentId: e1.environmentId,
        projectId: p.projectId,
        name: "staging",
        description: "b",
      });
      return { p, e1, e2 };
    });

    const out = await Effect.runPromise(program.pipe(Effect.provide(dokployInMemoryTestLayer)));

    expect(out.e2.environmentId).toBe(out.e1.environmentId);
    expect(out.e2.description).toBe("b");
  });

  test("application domain create list update delete", async () => {
    const program = Effect.gen(function* () {
      const engine = yield* DokployEngine;
      const app = yield* engine.upsertDockerApplication({
        applicationId: undefined,
        environmentId: "env-a",
        serverId: undefined,
        name: "web",
        appName: "dom-app",
        dockerImage: "nginx:alpine",
        registry: undefined,
      });
      const { domainId } = yield* engine.createApplicationDomain({
        applicationId: app.applicationId,
        host: "api.example.test",
        path: "/v1/",
        port: 8080,
        internalPath: "/",
        stripPath: true,
        https: true,
        certificateType: "letsencrypt",
        middlewares: ["mw-a"],
        domainType: "application",
      });
      const listed = yield* engine.listDomainsByApplicationId(app.applicationId);
      yield* engine.updateApplicationDomain({
        domainId,
        host: "api.example.test",
        path: "/v2/",
        port: 8080,
        internalPath: "/",
        stripPath: true,
        https: false,
        certificateType: "none",
        middlewares: [],
        domainType: "application",
      });
      const afterUpdate = yield* engine.listDomainsByApplicationId(app.applicationId);
      yield* engine.deleteDomain(domainId);
      const empty = yield* engine.listDomainsByApplicationId(app.applicationId);
      return { listed, afterUpdate, empty, domainId };
    });

    const out = await Effect.runPromise(program.pipe(Effect.provide(dokployInMemoryTestLayer)));

    expect(out.listed).toHaveLength(1);
    expect(out.listed[0]!.domainId).toBe(out.domainId);
    expect(out.afterUpdate[0]?.path).toBe("/v2/");
    expect(out.afterUpdate[0]?.https).toBe(false);
    expect(out.empty).toHaveLength(0);
  });

  test("application delete clears attached domains", async () => {
    const program = Effect.gen(function* () {
      const engine = yield* DokployEngine;
      const app = yield* engine.upsertDockerApplication({
        applicationId: undefined,
        environmentId: "env-a",
        serverId: undefined,
        name: "web",
        appName: "dom-gone",
        dockerImage: "nginx:alpine",
        registry: undefined,
      });
      yield* engine.createApplicationDomain({
        applicationId: app.applicationId,
        host: "x.example",
        domainType: "application",
      });
      yield* engine.deleteApplication(app.applicationId);
      const listed = yield* engine.listDomainsByApplicationId(app.applicationId);
      return listed;
    });

    const listed = await Effect.runPromise(program.pipe(Effect.provide(dokployInMemoryTestLayer)));
    expect(listed).toHaveLength(0);
  });

  test("project delete cascades environments in memory store", async () => {
    const program = Effect.gen(function* () {
      const engine = yield* DokployEngine;
      const p = yield* engine.upsertProject({ projectId: undefined, name: "cascade" });
      const e = yield* engine.upsertEnvironment({
        environmentId: undefined,
        projectId: p.projectId,
        name: "uat",
      });
      yield* engine.deleteProject(p.projectId);
      const foundEnv = yield* engine.findByEnvironmentId(e.environmentId);
      return foundEnv;
    });

    const found = await Effect.runPromise(program.pipe(Effect.provide(dokployInMemoryTestLayer)));

    expect(Option.isNone(found)).toBe(true);
  });
});

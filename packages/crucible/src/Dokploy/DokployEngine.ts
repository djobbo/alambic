import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import type { DeploymentStrategy } from "./types.ts";
import { DokployApiError } from "./errors.ts";

/** Resolved snapshot returned by {@link DokployEngine.Service.findByApplicationId}. */
export interface DokployApplicationSnapshot {
  readonly applicationId: string;
  readonly name: string;
  readonly appName: string;
  readonly dockerImage: string;
  readonly environmentId: string;
  readonly serverId: string | undefined;
}

export interface UpsertDockerApplicationInput {
  readonly applicationId: string | undefined;
  readonly environmentId: string;
  readonly serverId: string | undefined;
  readonly name: string;
  readonly appName: string;
  readonly dockerImage: string;
  readonly registry:
    | {
        readonly username?: string;
        readonly password?: Redacted.Redacted<string>;
        readonly registryUrl?: string;
      }
    | undefined;
  readonly deployment: DeploymentStrategy;
}

export class DokployEngine extends Context.Tag("@crucible/Dokploy/DokployEngine")<
  DokployEngine,
  DokployEngine.Service
>() {}

export namespace DokployEngine {
  export interface Service {
    readonly upsertDockerApplication: (
      input: UpsertDockerApplicationInput,
    ) => Effect.Effect<DokployApplicationSnapshot, DokployApiError>;

    readonly deleteApplication: (applicationId: string) => Effect.Effect<void, DokployApiError>;

    readonly findByApplicationId: (
      applicationId: string,
    ) => Effect.Effect<Option.Option<DokployApplicationSnapshot>, DokployApiError>;
  }
}

export class DokployConnection extends Context.Tag("@crucible/Dokploy/DokployConnection")<
  DokployConnection,
  {
    readonly baseUrl: string;
    readonly apiKey: Redacted.Redacted<string>;
  }
>() {}

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, "");

/** Walk nested JSON for the first string value at `applicationId` or `id`. */
const extractApplicationId = (body: unknown): string | undefined => {
  const walk = (node: unknown): string | undefined => {
    if (node === null || node === undefined) return undefined;
    if (typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const x of node) {
        const v = walk(x);
        if (v) return v;
      }
      return undefined;
    }
    const o = node as Record<string, unknown>;
    const aid = o.applicationId;
    if (typeof aid === "string" && aid.length > 0) return aid;
    const id = o.id;
    if (typeof id === "string" && id.length > 0 && id.startsWith("cm")) return id;
    for (const v of Object.values(o)) {
      const nested = walk(v);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(body);
};

const extractDockerImage = (body: unknown): string | undefined => {
  const walk = (node: unknown): string | undefined => {
    if (node === null || node === undefined) return undefined;
    if (typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const x of node) {
        const v = walk(x);
        if (v) return v;
      }
      return undefined;
    }
    const o = node as Record<string, unknown>;
    const di = o.dockerImage;
    if (typeof di === "string" && di.length > 0) return di;
    for (const v of Object.values(o)) {
      const nested = walk(v);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(body);
};

const decodeJson = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.gen(function* () {
    const text = yield* response.text;
    if (!text || text.trim() === "") return {} as unknown;
    return yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (e) =>
        new DokployApiError({
          message: `Invalid JSON from Dokploy: ${String(e)}`,
          status: response.status,
          body: text,
        }),
    });
  });

const postApplication = (path: string, body: Record<string, unknown>) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const conn = yield* DokployConnection;
    const url = `${normalizeBaseUrl(conn.baseUrl)}/api/${path}`;
    const req = HttpClientRequest.post(url, {
      body: yield* HttpClientRequest.bodyJson(body),
    }).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.setHeader("x-api-key", Redacted.value(conn.apiKey)),
    );
    const res = yield* client.execute(req);
    if (res.status >= 400) {
      const parsed = yield* decodeJson(res).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      return yield* Effect.fail(
        new DokployApiError({
          message: `Dokploy POST ${path} failed`,
          status: res.status,
          path,
          body: parsed,
        }),
      );
    }
    return yield* decodeJson(res);
  });

const getApplicationJson = (applicationId: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const conn = yield* DokployConnection;
    const base = normalizeBaseUrl(conn.baseUrl);
    const url = `${base}/api/application.one?applicationId=${encodeURIComponent(applicationId)}`;
    const req = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeader("x-api-key", Redacted.value(conn.apiKey)),
    );
    const res = yield* client.execute(req);
    if (res.status === 404) return undefined;
    if (res.status >= 400) {
      const parsed = yield* decodeJson(res).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      return yield* Effect.fail(
        new DokployApiError({
          message: "Dokploy GET application.one failed",
          status: res.status,
          path: "application.one",
          body: parsed,
        }),
      );
    }
    return yield* decodeJson(res);
  });

const deployAction = (strategy: DeploymentStrategy, applicationId: string) =>
  strategy.mode === "recreate"
    ? postApplication("application.redeploy", { applicationId })
    : postApplication("application.deploy", { applicationId });

/**
 * In-memory Dokploy simulation for {@link test.provider} lifecycle tests.
 */
export const DokployEngineInMemoryLive = Layer.sync(DokployEngine, () => {
  const store = new Map<string, DokployApplicationSnapshot>();

  const service: DokployEngine.Service = {
    upsertDockerApplication: Effect.fn(function* (input) {
      yield* Effect.void;
      const existingId = input.applicationId;
      if (existingId && store.has(existingId)) {
        const prev = store.get(existingId)!;
        const next: DokployApplicationSnapshot = {
          ...prev,
          name: input.name,
          appName: input.appName,
          dockerImage: input.dockerImage,
          environmentId: input.environmentId,
          serverId: input.serverId,
        };
        store.set(existingId, next);
        yield* deployAction(input.deployment, existingId);
        return next;
      }
      const applicationId = existingId ?? `mem-${input.appName}`;
      const snap: DokployApplicationSnapshot = {
        applicationId,
        name: input.name,
        appName: input.appName,
        dockerImage: input.dockerImage,
        environmentId: input.environmentId,
        serverId: input.serverId,
      };
      store.set(applicationId, snap);
      yield* deployAction(input.deployment, applicationId);
      return snap;
    }),

    deleteApplication: Effect.fn(function* (applicationId) {
      yield* Effect.void;
      store.delete(applicationId);
    }),

    findByApplicationId: Effect.fn(function* (applicationId) {
      yield* Effect.void;
      return Option.fromNullable(store.get(applicationId));
    }),
  };

  return service;
});

/**
 * HTTP-backed engine targeting Dokploy `POST /api/application.*` endpoints.
 */
export const DokployEngineHttpLive = Layer.effect(
  DokployEngine,
  Effect.gen(function* () {
    const service: DokployEngine.Service = {
      upsertDockerApplication: Effect.fn(function* (input) {
        let applicationId = input.applicationId;

        if (!applicationId) {
          const created = yield* postApplication("application.create", {
            name: input.name,
            appName: input.appName,
            environmentId: input.environmentId,
            serverId: input.serverId ?? null,
          });
          applicationId = extractApplicationId(created);
          if (!applicationId) {
            return yield* Effect.fail(
              new DokployApiError({
                message:
                  "application.create succeeded but no applicationId was found in the JSON body — check Dokploy API version",
                body: created,
              }),
            );
          }
        }

        const registryBody: Record<string, unknown> = {
          applicationId,
          dockerImage: input.dockerImage,
        };
        if (input.registry?.username) registryBody.username = input.registry.username;
        if (input.registry?.password)
          registryBody.password = Redacted.value(input.registry.password);
        if (input.registry?.registryUrl) registryBody.registryUrl = input.registry.registryUrl;

        yield* postApplication("application.saveDockerProvider", registryBody);

        yield* deployAction(input.deployment, applicationId);

        const json = yield* getApplicationJson(applicationId);
        const dockerImage = extractDockerImage(json) ?? input.dockerImage ?? "";

        return {
          applicationId,
          name: input.name,
          appName: input.appName,
          dockerImage,
          environmentId: input.environmentId,
          serverId: input.serverId,
        } satisfies DokployApplicationSnapshot;
      }),

      deleteApplication: Effect.fn(function* (applicationId) {
        yield* postApplication("application.delete", { applicationId });
      }),

      findByApplicationId: Effect.fn(function* (applicationId) {
        const json = yield* getApplicationJson(applicationId);
        if (json === undefined) return Option.none();
        const dockerImage = extractDockerImage(json) ?? "";
        return Option.some({
          applicationId,
          name: extractDockerImage(json) ? applicationId : applicationId,
          appName: applicationId,
          dockerImage,
          environmentId: "",
          serverId: undefined,
        } satisfies DokployApplicationSnapshot);
      }),
    };

    return service;
  }),
);

export const DokployConnectionFromEnvLive = Layer.sync(DokployConnection, () => ({
  baseUrl: process.env.DOKPLOY_URL ?? "http://127.0.0.1:3000",
  apiKey: Redacted.make(process.env.DOKPLOY_API_KEY ?? ""),
}));

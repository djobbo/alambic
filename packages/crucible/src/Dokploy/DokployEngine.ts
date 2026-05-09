import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Config from "effect/Config";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { HttpClientError } from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import type { DeploymentStrategy } from "./types.ts";
import { DokployApiError } from "./errors.ts";
import {
  mergeComposeEnvParts,
  restartComposeToSwarm,
  type DockerComposePort,
  type DockerComposeService,
  type DockerComposeVolume,
} from "./dockerCompose.ts";

/** Resolved snapshot returned by {@link DokployEngineShape.findByApplicationId}. */
export interface DokployApplicationSnapshot {
  readonly applicationId: string;
  readonly name: string;
  readonly appName: string;
  readonly dockerImage: string;
  readonly environmentId: string;
  readonly serverId: string | undefined;
}

export interface DokployProjectSnapshot {
  readonly projectId: string;
  readonly name: string;
  readonly description: string | undefined;
}

export interface DokployEnvironmentSnapshot {
  readonly environmentId: string;
  readonly projectId: string;
  readonly name: string;
  readonly description: string | undefined;
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
  /**
   * Optional compose-shaped options (maps to Dokploy `saveEnvironment`, `application.update`,
   * and optional `port` / `mount` writes).
   */
  readonly compose?: DockerComposeService;
}

export interface UpsertProjectInput {
  readonly projectId: string | undefined;
  readonly name: string;
  readonly description?: string | null;
}

export interface UpsertEnvironmentInput {
  readonly environmentId: string | undefined;
  readonly projectId: string;
  readonly name: string;
  readonly description?: string;
}

type DokployEngineRequirements = DokployConnectionShape | HttpClient.HttpClient;

/** Dokploy automation facade — HTTP or in-memory (tests). See `.repos/effect` Context.Service. */
export interface DokployEngineShape {
  readonly upsertDockerApplication: (
    input: UpsertDockerApplicationInput,
  ) => Effect.Effect<
    DokployApplicationSnapshot,
    DokployApiError | HttpClientError,
    DokployEngineRequirements
  >;

  readonly deleteApplication: (
    applicationId: string,
  ) => Effect.Effect<void, DokployApiError | HttpClientError, DokployEngineRequirements>;

  readonly findByApplicationId: (
    applicationId: string,
  ) => Effect.Effect<
    Option.Option<DokployApplicationSnapshot>,
    DokployApiError | HttpClientError,
    DokployEngineRequirements
  >;

  readonly upsertProject: (
    input: UpsertProjectInput,
  ) => Effect.Effect<
    DokployProjectSnapshot,
    DokployApiError | HttpClientError,
    DokployEngineRequirements
  >;

  readonly deleteProject: (
    projectId: string,
  ) => Effect.Effect<void, DokployApiError | HttpClientError, DokployEngineRequirements>;

  readonly findByProjectId: (
    projectId: string,
  ) => Effect.Effect<
    Option.Option<DokployProjectSnapshot>,
    DokployApiError | HttpClientError,
    DokployEngineRequirements
  >;

  readonly upsertEnvironment: (
    input: UpsertEnvironmentInput,
  ) => Effect.Effect<
    DokployEnvironmentSnapshot,
    DokployApiError | HttpClientError,
    DokployEngineRequirements
  >;

  readonly deleteEnvironment: (
    environmentId: string,
  ) => Effect.Effect<void, DokployApiError | HttpClientError, DokployEngineRequirements>;

  readonly findByEnvironmentId: (
    environmentId: string,
  ) => Effect.Effect<
    Option.Option<DokployEnvironmentSnapshot>,
    DokployApiError | HttpClientError,
    DokployEngineRequirements
  >;

  readonly listEnvironmentsByProjectId: (
    projectId: string,
  ) => Effect.Effect<
    ReadonlyArray<DokployEnvironmentSnapshot>,
    DokployApiError | HttpClientError,
    DokployEngineRequirements
  >;
}

export const DokployEngine = Context.Service<DokployEngineShape>("@crucible/Dokploy/DokployEngine");

export interface DokployConnectionShape {
  readonly baseUrl: string;
  readonly apiKey: Redacted.Redacted<string>;
}

export const DokployConnection = Context.Service<DokployConnectionShape>(
  "@crucible/Dokploy/DokployConnection",
);

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, "");

/** Walk nested JSON for `applicationId` or Dokploy-style `id`. */
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
    if (typeof id === "string" && id.length > 0) return id;
    for (const v of Object.values(o)) {
      const nested = walk(v);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(body);
};

const extractProjectId = (body: unknown): string | undefined => {
  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    const nested = o.project;
    if (nested && typeof nested === "object") {
      const pid = (nested as Record<string, unknown>).projectId;
      if (typeof pid === "string" && pid.length > 0) return pid;
    }
  }
  return extractStringField(body, "projectId");
};

const extractEnvironmentId = (body: unknown): string | undefined => {
  if (typeof body === "object" && body !== null) {
    const o = body as Record<string, unknown>;
    const nested = o.environment;
    if (nested && typeof nested === "object") {
      const eid = (nested as Record<string, unknown>).environmentId;
      if (typeof eid === "string" && eid.length > 0) return eid;
    }
  }
  return extractStringField(body, "environmentId");
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

const extractStringField = (body: unknown, field: string): string | undefined => {
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
    const v = o[field];
    if (typeof v === "string" && v.length > 0) return v;
    for (const x of Object.values(o)) {
      const nested = walk(x);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(body);
};

const snapshotFromEnvironmentJson = (
  json: unknown,
  fallbackProjectId?: string,
): DokployEnvironmentSnapshot | undefined => {
  if (typeof json !== "object" || json === null) return undefined;
  const o = json as Record<string, unknown>;
  const environmentId = typeof o.environmentId === "string" ? o.environmentId : undefined;
  const projectId =
    (typeof o.projectId === "string" ? o.projectId : undefined) ?? fallbackProjectId;
  const name = typeof o.name === "string" ? o.name : undefined;
  if (!environmentId || !projectId || !name) return undefined;
  const description = typeof o.description === "string" ? o.description : undefined;
  return { environmentId, projectId, name, description };
};

const parseEnvironmentListJson = (raw: unknown): ReadonlyArray<DokployEnvironmentSnapshot> => {
  const tryRow = (row: unknown, projectIdHint?: string): DokployEnvironmentSnapshot | undefined =>
    snapshotFromEnvironmentJson(row, projectIdHint);

  const fromArray = (arr: ReadonlyArray<unknown>, projectIdHint?: string) =>
    arr
      .map((row) => tryRow(row, projectIdHint))
      .filter((x): x is DokployEnvironmentSnapshot => x !== undefined);

  if (Array.isArray(raw)) return fromArray(raw);

  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["json", "items", "environments", "data", "result"]) {
      const v = o[k];
      if (Array.isArray(v)) return fromArray(v);
    }
  }
  return [];
};

const snapshotFromProjectJson = (json: unknown): DokployProjectSnapshot | undefined => {
  if (typeof json !== "object" || json === null) return undefined;
  const o = json as Record<string, unknown>;
  const projectId = typeof o.projectId === "string" ? o.projectId : undefined;
  const name = typeof o.name === "string" ? o.name : undefined;
  if (!projectId || !name) return undefined;
  let description: string | undefined;
  if (typeof o.description === "string") description = o.description;
  return { projectId, name, description };
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

const safeDecodeUnknown = (res: HttpClientResponse.HttpClientResponse) =>
  Effect.match(decodeJson(res), {
    onFailure: () => undefined as unknown,
    onSuccess: (x) => x,
  });

const dokployPost = (path: string, body: Record<string, unknown>) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const conn = yield* DokployConnection;
    const url = `${normalizeBaseUrl(conn.baseUrl)}/api/${path}`;
    const req = HttpClientRequest.post(url, {
      body: HttpBody.jsonUnsafe(body),
    }).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.setHeader("x-api-key", Redacted.value(conn.apiKey)),
    );
    const res = yield* client.execute(req);
    if (res.status >= 400) {
      const parsed = yield* safeDecodeUnknown(res);
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

const dokployPostAllow404 = (path: string, body: Record<string, unknown>) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const conn = yield* DokployConnection;
    const url = `${normalizeBaseUrl(conn.baseUrl)}/api/${path}`;
    const req = HttpClientRequest.post(url, {
      body: HttpBody.jsonUnsafe(body),
    }).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.setHeader("x-api-key", Redacted.value(conn.apiKey)),
    );
    const res = yield* client.execute(req);
    if (res.status === 404) return;
    if (res.status >= 400) {
      const parsed = yield* safeDecodeUnknown(res);
      return yield* Effect.fail(
        new DokployApiError({
          message: `Dokploy POST ${path} failed`,
          status: res.status,
          path,
          body: parsed,
        }),
      );
    }
    yield* decodeJson(res);
  });

const dokployGet = (path: string, query: Record<string, string>) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const conn = yield* DokployConnection;
    const base = normalizeBaseUrl(conn.baseUrl);
    const qs = new URLSearchParams(query).toString();
    const url = `${base}/api/${path}${qs.length > 0 ? `?${qs}` : ""}`;
    const req = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeader("x-api-key", Redacted.value(conn.apiKey)),
    );
    const res = yield* client.execute(req);
    if (res.status === 404) return undefined;
    if (res.status >= 400) {
      const parsed = yield* safeDecodeUnknown(res);
      return yield* Effect.fail(
        new DokployApiError({
          message: `Dokploy GET ${path} failed`,
          status: res.status,
          path,
          body: parsed,
        }),
      );
    }
    return yield* decodeJson(res);
  });

const getApplicationJson = (applicationId: string) =>
  dokployGet("application.one", { applicationId });

type PortWire = {
  portId?: string;
  publishedPort: number;
  targetPort: number;
};

const extractPortsFromApplication = (body: unknown): PortWire[] => {
  if (!body || typeof body !== "object") return [];
  const ports = (body as Record<string, unknown>).ports;
  if (!Array.isArray(ports)) return [];
  const out: PortWire[] = [];
  for (const row of ports) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const published = o.publishedPort;
    const target = o.targetPort;
    if (typeof published !== "number" || typeof target !== "number") continue;
    out.push({
      portId: typeof o.portId === "string" ? o.portId : undefined,
      publishedPort: published,
      targetPort: target,
    });
  }
  return out;
};

type MountWire = {
  mountId?: string;
  type?: string;
  mountPath: string;
};

const extractMountsFromApplication = (body: unknown): MountWire[] => {
  if (!body || typeof body !== "object") return [];
  const mounts = (body as Record<string, unknown>).mounts;
  if (!Array.isArray(mounts)) return [];
  const out: MountWire[] = [];
  for (const row of mounts) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const mountPath = typeof o.mountPath === "string" ? o.mountPath : undefined;
    if (!mountPath) continue;
    out.push({
      mountId: typeof o.mountId === "string" ? o.mountId : undefined,
      type: typeof o.type === "string" ? o.type : undefined,
      mountPath,
    });
  }
  return out;
};

const mergeApplicationUpdateFromCompose = (
  applicationId: string,
  compose: DockerComposeService,
): Record<string, unknown> | undefined => {
  const body: Record<string, unknown> = { applicationId };
  if (compose.command !== undefined) body.command = compose.command;
  if (compose.args !== undefined) body.args = [...compose.args];
  if (compose.restart !== undefined)
    body.restartPolicySwarm = restartComposeToSwarm(compose.restart);
  if (compose.replicas !== undefined) body.replicas = compose.replicas;
  if (compose.rawUpdate !== undefined) {
    for (const [k, v] of Object.entries(compose.rawUpdate)) {
      if (k === "applicationId") continue;
      body[k] = v;
    }
  }
  return Object.keys(body).length > 1 ? body : undefined;
};

const replaceApplicationPorts = (
  applicationId: string,
  desired: ReadonlyArray<DockerComposePort>,
  appJson: unknown,
) =>
  Effect.gen(function* () {
    const existing = extractPortsFromApplication(appJson);
    for (const p of existing) {
      if (typeof p.portId === "string" && p.portId.length > 0) {
        yield* dokployPost("port.delete", { portId: p.portId });
      }
    }
    for (const d of desired) {
      yield* dokployPost("port.create", {
        applicationId,
        publishedPort: d.published,
        targetPort: d.target,
        protocol: d.protocol ?? "tcp",
        publishMode: d.publishMode ?? "host",
      });
    }
  });

const replaceApplicationMounts = (
  applicationId: string,
  desired: ReadonlyArray<DockerComposeVolume>,
  appJson: unknown,
) =>
  Effect.gen(function* () {
    const existing = extractMountsFromApplication(appJson);
    for (const m of existing) {
      if (typeof m.mountId === "string" && m.mountId.length > 0) {
        yield* dokployPost("mount.remove", { mountId: m.mountId });
      }
    }
    for (const v of desired) {
      const base: Record<string, unknown> = {
        serviceType: "application",
        serviceId: applicationId,
      };
      if (v.type === "bind") {
        base.type = "bind";
        base.hostPath = v.source;
        base.mountPath = v.target;
      } else if (v.type === "volume") {
        base.type = "volume";
        base.volumeName = v.volumeName;
        base.mountPath = v.target;
      } else {
        base.type = "file";
        base.mountPath = v.mountPath;
        base.filePath = v.filePath;
        base.content = v.content;
      }
      yield* dokployPost("mount.create", base);
    }
  });

/** Maps {@link DockerComposeService} to Dokploy `saveEnvironment` / `application.update` / port / mount routes. */
const applyComposeConfiguration = (
  applicationId: string,
  compose: DockerComposeService | undefined,
) =>
  Effect.gen(function* () {
    if (compose === undefined) return;

    const shouldSaveEnv =
      compose.environment !== undefined ||
      (compose.env !== undefined && compose.env.trim() !== "") ||
      compose.createEnvFile !== undefined;

    if (shouldSaveEnv) {
      const mergedEnv = mergeComposeEnvParts(compose.env, compose.environment);
      yield* dokployPost("application.saveEnvironment", {
        applicationId,
        env: mergedEnv,
        buildArgs: "",
        buildSecrets: "",
        createEnvFile: compose.createEnvFile ?? true,
      });
    }

    const update = mergeApplicationUpdateFromCompose(applicationId, compose);
    if (update !== undefined) {
      yield* dokployPost("application.update", update);
    }

    const json = yield* getApplicationJson(applicationId);

    if (compose.ports !== undefined) {
      yield* replaceApplicationPorts(applicationId, compose.ports, json ?? {});
    }
    if (compose.volumes !== undefined) {
      yield* replaceApplicationMounts(applicationId, compose.volumes, json ?? {});
    }
  });

const httpDeploy = (strategy: DeploymentStrategy, applicationId: string) =>
  strategy.mode === "recreate"
    ? dokployPost("application.redeploy", { applicationId })
    : dokployPost("application.deploy", { applicationId });

const syncProjectMetadata = (input: UpsertProjectInput, projectId: string) =>
  Effect.gen(function* () {
    const existing = yield* dokployGet("project.one", { projectId });
    const snap = snapshotFromProjectJson(existing);
    if (!snap) return;
    const descEqual = (snap.description ?? undefined) === (input.description ?? undefined);
    if (snap.name === input.name && descEqual) return;
    const body: Record<string, unknown> = { projectId, name: input.name };
    if (input.description !== undefined) body.description = input.description;
    yield* dokployPost("project.update", body);
  });

const syncEnvironmentMetadata = (input: UpsertEnvironmentInput, environmentId: string) =>
  Effect.gen(function* () {
    const existing = yield* dokployGet("environment.one", { environmentId });
    const snap = snapshotFromEnvironmentJson(existing);
    if (!snap) return;
    const descEqual = (snap.description ?? undefined) === (input.description ?? undefined);
    if (snap.name === input.name && descEqual) return;
    const body: Record<string, unknown> = {
      environmentId,
      name: input.name,
      projectId: input.projectId,
    };
    if (input.description !== undefined) body.description = input.description;
    yield* dokployPost("environment.update", body);
  });

/**
 * In-memory Dokploy simulation for {@link test.provider} lifecycle tests.
 * Does not perform HTTP (including simulated deploy).
 */
export const DokployEngineInMemoryLive = Layer.sync(DokployEngine, () => {
  const apps = new Map<string, DokployApplicationSnapshot>();
  const projects = new Map<string, DokployProjectSnapshot>();
  const environments = new Map<string, DokployEnvironmentSnapshot>();

  const findEnvByProjectAndName = (projectId: string, name: string) =>
    [...environments.values()].find((e) => e.projectId === projectId && e.name === name);

  const service: DokployEngineShape = {
    upsertDockerApplication: (input) =>
      Effect.gen(function* () {
        yield* Effect.void;
        const existingId = input.applicationId;
        if (existingId && apps.has(existingId)) {
          const prev = apps.get(existingId)!;
          const next: DokployApplicationSnapshot = {
            ...prev,
            name: input.name,
            appName: input.appName,
            dockerImage: input.dockerImage,
            environmentId: input.environmentId,
            serverId: input.serverId,
          };
          apps.set(existingId, next);
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
        apps.set(applicationId, snap);
        return snap;
      }),

    deleteApplication: (applicationId) =>
      Effect.gen(function* () {
        yield* Effect.void;
        apps.delete(applicationId);
      }),

    findByApplicationId: (applicationId) =>
      Effect.gen(function* () {
        yield* Effect.void;
        return Option.fromUndefinedOr(apps.get(applicationId));
      }),

    upsertProject: (input) =>
      Effect.gen(function* () {
        yield* Effect.void;
        let projectId = input.projectId;
        if (projectId && projects.has(projectId)) {
          const next: DokployProjectSnapshot = {
            projectId,
            name: input.name,
            description: input.description ?? undefined,
          };
          projects.set(projectId, next);
          return next;
        }
        const byName = [...projects.values()].find((p) => p.name === input.name);
        if (byName) {
          projectId = byName.projectId;
          const next: DokployProjectSnapshot = {
            projectId,
            name: input.name,
            description: input.description ?? undefined,
          };
          projects.set(projectId, next);
          return next;
        }
        const nextId = projectId ?? `mem-proj-${input.name.replace(/[^a-zA-Z0-9-]/g, "-")}`;
        const snap: DokployProjectSnapshot = {
          projectId: nextId,
          name: input.name,
          description: input.description ?? undefined,
        };
        projects.set(nextId, snap);
        return snap;
      }),

    deleteProject: (projectId) =>
      Effect.gen(function* () {
        yield* Effect.void;
        projects.delete(projectId);
        for (const [eid, e] of environments.entries()) {
          if (e.projectId === projectId) environments.delete(eid);
        }
      }),

    findByProjectId: (projectId) =>
      Effect.gen(function* () {
        yield* Effect.void;
        return Option.fromUndefinedOr(projects.get(projectId));
      }),

    upsertEnvironment: (input) =>
      Effect.gen(function* () {
        yield* Effect.void;
        let environmentId =
          input.environmentId !== undefined && environments.has(input.environmentId)
            ? input.environmentId
            : undefined;
        if (environmentId !== undefined) {
          const prev = environments.get(environmentId)!;
          if (prev.projectId !== input.projectId) {
            return yield* Effect.die(
              new Error("Dokploy in-memory: environment moved between projects (replace required)"),
            );
          }
          const next: DokployEnvironmentSnapshot = {
            environmentId,
            projectId: input.projectId,
            name: input.name,
            description: input.description ?? undefined,
          };
          environments.set(environmentId, next);
          return next;
        }
        const named = findEnvByProjectAndName(input.projectId, input.name);
        if (named) {
          environmentId = named.environmentId;
          const next: DokployEnvironmentSnapshot = {
            environmentId,
            projectId: input.projectId,
            name: input.name,
            description: input.description ?? undefined,
          };
          environments.set(environmentId, next);
          return next;
        }
        const nextId =
          environmentId ??
          `mem-env-${input.projectId.slice(0, 8)}-${input.name.replace(/[^a-zA-Z0-9-]/g, "-")}`;
        const snap: DokployEnvironmentSnapshot = {
          environmentId: nextId,
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? undefined,
        };
        environments.set(nextId, snap);
        return snap;
      }),

    deleteEnvironment: (environmentId) =>
      Effect.gen(function* () {
        yield* Effect.void;
        environments.delete(environmentId);
      }),

    findByEnvironmentId: (environmentId) =>
      Effect.gen(function* () {
        yield* Effect.void;
        return Option.fromUndefinedOr(environments.get(environmentId));
      }),

    listEnvironmentsByProjectId: (projectId) =>
      Effect.gen(function* () {
        yield* Effect.void;
        return [...environments.values()].filter((e) => e.projectId === projectId);
      }),
  };

  return service;
});

/**
 * HTTP-backed engine targeting Dokploy `/api/application.*`, `/api/project.*`, `/api/environment.*`.
 */
export const DokployEngineHttpLive = Layer.sync(
  DokployEngine,
  (): DokployEngineShape => ({
    upsertDockerApplication: (input) =>
      Effect.gen(function* () {
        let applicationId = input.applicationId;

        if (!applicationId) {
          const created = yield* dokployPost("application.create", {
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

        yield* dokployPost("application.saveDockerProvider", registryBody);

        yield* applyComposeConfiguration(applicationId, input.compose);

        yield* httpDeploy(input.deployment, applicationId);

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

    deleteApplication: (applicationId) =>
      Effect.gen(function* () {
        yield* dokployPost("application.delete", { applicationId });
      }),

    findByApplicationId: (applicationId) =>
      Effect.gen(function* () {
        const json = yield* getApplicationJson(applicationId);
        if (json === undefined) return Option.none<DokployApplicationSnapshot>();
        const dockerImage = extractDockerImage(json) ?? "";
        const name = extractStringField(json, "name") ?? applicationId;
        const appName = extractStringField(json, "appName") ?? applicationId;
        const environmentId = extractStringField(json, "environmentId") ?? "";

        return Option.some<DokployApplicationSnapshot>({
          applicationId,
          name,
          appName,
          dockerImage,
          environmentId,
          serverId: undefined,
        });
      }),

    upsertProject: (input) =>
      Effect.gen(function* () {
        let projectId = input.projectId;
        const jsonExisting =
          projectId !== undefined ? yield* dokployGet("project.one", { projectId }) : undefined;

        if (jsonExisting === undefined || snapshotFromProjectJson(jsonExisting) === undefined) {
          const created = yield* dokployPost("project.create", {
            name: input.name,
            description: input.description ?? null,
          });
          projectId = extractProjectId(created);
          if (!projectId) {
            return yield* Effect.fail(
              new DokployApiError({
                message:
                  "project.create succeeded but no projectId was found in the JSON body — check Dokploy API version",
                body: created,
              }),
            );
          }
          yield* syncProjectMetadata(input, projectId);
        } else if (projectId !== undefined) {
          yield* syncProjectMetadata(input, projectId);
        }

        const finalId = projectId!;
        const readBack = yield* dokployGet("project.one", { projectId: finalId });
        const snap =
          snapshotFromProjectJson(readBack) ??
          ({
            projectId: finalId,
            name: input.name,
            description: input.description ?? undefined,
          } satisfies DokployProjectSnapshot);
        return snap;
      }),

    deleteProject: (projectId) =>
      Effect.gen(function* () {
        yield* dokployPostAllow404("project.remove", { projectId });
      }),

    findByProjectId: (projectId) =>
      Effect.gen(function* () {
        const json = yield* dokployGet("project.one", { projectId });
        const snap = snapshotFromProjectJson(json);
        if (!snap) return Option.none<DokployProjectSnapshot>();
        return Option.some(snap);
      }),

    upsertEnvironment: (input) =>
      Effect.gen(function* () {
        let environmentId = input.environmentId;

        if (environmentId) {
          const one = yield* dokployGet("environment.one", { environmentId });
          const snapExisting = snapshotFromEnvironmentJson(one);
          if (
            snapExisting !== undefined &&
            snapExisting.projectId === input.projectId &&
            snapExisting.environmentId === environmentId
          ) {
            yield* syncEnvironmentMetadata(input, environmentId);
            const refreshed = yield* dokployGet("environment.one", { environmentId });
            return (
              snapshotFromEnvironmentJson(refreshed) ?? {
                environmentId,
                projectId: input.projectId,
                name: input.name,
                description: input.description ?? undefined,
              }
            );
          }
          if (
            snapExisting !== undefined &&
            snapExisting.projectId !== input.projectId &&
            snapExisting.environmentId === environmentId
          ) {
            return yield* Effect.fail(
              new DokployApiError({
                message:
                  "existing environment belongs to another project — replace the Environment resource instead",
              }),
            );
          }
        }

        const listJson = yield* dokployGet("environment.byProjectId", {
          projectId: input.projectId,
        });
        const list = parseEnvironmentListJson(listJson);
        const match = list.find((e) => e.name === input.name && e.projectId === input.projectId);
        if (match) {
          environmentId = match.environmentId;
          yield* syncEnvironmentMetadata(input, environmentId);
          const refreshed = yield* dokployGet("environment.one", { environmentId });
          const snapFinal = snapshotFromEnvironmentJson(refreshed);
          if (snapFinal) return snapFinal;
        }

        const created = yield* dokployPost("environment.create", {
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? "",
        });
        environmentId = extractEnvironmentId(created);
        if (!environmentId) {
          return yield* Effect.fail(
            new DokployApiError({
              message:
                "environment.create succeeded but no environmentId was found in the JSON body — check Dokploy API version",
              body: created,
            }),
          );
        }
        const refreshed = yield* dokployGet("environment.one", { environmentId });
        const snapFinal = snapshotFromEnvironmentJson(refreshed);
        if (snapFinal) return snapFinal;
        return {
          environmentId,
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? undefined,
        } satisfies DokployEnvironmentSnapshot;
      }),

    deleteEnvironment: (environmentId) =>
      Effect.gen(function* () {
        yield* dokployPostAllow404("environment.remove", { environmentId });
      }),

    findByEnvironmentId: (environmentId) =>
      Effect.gen(function* () {
        const json = yield* dokployGet("environment.one", { environmentId });
        const snap = snapshotFromEnvironmentJson(json);
        if (!snap) return Option.none<DokployEnvironmentSnapshot>();
        return Option.some(snap);
      }),

    listEnvironmentsByProjectId: (projectId) =>
      Effect.gen(function* () {
        const json = yield* dokployGet("environment.byProjectId", { projectId });
        return parseEnvironmentListJson(json).filter((e) => e.projectId === projectId);
      }),
  }),
);

export const DokployConnectionFromEnvLive = Layer.effect(
  DokployConnection,
  Effect.gen(function* () {
    const baseUrl = yield* Config.string("DOKPLOY_URL");
    const apiKey = yield* Config.string("DOKPLOY_API_KEY");

    return {
      baseUrl,
      apiKey: Redacted.make(apiKey),
    };
  }),
);

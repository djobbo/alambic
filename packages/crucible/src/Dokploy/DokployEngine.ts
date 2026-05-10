import { DokployApi } from "@crucible/dokploy-api";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Config from "effect/Config";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { HttpClientError, isHttpClientError } from "effect/unstable/http/HttpClientError";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as Schema from "effect/Schema";
import type { DeploymentStrategy } from "./types.ts";
import { DokployApiError } from "./errors.ts";
import { buildTraefikBlueGreenDynamicYaml } from "./traefikBlueGreen.ts";
import {
  expandComposeBlueGreenPlaceholder,
  mergeComposeEnvParts,
  restartComposeToSwarm,
  type DockerComposePort,
  type DockerComposeService,
  type DockerComposeVolume,
} from "./dockerCompose.ts";

export type DokployBlueGreenSlot = "blue" | "green";

/** Resolved snapshot returned by {@link DokployEngineShape.findByApplicationId}. */
export interface DokployApplicationSnapshot {
  readonly applicationId: string;
  readonly name: string;
  readonly appName: string;
  readonly dockerImage: string;
  readonly environmentId: string;
  readonly serverId: string | undefined;
  readonly activeSlot: DokployBlueGreenSlot | undefined;
  readonly blueApplicationId: string | undefined;
  readonly greenApplicationId: string | undefined;
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

/** Dokploy `domain.one` / list row shape — used by {@link DokployEngineShape.listDomainsByApplicationId}. */
export interface DokployApplicationDomainSnapshot {
  readonly domainId: string;
  readonly applicationId: string;
  readonly host: string;
  readonly path: string | null | undefined;
  readonly port: number | null | undefined;
  readonly internalPath: string | null | undefined;
  readonly stripPath: boolean;
  readonly https: boolean;
  readonly certificateType: string | undefined;
  readonly customCertResolver: string | null | undefined;
  readonly customEntrypoint: string | null | undefined;
  readonly serviceName: string | null | undefined;
  readonly middlewares: ReadonlyArray<string> | undefined;
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
  readonly blueGreen:
    | {
        readonly activeSlot: DokployBlueGreenSlot | undefined;
        readonly blueApplicationId: string | undefined;
        readonly greenApplicationId: string | undefined;
      }
    | undefined;
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

/** Dokploy automation facade — HTTP or in-memory (tests). Modeled as `Effect.Service` in `.repos/effect`. */
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

  readonly listDomainsByApplicationId: (
    applicationId: string,
  ) => Effect.Effect<
    ReadonlyArray<DokployApplicationDomainSnapshot>,
    DokployApiError | HttpClientError,
    DokployEngineRequirements
  >;

  readonly createApplicationDomain: (
    body: Record<string, unknown>,
  ) => Effect.Effect<
    { readonly domainId: string },
    DokployApiError | HttpClientError,
    DokployEngineRequirements
  >;

  readonly updateApplicationDomain: (
    body: Record<string, unknown>,
  ) => Effect.Effect<void, DokployApiError | HttpClientError, DokployEngineRequirements>;

  readonly deleteDomain: (
    domainId: string,
  ) => Effect.Effect<void, DokployApiError | HttpClientError, DokployEngineRequirements>;
}

export const DokployEngine = Context.Service<DokployEngineShape>("@crucible/Dokploy/DokployEngine");

/** OpenAPI often types 2xx as `{}`; decode real JSON from the bundled `HttpClientResponse` (cached `text`). */
const responseBodyJsonUnknown = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<unknown, HttpClientError, never> =>
  Effect.map(response.json, (body) => body as unknown);

const oppositeSlot = (slot: DokployBlueGreenSlot): DokployBlueGreenSlot =>
  slot === "blue" ? "green" : "blue";
const slotAppName = (baseAppName: string, slot: DokployBlueGreenSlot): string =>
  `${baseAppName}-${slot}`;

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

const snapshotFromDomainRow = (row: unknown): DokployApplicationDomainSnapshot | undefined => {
  if (typeof row !== "object" || row === null) return undefined;
  const o = row as Record<string, unknown>;
  const domainId = typeof o.domainId === "string" ? o.domainId : undefined;
  const applicationId = typeof o.applicationId === "string" ? o.applicationId : undefined;
  const host = typeof o.host === "string" ? o.host : undefined;
  if (!domainId || !applicationId || !host) return undefined;
  const middlewaresRaw = o.middlewares;
  const middlewares =
    Array.isArray(middlewaresRaw) && middlewaresRaw.every((x) => typeof x === "string")
      ? (middlewaresRaw as ReadonlyArray<string>)
      : undefined;

  let pathOut: string | null | undefined;
  if (typeof o.path === "string") pathOut = o.path;
  else if (o.path === null) pathOut = null;

  const portRaw = o.port;
  const port =
    typeof portRaw === "number"
      ? portRaw
      : typeof portRaw === "string"
        ? Number.parseInt(portRaw, 10)
        : undefined;

  return {
    domainId,
    applicationId,
    host,
    path: pathOut,
    port: Number.isFinite(port) ? port : undefined,
    internalPath:
      typeof o.internalPath === "string" ? o.internalPath : (o.internalPath as undefined),
    stripPath: typeof o.stripPath === "boolean" ? o.stripPath : false,
    https: typeof o.https === "boolean" ? o.https : false,
    certificateType: typeof o.certificateType === "string" ? o.certificateType : undefined,
    customCertResolver:
      typeof o.customCertResolver === "string"
        ? o.customCertResolver
        : o.customCertResolver === null
          ? null
          : undefined,
    customEntrypoint:
      typeof o.customEntrypoint === "string"
        ? o.customEntrypoint
        : o.customEntrypoint === null
          ? null
          : undefined,
    serviceName:
      typeof o.serviceName === "string" ? o.serviceName : o.serviceName === null ? null : undefined,
    middlewares,
  };
};

const parseDomainsListJson = (raw: unknown): ReadonlyArray<DokployApplicationDomainSnapshot> => {
  const fromArray = (arr: ReadonlyArray<unknown>) =>
    arr
      .map((row) => snapshotFromDomainRow(row))
      .filter((x): x is DokployApplicationDomainSnapshot => x !== undefined);

  if (Array.isArray(raw)) return fromArray(raw);

  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["json", "items", "domains", "data", "result"]) {
      const v = o[k];
      if (Array.isArray(v)) return fromArray(v);
    }
  }
  return [];
};

/** Walk nested JSON for `domainId`. */
const extractDomainId = (body: unknown): string | undefined => {
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
    const did = o.domainId;
    if (typeof did === "string" && did.length > 0) return did;
    for (const v of Object.values(o)) {
      const nested = walk(v);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(body);
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

const getApplicationJson = (applicationId: string) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    return yield* api
      .applicationOne({ params: { applicationId }, config: { includeResponse: true } })
      .pipe(
        Effect.map(([json]) => json),
        Effect.catchTag("ApplicationOne404", () => Effect.succeed(null)),
      );
  });

const optionalProjectJson = (projectId: string) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    return yield* api
      .projectOne({ params: { projectId }, config: { includeResponse: true } })
      .pipe(
        Effect.map(([json]) => json),
        Effect.catchTag("ProjectOne404", () => Effect.succeed(null)),
      );
  });

const optionalEnvironmentJson = (environmentId: string) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    return yield* api
      .environmentOne({ params: { environmentId }, config: { includeResponse: true } })
      .pipe(
        Effect.map(([json]) => json),
        Effect.catchTag("EnvironmentOne404", () => Effect.succeed(null)),
      );
  });

const environmentsByProjectJson = (projectId: string) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    return yield* api
      .environmentByProjectId({
        params: { projectId },
        config: { includeResponse: true },
      })
      .pipe(
        Effect.map(([json]) => json),
        Effect.catchTag("EnvironmentByProjectId404", () => Effect.succeed(null)),
      );
  });

const domainsByApplicationJson = (applicationId: string) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    const tup = yield* api
      .domainByApplicationId({
        params: { applicationId },
        config: { includeResponse: true },
      })
      .pipe(
        Effect.catchTag("DomainByApplicationId404", () => Effect.succeed(undefined)),
        Effect.catch(mapSdkFailure("/domain.byApplicationId", "GET")),
      );
    if (tup === undefined) return undefined as unknown;
    return yield* responseBodyJsonUnknown(tup[1]);
  });

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
    const api = yield* DokployApi;
    const existing = extractPortsFromApplication(appJson);
    for (const p of existing) {
      if (typeof p.portId === "string" && p.portId.length > 0) {
        yield* api
          .portDelete({ payload: { portId: p.portId } })
          .pipe(Effect.catch(mapSdkFailure("/port.delete", "POST")));
      }
    }
    for (const d of desired) {
      yield* api
        .portCreate({
          payload: {
            applicationId,
            publishedPort: d.published,
            targetPort: d.target,
            protocol: d.protocol ?? "tcp",
            publishMode: d.publishMode ?? "host",
          },
        })
        .pipe(Effect.catch(mapSdkFailure("/port.create", "POST")));
    }
  });

const replaceApplicationMounts = (
  applicationId: string,
  desired: ReadonlyArray<DockerComposeVolume>,
  appJson: unknown,
) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    const existing = extractMountsFromApplication(appJson);
    for (const m of existing) {
      if (typeof m.mountId === "string" && m.mountId.length > 0) {
        yield* api
          .mountsRemove({ payload: { mountId: m.mountId } })
          .pipe(Effect.catch(mapSdkFailure("/mounts.remove", "POST")));
      }
    }
    for (const v of desired) {
      const base =
        v.type === "bind"
          ? {
              serviceType: "application" as const,
              serviceId: applicationId,
              type: "bind" as const,
              hostPath: v.source,
              mountPath: v.target,
            }
          : v.type === "volume"
            ? {
                serviceType: "application" as const,
                serviceId: applicationId,
                type: "volume" as const,
                volumeName: v.volumeName,
                mountPath: v.target,
              }
            : {
                serviceType: "application" as const,
                serviceId: applicationId,
                type: "file" as const,
                mountPath: v.mountPath,
                filePath: v.filePath,
                content: v.content,
              };
      yield* api
        .mountsCreate({ payload: base })
        .pipe(Effect.catch(mapSdkFailure("/mounts.create", "POST")));
    }
  });

/** Maps {@link DockerComposeService} to Dokploy `saveEnvironment` / `application.update` / port / mount routes. */
const applyComposeConfiguration = (
  applicationId: string,
  compose: DockerComposeService | undefined,
  blueGreenSlot?: DokployBlueGreenSlot,
) =>
  Effect.gen(function* () {
    const resolved = expandComposeBlueGreenPlaceholder(compose, blueGreenSlot);
    if (resolved === undefined) return;

    const api = yield* DokployApi;

    const shouldSaveEnv =
      resolved.environment !== undefined ||
      (resolved.env !== undefined && resolved.env.trim() !== "") ||
      resolved.createEnvFile !== undefined;

    if (shouldSaveEnv) {
      const mergedEnv = mergeComposeEnvParts(resolved.env, resolved.environment);
      yield* api
        .applicationSaveEnvironment({
          payload: {
            applicationId,
            env: mergedEnv,
            buildArgs: "",
            buildSecrets: "",
            createEnvFile: resolved.createEnvFile ?? true,
          },
        })
        .pipe(Effect.catch(mapSdkFailure("/application.saveEnvironment", "POST")));
    }

    const update = mergeApplicationUpdateFromCompose(applicationId, resolved);
    if (update !== undefined) {
      yield* api
        .applicationUpdate({ payload: update as never })
        .pipe(Effect.catch(mapSdkFailure("/application.update", "POST")));
    }

    const json = yield* getApplicationJson(applicationId);

    if (resolved.ports !== undefined) {
      yield* replaceApplicationPorts(applicationId, resolved.ports, json ?? {});
    }
    if (resolved.volumes !== undefined) {
      yield* replaceApplicationMounts(applicationId, resolved.volumes, json ?? {});
    }
  });

const httpDeploy = (strategy: DeploymentStrategy, applicationId: string) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    yield* (
      strategy.mode === "recreate"
        ? sdk.applicationRedeploy({ payload: { applicationId } })
        : sdk.applicationDeploy({ payload: { applicationId } })
    ).pipe(
      Effect.catch(
        mapSdkFailure(
          strategy.mode === "recreate" ? "/application.redeploy" : "/application.deploy",
          "POST",
        ),
      ),
    );
  });

const syncProjectMetadata = (input: UpsertProjectInput, projectId: string) =>
  Effect.gen(function* () {
    const existing = yield* optionalProjectJson(projectId);
    const snap = snapshotFromProjectJson(existing);
    if (!snap) return;
    const descEqual = (snap.description ?? undefined) === (input.description ?? undefined);
    if (snap.name === input.name && descEqual) return;
    const api = yield* DokployApi;
    yield* api
      .projectUpdate({
        payload: {
          projectId,
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      })
      .pipe(Effect.catch(mapSdkFailure("/project.update", "POST")));
  });

const syncEnvironmentMetadata = (input: UpsertEnvironmentInput, environmentId: string) =>
  Effect.gen(function* () {
    const existing = yield* optionalEnvironmentJson(environmentId);
    const snap = snapshotFromEnvironmentJson(existing);
    if (!snap) return;
    const descEqual = (snap.description ?? undefined) === (input.description ?? undefined);
    if (snap.name === input.name && descEqual) return;
    const api = yield* DokployApi;
    yield* api
      .environmentUpdate({
        payload: {
          environmentId,
          name: input.name,
          projectId: input.projectId,
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      })
      .pipe(Effect.catch(mapSdkFailure("/environment.update", "POST")));
  });

/**
 * In-memory Dokploy simulation for {@link test.provider} lifecycle tests.
 * Does not perform HTTP (including simulated deploy).
 */
export const DokployEngineInMemoryLive = Layer.sync(DokployEngine, () => {
  const apps = new Map<string, DokployApplicationSnapshot>();
  const projects = new Map<string, DokployProjectSnapshot>();
  const environments = new Map<string, DokployEnvironmentSnapshot>();
  const memDomains = new Map<string, DokployApplicationDomainSnapshot>();
  let memDomainSeq = 0;

  const findEnvByProjectAndName = (projectId: string, name: string) =>
    [...environments.values()].find((e) => e.projectId === projectId && e.name === name);

  const service: DokployEngineShape = {
    upsertDockerApplication: (input) =>
      Effect.gen(function* () {
        yield* Effect.void;
        if (input.deployment.mode === "blue-green") {
          const priorActive = input.blueGreen?.activeSlot;
          const activeSlot = priorActive ?? input.deployment.initialSlot ?? "blue";
          const inactiveSlot = oppositeSlot(activeSlot);
          const targetSlot =
            input.deployment.cutover === "manual" && priorActive !== undefined
              ? inactiveSlot
              : inactiveSlot;

          const ensureSlot = (
            slot: DokployBlueGreenSlot,
            id: string | undefined,
            dockerImage: string,
          ) => {
            const applicationId = id ?? `mem-${slotAppName(input.appName, slot)}`;
            const prev = apps.get(applicationId);
            const snap: DokployApplicationSnapshot = {
              applicationId,
              name: `${input.name} (${slot})`,
              appName: slotAppName(input.appName, slot),
              dockerImage,
              environmentId: input.environmentId,
              serverId: input.serverId,
              activeSlot: slot,
              blueApplicationId:
                slot === "blue" ? applicationId : input.blueGreen?.blueApplicationId,
              greenApplicationId:
                slot === "green" ? applicationId : input.blueGreen?.greenApplicationId,
            };
            apps.set(applicationId, { ...(prev ?? snap), ...snap });
            return applicationId;
          };

          const existingBlue = input.blueGreen?.blueApplicationId;
          const existingGreen = input.blueGreen?.greenApplicationId;
          const blueApplicationId = ensureSlot(
            "blue",
            existingBlue,
            targetSlot === "blue"
              ? input.dockerImage
              : (apps.get(existingBlue ?? "")?.dockerImage ?? input.dockerImage),
          );
          const greenApplicationId = ensureSlot(
            "green",
            existingGreen,
            targetSlot === "green"
              ? input.dockerImage
              : (apps.get(existingGreen ?? "")?.dockerImage ?? input.dockerImage),
          );

          const nextActive =
            input.deployment.cutover === "manual" && priorActive !== undefined
              ? priorActive
              : targetSlot;
          const activeId = nextActive === "blue" ? blueApplicationId : greenApplicationId;
          const active = apps.get(activeId)!;
          const next: DokployApplicationSnapshot = {
            ...active,
            name: input.name,
            appName: input.appName,
            dockerImage: active.dockerImage,
            activeSlot: nextActive,
            blueApplicationId,
            greenApplicationId,
          };
          apps.set(activeId, next);
          return next;
        }

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
            activeSlot: undefined,
            blueApplicationId: undefined,
            greenApplicationId: undefined,
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
          activeSlot: undefined,
          blueApplicationId: undefined,
          greenApplicationId: undefined,
        };
        apps.set(applicationId, snap);
        return snap;
      }),

    deleteApplication: (applicationId) =>
      Effect.gen(function* () {
        yield* Effect.void;
        const domainIdsForApp = [...memDomains.entries()]
          .filter(([, row]) => row.applicationId === applicationId)
          .map(([did]) => did);
        for (const did of domainIdsForApp) memDomains.delete(did);
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

    listDomainsByApplicationId: (applicationId) =>
      Effect.gen(function* () {
        yield* Effect.void;
        return [...memDomains.values()].filter((d) => d.applicationId === applicationId);
      }),

    createApplicationDomain: (body) =>
      Effect.gen(function* () {
        yield* Effect.void;
        const applicationId = typeof body.applicationId === "string" ? body.applicationId : "";
        const host = typeof body.host === "string" ? body.host : "";
        const domainId = `mem-domain-${memDomainSeq++}`;
        const https = typeof body.https === "boolean" ? body.https : false;
        const row: DokployApplicationDomainSnapshot = {
          domainId,
          applicationId,
          host,
          path: typeof body.path === "string" ? body.path : "/",
          port: typeof body.port === "number" ? body.port : 3000,
          internalPath: typeof body.internalPath === "string" ? body.internalPath : "/",
          stripPath: typeof body.stripPath === "boolean" ? body.stripPath : false,
          https,
          certificateType:
            typeof body.certificateType === "string" ? body.certificateType : undefined,
          customCertResolver:
            typeof body.customCertResolver === "string" ? body.customCertResolver : null,
          customEntrypoint:
            typeof body.customEntrypoint === "string" ? body.customEntrypoint : null,
          serviceName: typeof body.serviceName === "string" ? body.serviceName : null,
          middlewares: Array.isArray(body.middlewares)
            ? (body.middlewares as ReadonlyArray<string>)
            : [],
        };
        memDomains.set(domainId, row);
        return { domainId };
      }),

    updateApplicationDomain: (body) =>
      Effect.gen(function* () {
        yield* Effect.void;
        const domainId = typeof body.domainId === "string" ? body.domainId : "";
        const prev = memDomains.get(domainId);
        if (!prev) return;
        const next: DokployApplicationDomainSnapshot = {
          ...prev,
          host: typeof body.host === "string" ? body.host : prev.host,
          path: typeof body.path === "string" ? body.path : prev.path,
          port: typeof body.port === "number" ? body.port : prev.port,
          internalPath:
            typeof body.internalPath === "string" ? body.internalPath : prev.internalPath,
          stripPath: typeof body.stripPath === "boolean" ? body.stripPath : prev.stripPath,
          https: typeof body.https === "boolean" ? body.https : prev.https,
          certificateType:
            typeof body.certificateType === "string" ? body.certificateType : prev.certificateType,
          customCertResolver:
            typeof body.customCertResolver === "string"
              ? body.customCertResolver
              : body.customCertResolver === null
                ? null
                : prev.customCertResolver,
          customEntrypoint:
            typeof body.customEntrypoint === "string"
              ? body.customEntrypoint
              : body.customEntrypoint === null
                ? null
                : prev.customEntrypoint,
          serviceName:
            typeof body.serviceName === "string"
              ? body.serviceName
              : body.serviceName === null
                ? null
                : prev.serviceName,
          middlewares: Array.isArray(body.middlewares)
            ? (body.middlewares as ReadonlyArray<string>)
            : prev.middlewares,
        };
        memDomains.set(domainId, next);
      }),

    deleteDomain: (domainId) =>
      Effect.gen(function* () {
        yield* Effect.void;
        memDomains.delete(domainId);
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
        const upsertSingle = Effect.fn(function* ({
          applicationId,
          name,
          appName,
          dockerImage,
          blueGreenSlot,
        }: {
          readonly applicationId: string | undefined;
          readonly name: string;
          readonly appName: string;
          readonly dockerImage: string;
          readonly blueGreenSlot?: DokployBlueGreenSlot;
        }) {
          let nextId = applicationId;
          const api = yield* DokployApi;
          if (!nextId) {
            const tup = yield* api
              .applicationCreate({
                payload: {
                  name,
                  appName,
                  environmentId: input.environmentId,
                  serverId: input.serverId ?? null,
                },
                config: { includeResponse: true },
              })
              .pipe(Effect.catch(mapSdkFailure("/application.create", "POST")));
            const created = yield* responseBodyJsonUnknown(tup[1]);
            nextId = extractApplicationId(created);
            if (!nextId) {
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
            applicationId: nextId,
            dockerImage,
          };
          if (input.registry?.username) registryBody.username = input.registry.username;
          if (input.registry?.password)
            registryBody.password = Redacted.value(input.registry.password);
          if (input.registry?.registryUrl) registryBody.registryUrl = input.registry.registryUrl;
          yield* api
            .applicationSaveDockerProvider({ payload: registryBody as never })
            .pipe(Effect.catch(mapSdkFailure("/application.saveDockerProvider", "POST")));
          yield* applyComposeConfiguration(nextId, input.compose, blueGreenSlot);
          yield* httpDeploy(input.deployment, nextId);
          const json = yield* getApplicationJson(nextId);
          return {
            applicationId: nextId,
            dockerImage: extractDockerImage(json) ?? dockerImage,
          };
        });

        if (input.deployment.mode === "blue-green") {
          const priorActive = input.blueGreen?.activeSlot;
          const activeSlot = priorActive ?? input.deployment.initialSlot ?? "blue";
          const inactiveSlot = oppositeSlot(activeSlot);
          const targetSlot = inactiveSlot;
          const keepActive = input.deployment.cutover === "manual" && priorActive !== undefined;

          const activeIdBefore =
            activeSlot === "blue"
              ? input.blueGreen?.blueApplicationId
              : input.blueGreen?.greenApplicationId;
          const activeJsonBefore =
            activeIdBefore !== undefined ? yield* getApplicationJson(activeIdBefore) : undefined;
          const activeImageBefore = extractDockerImage(activeJsonBefore);

          const blueResult =
            targetSlot === "blue"
              ? yield* upsertSingle({
                  applicationId: input.blueGreen?.blueApplicationId,
                  name: `${input.name} (blue)`,
                  appName: slotAppName(input.appName, "blue"),
                  dockerImage: input.dockerImage,
                  blueGreenSlot: "blue",
                })
              : input.blueGreen?.blueApplicationId
                ? {
                    applicationId: input.blueGreen.blueApplicationId,
                    dockerImage:
                      activeSlot === "blue"
                        ? (activeImageBefore ?? input.dockerImage)
                        : input.dockerImage,
                  }
                : yield* upsertSingle({
                    applicationId: undefined,
                    name: `${input.name} (blue)`,
                    appName: slotAppName(input.appName, "blue"),
                    dockerImage:
                      activeSlot === "blue"
                        ? (activeImageBefore ?? input.dockerImage)
                        : input.dockerImage,
                    blueGreenSlot: "blue",
                  });

          const greenResult =
            targetSlot === "green"
              ? yield* upsertSingle({
                  applicationId: input.blueGreen?.greenApplicationId,
                  name: `${input.name} (green)`,
                  appName: slotAppName(input.appName, "green"),
                  dockerImage: input.dockerImage,
                  blueGreenSlot: "green",
                })
              : input.blueGreen?.greenApplicationId
                ? {
                    applicationId: input.blueGreen.greenApplicationId,
                    dockerImage:
                      activeSlot === "green"
                        ? (activeImageBefore ?? input.dockerImage)
                        : input.dockerImage,
                  }
                : yield* upsertSingle({
                    applicationId: undefined,
                    name: `${input.name} (green)`,
                    appName: slotAppName(input.appName, "green"),
                    dockerImage:
                      activeSlot === "green"
                        ? (activeImageBefore ?? input.dockerImage)
                        : input.dockerImage,
                    blueGreenSlot: "green",
                  });

          const nextActiveSlot = keepActive ? activeSlot : targetSlot;
          const activeResult = nextActiveSlot === "blue" ? blueResult : greenResult;

          if (input.deployment.traefik !== undefined) {
            const [blueJson, greenJson] = yield* Effect.all([
              getApplicationJson(blueResult.applicationId),
              getApplicationJson(greenResult.applicationId),
            ]);
            const yaml = buildTraefikBlueGreenDynamicYaml({
              logicalAppSlug: input.appName,
              baseAppName: input.appName,
              traefik: input.deployment.traefik,
              dokployAppNamesBySlot: {
                blue: extractStringField(blueJson, "appName"),
                green: extractStringField(greenJson, "appName"),
              },
            });
            const sdkTraefik = yield* DokployApi;
            yield* sdkTraefik
              .applicationUpdateTraefikConfig({
                payload: {
                  applicationId: blueResult.applicationId,
                  traefikConfig: yaml,
                },
              })
              .pipe(Effect.catch(mapSdkFailure("/application.updateTraefikConfig", "POST")));
          }

          return {
            applicationId: activeResult.applicationId,
            name: input.name,
            appName: input.appName,
            dockerImage: activeResult.dockerImage,
            environmentId: input.environmentId,
            serverId: input.serverId,
            activeSlot: nextActiveSlot,
            blueApplicationId: blueResult.applicationId,
            greenApplicationId: greenResult.applicationId,
          } satisfies DokployApplicationSnapshot;
        }

        const single = yield* upsertSingle({
          applicationId: input.applicationId,
          name: input.name,
          appName: input.appName,
          dockerImage: input.dockerImage,
        });
        return {
          applicationId: single.applicationId,
          name: input.name,
          appName: input.appName,
          dockerImage: single.dockerImage,
          environmentId: input.environmentId,
          serverId: input.serverId,
          activeSlot: undefined,
          blueApplicationId: undefined,
          greenApplicationId: undefined,
        } satisfies DokployApplicationSnapshot;
      }),

    deleteApplication: (applicationId) =>
      Effect.gen(function* () {
        const api = yield* DokployApi;
        yield* api
          .applicationDelete({ payload: { applicationId } })
          .pipe(Effect.catch(mapSdkFailure("/application.delete", "POST")));
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
          activeSlot: undefined,
          blueApplicationId: undefined,
          greenApplicationId: undefined,
        });
      }),

    upsertProject: (input) =>
      Effect.gen(function* () {
        let projectId = input.projectId;
        const jsonExisting =
          projectId !== undefined ? yield* optionalProjectJson(projectId) : undefined;

        if (jsonExisting === undefined || snapshotFromProjectJson(jsonExisting) === undefined) {
          const api = yield* DokployApi;
          const tup = yield* api
            .projectCreate({
              payload: {
                name: input.name,
                description: input.description ?? null,
              },
              config: { includeResponse: true },
            })
            .pipe(Effect.catch(mapSdkFailure("/project.create", "POST")));
          const created = yield* responseBodyJsonUnknown(tup[1]);
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
        const readBack = yield* optionalProjectJson(finalId);
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
        const api = yield* DokployApi;
        yield* sdk.projectRemove({ payload: { projectId } }).pipe(
          Effect.catchTag("HttpClientError", (e: HttpClientError) =>
            e.reason._tag === "StatusCodeError" && e.reason.response.status === 404
              ? Effect.void
              : Effect.fail(e),
          ),
          Effect.catch(mapSdkFailure("/project.remove", "POST")),
          Effect.asVoid,
        );
      }),

    findByProjectId: (projectId) =>
      Effect.gen(function* () {
        const json = yield* optionalProjectJson(projectId);
        const snap = snapshotFromProjectJson(json);
        if (!snap) return Option.none<DokployProjectSnapshot>();
        return Option.some(snap);
      }),

    upsertEnvironment: (input) =>
      Effect.gen(function* () {
        let environmentId = input.environmentId;

        if (environmentId) {
          const one = yield* optionalEnvironmentJson(environmentId);
          const snapExisting = snapshotFromEnvironmentJson(one);
          if (
            snapExisting !== undefined &&
            snapExisting.projectId === input.projectId &&
            snapExisting.environmentId === environmentId
          ) {
            yield* syncEnvironmentMetadata(input, environmentId);
            const refreshed = yield* optionalEnvironmentJson(environmentId);
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

        const listJson = yield* environmentsByProjectJson(input.projectId);
        const list = parseEnvironmentListJson(listJson);
        const match = list.find((e) => e.name === input.name && e.projectId === input.projectId);
        if (match) {
          environmentId = match.environmentId;
          yield* syncEnvironmentMetadata(input, environmentId);
          const refreshed = yield* optionalEnvironmentJson(environmentId);
          const snapFinal = snapshotFromEnvironmentJson(refreshed);
          if (snapFinal) return snapFinal;
        }

        const sdkEc = yield* DokployApi;
        const tupEc = yield* sdkEc
          .environmentCreate({
            payload: {
              projectId: input.projectId,
              name: input.name,
              description: input.description ?? "",
            },
            config: { includeResponse: true },
          })
          .pipe(Effect.catch(mapSdkFailure("/environment.create", "POST")));
        const created = yield* responseBodyJsonUnknown(tupEc[1]);
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
        const refreshedAfterCreate = yield* optionalEnvironmentJson(environmentId);
        const snapFinalAfterCreate = snapshotFromEnvironmentJson(refreshedAfterCreate);
        if (snapFinalAfterCreate) return snapFinalAfterCreate;
        return {
          environmentId,
          projectId: input.projectId,
          name: input.name,
          description: input.description ?? undefined,
        } satisfies DokployEnvironmentSnapshot;
      }),

    deleteEnvironment: (environmentId) =>
      Effect.gen(function* () {
        const api = yield* DokployApi;
        yield* sdk.environmentRemove({ payload: { environmentId } }).pipe(
          Effect.catchTag("HttpClientError", (e: HttpClientError) =>
            e.reason._tag === "StatusCodeError" && e.reason.response.status === 404
              ? Effect.void
              : Effect.fail(e),
          ),
          Effect.catch(mapSdkFailure("/environment.remove", "POST")),
          Effect.asVoid,
        );
      }),

    findByEnvironmentId: (environmentId) =>
      Effect.gen(function* () {
        const json = yield* optionalEnvironmentJson(environmentId);
        const snap = snapshotFromEnvironmentJson(json);
        if (!snap) return Option.none<DokployEnvironmentSnapshot>();
        return Option.some(snap);
      }),

    listEnvironmentsByProjectId: (projectId) =>
      Effect.gen(function* () {
        const json = yield* environmentsByProjectJson(projectId);
        return parseEnvironmentListJson(json).filter((e) => e.projectId === projectId);
      }),

    listDomainsByApplicationId: (applicationId) =>
      Effect.gen(function* () {
        const json = yield* domainsByApplicationJson(applicationId);
        return parseDomainsListJson(json ?? []);
      }),

    createApplicationDomain: (body) =>
      Effect.gen(function* () {
        const api = yield* DokployApi;
        const tup = yield* api
          .domainCreate({ payload: body as never, config: { includeResponse: true } })
          .pipe(Effect.catch(mapSdkFailure("/domain.create", "POST")));
        const created = yield* responseBodyJsonUnknown(tup[1]);
        const domainId = extractDomainId(created);
        if (!domainId) {
          return yield* Effect.fail(
            new DokployApiError({
              message:
                "domain.create succeeded but no domainId was found in the JSON body — check Dokploy API version",
              body: created,
            }),
          );
        }
        return { domainId };
      }),

    updateApplicationDomain: (body) =>
      Effect.gen(function* () {
        const api = yield* DokployApi;
        yield* api
          .domainUpdate({ payload: body as never })
          .pipe(Effect.catch(mapSdkFailure("/domain.update", "POST")));
      }),

    deleteDomain: (domainId) =>
      Effect.gen(function* () {
        const api = yield* DokployApi;
        yield* sdk.domainDelete({ payload: { domainId } }).pipe(
          Effect.catchTag("HttpClientError", (e: HttpClientError) =>
            e.reason._tag === "StatusCodeError" && e.reason.response.status === 404
              ? Effect.void
              : Effect.fail(e),
          ),
          Effect.catch(mapSdkFailure("/domain.delete", "POST")),
          Effect.asVoid,
        );
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

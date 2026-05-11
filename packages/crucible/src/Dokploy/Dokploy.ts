import { DokployApi, Api } from "@crucible/dokploy-api";
import { Console, Effect } from "effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { HttpClientError } from "effect/unstable/http/HttpClientError";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { DokployApiError } from "./errors.ts";
import {
  mergeComposeEnvParts,
  restartComposeToSwarm,
  type DockerComposePort,
  type DockerComposeService,
  type DockerComposeVolume,
} from "./dockerCompose.ts";

/** Resolved snapshot returned by `applications.findById`. */
export interface DokployApplicationSnapshot {
  readonly applicationId: string;
  readonly name: string;
  readonly appName: string;
  readonly dockerImage: string;
  readonly environmentId: string;
  readonly serverId: string | undefined;
}

/** Dokploy `domain.one` / list row shape. */
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
  /**
   * Optional compose-shaped options (maps to Dokploy `saveEnvironment`, `application.update`,
   * and optional `port` / `mount` writes).
   */
  readonly compose?: DockerComposeService;
}

/** Domain routes used by {@link syncApplicationDomains}. */
export type DokployDomainsClient = {
  readonly listDomainsByApplicationId: (
    applicationId: string,
  ) => Effect.Effect<
    ReadonlyArray<DokployApplicationDomainSnapshot>,
    DokployApiError | HttpClientError,
    DokployApi
  >;
  readonly createApplicationDomain: (
    body: Record<string, unknown>,
  ) => Effect.Effect<{ readonly domainId: string }, DokployApiError | HttpClientError, DokployApi>;
  readonly updateApplicationDomain: (
    body: Record<string, unknown>,
  ) => Effect.Effect<void, DokployApiError | HttpClientError, DokployApi>;
  readonly deleteDomain: (
    domainId: string,
  ) => Effect.Effect<void, DokployApiError | HttpClientError, DokployApi>;
};

/** OpenAPI often types 2xx as `{}`; decode real JSON from the bundled `HttpClientResponse` (cached `text`). */
const responseBodyJsonUnknown = (
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<unknown, HttpClientError, never> =>
  Effect.map(response.json, (body) => body as unknown);

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

const domainsByApplicationJson = (applicationId: string) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    const tup = yield* api
      .domainByApplicationId({
        params: { applicationId },
        config: { includeResponse: true },
      })
      .pipe(Effect.catchTag("DomainByApplicationId404", () => Effect.succeed(undefined)));
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
        yield* api.portDelete({ payload: { portId: p.portId } });
      }
    }
    for (const d of desired) {
      yield* api.portCreate({
        payload: {
          applicationId,
          publishedPort: d.published,
          targetPort: d.target,
          protocol: d.protocol ?? "tcp",
          publishMode: d.publishMode ?? "host",
        },
      });
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
        yield* api.mountsRemove({ payload: { mountId: m.mountId } });
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
      yield* api.mountsCreate({ payload: base });
    }
  });

/** Maps {@link DockerComposeService} to Dokploy `saveEnvironment` / `application.update` / port / mount routes. */
const applyComposeConfiguration = (
  applicationId: string,
  compose: DockerComposeService | undefined,
) =>
  Effect.gen(function* () {
    const resolved = compose;
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
        .pipe(Effect.tapError((e) => Console.error("applicationSaveEnvironment", e)));
    }

    const update = mergeApplicationUpdateFromCompose(applicationId, resolved);
    if (update !== undefined) {
      yield* api
        .applicationUpdate({ payload: update as never })
        .pipe(Effect.tapError((e) => Console.error("applicationUpdate", e)));
    }

    const json = yield* getApplicationJson(applicationId);

    if (resolved.ports !== undefined) {
      yield* replaceApplicationPorts(applicationId, resolved.ports, json ?? {}).pipe(
        Effect.tapError((e) => Console.error("replaceApplicationPorts", e)),
      );
    }
    if (resolved.volumes !== undefined) {
      yield* replaceApplicationMounts(applicationId, resolved.volumes, json ?? {}).pipe(
        Effect.tapError((e) => Console.error("replaceApplicationMounts", e)),
      );
    }
  });

const httpDeploy = (applicationId: string) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    yield* api.applicationDeploy({ payload: { applicationId } });
  });

const upsertDockerApplicationHttp = (input: UpsertDockerApplicationInput) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    let nextId = input.applicationId;
    if (!nextId) {
      const tup = yield* api
        .applicationCreate({
          payload: {
            name: input.name,
            appName: input.appName,
            environmentId: input.environmentId,
            serverId: input.serverId ?? null,
          },
          config: { includeResponse: true },
        })
        .pipe(Effect.tapError((e) => Console.error(e)));

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
      dockerImage: input.dockerImage,
    };
    if (input.registry?.username) registryBody.username = input.registry.username;
    if (input.registry?.password) registryBody.password = Redacted.value(input.registry.password);
    if (input.registry?.registryUrl) registryBody.registryUrl = input.registry.registryUrl;
    yield* api
      .applicationSaveDockerProvider({ payload: registryBody as never })
      .pipe(Effect.tapError((e) => Console.error("applicationSaveDockerProvider", e)));
    yield* applyComposeConfiguration(nextId, input.compose).pipe(
      Effect.tapError((e) => Console.error("applyComposeConfiguration", e)),
    );
    yield* httpDeploy(nextId).pipe(Effect.tapError((e) => Console.error("httpDeploy", e)));
    const json = yield* getApplicationJson(nextId);
    return {
      applicationId: nextId,
      name: input.name,
      appName: input.appName,
      dockerImage: extractDockerImage(json) ?? input.dockerImage,
      environmentId: input.environmentId,
      serverId: input.serverId,
    } satisfies DokployApplicationSnapshot;
  });
const deleteApplicationHttp = (applicationId: string) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    yield* api.applicationDelete({ payload: { applicationId } });
  });

const findByApplicationIdHttp = (applicationId: string) =>
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
  });

const listDomainsByApplicationIdHttp = (applicationId: string) =>
  Effect.gen(function* () {
    const json = yield* domainsByApplicationJson(applicationId);
    return parseDomainsListJson(json ?? []);
  });

const createApplicationDomainHttp = (body: Record<string, unknown>) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    const tup = yield* api.domainCreate({
      payload: body as never,
      config: { includeResponse: true },
    });
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
  });

const updateApplicationDomainHttp = (body: Record<string, unknown>) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    yield* api.domainUpdate({ payload: body as never });
  });

const deleteDomainHttp = (domainId: string) =>
  Effect.gen(function* () {
    const api = yield* DokployApi;
    yield* api.domainDelete({ payload: { domainId } }).pipe(
      Effect.catchTag("HttpClientError", (e: HttpClientError) =>
        e.reason._tag === "StatusCodeError" && e.reason.response.status === 404
          ? Effect.void
          : Effect.fail(e),
      ),
      Effect.asVoid,
    );
  });

export class Dokploy extends Context.Service<Dokploy>()("Crucible.Dokploy.Provider", {
  make: Effect.gen(function* () {
    const dokployApi = yield* DokployApi;

    const projects = {
      findById: Effect.fn(function* (projectId?: string) {
        if (!projectId) return Option.none();
        const project = yield* dokployApi.projectOne({ params: { projectId } }).pipe(
          Effect.catchTag("ProjectOne404", () => Effect.succeed(undefined)),
          Effect.map(Option.fromNullishOr),
        );
        return project;
      }),
      create: Effect.fn(function* (payload: Api.ProjectCreateRequestJson) {
        const project = yield* dokployApi.projectCreate({ payload });
        return project;
      }),
      update: Effect.fn(function* (payload: Api.ProjectUpdateRequestJson) {
        const project = yield* dokployApi
          .projectUpdate({ payload })
          .pipe(Effect.map(Option.fromNullishOr));
        return project;
      }),
      delete: Effect.fn(function* (projectId?: string) {
        if (!projectId) return;
        const project = yield* dokployApi.projectRemove({ payload: { projectId } });
        return project;
      }),
    };

    const environments = {
      findById: Effect.fn(function* (environmentId?: string) {
        if (!environmentId) return Option.none();
        const environment = yield* dokployApi.environmentOne({ params: { environmentId } }).pipe(
          Effect.catchTag("EnvironmentOne404", () => Effect.succeed(undefined)),
          Effect.map(Option.fromNullishOr),
        );
        return environment;
      }),
      create: Effect.fn(function* (payload: Api.EnvironmentCreateRequestJson) {
        const environment = yield* dokployApi.environmentCreate({ payload });
        return environment;
      }),
      update: Effect.fn(function* (payload: Api.EnvironmentUpdateRequestJson) {
        const environment = yield* dokployApi
          .environmentUpdate({ payload })
          .pipe(Effect.map(Option.fromNullishOr));
        return environment;
      }),
      delete: Effect.fn(function* (environmentId?: string) {
        if (!environmentId) return;
        const environment = yield* dokployApi.environmentRemove({ payload: { environmentId } });
        return environment;
      }),
    };

    return {
      projects: {
        ...projects,
        upsert: Effect.fn(function* (
          payload: Api.ProjectCreateRequestJson | Api.ProjectUpdateRequestJson,
        ) {
          const existing =
            "projectId" in payload ? yield* projects.findById(payload.projectId) : Option.none();
          if (Option.isNone(existing)) {
            const created = yield* projects.create({
              ...payload,
              name: payload.name ?? "",
            });

            return Option.some({
              projectId: created.project.projectId,
              name: created.project.name,
              description: created.project.description ?? undefined,
            });
          }
          const updated = yield* projects.update({
            projectId: existing.value.projectId,
            ...payload,
          });

          if (Option.isNone(updated)) {
            return yield* projects.findById(existing.value.projectId);
          }

          return updated;
        }),
      },
      environments: {
        ...environments,
        upsert: Effect.fn(function* (
          payload: Api.EnvironmentCreateRequestJson | Api.EnvironmentUpdateRequestJson,
        ) {
          const existing =
            "environmentId" in payload
              ? yield* environments.findById(payload.environmentId)
              : Option.none();
          if (Option.isNone(existing)) {
            if (!payload.projectId) {
              return yield* Effect.fail(Api.EnvironmentCreate400);
            }
            const created = yield* environments.create({
              projectId: payload.projectId,
              name: payload.name ?? "",
              description: payload.description ?? undefined,
            });
            return Option.some({
              environmentId: created.environmentId,
              projectId: created.projectId,
              name: created.name,
              description: created.description ?? undefined,
            });
          }
          const updated = yield* environments.update({
            environmentId: existing.value.environmentId,
            ...payload,
          });
          if (Option.isNone(updated)) {
            return yield* environments.findById(existing.value.environmentId);
          }
          return updated;
        }),
      },
      applications: {
        upsertDocker: upsertDockerApplicationHttp,
        findById: findByApplicationIdHttp,
        delete: deleteApplicationHttp,
      },
      domains: {
        listDomainsByApplicationId: listDomainsByApplicationIdHttp,
        createApplicationDomain: createApplicationDomainHttp,
        updateApplicationDomain: updateApplicationDomainHttp,
        deleteDomain: deleteDomainHttp,
      },
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

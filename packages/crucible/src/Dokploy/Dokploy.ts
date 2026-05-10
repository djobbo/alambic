import { DokployApi, Api } from "@crucible/dokploy-api";
import { Effect } from "effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export class Dokploy extends Context.Service<Dokploy>()("Crucible.Dokploy", {
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
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

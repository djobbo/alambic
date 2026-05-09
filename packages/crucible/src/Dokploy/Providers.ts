import * as Provider from "alchemy/Provider";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { ComposeProvider, DockerCompose } from "../Docker/Compose.ts";
import { DockerImage, ImageProvider } from "../Docker/Image.ts";
import { ApplicationProvider, ApplicationResource } from "./Application.ts";
import { DeploymentProvider, DeploymentResource } from "./Deployment.ts";
import { Environment, EnvironmentProvider } from "./Environment.ts";
import { Project, ProjectProvider } from "./Project.ts";
import {
  DokployConnectionFromEnvLive,
  DokployEngineHttpLive,
  DokployEngineInMemoryLive,
} from "./DokployEngine.ts";

export class Providers extends Provider.ProviderCollection<Providers>()("Crucible.Dokploy") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/** Production-style Dokploy API wiring (`DOKPLOY_URL`, `DOKPLOY_API_KEY`, `x-api-key`). */
export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([
      DockerImage,
      DockerCompose,
      Project,
      Environment,
      DeploymentResource,
      ApplicationResource,
    ]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        ImageProvider(),
        ComposeProvider(),
        ProjectProvider(),
        EnvironmentProvider(),
        DeploymentProvider(),
        ApplicationProvider(),
      ),
    ),
    Layer.provideMerge(DokployEngineHttpLive),
    Layer.provideMerge(DokployConnectionFromEnvLive),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.orDie,
  );

/** In-memory engine for Alchemy `test.provider` lifecycle tests (no HTTP). */
export const testProviders = () =>
  Layer.effect(
    Providers,
    Provider.collection([
      DockerImage,
      DockerCompose,
      Project,
      Environment,
      DeploymentResource,
      ApplicationResource,
    ]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        ImageProvider(),
        ComposeProvider(),
        ProjectProvider(),
        EnvironmentProvider(),
        DeploymentProvider(),
        ApplicationProvider(),
      ),
    ),
    Layer.provideMerge(DokployEngineInMemoryLive),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.orDie,
  );

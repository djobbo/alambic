import { DokployApi, DokployConnection } from "@crucible/dokploy-api";
import * as Provider from "alchemy/Provider";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { ComposeProvider, DockerCompose } from "../Docker/Compose.ts";
import { DockerImage, ImageProvider } from "../Docker/Image.ts";
import {
  ApplicationComposeProvider,
  ApplicationCompose,
  ApplicationImageProvider,
  ApplicationImage,
} from "./Application/index.ts";
import { Domain, DomainProvider } from "./Domain.ts";
import { Environment, EnvironmentProvider } from "./Environment.ts";
import { Dokploy } from "./Dokploy.ts";
import { DokployEngineInMemoryLive } from "./DokployEngine.ts";
import { Project, ProjectProvider } from "./Project.ts";

/** Must not share {@link Dokploy}'s Context key (`Crucible.Dokploy`) or `yield* Dokploy` resolves to this registry instead of the HTTP client. */
export class Providers extends Provider.ProviderCollection<Providers>()("Crucible.Dokploy") {}

export type ProviderRequirements = Layer.Services<ReturnType<typeof providers>>;

/** Production-style Dokploy API wiring (`DOKPLOY_URL`, `DOKPLOY_API_KEY` → `x-api-key` header). */
export const providers = () =>
  Layer.effect(
    Providers,
    Provider.collection([
      DockerImage,
      DockerCompose,
      Project,
      Environment,
      Domain,
      ApplicationImage,
      ApplicationCompose,
    ]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        ImageProvider(),
        ComposeProvider(),
        ProjectProvider(),
        EnvironmentProvider(),
        DomainProvider(),
        ApplicationImageProvider(),
        ApplicationComposeProvider(),
      ),
    ),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(Dokploy.layer),
    Layer.provideMerge(DokployApi.layer),
    Layer.provideMerge(DokployConnection.layer),
    Layer.orDie,
  );

/** In-memory Dokploy facade for Alchemy `test.provider` lifecycle tests (no HTTP). */
export const testProviders = () =>
  Layer.effect(
    Providers,
    Provider.collection([
      DockerImage,
      DockerCompose,
      Project,
      Environment,
      Domain,
      ApplicationImage,
      ApplicationCompose,
    ]),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        ImageProvider(),
        ComposeProvider(),
        ProjectProvider(),
        EnvironmentProvider(),
        DomainProvider(),
        ApplicationImageProvider(),
        ApplicationComposeProvider(),
      ),
    ),
    Layer.provideMerge(DokployEngineInMemoryLive),
    Layer.provideMerge(Dokploy.delegatingEngineLayer),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.orDie,
  );

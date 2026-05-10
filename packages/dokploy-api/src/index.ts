import * as HttpClient from "effect/unstable/http/HttpClient";
import { Config, Effect, flow } from "effect";
import * as Layer from "effect/Layer";
import type { Dokploy } from "./generated/DokployClient.ts";
import * as Context from "effect/Context";
import { HttpClientRequest } from "effect/unstable/http";
import { make as makeDokployClient } from "./generated/DokployClient.ts";
import * as Schedule from "effect/Schedule";
import * as Redacted from "effect/Redacted";

import * as Api from "./generated/DokployClient.ts";
export { Api };

/** Matches {@link DokployApi} URL normalization (`DOKPLOY_URL` trimming). */
export const normalizeDokployBaseUrl = (url: string) => url.trim().replace(/\/+$/, "");

export class DokployConnection extends Context.Service<
  DokployConnection,
  {
    readonly baseUrl: string;
    readonly apiKey: Redacted.Redacted<string>;
  }
>()("@crucible/DokployConnection", {
  make: Effect.gen(function* () {
    const apiKey = yield* Config.string("DOKPLOY_API_KEY");
    const baseUrl = yield* Config.string("DOKPLOY_URL");
    return {
      baseUrl,
      apiKey: Redacted.make(apiKey),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

export class DokployApi extends Context.Service<DokployApi, Dokploy>()("@crucible/DokployApi", {
  make: Effect.gen(function* () {
    const { apiKey, baseUrl } = yield* DokployConnection;
    const apiUrl = `${normalizeDokployBaseUrl(baseUrl)}/api`;
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(
        flow(
          HttpClientRequest.prependUrl(apiUrl),
          HttpClientRequest.bearerToken(apiKey),
          HttpClientRequest.acceptJson,
        ),
      ),
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({
        schedule: Schedule.exponential(100),
        times: 3,
      }),
    );
    return makeDokployClient(client);
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

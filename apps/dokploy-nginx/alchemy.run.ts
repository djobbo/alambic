import * as Alchemy from "alchemy";
import * as Docker from "crucible/Docker";
import * as Dokploy from "crucible/Dokploy";
import * as Effect from "effect/Effect";
import {config as dotenv} from 'dotenv'

dotenv({
  path: '.env',
  quiet: true,
});

/**
 * Single Dokploy Docker app: `nginx:alpine`.
 *
 * Env: `DOKPLOY_URL`, `DOKPLOY_API_KEY` (`crucible/Dokploy` connection).
 * The stack provisions a Dokploy Project and Environment, then attaches the Docker application.
 */
export default Alchemy.Stack(
  "dokploy-nginx",
  {
    providers: Dokploy.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const project = yield* Dokploy.Project("my-cool-project");
    const environment = yield* Dokploy.Environment("my-cool-environment", {
      project,
    });

    const nginxImage = yield* Docker.ImageTag("nginx:alpine");
    const app = yield* Dokploy.Application.Image("my-cool-app", {
      environment,
      image: nginxImage,
    });

    return {
      applicationId: app.applicationId,
      appName: app.appName,
      dockerImage: app.dockerImage,
    };
  })
);

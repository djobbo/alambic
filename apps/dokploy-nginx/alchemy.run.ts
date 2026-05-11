import * as Alchemy from "alchemy";
import * as Dokploy from "alambic/Dokploy";
import * as Effect from "effect/Effect";
import { config as dotenv } from "dotenv";
import { Docker } from "alambic";

dotenv({
  path: ".env",
  quiet: true,
});

export default Alchemy.Stack(
  "dokploy-nginx",
  {
    providers: Dokploy.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const project = yield* Dokploy.Project("my-cool-project", {
      name: "Alchemy is fun",
      description: "this is quite a cool project!",
    });
    const environment = yield* Dokploy.Environment("my-cool-environment", {
      project,
      name: "Hello World",
      description: "this is quite a cool environment indeed!",
    });
    const publicHost = process.env.PUBLIC_HOST?.trim();
    if (!publicHost) {
      return yield* Effect.die("PUBLIC_HOST is not set");
    }
    const domain = yield* Dokploy.Domain("my-cool-domain", {
      host: publicHost,
      path: "/",
      containerPort: 80,
      internalPath: "/",
      stripPath: false,
      https: true,
      certificateType: "letsencrypt",
    });

    const nginxImage = yield* Docker.NginxImageTag({ variant: "alpine" });
    const app = yield* Dokploy.Application.Image("my-cool-app", {
      environment,
      image: nginxImage,
      domains: [domain],
      service: {
        volumes: [
          {
            type: "file",
            filePath: "index.html",
            mountPath: "/usr/share/nginx/html/index.html",
            content: `<p><span>${publicHost}</span></p>`,
          },
        ],
      },
    });

    const workerDomain = yield* Dokploy.Domain("worker-domain", {
      host: publicHost,
      path: "/hello",
      containerPort: 8080,
      internalPath: "/",
      stripPath: true,
      https: true,
      certificateType: "letsencrypt",
    });

    const app2 = yield* Dokploy.Application.Worker("worker-app", {
      environment,
      domains: [workerDomain],
      main: "./worker.ts",
    });

    return {
      projectId: project.projectId,
      environmentId: environment.environmentId,
      app: {
        id: app.applicationId,
        name: app.appName,
        dockerImage: app.dockerImage,
      },
      worker: {
        id: app2.applicationId,
        name: app2.appName,
        dockerImage: app2.dockerImage,
      },
      publicHost,
    };
  }),
);

import * as Alchemy from "alchemy";
import * as Dokploy from "crucible/Dokploy";
import * as Effect from "effect/Effect";
import { config as dotenv } from "dotenv";
import { Docker } from "crucible";

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
    const domain = publicHost
      ? yield* Dokploy.Domain("my-cool-domain", {
          host: publicHost,
          path: "/",
          containerPort: 80,
          internalPath: "/",
          stripPath: false,
          https: true,
          certificateType: "letsencrypt",
        })
      : null;

    const nginxImage = yield* Docker.NginxImageTag({ variant: "alpine" });
    const app = yield* Dokploy.Application.Image("my-cool-app", {
      environment,
      image: nginxImage,
      domains: [domain].filter((d) => d !== null),
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

    const domain2 = publicHost
      ? yield* Dokploy.Domain("my-cool-domain-2", {
          host: publicHost,
          path: "/two",
          containerPort: 80,
          internalPath: "/",
          stripPath: true,
          https: true,
          certificateType: "letsencrypt",
        })
      : null;

    const app2 = yield* Dokploy.Application.Image("my-cool-app-2", {
      environment,
      image: nginxImage,
      domains: [domain2].filter((d) => d !== null),
    });

    return {
      projectId: project.projectId,
      environmentId: environment.environmentId,
      applicationId: app.applicationId,
      appName: app.appName,
      dockerImage: app.dockerImage,
      publicHost,
    };
  }),
);

import * as Alchemy from "alchemy";
import * as Docker from "crucible/Docker";
import * as Dokploy from "crucible/Dokploy";
import * as Effect from "effect/Effect";
import { config as dotenv } from "dotenv";

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
    const project = yield* Dokploy.Project("my-cool-project");
    const environment = yield* Dokploy.Environment("my-cool-environment", {
      project,
    });
    const publicHost = process.env.PUBLIC_HOST?.trim()!;
    const deployment = yield* Dokploy.Deployment.BlueGreen("nginx-blue-green", {
      cutover: "automatic",
      initialSlot: "blue",
      traefik: {
        host: publicHost,
        targetPort: 80,
        weightBlue: 90,
        weightGreen: 10,
        entryPoints: ["web", "websecure"],
        tls: true,
        certResolver: "letsencrypt",
      },
    });

    const nginxImage = yield* Docker.NginxImageTag({ variant: "alpine" });
    const app = yield* Dokploy.Application.Image("my-cool-app", {
      environment,
      image: nginxImage,
      deployment,
      service: {
        volumes: [
          {
            type: "file",
            filePath: "index.html",
            mountPath: "/usr/share/nginx/html/index.html",
            content: `<p><span>${publicHost}</span><br/><span>${Dokploy.CRUCIBLE_BLUE_GREEN_SLOT_PLACEHOLDER}</span></p>`,
          },
        ],
      },
    });

    return {
      applicationId: app.applicationId,
      appName: app.appName,
      dockerImage: app.dockerImage,
      activeSlot: app.activeSlot,
      blueApplicationId: app.blueApplicationId,
      greenApplicationId: app.greenApplicationId,
      /** Hostname matched by weighted Traefik (DNS should point here). */
      weightedPublicHost: publicHost,
      domainBindings: app.domainBindings,
    };
  }),
);

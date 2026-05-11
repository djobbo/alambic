import alchemy from "alchemy";
import { Tunnel, VpcService, Worker } from "alchemy/cloudflare";

const app = await alchemy("cloudflare-vpc-service");

export const tunnel = await Tunnel("tunnel", {
  ingress: [
    {
      service: "http://localhost:5173",
    },
  ],
  adopt: true,
});

export const vpcService = await VpcService("vpc-service", {
  httpPort: 5173,
  host: {
    hostname: "localhost",
    resolverNetwork: {
      tunnel,
      resolverIps: ["127.0.0.1"],
    },
  },
  adopt: true,
});

export const worker = await Worker("worker", {
  entrypoint: "./src/worker.ts",
  bindings: {
    VPC_SERVICE: vpcService,
  },
  adopt: true,
});

console.log(`Worker URL: ${worker.url}`);

await app.finalize();

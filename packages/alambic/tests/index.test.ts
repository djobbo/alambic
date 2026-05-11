import * as Docker from "../src/Docker/index.ts";
import * as Dokploy from "../src/Dokploy/index.ts";
import { describe, expect, test } from "vite-plus/test";

describe("alambic package surface", () => {
  test("Docker + Dokploy submodules resolve", () => {
    expect(Docker.ImageTag).toBeDefined();
    expect(Docker.ImageDigest).toBeDefined();
    expect(Docker.Compose).toBeDefined();
    expect(Docker.PostgresImageTag).toBeDefined();
    expect(Docker.postgresEnvironment).toBeDefined();
    expect(Docker.postgresDatabaseUrl).toBeDefined();
    expect(Docker.NginxImageTag).toBeDefined();
    expect(Docker.nginxEnvironment).toBeDefined();
    expect(Docker.nginxUrl).toBeDefined();
    expect(Dokploy.Application).toBeDefined();
    expect(Dokploy.Domain).toBeDefined();
  });
});

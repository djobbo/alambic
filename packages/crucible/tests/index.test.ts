import * as Docker from "../src/Docker/index.ts";
import * as Dokploy from "../src/Dokploy/index.ts";
import { describe, expect, test } from "vite-plus/test";

describe("crucible package surface", () => {
  test("Docker + Dokploy submodules resolve", () => {
    expect(Docker.ImageTag).toBeDefined();
    expect(Docker.ImageDigest).toBeDefined();
    expect(Docker.Compose).toBeDefined();
    expect(Dokploy.Application).toBeDefined();
  });
});

import { describe, expect, test } from "vite-plus/test";

import { buildTraefikBlueGreenDynamicYaml } from "../src/Dokploy/traefikBlueGreen.ts";

describe("buildTraefikBlueGreenDynamicYaml", () => {
  test("emits weighted services and backend URLs from slot hostnames", () => {
    const yaml = buildTraefikBlueGreenDynamicYaml({
      logicalAppSlug: "my-app",
      baseAppName: "my-app",
      traefik: {
        host: "nginx.example.com",
        targetPort: 80,
        weightBlue: 70,
        weightGreen: 30,
        entryPoints: ["web"],
        tls: false,
      },
    });

    expect(yaml).toContain("weighted:");
    expect(yaml).toContain("Host(`nginx.example.com`)");
    expect(yaml).toContain("http://my-app-blue:80");
    expect(yaml).toContain("http://my-app-green:80");
    expect(yaml).toContain("weight: 70");
    expect(yaml).toContain("weight: 30");
    expect(yaml).not.toContain("certResolver");
  });

  test("supports custom backend hosts", () => {
    const yaml = buildTraefikBlueGreenDynamicYaml({
      logicalAppSlug: "x",
      baseAppName: "x",
      traefik: {
        host: "h.test",
        weightBlue: 1,
        weightGreen: 1,
        tls: false,
        entryPoints: ["web"],
        blueBackendHost: "custom-blue.internal",
        greenBackendHost: "custom-green.internal",
      },
    });
    expect(yaml).toContain("http://custom-blue.internal:");
    expect(yaml).toContain("http://custom-green.internal:");
  });

  test("uses Dokploy canonical app names when provided (suffix after create)", () => {
    const yaml = buildTraefikBlueGreenDynamicYaml({
      logicalAppSlug: "my-app",
      baseAppName: "my-app",
      dokployAppNamesBySlot: {
        blue: "my-app-blue-l8orge",
        green: "my-app-green-zngnig",
      },
      traefik: {
        host: "nginx.example.com",
        targetPort: 80,
        weightBlue: 1,
        weightGreen: 1,
        tls: false,
        entryPoints: ["web"],
      },
    });
    expect(yaml).toContain("http://my-app-blue-l8orge:80");
    expect(yaml).toContain("http://my-app-green-zngnig:80");
    expect(yaml).not.toContain("http://my-app-blue:80");
    expect(yaml).not.toContain("http://my-app-green:80");
  });
});

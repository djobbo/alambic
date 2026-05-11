import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { Network } from "../../src/docker/network.ts";
import { BRANCH_PREFIX } from "../util.ts";
import { DockerApi } from "../../src/docker/api.ts";

import "../../src/test/vitest.ts";

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

describe.sequential("Network", () => {
  test("should ignore 'network already exists' error and return existing network", async (scope) => {
    const networkName = `alchemy-test-network-${Date.now()}`;
    const api = new DockerApi();

    // Create network manually first so it "already exists" when the resource runs
    await api.createNetwork(networkName);

    try {
      // Use the Network resource, which should detect the existing network and succeed
      const network = await Network("test-network-real", {
        name: networkName,
      });

      expect(network.name).toBe(networkName);
      expect(network.id).toBeDefined();
      expect(typeof network.id).toBe("string");
    } finally {
      // Cleanup: Destroy the resource scope (which might try to delete the network)
      try {
        await alchemy.destroy(scope);
      } catch (e) {
        // Ignore if destroy fails, we'll ensure cleanup next
      }

      // Ensure network is really gone
      try {
        if (await api.networkExists(networkName)) {
          await api.removeNetwork(networkName);
        }
      } catch {}
    }
  });
});

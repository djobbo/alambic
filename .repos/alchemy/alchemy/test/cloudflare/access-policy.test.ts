import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { AccessPolicy } from "../../src/cloudflare/access-policy.ts";
import { createCloudflareApi } from "../../src/cloudflare/api.ts";
import { destroy } from "../../src/destroy.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const api = await createCloudflareApi();

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

describe.skipIf(!process.env.ALL_TESTS)("AccessPolicy Resource", () => {
  const testId = `${BRANCH_PREFIX}-access-policy`;

  test("create, update, and delete access policy", async (scope) => {
    let policy: AccessPolicy | undefined;
    try {
      // Create — allow policy with email rule.
      policy = await AccessPolicy(testId, {
        name: `Test Policy ${testId}`,
        decision: "allow",
        include: [{ email_domain: { domain: "example.com" } }],
      });
      expect(policy.id).toBeTruthy();
      expect(policy.decision).toEqual("allow");
      const initialId = policy.id;

      // Update name (decision unchanged so no replacement).
      policy = await AccessPolicy(testId, {
        name: `Updated Policy ${testId}`,
        decision: "allow",
        include: [{ email_domain: { domain: "example.com" } }],
      });
      expect(policy.id).toEqual(initialId);
      expect(policy.name).toEqual(`Updated Policy ${testId}`);
    } finally {
      await destroy(scope);
      if (policy?.id) {
        const response = await api.get(
          `/accounts/${api.accountId}/access/policies/${policy.id}`,
        );
        expect(response.status).toEqual(404);
      }
    }
  });
});

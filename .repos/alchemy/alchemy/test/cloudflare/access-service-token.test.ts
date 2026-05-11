import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { AccessServiceToken } from "../../src/cloudflare/access-service-token.ts";
import { createCloudflareApi } from "../../src/cloudflare/api.ts";
import { destroy } from "../../src/destroy.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const api = await createCloudflareApi();

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

describe.skipIf(!process.env.ALL_TESTS)("AccessServiceToken Resource", () => {
  const testId = `${BRANCH_PREFIX}-access-svc-token`;

  test("create, update, and delete service token", async (scope) => {
    let token: AccessServiceToken | undefined;
    try {
      // Create
      token = await AccessServiceToken(testId, {
        name: `Test Service Token ${testId}`,
        duration: "24h",
      });
      expect(token.id).toBeTruthy();
      expect(token.clientId).toBeTruthy();
      expect(token.clientSecret?.unencrypted).toBeTruthy();
      const initialSecret = token.clientSecret?.unencrypted;
      const initialId = token.id;

      // Update name — clientSecret must be retained.
      token = await AccessServiceToken(testId, {
        name: `Updated Service Token ${testId}`,
        duration: "24h",
      });
      expect(token.id).toEqual(initialId);
      expect(token.name).toEqual(`Updated Service Token ${testId}`);
      expect(token.clientSecret?.unencrypted).toEqual(initialSecret);
    } finally {
      await destroy(scope);
      if (token?.id) {
        const response = await api.get(
          `/accounts/${api.accountId}/access/service_tokens/${token.id}`,
        );
        expect(response.status).toEqual(404);
      }
    }
  });
});

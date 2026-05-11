import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { AccessGroup } from "../../src/cloudflare/access-group.ts";
import { createCloudflareApi } from "../../src/cloudflare/api.ts";
import { destroy } from "../../src/destroy.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const api = await createCloudflareApi();

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

describe.skipIf(!process.env.ALL_TESTS)("AccessGroup Resource", () => {
  const testId = `${BRANCH_PREFIX}-access-group`;

  test("create, update, and delete access group", async (scope) => {
    let group: AccessGroup | undefined;
    try {
      // Create with a single email rule.
      group = await AccessGroup(testId, {
        name: `Test Group ${testId}`,
        include: [{ email_domain: { domain: "example.com" } }],
      });
      expect(group.id).toBeTruthy();
      const initialId = group.id;

      // Update — add an exclude rule.
      group = await AccessGroup(testId, {
        name: `Test Group ${testId}`,
        include: [{ email_domain: { domain: "example.com" } }],
        exclude: [{ email: { email: "blocked@example.com" } }],
      });
      expect(group.id).toEqual(initialId);
      expect(group.exclude).toHaveLength(1);
    } finally {
      await destroy(scope);
      if (group?.id) {
        const response = await api.get(
          `/accounts/${api.accountId}/access/groups/${group.id}`,
        );
        expect(response.status).toEqual(404);
      }
    }
  });
});

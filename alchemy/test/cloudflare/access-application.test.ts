import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { AccessApplication } from "../../src/cloudflare/access-application.ts";
import { createCloudflareApi } from "../../src/cloudflare/api.ts";
import { destroy } from "../../src/destroy.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const api = await createCloudflareApi();

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

describe.skipIf(!process.env.ALL_TESTS)("AccessApplication Resource", () => {
  const testId = `${BRANCH_PREFIX}-access-app`;

  test("create, update, and delete bookmark application", async (scope) => {
    let app: AccessApplication | undefined;
    try {
      // Bookmark apps are account-scoped (no zone fixture needed).
      app = await AccessApplication(testId, {
        type: "bookmark",
        name: `Test Bookmark ${testId}`,
        domain: "https://example.com",
        appLauncherVisible: true,
      });
      expect(app.id).toBeTruthy();
      expect(app.type).toEqual("bookmark");
      expect(app.aud).toBeTruthy();
      const initialId = app.id;

      // Update name.
      app = await AccessApplication(testId, {
        type: "bookmark",
        name: `Updated Bookmark ${testId}`,
        domain: "https://example.com",
        appLauncherVisible: true,
      });
      expect(app.id).toEqual(initialId);
      expect(app.name).toEqual(`Updated Bookmark ${testId}`);
    } finally {
      await destroy(scope);
      if (app?.id) {
        const response = await api.get(
          `/accounts/${api.accountId}/access/apps/${app.id}`,
        );
        expect(response.status).toEqual(404);
      }
    }
  });
});

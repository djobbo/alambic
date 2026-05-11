import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { AccessIdentityProvider } from "../../src/cloudflare/access-identity-provider.ts";
import { createCloudflareApi } from "../../src/cloudflare/api.ts";
import { destroy } from "../../src/destroy.ts";
import { Secret } from "../../src/secret.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const api = await createCloudflareApi();

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

describe.skipIf(!process.env.ALL_TESTS)(
  "AccessIdentityProvider Resource",
  () => {
    const testId = `${BRANCH_PREFIX}-access-oidc-idp`;

    // Cloudflare allows only one OneTimePin IdP per account, which makes it a
    // poor choice for an integration test on accounts that already have one.
    // OIDC has no such constraint and accepts stub URLs at creation time, so
    // it exercises the create/update/delete path plus secret normalisation
    // (camelToSnakeWithSecrets + clientSecret -> Secret on output).
    test("create, update, and delete OIDC identity provider", async (scope) => {
      let idp: AccessIdentityProvider | undefined;
      try {
        idp = await AccessIdentityProvider(testId, {
          type: "oidc",
          name: `Test OIDC ${testId}`,
          authUrl: "https://idp.example.com/oauth2/authorize",
          tokenUrl: "https://idp.example.com/oauth2/token",
          certsUrl: "https://idp.example.com/oauth2/certs",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        });
        expect(idp.id).toBeTruthy();
        expect(idp.type).toEqual("oidc");
        // Output convention: secrets are always wrapped, even when the user
        // passed a raw string in props.
        expect(
          (idp as unknown as { clientSecret: Secret }).clientSecret,
        ).toBeInstanceOf(Secret);
        const initialId = idp.id;

        // Update name (and re-send the secret — Cloudflare requires it on PUT
        // or it overwrites with empty).
        idp = await AccessIdentityProvider(testId, {
          type: "oidc",
          name: `Updated OIDC ${testId}`,
          authUrl: "https://idp.example.com/oauth2/authorize",
          tokenUrl: "https://idp.example.com/oauth2/token",
          certsUrl: "https://idp.example.com/oauth2/certs",
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
        });
        expect(idp.id).toEqual(initialId);
        expect(idp.name).toEqual(`Updated OIDC ${testId}`);
      } finally {
        await destroy(scope);
        if (idp?.id) {
          const response = await api.get(
            `/accounts/${api.accountId}/access/identity_providers/${idp.id}`,
          );
          expect(response.status).toEqual(404);
        }
      }
    });
  },
);

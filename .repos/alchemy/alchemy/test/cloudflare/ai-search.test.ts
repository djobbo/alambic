import "../../src/test/vitest.ts";

import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import {
  AiSearchNamespace,
  deleteAiSearchNamespace,
  getAiSearchNamespace,
} from "../../src/cloudflare/ai-search-namespace.ts";
import { AiSearchToken } from "../../src/cloudflare/ai-search-token.ts";
import {
  AiSearch,
  deleteAiSearchInstance,
  getAiSearchInstance,
} from "../../src/cloudflare/ai-search.ts";
import { Ai } from "../../src/cloudflare/ai.ts";
import { createCloudflareApi } from "../../src/cloudflare/api.ts";
import { R2Bucket } from "../../src/cloudflare/bucket.ts";
import { Worker } from "../../src/cloudflare/worker.ts";
import { destroy } from "../../src/destroy.ts";
import { poll } from "../../src/util/poll.ts";
import { BRANCH_PREFIX } from "../util.ts";

// Create API client for verification
const api = await createCloudflareApi();

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

/**
 * Cleanup-safe error filter: swallow 404s (resource already gone), re-throw
 * everything else so real API errors (auth, 5xx, rate limit) surface in CI.
 * Replaces the dangerous `.catch(() => {})` pattern.
 */
function ignore404(e: unknown): void {
  if ((e as { status?: number })?.status !== 404) throw e;
}

describe("AiSearchToken Resource", () => {
  const testId = `${BRANCH_PREFIX}-ai-token`;

  test("create and delete AI Search token", async (scope) => {
    let token: AiSearchToken | undefined;

    try {
      // Create an AI Search token
      token = await AiSearchToken("test-token", {
        name: testId,
      });

      expect(token.tokenId).toBeTruthy();
      expect(token.accountTokenId).toBeTruthy();
      expect(token.name).toEqual(testId);
      expect(token.type).toEqual("ai_search_token");
      expect(token.cfApiId).toBeTruthy();
      expect(token.cfApiKey).toBeTruthy();
      expect(token.enabled).toBe(true);

      // Verify token was created by querying the API directly
      const getResponse = await api.get(
        `/accounts/${api.accountId}/ai-search/tokens/${token.tokenId}`,
      );
      expect(getResponse.status).toEqual(200);
    } finally {
      await destroy(scope);

      // Verify AI Search token was deleted. CF's delete is eventually
      // consistent — poll for up to 60s.
      if (token?.tokenId) {
        const capturedTokenId = token.tokenId;
        const getDeletedResponse = await poll({
          description: "wait for AI Search token deletion to propagate",
          fn: () =>
            api.get(
              `/accounts/${api.accountId}/ai-search/tokens/${capturedTokenId}`,
            ),
          predicate: (res) => res.status === 404,
          initialDelay: 500,
          maxDelay: 3000,
          timeout: 30_000,
        });
        expect(getDeletedResponse.status).toEqual(404);
      }
    }
  });
});

describe("AiSearch Resource", () => {
  const testId = `${BRANCH_PREFIX}-ai-search`;

  test("create, update, and delete AI Search instance with R2 source", async (scope) => {
    const instanceName = `${testId}-r2`;
    const bucketName = `${testId}-bucket`;

    let aiSearch: AiSearch | undefined;
    let bucket: R2Bucket | undefined;

    try {
      // Create an R2 bucket for the AI Search source
      bucket = await R2Bucket("test-bucket", {
        name: bucketName,
        adopt: true,
      });

      expect(bucket.name).toEqual(bucketName);

      // Create AI Search instance backed by R2 with automatic token creation
      aiSearch = await AiSearch("test-search", {
        name: instanceName,
        source: {
          type: "r2",
          bucket,
        },
        indexOnCreate: false, // skip index on create to speed up test
        adopt: true,
      });

      expect(aiSearch.id).toEqual(instanceName);
      expect(aiSearch.type).toEqual("r2");
      expect(aiSearch.source).toEqual(bucketName);
      expect(aiSearch.tokenId).toBeTruthy();
      expect(aiSearch.namespace).toEqual("default");
      // Note: internalId and vectorizeName may not be immediately available

      // Verify instance was created by querying the API directly
      const instance = await getAiSearchInstance(api, "default", instanceName);
      expect(instance.id).toEqual(instanceName);
      expect(instance.type).toEqual("r2");

      // Update the AI Search configuration
      aiSearch = await AiSearch("test-search", {
        name: instanceName,
        source: {
          type: "r2",
          bucket,
        },
        maxNumResults: 20,
        scoreThreshold: 0.5,
        reranking: true,
        indexOnCreate: false, // skip index on create to speed up test
        adopt: true,
      });

      expect(aiSearch.id).toEqual(instanceName);
      expect(aiSearch.maxNumResults).toEqual(20);
      expect(aiSearch.scoreThreshold).toEqual(0.5);
      expect(aiSearch.reranking).toEqual(true);

      // Verify instance was updated. Cloudflare's instance PUT is
      // eventually consistent — poll briefly for the new values.
      const updatedInstance = await poll({
        description: "wait for AI Search instance PUT to propagate",
        fn: () => getAiSearchInstance(api, "default", instanceName),
        predicate: (r) =>
          r.max_num_results === 20 &&
          r.score_threshold === 0.5 &&
          r.reranking === true,
        initialDelay: 500,
        maxDelay: 3000,
        timeout: 30_000,
      });
      expect(updatedInstance.max_num_results).toEqual(20);
      expect(updatedInstance.score_threshold).toEqual(0.5);
      expect(updatedInstance.reranking).toEqual(true);
    } finally {
      await destroy(scope);

      // Verify instance was deleted (namespace-scoped endpoint). CF's
      // delete is eventually consistent — poll until the GET flips to 404.
      const getResponse = await poll({
        description: "wait for instance deletion to propagate",
        fn: () =>
          api.get(
            `/accounts/${api.accountId}/ai-search/namespaces/default/instances/${instanceName}`,
          ),
        predicate: (res) => res.status === 404,
        initialDelay: 500,
        maxDelay: 3000,
        timeout: 30_000,
      });
      expect(getResponse.status).toEqual(404);
    }
  });

  test("create AI Search with bucket name string", async (scope) => {
    const instanceName = `${testId}-str`;
    const bucketName = `${testId}-str-bucket`;

    let aiSearch: AiSearch | undefined;

    try {
      // First create the bucket so it exists
      await R2Bucket("str-bucket", {
        name: bucketName,
        adopt: true,
      });

      // Create AI Search using bucket name string instead of resource
      aiSearch = await AiSearch("str-search", {
        name: instanceName,
        source: {
          type: "r2",
          bucket: bucketName, // String instead of R2Bucket resource
        },
        indexOnCreate: false, // skip index on create to speed up test
        adopt: true,
      });

      expect(aiSearch.id).toEqual(instanceName);
      expect(aiSearch.type).toEqual("r2");
      expect(aiSearch.source).toEqual(bucketName);
      expect(aiSearch.namespace).toEqual("default");
    } finally {
      await destroy(scope);
    }
  });

  test("create AI Search with invalid domain", async (scope) => {
    const instanceName = `${testId}-invalid`;

    try {
      // Explicitly assert the Promise rejects with the expected message. The
      // previous `try/catch` variant silently passed if `AiSearch()` resolved.
      await expect(
        AiSearch("invalid-search", {
          name: instanceName,
          source: {
            type: "web-crawler",
            domain: "invalid-domain.com",
          },
          adopt: true,
        }),
      ).rejects.toThrow(/The domain needs to belong to this account\./);
    } finally {
      await destroy(scope);
    }
  });

  test("create AI Search with R2Bucket shorthand", async (scope) => {
    // Keep the suffix short — `${testId}` already uses BRANCH_PREFIX which
    // varies in length between environments; AI Search instance names are
    // capped at 32 chars by Cloudflare.
    const instanceName = `${testId}-sh`;
    const bucketName = `${testId}-sh-bucket`;

    let aiSearch: AiSearch | undefined;

    try {
      const bucket = await R2Bucket("shorthand-bucket", {
        name: bucketName,
        adopt: true,
      });

      // Use shorthand: pass R2Bucket directly as source
      aiSearch = await AiSearch("shorthand-search", {
        name: instanceName,
        source: bucket, // Direct R2Bucket instead of { type: "r2", bucket }
        indexOnCreate: false, // skip index on create to speed up test
        adopt: true,
      });

      expect(aiSearch.id).toEqual(instanceName);
      expect(aiSearch.type).toEqual("r2");
      expect(aiSearch.source).toEqual(bucketName);
      expect(aiSearch.tokenId).toBeTruthy();
      expect(aiSearch.namespace).toEqual("default");
    } finally {
      await destroy(scope);
    }
  });

  test("create AI Search with explicit token", async (scope) => {
    const instanceName = `${testId}-explicit`;
    const bucketName = `${testId}-explicit-bucket`;

    let aiSearch: AiSearch | undefined;

    try {
      const bucket = await R2Bucket("explicit-bucket", {
        name: bucketName,
        adopt: true,
      });

      // Create an explicit token
      const token = await AiSearchToken("explicit-token", {
        name: `${testId}-explicit-token`,
      });

      // Create AI Search with explicit token
      aiSearch = await AiSearch("explicit-search", {
        name: instanceName,
        source: {
          type: "r2",
          bucket,
        },
        token, // Pass explicit token
        indexOnCreate: false, // skip index on create to speed up test
        adopt: true,
      });

      expect(aiSearch.id).toEqual(instanceName);
      expect(aiSearch.tokenId).toEqual(token.tokenId);
      expect(aiSearch.namespace).toEqual("default");
    } finally {
      await destroy(scope);
    }
  });

  test("create AI Search with custom models and chunking", async (scope) => {
    const instanceName = `${testId}-custom`;
    const bucketName = `${testId}-custom-bucket`;

    let aiSearch: AiSearch | undefined;

    try {
      const bucket = await R2Bucket("custom-bucket", {
        name: bucketName,
        adopt: true,
      });

      // Create AI Search with custom configuration
      aiSearch = await AiSearch("custom-search", {
        name: instanceName,
        source: {
          type: "r2",
          bucket,
        },
        chunkSize: 512,
        chunkOverlap: 20,
        maxNumResults: 15,
        scoreThreshold: 0.3,
        rewriteQuery: true,
        indexOnCreate: false, // skip index on create to speed up test
        adopt: true,
      });

      expect(aiSearch.id).toEqual(instanceName);
      expect(aiSearch.chunkSize).toEqual(512);
      expect(aiSearch.chunkOverlap).toEqual(20);
      expect(aiSearch.maxNumResults).toEqual(15);
      expect(aiSearch.scoreThreshold).toEqual(0.3);
      expect(aiSearch.rewriteQuery).toEqual(true);
      expect(aiSearch.namespace).toEqual("default");
    } finally {
      await destroy(scope);
    }
  });

  test("adopt preserves underlying AiSearch instance (createdAt + internalId stable)", async (scope) => {
    // Catches silent-recreate regressions: adoption must reuse the same
    // underlying Cloudflare resource, not destroy-then-recreate. The only
    // way to reliably prove this is to verify the server-assigned
    // createdAt and internalId are identical across the two calls.
    const instanceName = `${testId}-adopt`;
    const bucketName = `${testId}-adopt-bucket`;

    try {
      const bucket = await R2Bucket("adopt-bucket", {
        name: bucketName,
        adopt: true,
      });

      // Create initial instance
      const aiSearch1 = await AiSearch("adopt-search-1", {
        name: instanceName,
        source: {
          type: "r2",
          bucket,
        },
        maxNumResults: 10,
        indexOnCreate: false, // skip index on create to speed up test
      });

      expect(aiSearch1.id).toEqual(instanceName);
      const originalCreatedAt = aiSearch1.createdAt;
      const originalInternalId = aiSearch1.internalId;

      // Create second instance with same name - should adopt
      const aiSearch2 = await AiSearch("adopt-search-2", {
        name: instanceName,
        source: {
          type: "r2",
          bucket,
        },
        maxNumResults: 25,
        indexOnCreate: false, // skip index on create to speed up test
        adopt: true,
      });

      // Should have adopted and updated
      expect(aiSearch2.id).toEqual(instanceName);
      expect(aiSearch2.maxNumResults).toEqual(25);
      expect(aiSearch2.namespace).toEqual("default");
      // Adoption preserves the underlying resource: createdAt + internalId
      // must match the original exactly. If the resource had been silently
      // recreated, the server would have issued new values.
      expect(aiSearch2.createdAt).toEqual(originalCreatedAt);
      expect(aiSearch2.internalId).toEqual(originalInternalId);
    } finally {
      await destroy(scope);
    }
  });

  test("AI Search with delete false preserves instance", async (scope) => {
    const instanceName = `${testId}-nodelete`;
    const bucketName = `${testId}-nodelete-bucket`;

    try {
      const bucket = await R2Bucket("nodelete-bucket", {
        name: bucketName,
        adopt: true,
      });

      await AiSearch("nodelete-search", {
        name: instanceName,
        source: {
          type: "r2",
          bucket,
        },
        indexOnCreate: false, // skip index on create to speed up test
        delete: false, // don't delete on destroy
        adopt: true,
      });

      // Destroy the scope
      await destroy(scope);

      // Instance should still exist
      const instance = await getAiSearchInstance(api, "default", instanceName);
      expect(instance.id).toEqual(instanceName);
    } finally {
      await deleteAiSearchInstance(api, "default", instanceName);
    }
  });

  // Test aiSearch() with RAG response generation
  test(
    "AI Search with RAG response generation via Worker",
    async (scope) => {
      const instanceName = `${testId}-rag`;
      const bucketName = `${testId}-rag-bucket`;
      const workerName = `${testId}-rag-worker`;

      try {
        // 1. Create bucket with test content.
        // NOTE: `delete: false` (and `empty: true` is intentionally not set)
        // because AI Search holds a reference to the bucket — attempting
        // to delete or empty the bucket while an AI Search instance is
        // indexing it races with the indexing job and flakes CI. We leak
        // the test buckets into the account; they're cleaned up out-of-band.
        const bucket = await R2Bucket("rag-bucket", {
          name: bucketName,
          adopt: true,
          delete: false,
        });

        await bucket.put(
          "llama-care.md",
          `# How to Care for Llamas

## Feeding

Llamas eat grass, hay, and grain. Feed them twice daily.

## Housing

Provide a shelter with at least 40 square feet per llama.

## Health

Schedule regular vet checkups and keep vaccinations current.
`,
        );

        // 2. Create AI Search instance
        const aiSearch = await AiSearch("rag-search", {
          name: instanceName,
          source: {
            type: "r2",
            bucket,
          },
          cache: false,
          adopt: true,
        });

        expect(aiSearch.id).toEqual(instanceName);

        // 3. Create worker that uses aiSearch (RAG)
        const worker = await Worker(workerName, {
          name: workerName,
          adopt: true,
          script: `
            export default {
              async fetch(request, env, ctx) {
                try {
                  // Access AI Search through the AI binding using RAG_ID
                  const result = await env.AI.autorag(env.RAG_ID).aiSearch({
                    query: "How do I feed a llama?",
                    max_num_results: 3,
                  });
                  
                  return Response.json({
                    success: true,
                    hasResponse: !!result.response,
                    responseLength: result.response?.length || 0,
                    sourceCount: result.data?.length || 0,
                  });
                } catch (error) {
                  return Response.json({
                    success: false,
                    error: error.message,
                  }, { status: 500 });
                }
              }
            };
          `,
          format: "esm",
          url: true,
          bindings: {
            AI: Ai(),
            RAG_ID: aiSearch.id, // Pass the actual instance name
          },
        });

        expect(worker.url).toBeTruthy();

        // 5. Verify RAG response. `poll.initialDelay` handles the initial
        // warm-up (was previously preceded by a bare `setTimeout(2000)` magic
        // sleep; removed in favor of letting `poll` drive the cadence).
        // The fetch itself can return HTML error pages (e.g. 404 from a not-
        // yet-ready worker) — tolerate JSON parse errors as "not ready".
        type RagResponse = {
          success: boolean;
          hasResponse?: boolean;
          responseLength?: number;
          sourceCount?: number;
        };
        const data = await poll({
          description: "wait for AI Search to be ready",
          fn: async (): Promise<RagResponse> => {
            const url = new URL(worker.url!);
            url.searchParams.set("q", "installation");
            try {
              const response = await fetch(url);
              const contentType = response.headers.get("content-type") ?? "";
              if (!contentType.includes("application/json")) {
                return { success: false };
              }
              return (await response.json()) as RagResponse;
            } catch {
              return { success: false };
            }
          },
          predicate: (result) =>
            result.success === true && (result.sourceCount ?? 0) > 0,
          initialDelay: 5000,
          maxDelay: 10_000,
          // Explicit timeout — produces a clearer failure than vitest's
          // outer test timeout (which just reports "test timed out").
          timeout: 8 * 60_000,
        });

        expect(data.success).toBe(true);
        // AI Search with RAG should generate a response based on source documents
        expect(data.hasResponse).toBe(true);
        expect(data.responseLength).toBeGreaterThan(0);
        expect(data.sourceCount).toBeGreaterThan(0);
      } finally {
        await destroy(scope);

        // Verify instance was deleted. CF's instance delete is eventually
        // consistent — same-colo is immediate (edge cache invalidation),
        // cross-colo is bounded to ~60s (KV TTL).
        const getResponse = await poll({
          description: "wait for RAG instance deletion to propagate",
          fn: () =>
            api.get(
              `/accounts/${api.accountId}/ai-search/namespaces/default/instances/${instanceName}`,
            ),
          predicate: (res) => res.status === 404,
          initialDelay: 500,
          maxDelay: 5000,
          timeout: 90_000,
        });
        expect(getResponse.status).toEqual(404);
      }
    },
    60_000 * 10,
  );

  test("create sourceless AI Search instance (built-in storage)", async (scope) => {
    const instanceName = `${testId}-nosrc`;

    let aiSearch: AiSearch | undefined;

    try {
      // Create AI Search instance without a source (built-in storage)
      aiSearch = await AiSearch("nosrc-search", {
        name: instanceName,
        adopt: true,
      });

      expect(aiSearch.id).toEqual(instanceName);
      expect(aiSearch.namespace).toEqual("default");
      // Sourceless instances don't have a user-facing source
      expect(aiSearch.source).toBeFalsy();

      // Verify instance was created
      const instance = await getAiSearchInstance(api, "default", instanceName);
      expect(instance.id).toEqual(instanceName);
      expect(instance.source).toBeFalsy();
    } finally {
      await destroy(scope);
    }
  });

  test("create AI Search instance in custom namespace", async (scope) => {
    const namespaceName = `${testId}-ns`;
    const instanceName = `${testId}-ns-inst`;

    try {
      // Create a namespace
      const ns = await AiSearchNamespace("test-ns", {
        name: namespaceName,
        adopt: true,
      });

      expect(ns.namespace).toEqual(namespaceName);
      expect(ns.type).toEqual("ai_search_namespace");

      // Create instance in that namespace
      const aiSearch = await AiSearch("ns-search", {
        name: instanceName,
        namespace: ns,
        adopt: true,
      });

      expect(aiSearch.id).toEqual(instanceName);
      expect(aiSearch.namespace).toEqual(namespaceName);

      // Verify instance exists in the namespace
      const instance = await getAiSearchInstance(
        api,
        namespaceName,
        instanceName,
      );
      expect(instance.id).toEqual(instanceName);
    } finally {
      await destroy(scope);

      // Clean up namespace (should be empty after instance deletion)
      await deleteAiSearchNamespace(api, namespaceName);
    }
  });
});

describe("AiSearchNamespace Resource", () => {
  const testId = `${BRANCH_PREFIX}-ai-ns`;

  test("create and delete AI Search namespace", async (scope) => {
    const namespaceName = `${testId}-crud`;

    try {
      const ns = await AiSearchNamespace("crud-ns", {
        name: namespaceName,
        description: "Test namespace",
      });

      expect(ns.type).toEqual("ai_search_namespace");
      expect(ns.namespace).toEqual(namespaceName);
      expect(ns.description).toEqual("Test namespace");
      expect(ns.createdAt).toBeTruthy();

      // Verify namespace was created by querying the API directly
      const existing = await getAiSearchNamespace(api, namespaceName);
      expect(existing).toBeTruthy();
      expect(existing!.name).toEqual(namespaceName);
    } finally {
      await destroy(scope);

      // Verify namespace was deleted. Cloudflare's namespace delete is
      // eventually consistent — poll briefly until the GET returns
      // `undefined` (helper maps 404 → undefined) before asserting.
      const deleted = await poll({
        description: "wait for namespace deletion to propagate",
        fn: () => getAiSearchNamespace(api, namespaceName),
        predicate: (r) => r === undefined,
        initialDelay: 500,
        maxDelay: 3000,
        timeout: 30_000,
      });
      expect(deleted).toBeUndefined();
    }
  });

  test("adopt existing AI Search namespace", async (scope) => {
    const namespaceName = `${testId}-adopt`;

    try {
      // Create initial namespace
      const ns1 = await AiSearchNamespace("adopt-ns-1", {
        name: namespaceName,
      });

      expect(ns1.namespace).toEqual(namespaceName);

      // Create second namespace with same name - should adopt
      const ns2 = await AiSearchNamespace("adopt-ns-2", {
        name: namespaceName,
        description: "Adopted namespace",
        adopt: true,
      });

      expect(ns2.namespace).toEqual(namespaceName);
      expect(ns2.description).toEqual("Adopted namespace");
    } finally {
      await destroy(scope);

      // Clean up
      await deleteAiSearchNamespace(api, namespaceName);
    }
  });

  test("adopt preserves underlying resource (createdAt match)", async (scope) => {
    const namespaceName = `${testId}-av`;

    try {
      // Create initial namespace, capture createdAt
      const ns1 = await AiSearchNamespace("adopt-verify-1", {
        name: namespaceName,
      });
      expect(ns1.namespace).toEqual(namespaceName);
      const originalCreatedAt = ns1.createdAt;

      // Second create with adopt: true — should adopt the SAME underlying namespace,
      // not create a new one. The createdAt must remain identical.
      const ns2 = await AiSearchNamespace("adopt-verify-2", {
        name: namespaceName,
        adopt: true,
      });

      expect(ns2.namespace).toEqual(namespaceName);
      expect(ns2.createdAt).toEqual(originalCreatedAt);
    } finally {
      await destroy(scope);
      await deleteAiSearchNamespace(api, namespaceName);
    }
  });

  test("rename triggers replace (old deleted, new created)", async (scope) => {
    const originalName = `${testId}-ra`;
    const renamedName = `${testId}-rb`;

    try {
      // Create namespace with initial name
      const ns1 = await AiSearchNamespace("rename-ns", {
        name: originalName,
      });
      expect(ns1.namespace).toEqual(originalName);
      await scope.finalize();

      // Verify initial namespace exists
      const initialExists = await getAiSearchNamespace(api, originalName);
      expect(initialExists).toBeTruthy();

      // Rename — triggers this.replace()
      const ns2 = await AiSearchNamespace("rename-ns", {
        name: renamedName,
      });
      expect(ns2.namespace).toEqual(renamedName);
      await scope.finalize();

      // Original must be gone, new one present. The delete fires during
      // scope.finalize() (pending-deletion flush), but CF's namespace
      // delete is eventually consistent — poll briefly.
      const oldExists = await poll({
        description: "wait for old namespace deletion to propagate",
        fn: () => getAiSearchNamespace(api, originalName),
        predicate: (r) => r === undefined,
        initialDelay: 500,
        maxDelay: 3000,
        timeout: 30_000,
      });
      expect(oldExists).toBeUndefined();
      const newExists = await getAiSearchNamespace(api, renamedName);
      expect(newExists).toBeTruthy();
    } finally {
      await destroy(scope);
      // Cleanup both just in case
      await deleteAiSearchNamespace(api, originalName).catch(ignore404);
      await deleteAiSearchNamespace(api, renamedName).catch(ignore404);
    }
  });

  test("description round-trips through the API (set → update → clear with null)", async (scope) => {
    // Covers the three-way semantics on `description`:
    //   - absent (undefined)  → do not touch
    //   - string              → set
    //   - null                → clear
    const namespaceName = `${testId}-desc`;

    try {
      // (1) Create with an initial description
      const ns1 = await AiSearchNamespace("desc-ns", {
        name: namespaceName,
        description: "initial description",
      });
      expect(ns1.description).toEqual("initial description");

      // Verify via API read that it was persisted server-side, not just
      // mirrored in Alchemy output.
      const apiView1 = await getAiSearchNamespace(api, namespaceName);
      expect(apiView1?.description).toEqual("initial description");

      // (2) Update with a new description — must PUT.
      const ns2 = await AiSearchNamespace("desc-ns", {
        name: namespaceName,
        description: "updated description",
      });
      expect(ns2.description).toEqual("updated description");

      // Cloudflare's namespace PUT is eventually consistent — poll briefly
      // until the GET surfaces the new value before asserting.
      const apiView2 = await poll({
        description: "wait for namespace description update to propagate",
        fn: () => getAiSearchNamespace(api, namespaceName),
        predicate: (r) => r?.description === "updated description",
        initialDelay: 500,
        maxDelay: 2000,
        timeout: 15_000,
      });
      expect(apiView2?.description).toEqual("updated description");

      // (3) Clear by passing null explicitly.
      const ns3 = await AiSearchNamespace("desc-ns", {
        name: namespaceName,
        description: null,
      });
      expect(ns3.description).toBeNull();

      const apiView3 = await poll({
        description: "wait for namespace description clear to propagate",
        fn: () => getAiSearchNamespace(api, namespaceName),
        // API surfaces cleared description as null or empty string — both OK.
        predicate: (r) => !r?.description,
        initialDelay: 500,
        maxDelay: 2000,
        timeout: 15_000,
      });
      expect(apiView3?.description ?? null).toBeFalsy();
    } finally {
      await destroy(scope);
      await deleteAiSearchNamespace(api, namespaceName).catch(ignore404);
    }
  });

  test("adopt on reserved default namespace binds without create", async (scope) => {
    // The `default` namespace is reserved by Cloudflare — create/update/
    // delete via the API all fail. Alchemy must bind to it via `adopt: true`
    // without issuing any CREATE request, and destroy must NOT attempt to
    // delete it.
    const ns = await AiSearchNamespace("default-adoption", {
      name: "default",
      adopt: true,
    });
    expect(ns.namespace).toEqual("default");
    expect(ns.type).toEqual("ai_search_namespace");

    // Destroy must be a no-op for the default namespace (the helper
    // skips it silently). If this throws, the implementation is attempting
    // an illegal DELETE and we want the test to fail loudly.
    await destroy(scope);
  });

  test("rejects names that violate Cloudflare's character rules", async (scope) => {
    // Local validation catches bad names before any API call. This test
    // locks in the documented regex: ^[a-z0-9]([a-z0-9-]{0,26}[a-z0-9])?$
    try {
      await expect(
        AiSearchNamespace("bad-start", { name: "-leading-hyphen" }),
      ).rejects.toThrow(/invalid/i);

      await expect(
        AiSearchNamespace("bad-end", { name: "trailing-hyphen-" }),
      ).rejects.toThrow(/invalid/i);

      await expect(
        AiSearchNamespace("bad-upper", { name: "HasUppercase" }),
      ).rejects.toThrow(/invalid/i);
    } finally {
      await destroy(scope);
    }
  });

  test("delete=false preserves namespace on scope destroy", async (scope) => {
    const namespaceName = `${testId}-nd`;

    try {
      await AiSearchNamespace("nodelete-ns", {
        name: namespaceName,
        delete: false,
      });

      // Destroy scope — namespace should still exist
      await destroy(scope);

      const stillExists = await getAiSearchNamespace(api, namespaceName);
      expect(stillExists).toBeTruthy();
      expect(stillExists!.name).toEqual(namespaceName);
    } finally {
      // Manual cleanup (delete: false means scope destroy didn't remove it)
      await deleteAiSearchNamespace(api, namespaceName);
    }
  });
});

describe("AiSearch namespace + binding integration", () => {
  const testId = `${BRANCH_PREFIX}-bnd`;

  test("sourceless instance update changes maxNumResults without replacing the instance", async (scope) => {
    const instanceName = `${testId}-srcupd`;

    try {
      // Create sourceless instance
      let aiSearch = await AiSearch("srcless-upd", {
        name: instanceName,
        maxNumResults: 10,
        adopt: true,
      });
      expect(aiSearch.maxNumResults).toEqual(10);
      // Alchemy must not auto-create a service token for sourceless instances
      // (the API may still surface an internal default token_id — that's fine).
      expect(aiSearch.source).toBeFalsy();

      const initialInternalId = aiSearch.internalId;

      // Update maxNumResults — must not trigger a replace (internalId stable)
      aiSearch = await AiSearch("srcless-upd", {
        name: instanceName,
        maxNumResults: 25,
        adopt: true,
      });
      expect(aiSearch.maxNumResults).toEqual(25);
      expect(aiSearch.source).toBeFalsy();
      expect(aiSearch.internalId).toEqual(initialInternalId);

      // Verify on the API
      const instance = await getAiSearchInstance(api, "default", instanceName);
      expect(instance.max_num_results).toEqual(25);
      expect(instance.source).toBeFalsy();
    } finally {
      await destroy(scope);
      // Verify gone. Cloudflare's delete endpoint is eventually consistent —
      // poll briefly until the GET flips to 404 before failing the test.
      const after = await poll({
        description: "wait for instance deletion to propagate",
        fn: () =>
          api.get(
            `/accounts/${api.accountId}/ai-search/namespaces/default/instances/${instanceName}`,
          ),
        predicate: (res) => res.status === 404,
        initialDelay: 500,
        maxDelay: 3000,
        timeout: 30_000,
      });
      expect(after.status).toEqual(404);
    }
  });

  test("changing namespace on an existing instance triggers replace", async (scope) => {
    // Covers the critical path where a user moves an AI Search instance
    // from one namespace to another. Because namespace is immutable on the
    // CF side, Alchemy must delete the old instance and create a new one
    // (rather than silently attempting an in-place PUT against the new
    // namespace and leaking the old instance).
    const namespaceName = `${testId}-mvns`;
    const instanceName = `${testId}-mvinst`;

    try {
      await AiSearchNamespace("mv-ns", {
        name: namespaceName,
        adopt: true,
      });

      // Create in default namespace first
      const first = await AiSearch("mv-inst", {
        name: instanceName,
        adopt: true,
      });
      expect(first.namespace).toEqual("default");
      await scope.finalize();

      const inDefault = await getAiSearchInstance(api, "default", instanceName);
      expect(inDefault.id).toEqual(instanceName);

      // Move to custom namespace — must trigger this.replace()
      const second = await AiSearch("mv-inst", {
        name: instanceName,
        namespace: namespaceName,
        adopt: true,
      });
      expect(second.namespace).toEqual(namespaceName);
      await scope.finalize();

      // Old (default) must be gone; new (custom ns) must exist. Delete is
      // eventually consistent — poll for the old instance to vanish.
      const oldGone = await poll({
        description: "wait for old instance deletion to propagate",
        fn: () =>
          getAiSearchInstance(api, "default", instanceName).catch((e) =>
            e?.status === 404 ? undefined : Promise.reject(e),
          ),
        predicate: (r) => r === undefined,
        initialDelay: 500,
        maxDelay: 3000,
        timeout: 30_000,
      });
      expect(oldGone).toBeUndefined();

      const newInstance = await getAiSearchInstance(
        api,
        namespaceName,
        instanceName,
      );
      expect(newInstance.id).toEqual(instanceName);
    } finally {
      await deleteAiSearchInstance(api, "default", instanceName).catch(
        ignore404,
      );
      await deleteAiSearchInstance(api, namespaceName, instanceName).catch(
        ignore404,
      );
      await destroy(scope).catch(ignore404);
      await deleteAiSearchNamespace(api, namespaceName).catch(ignore404);
    }
  });

  test("namespace prop accepts a string (not just a Resource)", async (scope) => {
    const namespaceName = `${testId}-sns`;
    const instanceName = `${testId}-sinst`;

    try {
      // Pre-create the namespace since AiSearch doesn't create it for us
      await AiSearchNamespace("str-ns", {
        name: namespaceName,
        adopt: true,
      });

      // Use the namespace as a plain string
      const aiSearch = await AiSearch("str-inst", {
        name: instanceName,
        namespace: namespaceName, // string, not a Resource
        adopt: true,
      });

      expect(aiSearch.namespace).toEqual(namespaceName);

      // Verify on the API (namespace-scoped endpoint)
      const instance = await getAiSearchInstance(
        api,
        namespaceName,
        instanceName,
      );
      expect(instance.id).toEqual(instanceName);
    } finally {
      await destroy(scope);
      await deleteAiSearchNamespace(api, namespaceName);
    }
  });

  test("single-instance binding rejects non-default namespace at deploy time", async (scope) => {
    const namespaceName = `${testId}-rjns`;
    const instanceName = `${testId}-rjinst`;
    const workerName = `${testId}-rjwkr`;

    try {
      const ns = await AiSearchNamespace("reject-ns", {
        name: namespaceName,
        adopt: true,
      });

      // Instance in a custom namespace
      const aiSearch = await AiSearch("reject-inst", {
        name: instanceName,
        namespace: ns,
        adopt: true,
      });
      expect(aiSearch.namespace).toEqual(namespaceName);

      // Attempt to bind it as a single-instance binding — must fail
      await expect(
        Worker(workerName, {
          name: workerName,
          adopt: true,
          script: "export default { fetch() { return new Response('hi'); } };",
          format: "esm",
          bindings: {
            SEARCH: aiSearch, // ← single-instance binding, but namespace isn't "default"
          },
        }),
      ).rejects.toThrow(/single-instance AiSearch binding/);
    } finally {
      await destroy(scope);
      await deleteAiSearchNamespace(api, namespaceName);
    }
  });
});

import type { AutoRagAiSearchResponse } from "@cloudflare/workers-types";
import assert from "node:assert";
import { poll } from "../../alchemy/src/util/poll";

export async function test(props: { url: string }) {
  console.log("testing", props.url);
  await poll({
    description: "wait for worker to be ready",
    fn: () => fetch(props.url),
    predicate: (res) => res.ok,
    timeout: 90_000,
  });
  console.log("worker ready");
  await poll({
    description: "wait for index ready",
    fn: () => {
      const url = new URL(props.url);
      url.pathname = "/search";
      url.searchParams.set("q", "What is the capital of France?");
      return fetch(url);
    },
    predicate: (res) => res.ok,
    initialDelay: 5000,
    maxDelay: 10_000,
    timeout: 8 * 60_000,
  });
  console.log("index ready");

  // 1. /legacy/query — legacy AI.autorag() path
  {
    const url = new URL(props.url);
    url.pathname = "/legacy/query";
    url.searchParams.set("q", "What is the capital of France?");
    const response = await fetch(url);
    const result = (await response.json()) as AutoRagAiSearchResponse;
    assert(
      result.response.includes("Paris"),
      `Paris is not in the response: ${result.response}`,
    );
    assert(result.data.length > 0, "No data returned");
    assert.equal(result.data[0].filename, "france.txt");
    console.log("legacy/query: success");
  }

  // 2. /search — ai_search binding
  {
    const url = new URL(props.url);
    url.pathname = "/search";
    url.searchParams.set("q", "What is the capital of France?");
    const response = await fetch(url);
    assert(response.ok, `/search failed: ${response.status}`);
    const result = (await response.json()) as {
      chunks?: Array<{ text?: string }>;
    };
    assert((result.chunks?.length ?? 0) > 0, "/search returned no chunks");
    // Parity with the legacy path: verify the retrieved chunks actually
    // surface "Paris" from the seeded `france.txt` document. Without this,
    // the assertion was only checking that *some* chunk came back, which
    // could succeed even if the ranking was completely broken.
    assert(
      result.chunks!.some((c) => c.text?.toLowerCase().includes("paris")),
      `/search did not surface "Paris" in any chunk: ${JSON.stringify(result.chunks)}`,
    );
    console.log("/search: success");
  }

  // 3. /list — ai_search_namespaces binding
  {
    const url = new URL(props.url);
    url.pathname = "/list";
    const response = await fetch(url);
    assert(response.ok, `/list failed: ${response.status}`);
    const result = (await response.json()) as {
      result?: Array<{ id: string }>;
    };
    // result.result may be empty if the namespace has no instances yet,
    // but the call must succeed.
    assert(Array.isArray(result.result), "/list did not return an array");
    console.log("/list: success");
  }

  console.log("success");
}

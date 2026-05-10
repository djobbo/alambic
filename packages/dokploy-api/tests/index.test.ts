import type * as HttpClientPkg from "effect/unstable/http/HttpClient";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, test } from "vite-plus/test";

import { Error_BAD_REQUEST, make, normalizeDokployBaseUrl } from "../src/index.ts";

describe("@crucible/dokploy-api", () => {
  test("decode BAD_REQUEST envelope (Exit smoke)", () => {
    const exit = Schema.decodeUnknownExit(Error_BAD_REQUEST)({
      message: "nope",
      code: "BAD",
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.message).toBe("nope");
      expect(exit.value.code).toBe("BAD");
    }
  });

  test("make exposes adminSetupMonitoring", () => {
    const client = make(null as unknown as HttpClientPkg.HttpClient);
    expect(typeof client.adminSetupMonitoring).toBe("function");
  });

  test("normalizeDokployBaseUrl trims trailing slashes", () => {
    expect(normalizeDokployBaseUrl("https://example.com/api/ ")).toBe("https://example.com/api");
  });
});

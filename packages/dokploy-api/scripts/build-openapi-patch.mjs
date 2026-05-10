/**
 * Maintainer helper: regenerate `openapi.codegen.patch.json`
 * whenever `.repos/dokploy/openapi.json` gains paths/operations again.
 *
 * **`openapi.codegen.response-patch.json` is not touched here** — keep response-schema JSON Patch
 * ops there; `scripts/codegen.mjs` merges security + response patches before `openapigen`.
 *
 * Usage (from repo root): `node packages/dokploy-api/scripts/build-openapi-patch.mjs`
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const specPath = path.resolve(pkgRoot, "../../.repos/dokploy/openapi.json");

const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);

/** @param {string} segment */
function escapeSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
/** @type {Array<{ op: string, path: string, value?: unknown }>} */
const ops = [];

for (const [pathKey, pathItem] of Object.entries(spec.paths ?? {})) {
  if (!pathItem || typeof pathItem !== "object") continue;

  for (const [method, op] of Object.entries(pathItem)) {
    if (!methods.has(method)) continue;
    if (!op || typeof op !== "object" || !Array.isArray(op.security)) continue;

    const needsPatch = op.security.some((s) => s && typeof s === "object" && "Authorization" in s);
    if (!needsPatch) continue;

    const pointer = `/paths/${escapeSegment(pathKey)}/${method}/security`;
    ops.push({ op: "replace", path: pointer, value: [{ apiKey: [] }] });
  }
}

const outPath = path.join(pkgRoot, "openapi.codegen.patch.json");
fs.writeFileSync(outPath, `${JSON.stringify(ops, null, 2)}\n`);
console.warn(`wrote ${ops.length} JSON Patch ops to ${outPath}`);

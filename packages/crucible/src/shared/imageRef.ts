/**
 * Plain Docker image reference (no build context).
 */
export type PlainImageRef =
  | { readonly kind: "tag"; readonly value: string }
  | { readonly kind: "digest"; readonly value: string };

/** Canonical image string for APIs (`repo:tag` or `@sha256:…`). */
export const formatImageRef = (ref: PlainImageRef): string =>
  ref.kind === "tag" ? ref.value : ref.value;

import * as Data from "effect/Data";

export class DokployApiError extends Data.TaggedError("DokployApiError")<{
  readonly message: string;
  readonly status?: number;
  readonly path?: string;
  readonly body?: unknown;
}> {}

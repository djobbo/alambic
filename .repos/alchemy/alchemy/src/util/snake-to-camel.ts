/**
 * Convert a snake_case string to camelCase.
 * @example "account_id" -> "accountId", "created_at" -> "createdAt"
 */
export function snakeToCamelString(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Recursively convert an object's keys from snake_case to camelCase.
 * Arrays and nested objects are traversed; primitives, Date, and RegExp are returned as-is.
 */
export function snakeToCamelObjectDeep<T>(obj: T): SnakeToCamel<T> {
  if (obj === undefined || obj === null) {
    return obj as SnakeToCamel<T>;
  }
  if (typeof obj !== "object") {
    return obj as SnakeToCamel<T>;
  }
  if (obj instanceof RegExp || obj instanceof Date) {
    return obj as SnakeToCamel<T>;
  }
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamelObjectDeep) as SnakeToCamel<T>;
  }
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      snakeToCamelString(key),
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? snakeToCamelObjectDeep(value)
        : Array.isArray(value)
          ? value.map(snakeToCamelObjectDeep)
          : value,
    ]),
  ) as SnakeToCamel<T>;
}

/**
 * Convert a snake_case string to camelCase at the type level.
 */
export type SnakeToCamelString<S extends string> =
  S extends `${infer A}_${infer B}`
    ? `${A}${Capitalize<SnakeToCamelString<B>>}`
    : S;

/**
 * Recursively convert an object type's keys from snake_case to camelCase.
 */
export type SnakeToCamel<T> = T extends object
  ? T extends Array<infer U>
    ? Array<SnakeToCamel<U>>
    : T extends Date | RegExp | Function
      ? T
      : {
          [K in keyof T as K extends string
            ? SnakeToCamelString<K>
            : K]: SnakeToCamel<T[K]>;
        }
  : T;

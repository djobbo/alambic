import { describe, expect, it } from "vitest";
import {
  snakeToCamelObjectDeep,
  snakeToCamelString,
} from "../../src/util/snake-to-camel.ts";

describe("snakeToCamelString", () => {
  it("converts simple snake_case to camelCase", () => {
    expect(snakeToCamelString("foo_bar")).toBe("fooBar");
  });

  it("converts multiple underscores", () => {
    expect(snakeToCamelString("foo_bar_baz")).toBe("fooBarBaz");
  });

  it("returns lowercase single word as-is", () => {
    expect(snakeToCamelString("foo")).toBe("foo");
  });

  it("converts account_id to accountId", () => {
    expect(snakeToCamelString("account_id")).toBe("accountId");
  });

  it("converts created_at to createdAt", () => {
    expect(snakeToCamelString("created_at")).toBe("createdAt");
  });
});

describe("snakeToCamelObjectDeep", () => {
  describe("null and undefined handling", () => {
    it("returns undefined for undefined input", () => {
      const result = snakeToCamelObjectDeep(undefined);
      expect(result).toBeUndefined();
    });

    it("returns null for null input", () => {
      const result = snakeToCamelObjectDeep(null);
      expect(result).toBeNull();
    });
  });

  describe("primitive types", () => {
    it("returns string as-is", () => {
      const result = snakeToCamelObjectDeep("hello");
      expect(result).toBe("hello");
    });

    it("returns number as-is", () => {
      const result = snakeToCamelObjectDeep(42);
      expect(result).toBe(42);
    });

    it("returns boolean as-is", () => {
      const result = snakeToCamelObjectDeep(true);
      expect(result).toBe(true);
    });

    it("returns false boolean as-is", () => {
      const result = snakeToCamelObjectDeep(false);
      expect(result).toBe(false);
    });
  });

  describe("simple snake_case to camelCase conversion", () => {
    it("converts simple snake_case key", () => {
      const result = snakeToCamelObjectDeep({ foo_bar: "value" });
      expect(result).toEqual({ fooBar: "value" });
    });

    it("converts multiple snake_case keys", () => {
      const result = snakeToCamelObjectDeep({
        first_name: "John",
        last_name: "Doe",
        email_address: "john@example.com",
      });
      expect(result).toEqual({
        firstName: "John",
        lastName: "Doe",
        emailAddress: "john@example.com",
      });
    });

    it("converts key with multiple underscores", () => {
      const result = snakeToCamelObjectDeep({ foo_bar_baz: "value" });
      expect(result).toEqual({ fooBarBaz: "value" });
    });

    it("preserves lowercase single word key", () => {
      const result = snakeToCamelObjectDeep({ foo: "value" });
      expect(result).toEqual({ foo: "value" });
    });

    it("converts single word key with leading underscore to camelCase", () => {
      const result = snakeToCamelObjectDeep({ _foo: "value" });
      expect(result).toEqual({ Foo: "value" });
    });
  });

  describe("acronym and multi-segment handling", () => {
    it("handles foo_bar pattern", () => {
      const result = snakeToCamelObjectDeep({ foo_bar: "value" });
      expect(result).toEqual({ fooBar: "value" });
    });

    it("handles xml_parser pattern", () => {
      const result = snakeToCamelObjectDeep({ xml_parser: "value" });
      expect(result).toEqual({ xmlParser: "value" });
    });

    it("handles get_http_response pattern", () => {
      const result = snakeToCamelObjectDeep({ get_http_response: "value" });
      expect(result).toEqual({ getHttpResponse: "value" });
    });

    it("handles user_id suffix", () => {
      const result = snakeToCamelObjectDeep({ user_id: "value" });
      expect(result).toEqual({ userId: "value" });
    });

    it("handles url_path pattern", () => {
      const result = snakeToCamelObjectDeep({ url_path: "value" });
      expect(result).toEqual({ urlPath: "value" });
    });

    it("handles get_htmlurl_parser pattern", () => {
      const result = snakeToCamelObjectDeep({ get_htmlurl_parser: "value" });
      expect(result).toEqual({ getHtmlurlParser: "value" });
    });
  });

  describe("array handling", () => {
    it("handles array of primitives", () => {
      const result = snakeToCamelObjectDeep([1, 2, 3]);
      expect(result).toEqual([1, 2, 3]);
    });

    it("handles array of strings", () => {
      const result = snakeToCamelObjectDeep(["a", "b", "c"]);
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("handles object with arrays of strings", () => {
      const result = snakeToCamelObjectDeep({ some_array: ["a", "b", "c"] });
      expect(result).toEqual({ someArray: ["a", "b", "c"] });
    });

    it("handles array of objects", () => {
      const result = snakeToCamelObjectDeep([
        { first_name: "John" },
        { first_name: "Jane" },
      ]);
      expect(result).toEqual([{ firstName: "John" }, { firstName: "Jane" }]);
    });

    it("handles empty array", () => {
      const result = snakeToCamelObjectDeep([]);
      expect(result).toEqual([]);
    });

    it("handles mixed array of objects and primitives", () => {
      const result = snakeToCamelObjectDeep([
        { foo_bar: "value" },
        42,
        "string",
        null,
      ]);
      expect(result).toEqual([{ fooBar: "value" }, 42, "string", null]);
    });
  });

  describe("nested objects", () => {
    it("handles nested object", () => {
      const result = snakeToCamelObjectDeep({
        outer_key: {
          inner_key: "value",
        },
      });
      expect(result).toEqual({
        outerKey: {
          innerKey: "value",
        },
      });
    });

    it("handles deeply nested objects", () => {
      const result = snakeToCamelObjectDeep({
        outer_level: {
          middle_level: {
            inner_level: {
              deep_value: "value",
            },
          },
        },
      });
      expect(result).toEqual({
        outerLevel: {
          middleLevel: {
            innerLevel: {
              deepValue: "value",
            },
          },
        },
      });
    });

    it("handles object with array property", () => {
      const result = snakeToCamelObjectDeep({
        user_list: [{ first_name: "John" }, { first_name: "Jane" }],
      });
      expect(result).toEqual({
        userList: [{ firstName: "John" }, { firstName: "Jane" }],
      });
    });

    it("handles object with mixed nested content", () => {
      const result = snakeToCamelObjectDeep({
        user_name: "John",
        user_details: {
          phone_number: "123-456-7890",
          email_addresses: ["john@example.com", "doe@example.com"],
        },
        user_roles: [
          { role_name: "admin", role_id: 1 },
          { role_name: "user", role_id: 2 },
        ],
      });
      expect(result).toEqual({
        userName: "John",
        userDetails: {
          phoneNumber: "123-456-7890",
          emailAddresses: ["john@example.com", "doe@example.com"],
        },
        userRoles: [
          { roleName: "admin", roleId: 1 },
          { roleName: "user", roleId: 2 },
        ],
      });
    });
  });

  describe("edge cases", () => {
    it("handles empty object", () => {
      const result = snakeToCamelObjectDeep({});
      expect(result).toEqual({});
    });

    it("handles key with number suffix", () => {
      const result = snakeToCamelObjectDeep({ item1: "value", item2: "value" });
      expect(result).toEqual({ item1: "value", item2: "value" });
    });

    it("handles key with number in middle", () => {
      const result = snakeToCamelObjectDeep({ user2_name: "value" });
      expect(result).toEqual({ user2Name: "value" });
    });

    it("handles already camelCase key", () => {
      const result = snakeToCamelObjectDeep({ fooBar: "value" });
      expect(result).toEqual({ fooBar: "value" });
    });

    it("handles single character key", () => {
      const result = snakeToCamelObjectDeep({ a: "value" });
      expect(result).toEqual({ a: "value" });
    });

    it("handles key with single letter after underscore", () => {
      const result = snakeToCamelObjectDeep({ a_b: "value" });
      expect(result).toEqual({ aB: "value" });
    });

    it("handles value with null", () => {
      const result = snakeToCamelObjectDeep({ foo_bar: null });
      expect(result).toEqual({ fooBar: null });
    });

    it("handles value with undefined", () => {
      const result = snakeToCamelObjectDeep({ foo_bar: undefined });
      expect(result).toEqual({ fooBar: undefined });
    });
  });

  describe("complex real-world examples", () => {
    it("handles API response style object", () => {
      const result = snakeToCamelObjectDeep({
        user_id: 123,
        user_name: "john_doe",
        created_at: "2023-01-01T00:00:00Z",
        is_active: true,
        profile_settings: {
          dark_mode: false,
          notifications_enabled: true,
          preferred_language: "en",
        },
      });
      expect(result).toEqual({
        userId: 123,
        userName: "john_doe",
        createdAt: "2023-01-01T00:00:00Z",
        isActive: true,
        profileSettings: {
          darkMode: false,
          notificationsEnabled: true,
          preferredLanguage: "en",
        },
      });
    });

    it("handles LogPushProps style object", () => {
      const result = snakeToCamelObjectDeep({
        max_foo_bar: "test",
        log_level: "debug",
        retry_count: 3,
      });
      expect(result).toEqual({
        maxFooBar: "test",
        logLevel: "debug",
        retryCount: 3,
      });
    });

    it("handles config object with nested arrays and objects", () => {
      const result = snakeToCamelObjectDeep({
        server_config: {
          host_name: "localhost",
          port_number: 8080,
          ssl_enabled: true,
        },
        database_connections: [
          {
            connection_name: "primary",
            max_pool_size: 10,
            timeout_ms: 5000,
          },
          {
            connection_name: "replica",
            max_pool_size: 5,
            timeout_ms: 3000,
          },
        ],
        feature_flags: {
          enable_new_ui: true,
          enable_beta_features: false,
        },
      });
      expect(result).toEqual({
        serverConfig: {
          hostName: "localhost",
          portNumber: 8080,
          sslEnabled: true,
        },
        databaseConnections: [
          {
            connectionName: "primary",
            maxPoolSize: 10,
            timeoutMs: 5000,
          },
          {
            connectionName: "replica",
            maxPoolSize: 5,
            timeoutMs: 3000,
          },
        ],
        featureFlags: {
          enableNewUi: true,
          enableBetaFeatures: false,
        },
      });
    });
  });

  describe("type preservation", () => {
    it("preserves Date values", () => {
      const date = new Date("2023-01-01");
      const result = snakeToCamelObjectDeep({ created_at: date });
      expect(result).toEqual({ createdAt: date });
      expect((result as any).createdAt).toBeInstanceOf(Date);
    });

    it("preserves RegExp values", () => {
      const regex = /test/gi;
      const result = snakeToCamelObjectDeep({ pattern_match: regex });
      expect(result).toEqual({ patternMatch: regex });
      expect((result as any).patternMatch).toBeInstanceOf(RegExp);
    });

    it("preserves number types", () => {
      const result = snakeToCamelObjectDeep({
        int_value: 42,
        float_value: 3.14,
        negative_value: -10,
        zero_value: 0,
      });
      expect(result).toEqual({
        intValue: 42,
        floatValue: 3.14,
        negativeValue: -10,
        zeroValue: 0,
      });
    });

    it("preserves boolean types", () => {
      const result = snakeToCamelObjectDeep({
        is_enabled: true,
        is_disabled: false,
      });
      expect(result).toEqual({
        isEnabled: true,
        isDisabled: false,
      });
    });
  });
});

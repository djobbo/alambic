import { describe, expect, test } from "vitest";
import { serializeAccessRule } from "../../src/cloudflare/access-rule.ts";
import { ResourceKind } from "../../src/resource.ts";

describe("serializeAccessRule", () => {
  test("passes through literal scalar values unchanged", () => {
    expect(
      serializeAccessRule({ email: { email: "user@example.com" } }),
    ).toEqual({
      email: { email: "user@example.com" },
    });
  });

  test("preserves the empty-object shape for parameterless rules", () => {
    expect(serializeAccessRule({ everyone: {} })).toEqual({
      everyone: {},
    });
    expect(serializeAccessRule({ certificate: {} })).toEqual({
      certificate: {},
    });
  });

  test("preserves a string id reference (no resource lifting)", () => {
    expect(serializeAccessRule({ group: { id: "abc-123" } })).toEqual({
      group: { id: "abc-123" },
    });
  });

  test("extracts .id from an Alchemy Resource reference", () => {
    const fakeGroup = {
      id: "real-group-uuid",
      [ResourceKind]: "cloudflare::AccessGroup",
    };
    expect(serializeAccessRule({ group: { id: fakeGroup as any } })).toEqual({
      group: { id: "real-group-uuid" },
    });
  });

  test("preserves multi-string fields without mangling them (regression for non-Resource nested objects)", () => {
    // external_evaluation has two literal string fields — neither is a
    // Resource. The serializer must leave both alone.
    expect(
      serializeAccessRule({
        external_evaluation: {
          evaluate_url: "https://eval.example.com/check",
          keys_url: "https://eval.example.com/keys",
        },
      }),
    ).toEqual({
      external_evaluation: {
        evaluate_url: "https://eval.example.com/check",
        keys_url: "https://eval.example.com/keys",
      },
    });
  });

  test("mixes literal fields with a Resource ref in the same rule", () => {
    const fakeIdp = {
      id: "idp-uuid",
      [ResourceKind]: "cloudflare::AccessIdentityProvider",
    };
    expect(
      serializeAccessRule({
        saml: {
          attribute_name: "department",
          attribute_value: "engineering",
          identity_provider_id: fakeIdp as any,
        },
      }),
    ).toEqual({
      saml: {
        attribute_name: "department",
        attribute_value: "engineering",
        identity_provider_id: "idp-uuid",
      },
    });
  });

  test("rejects a rule with multiple top-level keys", () => {
    expect(() =>
      serializeAccessRule({
        email: { email: "a@b.com" },
        ip: { ip: "1.2.3.4" },
      } as any),
    ).toThrow(/exactly one key/);
  });
});

import { describe, expect, test } from "vite-plus/test";

import {
  NGINX_DEFAULT_HTTP_PORT,
  NGINX_DEFAULT_HTTPS_PORT,
  nginxEnvironment,
  nginxImageRef,
  nginxUrl,
} from "../src/Docker/Images/Nginx.ts";

describe("Crucible.Docker.Nginx helpers", () => {
  describe("nginxImageRef", () => {
    test("defaults to mainline alpine", () => {
      expect(nginxImageRef()).toBe("nginx:alpine");
    });

    test("alpine-slim mainline keeps the bare flavor suffix", () => {
      expect(nginxImageRef({ variant: "alpine-slim" })).toBe("nginx:alpine-slim");
    });

    test("debian mainline yields nginx:mainline", () => {
      expect(nginxImageRef({ variant: "debian" })).toBe("nginx:mainline");
    });

    test("stable release prefixes the variant", () => {
      expect(nginxImageRef({ release: "stable", variant: "alpine" })).toBe("nginx:stable-alpine");
      expect(nginxImageRef({ release: "stable", variant: "alpine-slim" })).toBe(
        "nginx:stable-alpine-slim",
      );
      expect(nginxImageRef({ release: "stable", variant: "debian" })).toBe("nginx:stable");
    });

    test("explicit version pins override release", () => {
      expect(nginxImageRef({ version: "1.27.5", variant: "alpine", release: "stable" })).toBe(
        "nginx:1.27.5-alpine",
      );
      expect(nginxImageRef({ version: "1.27", variant: "debian" })).toBe("nginx:1.27");
    });

    test("perl variants compose with release/version", () => {
      expect(nginxImageRef({ variant: "alpine-perl" })).toBe("nginx:alpine-perl");
      expect(nginxImageRef({ release: "stable", variant: "perl" })).toBe("nginx:stable-perl");
    });
  });

  describe("nginxEnvironment", () => {
    test("maps typed envsubst vars and passes through extras", () => {
      expect(
        nginxEnvironment({
          NGINX_HOST: "example.com",
          NGINX_PORT: "8080",
          NGINX_ENVSUBST_TEMPLATE_DIR: "/etc/nginx/templates",
          NGINX_ENVSUBST_TEMPLATE_SUFFIX: ".tmpl",
          NGINX_ENVSUBST_OUTPUT_DIR: "/etc/nginx/conf.d",
          NGINX_ENVSUBST_FILTER: "^NGINX_",
          extra: { NGINX_BACKEND: "api:3000" },
        }),
      ).toEqual({
        NGINX_HOST: "example.com",
        NGINX_PORT: "8080",
        NGINX_ENVSUBST_TEMPLATE_DIR: "/etc/nginx/templates",
        NGINX_ENVSUBST_TEMPLATE_SUFFIX: ".tmpl",
        NGINX_ENVSUBST_OUTPUT_DIR: "/etc/nginx/conf.d",
        NGINX_ENVSUBST_FILTER: "^NGINX_",
        NGINX_BACKEND: "api:3000",
      });
    });

    test("omits unset typed fields", () => {
      expect(nginxEnvironment({ NGINX_HOST: "example.com" })).toEqual({
        NGINX_HOST: "example.com",
      });
    });

    test("returns just extras when no typed fields are set", () => {
      expect(nginxEnvironment({ extra: { CUSTOM_VAR: "1" } })).toEqual({ CUSTOM_VAR: "1" });
    });
  });

  describe("nginxUrl", () => {
    test("defaults to http://host/ on the default HTTP port", () => {
      expect(nginxUrl({ host: "nginx" })).toBe("http://nginx/");
      expect(NGINX_DEFAULT_HTTP_PORT).toBe(80);
    });

    test("https default port is omitted from the URL", () => {
      expect(nginxUrl({ host: "nginx", scheme: "https" })).toBe("https://nginx/");
      expect(NGINX_DEFAULT_HTTPS_PORT).toBe(443);
    });

    test("explicit port wins over env.NGINX_PORT", () => {
      expect(
        nginxUrl({
          env: { NGINX_PORT: "8080" },
          host: "nginx",
          port: 9090,
        }),
      ).toBe("http://nginx:9090/");
    });

    test("falls back to env.NGINX_PORT when port is not provided", () => {
      expect(
        nginxUrl({
          env: { NGINX_PORT: "8080" },
          host: "nginx",
        }),
      ).toBe("http://nginx:8080/");
    });

    test("ignores invalid env.NGINX_PORT and uses scheme default", () => {
      expect(
        nginxUrl({
          env: { NGINX_PORT: "not-a-number" },
          host: "nginx",
        }),
      ).toBe("http://nginx/");
    });

    test("non-default ports render in the authority", () => {
      expect(nginxUrl({ host: "nginx", port: 8443, scheme: "https" })).toBe("https://nginx:8443/");
    });

    test("normalizes path with or without leading slash", () => {
      expect(nginxUrl({ host: "nginx", path: "/healthz" })).toBe("http://nginx/healthz");
      expect(nginxUrl({ host: "nginx", path: "healthz" })).toBe("http://nginx/healthz");
    });

    test("preserves path with query/hash as-is after normalization", () => {
      expect(nginxUrl({ host: "nginx", path: "/api/v1?ok=1#frag" })).toBe(
        "http://nginx/api/v1?ok=1#frag",
      );
    });
  });
});

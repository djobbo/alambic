import { describe, expect, test } from "vite-plus/test";

import { postgresEnvironment } from "../src/Docker/Images/Postgres.ts";

describe("Crucible.Docker.Postgres helpers", () => {
  test("postgresEnvironment includes auth and optional keys", () => {
    const env = postgresEnvironment({
      POSTGRES_PASSWORD: "secret",
      POSTGRES_DB: "app",
      POSTGRES_USER: "app",
      PGDATA: "/var/lib/postgresql/data/pgdata",
    });

    expect(env).toEqual({
      POSTGRES_PASSWORD: "secret",
      POSTGRES_DB: "app",
      POSTGRES_USER: "app",
      PGDATA: "/var/lib/postgresql/data/pgdata",
    });
  });

  test("postgresEnvironment supports trust auth mode", () => {
    const env = postgresEnvironment({
      POSTGRES_HOST_AUTH_METHOD: "trust",
      POSTGRES_DB: "demo",
    });

    expect(env).toEqual({
      POSTGRES_HOST_AUTH_METHOD: "trust",
      POSTGRES_DB: "demo",
    });
  });
});

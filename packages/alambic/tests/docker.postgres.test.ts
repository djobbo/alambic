import { describe, expect, test } from "vite-plus/test";

import {
  POSTGRES_DEFAULT_PORT,
  postgresDatabaseUrl,
  postgresEnvironment,
} from "../src/Docker/Images/Postgres.ts";

describe("Alambic.Docker.Postgres helpers", () => {
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

  test("postgresDatabaseUrl uses defaults from the official image", () => {
    expect(
      postgresDatabaseUrl({
        env: { POSTGRES_PASSWORD: "secret" },
        host: "db",
      }),
    ).toBe(`postgresql://postgres:secret@db:${POSTGRES_DEFAULT_PORT}/postgres`);
  });

  test("postgresDatabaseUrl honors user/db overrides and explicit port/scheme", () => {
    expect(
      postgresDatabaseUrl({
        env: {
          POSTGRES_USER: "app",
          POSTGRES_PASSWORD: "s3cret",
          POSTGRES_DB: "appdb",
        },
        host: "drizzle-pg-db",
        port: 5433,
        scheme: "postgres",
      }),
    ).toBe("postgres://app:s3cret@drizzle-pg-db:5433/appdb");
  });

  test("postgresDatabaseUrl URL-encodes credentials and database names", () => {
    expect(
      postgresDatabaseUrl({
        env: {
          POSTGRES_USER: "user@admin",
          POSTGRES_PASSWORD: "p@ss:/word",
          POSTGRES_DB: "weird name",
        },
        host: "db",
      }),
    ).toBe("postgresql://user%40admin:p%40ss%3A%2Fword@db:5432/weird%20name");
  });

  test("postgresDatabaseUrl omits password under trust auth", () => {
    expect(
      postgresDatabaseUrl({
        env: {
          POSTGRES_HOST_AUTH_METHOD: "trust",
          POSTGRES_USER: "app",
          POSTGRES_DB: "demo",
        },
        host: "db",
      }),
    ).toBe("postgresql://app@db:5432/demo");
  });

  test("postgresDatabaseUrl falls back POSTGRES_DB to POSTGRES_USER", () => {
    expect(
      postgresDatabaseUrl({
        env: { POSTGRES_USER: "app", POSTGRES_PASSWORD: "secret" },
        host: "db",
      }),
    ).toBe("postgresql://app:secret@db:5432/app");
  });
});

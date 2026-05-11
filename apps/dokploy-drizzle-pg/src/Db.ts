import * as Docker from "alambic/Docker";
import * as Dokploy from "alambic/Dokploy";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";

/** Same `out` passed to `Drizzle.Schema`; use for stack logic that must not `yield*` `schema.out` (needs `RuntimeContext` from a Platform resource). */
export const SCHEMA_MIGRATIONS_OUT = "./migrations";

/**
 * Drizzle schema + Dokploy Postgres (Docker image), analogous to Neon’s:
 *
 * ```ts
 * const schema = yield* Drizzle.Schema(...);
 * const branch = yield* Neon.Branch("app-branch", { project, migrationsDir: schema.out });
 * ```
 *
 * Dokploy doesn’t expose `Neon.Branch`-style `migrationsDir`; apply `./migrations` in the stack with
 * Neon's internal `applyMigrations`/`listSqlFiles` (`alchemy.run.ts`) when `DATABASE_URL` reaches this Postgres.
 */
export const DokployPgDb = Effect.gen(function* () {
  const schema = yield* Drizzle.Schema("app-schema", {
    schema: "./src/schema.ts",
    out: SCHEMA_MIGRATIONS_OUT,
  });

  const project = yield* Dokploy.Project("app-db");
  const environment = yield* Dokploy.Environment("staging", { project });

  const drizzleGatewayImage = yield* Docker.ImageTag("ghcr.io/drizzle-team/gateway:latest");
  const postgresImage = yield* Docker.PostgresImageTag({ major: 16, variant: "alpine" });

  const compose = yield* Docker.Compose("drizzle-gateway", [
    {
      name: "drizzle-gateway",
      image: drizzleGatewayImage,
      restart: "always",
      environment: {
        PORT: "4983",
        STORE_PATH: "/app",
        MASTERPASS: "__CHANGE_ME_MASTERPASS__",
      },
    },
  ]);

  const drizzleGateway = yield* Dokploy.Application.Compose("drizzle-gateway", {
    environment,
    name: "Drizzle Gateway",
    appName: "drizzle-gateway",
    compose,
  });
  const postgres = yield* Dokploy.Application.Image("postgres", {
    environment,
    name: "Postgres (Drizzle demo)",
    appName: "drizzle-pg-db",
    image: postgresImage,
  });

  return { project, environment, postgres, drizzleGateway, schema };
});

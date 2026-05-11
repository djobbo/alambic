import * as Alchemy from "alchemy";
import * as Drizzle from "alchemy/Drizzle";
// Alchemy's Neon migrator is not re-exported from `alchemy/Neon`. Package `exports` also map
// `./Neon/*` to `Neon/*/index`, but these modules live as `lib/Neon/*.js`, so we load the built files.
import { applyMigrations } from "./node_modules/alchemy/lib/Neon/Migrations.js";
import { listSqlFiles } from "./node_modules/alchemy/lib/Neon/SqlFile.js";
import * as Dokploy from "alambic/Dokploy";
import { config as dotenv } from "dotenv";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Path from "node:path";
import { count } from "drizzle-orm";

import { DokployPgDb, SCHEMA_MIGRATIONS_OUT } from "./src/Db.ts";
import { Notes } from "./src/schema.ts";

dotenv({
  path: ".env",
  quiet: true,
});

const migrateAndSmokeTest = (migrationsRoot: string) =>
  Effect.gen(function* () {
    const raw = yield* Config.string("DATABASE_URL");
    const uri = Redacted.make(raw);

    const migrationsFiles = yield* listSqlFiles(migrationsRoot);
    yield* applyMigrations({
      connectionUri: uri,
      migrationsTable: "dokploy_drizzle_pg_migrations",
      migrationsFiles,
    });

    const db = yield* Drizzle.postgres(Effect.succeed(uri));
    const agg = yield* db.select({ n: count() }).from(Notes);

    yield* Effect.log(`Dokploy+Drizzle: migrations applied; rows in notes = ${agg[0]?.n ?? 0}`);
  });
/**
 * Dokploy Postgres + Alchemy Drizzle.Schema — same layering as Neon in the Cloudflare tutorial, but infra is
 * `Dokploy.Application` (`postgres:16-alpine`) instead of `Neon.Branch`; migrations apply when `DATABASE_URL` is set.
 *
 * Neon tutorial shape: {@link DokployPgDb}.
 */
export default Alchemy.Stack(
  "dokploy-drizzle-pg",
  {
    providers: Layer.mergeAll(Dokploy.providers(), Drizzle.providers()),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const { schema, postgres } = yield* DokployPgDb;

    /** Matches `Drizzle.Schema` `out` resolution (`path.resolve(cwd, …)`); avoid `yield* schema.out` without a Platform `RuntimeContext`. */
    const migrationsRoot = Path.resolve(process.cwd(), SCHEMA_MIGRATIONS_OUT);

    yield* migrateAndSmokeTest(migrationsRoot).pipe(Effect.catch((err) => Effect.die(err)));

    return {
      migrationsDir: schema.out,
      postgresApplicationId: postgres.applicationId,
      postgresAppName: postgres.appName,
    };
  }),
);

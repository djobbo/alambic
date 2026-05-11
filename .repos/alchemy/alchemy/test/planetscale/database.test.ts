import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { destroy } from "../../src/destroy.ts";
import {
  createPlanetScaleClient,
  type PlanetScaleClient,
} from "../../src/planetscale/api.ts";
import { Database } from "../../src/planetscale/database.ts";
import {
  waitForBranchReady,
  waitForDatabaseReady,
} from "../../src/planetscale/utils.ts";
import { BRANCH_PREFIX } from "../util.ts";
// must import this or else alchemy.test won't exist
import "../../src/test/vitest.ts";

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

const kinds = [
  { kind: "mysql", ps10: "PS_10", ps20: "PS_20" },
  { kind: "postgresql", ps10: "PS_10_AWS_X86", ps20: "PS_20_AWS_X86" },
] as const;

describe.skipIf(!process.env.PLANETSCALE_TEST).concurrent.each(kinds)(
  "Database Resource ($kind)",
  ({ kind, ...expectedClusterSizes }) => {
    const api = createPlanetScaleClient();
    const organization = alchemy.env.PLANETSCALE_ORG_ID;

    test(`create database with minimal settings (${kind})`, async (scope) => {
      const name = `${BRANCH_PREFIX}-${kind}-basic`;

      try {
        const database = await Database("basic", {
          name,
          clusterSize: "PS_10",
          kind,
          delete: true,
        });

        expect(database).toMatchObject({
          id: expect.any(String),
          name,
          defaultBranch: "main",
          organization,
          state: expect.any(String),
          plan: expect.any(String),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          htmlUrl: expect.any(String),
          kind,
          region: {
            slug: expect.any(String),
          },
        });

        // Branch won't exist until database is ready
        await waitForDatabaseReady(api, organization, name);

        // Verify main branch cluster size
        const { data: mainBranchData } = await api.getBranch({
          path: {
            organization,
            database: name,
            branch: "main",
          },
        });

        expect(mainBranchData.cluster_name).toEqual(expectedClusterSizes.ps10);
      } finally {
        await destroy(scope);
        // Verify database was deleted by checking API directly
        await assertDatabaseDeleted(api, organization, name);
      }
    }, 5_000_000); // postgres takes forever

    test(`create, update, and delete database (${kind})`, async (scope) => {
      const name = `${BRANCH_PREFIX}-${kind}-crud`;
      let database;
      try {
        // Create test database with initial settings
        database = await Database("crud", {
          name,
          region: {
            slug: "us-east",
          },
          clusterSize: "PS_10",
          ...(kind === "mysql"
            ? {
                allowDataBranching: true,
                automaticMigrations: true,
                requireApprovalForDeploy: false,
                restrictBranchRegion: true,
                insightsRawQueries: true,
                productionBranchWebConsole: true,
                defaultBranch: "main",
                migrationFramework: "rails",
                migrationTableName: "schema_migrations",
              }
            : {
                kind: "postgresql",
              }),
          delete: true,
        });

        expect(database).toMatchObject({
          id: expect.any(String),
          name,
          organization,
          ...(kind === "mysql"
            ? {
                allowDataBranching: true,
                automaticMigrations: true,
                requireApprovalForDeploy: false,
                restrictBranchRegion: true,
                insightsRawQueries: true,
                productionBranchWebConsole: true,
                defaultBranch: "main",
                migrationFramework: "rails",
                migrationTableName: "schema_migrations",
              }
            : {
                kind: "postgresql",
              }),
          state: expect.any(String),
          plan: expect.any(String),
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          htmlUrl: expect.any(String),
        });

        // Update database settings
        database = await Database("crud", {
          name,
          organization,
          clusterSize: "PS_20", // Change cluster size
          ...(kind === "mysql"
            ? {
                allowDataBranching: false,
                automaticMigrations: false,
                requireApprovalForDeploy: true,
                restrictBranchRegion: false,
                insightsRawQueries: false,
                productionBranchWebConsole: false,
                defaultBranch: "main",
                migrationFramework: "django",
                migrationTableName: "django_migrations",
              }
            : { kind: "postgresql" }),
          delete: true,
        });

        expect(database).toMatchObject(
          kind === "mysql"
            ? {
                allowDataBranching: false,
                automaticMigrations: false,
                requireApprovalForDeploy: true,
                restrictBranchRegion: false,
                insightsRawQueries: false,
                productionBranchWebConsole: false,
                defaultBranch: "main",
                migrationFramework: "django",
                migrationTableName: "django_migrations",
              }
            : {
                kind: "postgresql",
              },
        );

        // Verify main branch cluster size was updated
        const { data: mainBranchData } = await api.getBranch({
          path: {
            organization,
            database: name,
            branch: "main",
          },
        });
        expect(mainBranchData.cluster_name).toEqual(expectedClusterSizes.ps20);
      } catch (err) {
        console.error("Test error:", err);
        throw err;
      } finally {
        // Cleanup
        await destroy(scope);

        // Verify database was deleted by checking API directly
        await assertDatabaseDeleted(api, organization, name);
      }
    }, 5_000_000);

    test(`creates non-main default branch if specified (${kind})`, async (scope) => {
      const name = `${BRANCH_PREFIX}-${kind}-create-branch`;
      const defaultBranch = "custom";
      try {
        // Create database with custom default branch
        const database = await Database("create-branch", {
          name,
          clusterSize: "PS_10",
          defaultBranch,
          kind,
          delete: true,
        });

        expect(database).toMatchObject({
          defaultBranch,
        });
        await waitForBranchReady(
          api,
          database.organization,
          database.name,
          defaultBranch,
        );
        // Verify branch was created
        const { data: branchData } = await api.getBranch({
          path: {
            organization,
            database: name,
            branch: defaultBranch,
          },
        });
        expect(branchData.parent_branch).toEqual("main");
        expect(branchData.cluster_name).toEqual(expectedClusterSizes.ps10);

        // Update default branch on existing database
        await Database("create-branch", {
          name,
          organization,
          clusterSize: "PS_20",
          defaultBranch,
          kind,
          delete: true,
        });

        // Verify branch cluster size was updated
        await waitForBranchReady(
          api,
          organization,
          database.name,
          defaultBranch,
        );
        const { data: newBranchData } = await api.getBranch({
          path: {
            organization,
            database: name,
            branch: defaultBranch,
          },
        });
        expect(newBranchData.cluster_name).toEqual(expectedClusterSizes.ps20);
      } catch (err) {
        console.error("Test error:", err);
        throw err;
      } finally {
        await destroy(scope);

        // Verify database was deleted
        await assertDatabaseDeleted(api, organization, name);
      }
    }, 5_000_000); // must wait on multiple resizes and branch creation

    test.skipIf(kind !== "postgresql")(
      `create database with arm arch (${kind})`,
      async (scope) => {
        const name = `${BRANCH_PREFIX}-${kind}-arm`;
        try {
          const database = await Database("arm", {
            name,
            organization,
            clusterSize: "PS_10",
            kind: "postgresql",
            arch: "arm",
            delete: true,
          });
          expect(database).toMatchObject({
            id: expect.any(String),
            name,
            arch: "arm",
            kind,
          });
          await waitForDatabaseReady(api, organization, name);
          const { data: branchData } = await api.getBranch({
            path: {
              organization,
              database: name,
              branch: "main",
            },
          });
          expect(branchData.cluster_name).toEqual("PS_10_AWS_ARM");
          expect(branchData.cluster_architecture).toEqual("aarch64");
        } catch (err) {
          console.error("Test error:", err);
          throw err;
        } finally {
          await destroy(scope);
          await assertDatabaseDeleted(api, organization, name);
        }
      },
      5_000_000,
    );

    test(`adopt with wrong region should throw (${kind})`, async (scope) => {
      const name = `${BRANCH_PREFIX}-${kind}-region`;

      try {
        // Create a database (will be in default region, typically us-east)
        const database = await Database("region-check", {
          name,
          region: { slug: "us-east" },
          clusterSize: "PS_10",
          kind,
          delete: true,
        });

        expect(database.region).toMatchObject({
          slug: "us-east",
        });

        // Now try to adopt it with a different region — should throw
        await expect(
          Database("region-check", {
            name,
            adopt: true,
            region: { slug: "eu-west" },
            clusterSize: "PS_10",
            kind,
            delete: true,
          }),
        ).rejects.toThrow(/is in region "us-east" but expected "eu-west"/);

        // Adopting with the correct region should succeed
        const adopted = await Database("region-check", {
          name,
          adopt: true,
          region: { slug: "us-east" },
          clusterSize: "PS_10",
          kind,
          delete: true,
        });

        expect(adopted.region.slug).toBe("us-east");
      } finally {
        await destroy(scope);
        await assertDatabaseDeleted(api, organization, name);
      }
    }, 5_000_000);

    test(`adopt with wrong kind should throw (${kind})`, async (scope) => {
      const name = `${BRANCH_PREFIX}-${kind}-kind`;
      const wrongKind = kind === "mysql" ? "postgresql" : "mysql";

      try {
        await Database("kind-check", {
          name,
          clusterSize: "PS_10",
          kind,
          delete: true,
        });

        await waitForDatabaseReady(api, organization, name);

        // Try to adopt with the wrong kind — should throw
        await expect(
          Database("kind-check", {
            name,
            adopt: true,
            clusterSize: "PS_10",
            kind: wrongKind,
            delete: true,
          }),
        ).rejects.toThrow(
          new RegExp(`has kind "${kind}" but expected "${wrongKind}"`),
        );

        // Adopting with the correct kind should succeed
        const adopted = await Database("kind-check", {
          name,
          adopt: true,
          clusterSize: "PS_10",
          kind,
          delete: true,
        });

        expect(adopted.name).toBe(name);
      } finally {
        await destroy(scope);
        await assertDatabaseDeleted(api, organization, name);
      }
    }, 5_000_000);

    test.skipIf(kind !== "postgresql")(
      `adopt with wrong arch should throw (${kind})`,
      async (scope) => {
        const name = `${BRANCH_PREFIX}-${kind}-arch-check`;

        try {
          await Database("arch-check", {
            name,
            clusterSize: "PS_10",
            kind: "postgresql",
            arch: "x86",
            delete: true,
          });

          await waitForDatabaseReady(api, organization, name);

          // Try to adopt with the wrong arch — should throw
          await expect(
            Database("arch-check", {
              name,
              adopt: true,
              clusterSize: "PS_10",
              kind: "postgresql",
              arch: "arm",
              delete: true,
            }),
          ).rejects.toThrow(/has architecture "x86" but expected "arm"/);

          // Adopting with the correct arch should succeed
          const adopted = await Database("arch-check", {
            name,
            adopt: true,
            clusterSize: "PS_10",
            kind: "postgresql",
            arch: "x86",
            delete: true,
          });

          expect(adopted.name).toBe(name);
        } finally {
          await destroy(scope);
          await assertDatabaseDeleted(api, organization, name);
        }
      },
      5_000_000,
    );

    test(`database with delete=false should not be deleted via API (${kind})`, async (scope) => {
      const name = `${BRANCH_PREFIX}-${kind}-nodelete`;

      try {
        const database = await Database("nodelete", {
          name,
          clusterSize: "PS_10",
          kind,
          delete: false,
        });

        expect(database).toMatchObject({
          id: expect.any(String),
          name,
          delete: false,
        });

        // Verify database exists
        await waitForDatabaseReady(api, organization, name);
        const { data } = await api.getDatabase({
          path: {
            organization,
            database: name,
          },
        });
        expect(data.name).toBe(name);
      } catch (err) {
        console.error("Test error:", err);
        throw err;
      } finally {
        // When we call destroy, the database should NOT be deleted via API
        await destroy(scope);

        // Verify database still exists (was not deleted via API)
        const { response } = await api.getDatabase({
          path: {
            organization,
            database: name,
          },
          throwOnError: false,
        });
        expect(response.status).toBe(200); // Database should still exist

        // Clean up manually for the test
        await api.deleteDatabase({
          path: {
            organization,
            database: name,
          },
          throwOnError: false,
        });

        // Wait for manual cleanup to complete
        await assertDatabaseDeleted(api, organization, name);
      }
    }, 5_000_000);
  },
);

describe.skipIf(false)("Database Extensions (postgresql)", () => {
  const api = createPlanetScaleClient();
  const organization = alchemy.env.PLANETSCALE_ORG_ID;

  test("create database with extensions, update extensions, then remove them", async (scope) => {
    const name = `${BRANCH_PREFIX}-pg-ext`;
    const branch = "main";

    try {
      // Create a PostgreSQL database with pgvector and pg_stat_statements enabled
      const database = await Database("pg-ext", {
        name,
        kind: "postgresql",
        clusterSize: "PS_10",
        delete: true,
        extensions: {
          vector: { hnswEfSearch: 100 },
          pgStatStatements: {},
        },
      });

      expect(database).toMatchObject({
        id: expect.any(String),
        name,
        kind: "postgresql",
        extensions: {
          vector: { hnswEfSearch: 100 },
          pgStatStatements: {},
        },
      });

      // Verify extensions are enabled via the parameters API
      await waitForBranchReady(api, organization, name, branch);
      const { data: params } = await api.listParameters({
        path: { organization, database: name, branch },
      });

      const enabledNames = getEnabledExtensionNames(params);
      expect(enabledNames).toContain("vector");
      expect(enabledNames).toContain("pg_stat_statements");
      expect(enabledNames).not.toContain("pg_cron");

      // Verify pgvector param was set
      const hnswEfSearch = params.find((p) => p.name === "hnsw.ef_search");
      expect(hnswEfSearch?.value).toBe("100");

      // Update: remove pgStatStatements, add pgCron, change pgvector config
      const updated = await Database("pg-ext", {
        name,
        kind: "postgresql",
        organization,
        clusterSize: "PS_10",
        delete: true,
        extensions: {
          vector: { hnswEfSearch: 200 },
          pgCron: { maxRunningJobs: 3 },
        },
      });

      expect(updated.kind === "postgresql" && updated.extensions).toEqual({
        vector: { hnswEfSearch: 200 },
        pgCron: { maxRunningJobs: 3 },
      });

      // Verify the changes via API
      await waitForBranchReady(api, organization, name, branch);
      const { data: updatedParams } = await api.listParameters({
        path: { organization, database: name, branch },
      });

      const updatedNames = getEnabledExtensionNames(updatedParams);
      expect(updatedNames).toContain("vector");
      expect(updatedNames).toContain("pg_cron");
      expect(updatedNames).not.toContain("pg_stat_statements");

      // Verify updated params
      const updatedHnsw = updatedParams.find(
        (p) => p.name === "hnsw.ef_search",
      );
      expect(updatedHnsw?.value).toBe("200");
      const cronMax = updatedParams.find(
        (p) => p.name === "cron.max_running_jobs",
      );
      expect(cronMax?.value).toBe("3");

      // Update: remove all user extensions
      await Database("pg-ext", {
        name,
        kind: "postgresql",
        organization,
        clusterSize: "PS_10",
        delete: true,
        extensions: {},
      });

      // Verify all user extensions are removed
      await waitForBranchReady(api, organization, name, branch);
      const { data: finalParams } = await api.listParameters({
        path: { organization, database: name, branch },
      });

      const finalNames = getEnabledExtensionNames(finalParams);
      expect(finalNames).not.toContain("vector");
      expect(finalNames).not.toContain("pg_cron");
      expect(finalNames).not.toContain("pg_stat_statements");
    } catch (err) {
      console.error("Test error:", err);
      throw err;
    } finally {
      await destroy(scope);
      await assertDatabaseDeleted(api, organization, name);
    }
  }, 5_000_000);
});

/**
 * Get the names of extensions currently enabled in shared_preload_libraries.
 * Reads the shared_preload_libraries parameter from the branch parameters list.
 */
function getEnabledExtensionNames(
  params: Array<{ name: string; value: string }>,
): string[] {
  const spl = params.find((p) => p.name === "shared_preload_libraries");
  if (!spl?.value) return [];
  return spl.value.split(",").map((s) => s.trim());
}

/**
 * Wait for database to be deleted (return 404) for up to 60 seconds
 */
async function assertDatabaseDeleted(
  api: PlanetScaleClient,
  organizationName: string,
  databaseName: string,
): Promise<void> {
  const timeout = 1000_000;
  const interval = 2_000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const { response } = await api.getDatabase({
      path: {
        organization: organizationName,
        database: databaseName,
      },
      throwOnError: false,
    });

    console.log(
      `Waiting for database ${databaseName} to be deleted: ${response.status}`,
    );

    if (response.status === 404) {
      // Database is deleted, test passes
      return;
    }

    // Database still exists, wait and try again
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  // Timeout reached, database still exists
  throw new Error(
    `Database ${databaseName} was not deleted within ${timeout}ms`,
  );
}

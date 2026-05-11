<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] For changes under `packages/alambic` or `packages/dokploy-api`, add a Changeset: `pnpm changeset` and commit the new file under `.changeset/`.

## npm releases (Changesets)

Published packages: **`alambic`** and **`@alambic/dokploy-api`** (same semver; fixed group in `.changeset/config.json`).

**GitHub Actions secrets (repo `djobbo/alambic`):**

| Secret                   | Purpose                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NPM_TOKEN`              | Publish to npm (automation token with publish rights for the `@alambic` scope and unscoped `alambic`).                                                                 |
| `CHANGESET_GITHUB_TOKEN` | Optional PAT (`contents:write`, `pull_requests:write`). If unset, `GITHUB_TOKEN` is used; the auto-generated token may not re-trigger CI on the “Version Packages” PR. |

**Workflows:** `CI` runs `pnpm run build:publishable` on pushes and PRs to `main`. `Release` runs [changesets/action](https://github.com/changesets/action) on `main` (and can be re-run via **workflow_dispatch**): it opens a versioning PR when there are pending changesets, or publishes when versions are bumped on `main`. `Snapshot` publishes **pkg.pr.new** previews for the two packages on `main` / PRs.

**Prerelease line on npm:** run `pnpm changeset pre enter beta`, commit `.changeset/pre.json`, merge to `main`, then use the normal changeset flow; exit with `pnpm changeset pre exit` when stable releases should return to `latest`.

<!--VITE PLUS END-->

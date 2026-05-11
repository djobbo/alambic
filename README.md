# Alambic

[![pkg.pr.new](https://pkg.pr.new/badge/djobbo/alambic)](https://pkg.pr.new/~/djobbo/alambic)

TypeScript monorepo for **Alchemy**-driven infrastructure and **Dokploy** client tooling. Published libraries include [`alambic`](./packages/alambic) (resources and helpers) and [`@alambic/dokploy-api`](./packages/dokploy-api) (generated OpenAPI client). Example apps under [`apps/`](./apps/) show deployment patterns.

**Stack:** [Vite+](https://viteplus.dev/guide/) (`vp`), pnpm workspaces, Effect, and Alchemy. See [`AGENTS.md`](./AGENTS.md) for toolchain checklist, CI, releases, and optional pkg.pr.new snapshots.

## Development

```bash
pnpm install
pnpm run ready    # check, test, build (recursive)
pnpm run dev      # website dev server
```

## Vendored upstream (`.repos`)

Optional squashed `git subtree` copies of upstream repos live under [`.repos/`](./.repos/). Workflow and update notes: [`.plans/vendored-repo-git-subtree.md`](./.plans/vendored-repo-git-subtree.md).

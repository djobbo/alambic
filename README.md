# Vite+ Monorepo Starter

A starter for creating a Vite+ monorepo.

## Vendored upstream (`.repos`)

Squashed `git subtree` copies of upstream repositories live under [`.repos/`](.repos/). Use those trees as the **local source of truth** for implementation details and bundled documentation when working with the corresponding libraries or services in this monorepo (not only published packages or generic web search). Import and update procedure: [`.plans/vendored-repo-git-subtree.md`](.plans/vendored-repo-git-subtree.md).

## Development

- Check everything is ready:

```bash
vp run ready
```

- Run the tests:

```bash
vp run -r test
```

- Build the monorepo:

```bash
vp run -r build
```

- Run the development server:

```bash
vp run dev
```

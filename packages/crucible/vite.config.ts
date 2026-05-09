import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      Dokploy: "src/Dokploy/index.ts",
      Docker: "src/Docker/index.ts",
    },
    dts: {
      tsgo: true,
    },
    // Hand-maintain package.json "exports" (with `types`) — `exports: true` overwrites and can drop `types`.
    exports: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});

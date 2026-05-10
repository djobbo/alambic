import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
    },
    dts: {
      tsgo: true,
    },
    // Hand-maintain package.json `exports` (with `types`) — `exports: true` overwrites and can drop `types`.
    exports: false,
  },
  lint: {
    ignorePatterns: ["src/generated/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});

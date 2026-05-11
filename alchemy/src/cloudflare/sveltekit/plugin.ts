import adapter, { type AdapterOptions } from "@sveltejs/adapter-cloudflare";
import type { Adapter } from "@sveltejs/kit";
import { getPlatformProxyOptions } from "../cloudflare-env-proxy.ts";

export default (options?: AdapterOptions): Adapter => {
  if (shouldDisable()) {
    return {
      name: "alchemy-noop",
      adapt() {},
    };
  }
  const { platformProxy: proxyOptions, ...config } = options ?? {};
  const platformProxy = getPlatformProxyOptions(proxyOptions);
  return adapter({
    platformProxy,
    config: platformProxy.configPath,
    ...config,
  });
};

/**
 * Return true for `svelte-language-server`, `svelte-check`, and `svelte-kit sync`. This is because:
 * - The svelte language server runs from the root and therefore may be running in a different cwd than the `Website.cwd`, so disable to avoid breaking intellisense
 * - The `svelte-check` and `svelte-kit sync` commands do not require Cloudflare-specific configuration, so disable to avoid breaking the commands
 */
function shouldDisable(argv = process.argv): boolean {
  return (
    argv.some(
      (arg) =>
        arg.includes("svelte-check") || arg.includes("svelte-language-server"),
    ) ||
    (argv.some((arg) => arg.includes("svelte-kit")) && argv.includes("sync"))
  );
}

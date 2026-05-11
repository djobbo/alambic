import { cloudflare, type PluginConfig } from "@cloudflare/vite-plugin";
import path from "pathe";
import type { PluginOption } from "vite";
import {
  getDefaultConfigPath,
  getDefaultPersistPath,
  validateConfigPath,
} from "../miniflare/paths.ts";

const alchemy = (config?: PluginConfig): PluginOption => {
  const persistState = config?.persistState ?? {
    path:
      typeof config?.persistState === "object"
        ? config.persistState.path
        : // persist path should default to the /.alchemy/miniflare/v3
          getDefaultPersistPath(),
  };
  if (typeof persistState === "object" && persistState.path.endsWith("v3")) {
    persistState.path = path.dirname(persistState.path);
  }
  return [
    cloudflare({
      ...config,
      configPath: validateConfigPath(
        // config path doesn't need to be in the root, it can be in the app dir
        config?.configPath ?? getDefaultConfigPath(),
      ),
      persistState,
    }),
    {
      name: "alchemy:dev",
      config() {
        const allowedHosts: string[] = [];
        if (process.env.ALCHEMY_DEV_TUNNEL === "quick") {
          // leading dot = match all subdomains
          allowedHosts.push(".trycloudflare.com");
        }
        return {
          server: {
            watch: {
              ignored: ["**/.alchemy/**"],
            },
            ...(allowedHosts.length ? { allowedHosts } : {}),
          },
        };
      },
    },
  ] as PluginOption;
};

export default alchemy;

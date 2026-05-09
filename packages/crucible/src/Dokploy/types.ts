/** Weighted Traefik routing for blue/green slots (Dokploy `application.updateTraefikConfig`). */
export type TraefikBlueGreenWeightedConfig = {
  /**
   * Public `Host(...)` matcher, e.g. `nginx.prod.example.com`.
   * Deploy-time DNS / certificates are your responsibility.
   */
  readonly host: string;
  /** Container / Swarm backend port both slots listen on. */
  readonly targetPort?: number;
  /**
   * Proportional weight for blue backend (see Traefik weighted services).
   * Shift traffic progressively by changing weights and redeploying.
   */
  readonly weightBlue: number;
  readonly weightGreen: number;
  /**
   * Traefik entrypoints, e.g. `["web"]` or `["web","websecure"]`.
   * @default ["web", "websecure"]
   */
  readonly entryPoints?: ReadonlyArray<string>;
  /** Router name segment (sanitized); defaults from logical app id. */
  readonly routerName?: string;
  /**
   * When not `false`, enables TLS on the router (`tls` or `certResolver`).
   * @default true
   */
  readonly tls?: boolean;
  /** e.g. `letsencrypt` when using Dokploy Traefik resolver. */
  readonly certResolver?: string;
  /**
   * Swarm DNS hostname for the blue slot’s service (`Name` on the service).
   * With the HTTP engine, defaults come from each slot’s canonical Dokploy `appName` after deploy
   * (Dokploy appends a short random suffix on create). Omit both unless you need to override.
   */
  readonly blueBackendHost?: string;
  readonly greenBackendHost?: string;
};

export type DeploymentStrategy =
  | { readonly mode: "recreate" }
  | { readonly mode: "native"; readonly kind: "rolling" | "restart" }
  | {
      readonly mode: "blue-green";
      /**
       * When `automatic`, each reconcile deploys the inactive slot and flips active traffic.
       * When `manual`, reconcile deploys the inactive slot but keeps the previous active slot.
       * @default "automatic"
       */
      readonly cutover?: "automatic" | "manual";
      /**
       * Initial active slot on first provision.
       * @default "blue"
       */
      readonly initialSlot?: "blue" | "green";
      /**
       * Optional Traefik v3 weighted HTTP config pushed to Dokploy (`application.updateTraefikConfig`)
       * on the **blue** application only. Backends default to `{appName}-blue` / `{appName}-green`.
       */
      readonly traefik?: TraefikBlueGreenWeightedConfig;
    };

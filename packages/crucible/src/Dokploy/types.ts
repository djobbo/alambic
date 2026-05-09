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
    };

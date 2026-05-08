export type DeploymentStrategy =
  | { readonly mode: "recreate" }
  | { readonly mode: "native"; readonly kind: "rolling" | "restart" };

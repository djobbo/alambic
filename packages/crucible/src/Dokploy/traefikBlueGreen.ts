import type { TraefikBlueGreenWeightedConfig } from "./types.ts";

type BlueGreenSlot = "blue" | "green";

/** Slug-safe labels for router / service identifiers in YAML. */
const sanitizeIdentSegment = (s: string): string =>
  s
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "app";

const slotHostDefault = (baseAppName: string, slot: BlueGreenSlot): string =>
  `${baseAppName}-${slot}`;

const sanitizeHostToken = (s: string): string => s.replace(/`/g, "");

const pickBackendHost = (input: {
  readonly explicit: string | undefined;
  readonly dokployAppName: string | undefined;
  readonly baseAppName: string;
  readonly slot: BlueGreenSlot;
}): string => {
  const e = input.explicit;
  if (e !== undefined && e.trim() !== "") return sanitizeHostToken(e);
  const d = input.dokployAppName;
  if (d !== undefined && d.trim() !== "") return sanitizeHostToken(d);
  return sanitizeHostToken(slotHostDefault(input.baseAppName, input.slot));
};

/**
 * Traefik v3 dynamic config (`http` block) for weighted routing to two Swarm service hostnames.
 * Applied via Dokploy `application.updateTraefikConfig` on the **blue** slot application.
 *
 * Dokploy stores a **canonical** `appName` per application (Swarm service `Name`). On create it
 * appends a short random suffix to the name you pass in, so backends must use that value (or
 * {@link TraefikBlueGreenWeightedConfig.blueBackendHost} / `greenBackendHost`), not only
 * `{baseAppName}-{slot}`.
 *
 * @see https://doc.traefik.io/traefik/reference/dynamic-configuration/http/
 */
export const buildTraefikBlueGreenDynamicYaml = (input: {
  readonly logicalAppSlug: string;
  readonly baseAppName: string;
  readonly traefik: TraefikBlueGreenWeightedConfig;
  /** Canonical Dokploy `appName` per slot from `application.one` (optional). */
  readonly dokployAppNamesBySlot?: {
    readonly blue?: string;
    readonly green?: string;
  };
}): string => {
  const t = input.traefik;
  const slotNames = input.dokployAppNamesBySlot;
  const port = t.targetPort ?? 80;
  const slug = sanitizeIdentSegment(input.logicalAppSlug);
  const routerBase = sanitizeIdentSegment(t.routerName ?? `bg-${slug}`);
  const wrrName = `${routerBase}-wrr`;
  const blueSvc = `${routerBase}-blue`;
  const greenSvc = `${routerBase}-green`;
  const blueHost = pickBackendHost({
    explicit: t.blueBackendHost,
    dokployAppName: slotNames?.blue,
    baseAppName: input.baseAppName,
    slot: "blue",
  });
  const greenHost = pickBackendHost({
    explicit: t.greenBackendHost,
    dokployAppName: slotNames?.green,
    baseAppName: input.baseAppName,
    slot: "green",
  });

  const hostEscaped = t.host.replace(/\\/g, "\\\\").replace(/`/g, "");
  const rule = `Host(\`${hostEscaped}\`)`;

  const entryPoints =
    t.entryPoints !== undefined && t.entryPoints.length > 0
      ? [...t.entryPoints]
      : (["web", "websecure"] as const);

  const entryPointsYaml = entryPoints.map((ep) => `        - ${JSON.stringify(ep)}`).join("\n");

  let routerTls = "";
  if (t.tls !== false) {
    if (t.certResolver !== undefined && t.certResolver.trim() !== "") {
      routerTls = `\n      tls:\n        certResolver: ${JSON.stringify(t.certResolver)}`;
    } else {
      routerTls = "\n      tls: {}";
    }
  }

  return `http:
  routers:
    ${routerBase}:
      rule: ${JSON.stringify(rule)}
      entryPoints:
${entryPointsYaml}
      service: ${JSON.stringify(wrrName)}${routerTls}
  services:
    ${wrrName}:
      weighted:
        services:
          - name: ${JSON.stringify(blueSvc)}
            weight: ${Number(t.weightBlue)}
          - name: ${JSON.stringify(greenSvc)}
            weight: ${Number(t.weightGreen)}
    ${blueSvc}:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: ${JSON.stringify(`http://${blueHost}:${port}`)}
    ${greenSvc}:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: ${JSON.stringify(`http://${greenHost}:${port}`)}
`;
};

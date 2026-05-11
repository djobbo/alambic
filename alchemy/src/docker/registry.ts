import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { Secret, type Secret as SecretValue } from "../secret.ts";
import { DockerApi } from "./api.ts";

export interface RegistryPushCredentials {
  server: string;
  username: string;
  password: string | SecretValue;
}

export async function pushImageToRegistry(
  imageRef: string,
  registry: RegistryPushCredentials,
): Promise<{
  imageRef: string;
  repoDigest?: string;
}> {
  const registryHost = registry.server.replace(/\/$/, "");
  const password = Secret.unwrap(registry.password);

  const firstSegment = imageRef.split("/")[0];
  const hasRegistryPrefix = firstSegment.includes(".");
  const targetImage = hasRegistryPrefix
    ? imageRef
    : `${registryHost}/${imageRef}`;

  let repoDigest: string | undefined;
  let api: DockerApi | undefined;

  try {
    const tempConfigDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "docker-config-"),
    );
    api = new DockerApi({ configDir: tempConfigDir });

    await api.login(registryHost, registry.username, password);

    if (targetImage !== imageRef) {
      await api.exec(["tag", imageRef, targetImage]);
    }

    const { stdout } = await api.exec(["push", targetImage]);
    const digestMatch = /digest:\s+([a-z0-9]+:[a-f0-9]{64})/.exec(stdout);
    if (digestMatch) {
      const digestHash = digestMatch[1];
      const [repoWithoutTag] =
        targetImage.split(":").length > 2
          ? [targetImage]
          : [targetImage.substring(0, targetImage.lastIndexOf(":"))];
      repoDigest = `${repoWithoutTag}@${digestHash}`;
    }

    return {
      imageRef: targetImage,
      repoDigest,
    };
  } finally {
    await api?.logout(registryHost);
  }
}

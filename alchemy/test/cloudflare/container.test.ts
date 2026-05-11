import path from "pathe";
import { describe, expect, test as vitestTest } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import {
  Container,
  ContainerApplication,
  createCloudflareApi,
  getContainerApplicationByName,
  getCloudflareContainerRegistry,
  resolveImageName,
} from "../../src/cloudflare/index.ts";
import { Worker } from "../../src/cloudflare/worker.ts";
import { destroy } from "../../src/destroy.ts";
import { Image } from "../../src/docker/image.ts";
import { RemoteImage } from "../../src/docker/remote-image.ts";
import "../../src/test/vitest.ts";
import { BRANCH_PREFIX } from "../util.ts";

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

const api = await createCloudflareApi();

describe.sequential("Container Resource", () => {
  test("create container", async (scope) => {
    try {
      const make = async (dockerfile?: string) =>
        Worker(`container-test-worker${BRANCH_PREFIX}`, {
          name: `container-test-worker${BRANCH_PREFIX}`,
          adopt: true,
          entrypoint: path.join(import.meta.dirname, "container-handler.ts"),
          compatibilityFlags: ["nodejs_compat"],
          compatibilityDate: "2025-06-24",
          format: "esm",
          bindings: {
            MY_CONTAINER: await Container(`container-test${BRANCH_PREFIX}`, {
              className: "MyContainer",
              name: "test-image",
              tag: "latest",
              build: {
                context: path.join(import.meta.dirname, "container"),
                dockerfile,
              },
              maxInstances: 1,
              adopt: true,
            }),
          },
        });

      // create
      await make();
      // update
      await make("Dockerfile.update");
    } finally {
      // delete
      await destroy(scope);
    }
  });

  test("max_instances is set on ContainerApplication", async (scope) => {
    try {
      const containerName = `container-test-max-instances${BRANCH_PREFIX}`;
      const make = async (dockerfile?: string) =>
        Worker(`container-test-worker-max-instances${BRANCH_PREFIX}`, {
          name: `container-test-worker-max-instances${BRANCH_PREFIX}`,
          adopt: true,
          entrypoint: path.join(import.meta.dirname, "container-handler.ts"),
          compatibilityFlags: ["nodejs_compat"],
          compatibilityDate: "2025-06-24",
          format: "esm",
          bindings: {
            MY_CONTAINER: await Container(containerName, {
              className: "MyContainer",
              name: containerName,
              tag: "latest",
              build: {
                context: path.join(import.meta.dirname, "container"),
                dockerfile,
              },
              maxInstances: 2,
              adopt: true,
            }),
          },
        });

      // create
      await make();
      // update
      await make("Dockerfile.update");

      const app = await getContainerApplicationByName(api, containerName);
      expect(app?.max_instances).toBe(2);
    } finally {
      // delete
      await destroy(scope);
    }
  });

  test("adopt container bound to worker with same DO namespace id", async (scope) => {
    const workerName = `${BRANCH_PREFIX}-container-do-worker`;
    const containerName = `${BRANCH_PREFIX}-container-with-do`;

    async function create(suffix: string) {
      await Worker(`worker-${suffix}`, {
        name: workerName,
        adopt: true,
        entrypoint: path.join(import.meta.dirname, "container-handler.ts"),
        compatibilityFlags: ["nodejs_compat"],
        compatibilityDate: "2025-06-24",
        format: "esm",
        bindings: {
          MY_CONTAINER: await Container("container", {
            className: "MyContainer",
            name: containerName,
            adopt: true,
            tag: "v1",
            build: {
              context: path.join(import.meta.dirname, "container"),
            },
            maxInstances: 1,
          }),
        },
      });
    }

    try {
      await create("1");
      await create("2");
    } finally {
      await destroy(scope);
    }
  });

  test("container application adoption with non-existent app", async (scope) => {
    const applicationId = `${BRANCH_PREFIX}-container-app-nonexistent`;

    // Create a container to get the properly configured image
    const container = await Container(
      `${BRANCH_PREFIX}-container-for-nonexistent`,
      {
        className: "TestContainer",
        name: "test-container-nonexistent",
        tag: "latest",
        build: {
          context: path.join(import.meta.dirname, "container"),
        },
        adopt: true,
      },
    );

    try {
      // Test that adopting a non-existent application creates it normally
      const containerApp = await ContainerApplication(applicationId, {
        name: applicationId,
        adopt: true,
        image: container.image,
        instances: 1,
        maxInstances: 2,
      });

      expect(containerApp).toMatchObject({
        name: applicationId,
        id: expect.any(String),
      });
    } finally {
      await destroy(scope);
    }
  });

  test("pull and push external image (by ref) to CF", async (scope) => {
    const containerName = `${BRANCH_PREFIX}-external-image`;

    try {
      // Use a small external image - automatically pushed to CF
      const container = await Container(containerName, {
        className: "TestContainer",
        name: containerName,
        image: "nginx:alpine",
        adopt: true,
      });

      expect(container.image.imageRef).toContain("registry.cloudflare.com");
      expect(container.image.name).toBeTruthy();
    } finally {
      await destroy(scope);
    }
  });

  test("pull and push pulled Image to CF", async (scope) => {
    const containerName = `${BRANCH_PREFIX}-external-image`;

    try {
      const image = await Image("image", {
        image: "nginx:alpine",
      });
      // Use a small external image - automatically pushed to CF
      const container = await Container(containerName, {
        className: "TestContainer",
        name: containerName,
        image,
        adopt: true,
      });

      expect(container.image.imageRef).toContain("registry.cloudflare.com");
      expect(container.image.name).toBeTruthy();
    } finally {
      await destroy(scope);
    }
  });

  test("pull and push pulled RemoteImage to CF", async (scope) => {
    const containerName = `${BRANCH_PREFIX}-external-image`;

    try {
      const image = await RemoteImage("image", {
        name: "nginx",
        tag: "alpine",
      });
      // Use a small external image - automatically pushed to CF
      const container = await Container(containerName, {
        className: "TestContainer",
        name: containerName,
        image,
        adopt: true,
      });

      expect(container.image.imageRef).toContain("registry.cloudflare.com");
      expect(container.image.name).toBeTruthy();
    } finally {
      await destroy(scope);
    }
  });

  test("pull and push pre-built Image to CF", async (scope) => {
    const containerName = `${BRANCH_PREFIX}-external-image`;

    try {
      const image = await Image("image", {
        name: "my-image",
        tag: "latest",
        build: {
          context: path.join(import.meta.dirname, "container"),
        },
      });
      // Use a small external image - automatically pushed to CF
      const container = await Container(containerName, {
        className: "TestContainer",
        name: containerName,
        image,
        adopt: true,
      });

      expect(container.image.imageRef).toContain("registry.cloudflare.com");
      expect(container.image.name).toBeTruthy();
    } finally {
      await destroy(scope);
    }
  });

  test("rollout with rolling strategy is passed through Worker", async (scope) => {
    const containerName = `${BRANCH_PREFIX}-container-rollout-worker`;
    const workerName = `${BRANCH_PREFIX}-worker-with-rollout`;

    try {
      const container = await Container(containerName, {
        className: "MyContainer",
        name: containerName,
        tag: "latest",
        build: {
          context: path.join(import.meta.dirname, "container"),
        },
        adopt: true,
        maxInstances: 2,
        rollout: {
          strategy: "rolling",
          stepPercentage: 25,
        },
      });

      expect(container.rollout).toMatchObject({
        strategy: "rolling",
        stepPercentage: 25,
      });

      // Create worker with the container binding
      await Worker(workerName, {
        name: workerName,
        adopt: true,
        entrypoint: path.join(import.meta.dirname, "container-handler.ts"),
        compatibilityFlags: ["nodejs_compat"],
        compatibilityDate: "2025-06-24",
        format: "esm",
        bindings: {
          MY_CONTAINER: container,
        },
      });

      // Verify the container application was created
      const app = await getContainerApplicationByName(api, containerName);
      expect(app).toBeDefined();
      expect(app?.name).toBe(containerName);
    } finally {
      await destroy(scope);
    }
  });

  test("rollout with immediate strategy", async (scope) => {
    const containerName = `${BRANCH_PREFIX}-container-immediate-rollout`;
    const workerName = `${BRANCH_PREFIX}-worker-immediate-rollout`;

    try {
      const container = await Container(containerName, {
        className: "MyContainer",
        name: containerName,
        tag: "latest",
        build: {
          context: path.join(import.meta.dirname, "container"),
        },
        adopt: true,
        maxInstances: 2,
        rollout: {
          strategy: "immediate",
        },
      });

      expect(container.rollout).toMatchObject({
        strategy: "immediate",
      });

      // Create worker with the container binding
      await Worker(workerName, {
        name: workerName,
        adopt: true,
        entrypoint: path.join(import.meta.dirname, "container-handler.ts"),
        compatibilityFlags: ["nodejs_compat"],
        compatibilityDate: "2025-06-24",
        format: "esm",
        bindings: {
          MY_CONTAINER: container,
        },
      });

      // Verify the container application was created
      const app = await getContainerApplicationByName(api, containerName);
      expect(app).toBeDefined();
      expect(app?.name).toBe(containerName);
    } finally {
      await destroy(scope);
    }
  });

  test("throws error when both build and image are specified", async (scope) => {
    await expect(
      Container(`${BRANCH_PREFIX}-invalid-container`, {
        className: "TestContainer",
        name: "invalid-container",
        image: "nginx:alpine",
        build: {
          context: path.join(import.meta.dirname, "container"),
        },
      } as any),
    ).rejects.toThrow("specify either `build` or `image`, not both");
  });

  test("prebuilt CF registry image skips Docker pull (no 401)", async (scope) => {
    const containerName = `${BRANCH_PREFIX}-prebuilt-cf-image`;
    const cfRegistry = getCloudflareContainerRegistry();

    try {
      // Use a CF registry image reference - should NOT attempt to pull
      // This would cause a 401 if pulled, but should pass since we skip the pull
      const container = await Container(containerName, {
        className: "TestContainer",
        name: containerName,
        image: `${cfRegistry}/${api.accountId}/test-image:v1`,
        adopt: true,
      });

      // Verify the image reference is preserved (with normalization)
      expect(container.image.imageRef).toBe(
        `${cfRegistry}/${api.accountId}/test-image:v1`,
      );
      expect(container.image.build).toBeUndefined();
    } finally {
      await destroy(scope);
    }
  });

  describe("resolveImageName", () => {
    const accountId = "abc123def456abc123def456abc12345";
    const cfRegistry = getCloudflareContainerRegistry();

    vitestTest("adds CF registry and accountId to short names", () => {
      expect(resolveImageName(accountId, "myapp:v1")).toBe(
        `${cfRegistry}/${accountId}/myapp:v1`,
      );
      expect(resolveImageName(accountId, "my-image:latest")).toBe(
        `${cfRegistry}/${accountId}/my-image:latest`,
      );
    });

    vitestTest(
      "handles image names containing dots without registry prefix",
      () => {
        expect(resolveImageName(accountId, "my.app:v1")).toBe(
          `${cfRegistry}/${accountId}/my.app:v1`,
        );
        expect(resolveImageName(accountId, "my.dotted.image:latest")).toBe(
          `${cfRegistry}/${accountId}/my.dotted.image:latest`,
        );
      },
    );

    vitestTest("adds accountId to CF registry images missing accountId", () => {
      expect(resolveImageName(accountId, `${cfRegistry}/myapp:v1`)).toBe(
        `${cfRegistry}/${accountId}/myapp:v1`,
      );
      expect(
        resolveImageName(accountId, `${cfRegistry}/session-container:44f030b`),
      ).toBe(`${cfRegistry}/${accountId}/session-container:44f030b`);
    });

    vitestTest("adds accountId when first segment is not an accountId", () => {
      expect(
        resolveImageName(accountId, `${cfRegistry}/some-name/image:tag`),
      ).toBe(`${cfRegistry}/${accountId}/some-name/image:tag`);
    });

    vitestTest(
      "preserves fully-qualified CF registry images with accountId",
      () => {
        const fullyQualified = `${cfRegistry}/${accountId}/myapp:v1`;
        expect(resolveImageName(accountId, fullyQualified)).toBe(
          fullyQualified,
        );
      },
    );

    vitestTest("passes through external registry images unchanged", () => {
      expect(resolveImageName(accountId, "docker.io/nginx:1.25")).toBe(
        "docker.io/nginx:1.25",
      );
      expect(resolveImageName(accountId, "ghcr.io/org/image:v1")).toBe(
        "ghcr.io/org/image:v1",
      );
      expect(
        resolveImageName(
          accountId,
          "123456789.dkr.ecr.us-east-1.amazonaws.com/myapp:latest",
        ),
      ).toBe("123456789.dkr.ecr.us-east-1.amazonaws.com/myapp:latest");
    });
  });
});

const localTest = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
  local: true,
});

describe("Container Resource (local dev)", () => {
  localTest(
    "pulls CF registry image with auth in local dev mode",
    async (scope) => {
      const containerName = `${BRANCH_PREFIX}-cf-image-local-dev`;
      const cfRegistry = getCloudflareContainerRegistry();

      try {
        // First, push an image to CF registry (in non-local context)
        // We'll use an existing image that was pushed by previous tests
        // or build one fresh and push it
        const imageRef = `${cfRegistry}/${api.accountId}/${containerName}:latest`;

        // Build and push an image to CF registry first (in non-local mode)
        const remoteContainer = await alchemy.run(
          `${containerName}-setup`,
          {
            phase: scope.phase,
            prefix: `${BRANCH_PREFIX}-setup`,
            quiet: true,
            local: false,
          },
          async () => {
            return Container(`${containerName}-setup`, {
              className: "TestContainer",
              name: containerName,
              tag: "latest",
              build: {
                context: path.join(import.meta.dirname, "container"),
              },
              adopt: true,
            });
          },
        );

        // Now test that we can pull this CF registry image in local dev mode
        const container = await Container(containerName, {
          className: "TestContainer",
          name: containerName,
          image: remoteContainer.image.imageRef,
          adopt: true,
        });

        // In local dev mode, the image should be re-tagged to cloudflare-dev/ namespace
        expect(container.image.imageRef).toMatch(
          new RegExp(`^cloudflare-dev/${containerName}:latest`),
        );
        expect(container.image.name).toBe(`cloudflare-dev/${containerName}`);
      } finally {
        await destroy(scope);
      }
    },
  );
});

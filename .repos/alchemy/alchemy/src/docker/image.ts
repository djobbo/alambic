import fs from "node:fs/promises";
import path from "pathe";
import type { Context } from "../context.ts";
import { Resource } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { DockerApi } from "./api.ts";
import { pushImageToRegistry } from "./registry.ts";
import type { RemoteImage } from "./remote-image.ts";

/**
 * Options for building a Docker image
 */
export interface DockerBuildOptions {
  /**
   * Path to the build context directory
   *
   * @default - the `dirname(dockerfile)` if provided or otherwise `process.cwd()`
   */
  context?: string;

  /**
   * Path to the Dockerfile, relative to context
   *
   * @default - `Dockerfile`
   */
  dockerfile?: string;

  /**
   * Target build platform (e.g., linux/amd64)
   */
  platform?: string;

  /**
   * Build arguments as key-value pairs
   */
  args?: Record<string, string>;

  /**
   * Target build stage in multi-stage builds
   */
  target?: string;

  /**
   * Use an external cache source for a build
   *
   * @see https://docs.docker.com/reference/cli/docker/buildx/build/#cache-from
   *
   */
  cacheFrom?: string[];

  /**
   * Export build cache to an external cache destination
   *
   * @see https://docs.docker.com/reference/cli/docker/buildx/build/#cache-to
   *
   */
  cacheTo?: string[];

  /**
   * Additional options to pass to the Docker build command. This serves as an escape hatch for any additional options that are not supported by the other properties.
   *
   * @see https://docs.docker.com/reference/cli/docker/buildx/build/#options
   *
   */
  options?: string[];
}

export interface ImageRegistry {
  server: string;
  username: string;
  password: Secret;
}

/**
 * Properties for creating a Docker image
 */
export type ImageProps = {
  /**
   * Tag for the image (e.g., "latest")
   */
  tag?: string;

  /**
   * Registry credentials
   */
  registry?: ImageRegistry;

  /**
   * Whether to skip pushing the image to registry
   */
  skipPush?: boolean;
} & (
  | {
      /**
       * Image name or reference (e.g., "nginx:alpine")
       */
      image: string | Image | RemoteImage;
      build?: never;
      name?: never;
    }
  | {
      /**
       * Repository name for the image (e.g., "username/image")
       *
       * @default - the id
       */
      name?: string;
      /**
       * Build configuration
       */
      build: DockerBuildOptions;

      image?: never;
    }
);

/**
 * Docker Image resource
 */
export interface Image {
  kind: "Image";
  /**
   * Image name
   */
  name: string;

  /**
   * Full image reference (name:tag)
   */
  imageRef: string;

  /**
   * Image ID
   */
  imageId?: string;

  /**
   * Repository digest if pushed
   */
  repoDigest?: string;

  /**
   * Time when the image was built
   */
  builtAt: number;
  /**
   * Tag for the image
   */
  tag: string;

  /**
   * Build configuration
   */
  build: DockerBuildOptions | undefined;
}

/**
 * Build and manage a Docker image from a Dockerfile
 *
 * @example
 * // Build a Docker image from a Dockerfile
 * const appImage = await Image("app-image", {
 *   name: "myapp",
 *   tag: "latest",
 *   build: {
 *     context: "./app",
 *     dockerfile: "Dockerfile",
 *     buildArgs: {
 *       NODE_ENV: "production"
 *     }
 *   }
 * });
 */
export const Image = Resource(
  "docker::Image",
  async function (
    this: Context<Image>,
    id: string,
    props: ImageProps,
  ): Promise<Image> {
    // Initialize Docker API client with the isolated config directory
    const api = new DockerApi();

    if (this.phase === "delete") {
      // No action needed for delete as Docker images aren't automatically removed
      // This is intentional as other resources might depend on the same image
      return this.destroy();
    }

    const tag = props.tag || "latest";
    const name =
      props.name ||
      (typeof props.image === "string"
        ? props.image
        : props.image?.name
      )?.split(":")[0] ||
      id;
    const imageRef = `${name}:${tag}`;
    let imageId: string | undefined;
    if (props.image) {
      const image =
        typeof props.image === "string" ? props.image : props.image.imageRef;

      const kind =
        typeof props.image === "object" && props.image.kind === "Image"
          ? "local"
          : "remote";
      if (kind === "remote") {
        await api.pullImage(image);
      }
      await api.tagImage(image, imageRef);
      // TODO: Extract image ID from pull output if available
    } else {
      let context: string;
      let dockerfile: string;
      if (props.build?.dockerfile && props.build?.context) {
        context = path.resolve(props.build.context);
        dockerfile = path.resolve(context, props.build.dockerfile);
      } else if (props.build?.dockerfile) {
        context = process.cwd();
        dockerfile = path.resolve(context, props.build.dockerfile);
      } else if (props.build?.context) {
        context = path.resolve(props.build.context);
        dockerfile = path.resolve(context, "Dockerfile");
      } else {
        context = process.cwd();
        dockerfile = path.resolve(context, "Dockerfile");
      }
      await fs.access(context);
      await fs.access(dockerfile);

      // Prepare build options
      const buildOptions: Record<string, string> = props.build?.args || {};

      // Add platform if specified
      const buildArgs = ["build", "-t", imageRef];

      if (props.build?.platform) {
        buildArgs.push("--platform", props.build.platform);
      }

      // Add target if specified
      if (props.build?.target) {
        buildArgs.push("--target", props.build.target);
      }

      // Add cache sources if specified
      if (props.build?.cacheFrom && props.build.cacheFrom.length > 0) {
        for (const cacheSource of props.build.cacheFrom) {
          buildArgs.push("--cache-from", cacheSource);
        }
      }

      // Add cache destinations if specified
      if (props.build?.cacheTo && props.build.cacheTo.length > 0) {
        for (const cacheTarget of props.build.cacheTo) {
          buildArgs.push("--cache-to", cacheTarget);
        }
      }

      // Add build arguments
      for (const [key, value] of Object.entries(buildOptions)) {
        buildArgs.push("--build-arg", `${key}=${value}`);
      }

      // Add build options if specified
      if (props.build?.options && props.build.options.length > 0) {
        buildArgs.push(...props.build.options);
      }

      buildArgs.push("-f", dockerfile);

      // Add context path
      buildArgs.push(context);

      // Execute build command
      const { stdout } = await api.exec(buildArgs);

      // Extract image ID from build output if available
      const imageIdMatch = /Successfully built ([a-f0-9]+)/.exec(stdout);
      imageId = imageIdMatch ? imageIdMatch[1] : undefined;
    }

    // Handle push if required
    let repoDigest: string | undefined;
    let finalImageRef = imageRef;
    if (props.registry && !props.skipPush) {
      const pushedImage = await pushImageToRegistry(imageRef, props.registry);
      finalImageRef = pushedImage.imageRef;
      repoDigest = pushedImage.repoDigest;
    }
    return {
      kind: "Image",
      tag,
      name,
      imageRef: finalImageRef,
      imageId,
      repoDigest,
      builtAt: Date.now(),
      build: props.build,
    };
  },
);

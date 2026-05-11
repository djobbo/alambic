export {
  ApplicationComposeProvider,
  ApplicationCompose,
  type ApplicationComposeProps,
} from "./Compose.ts";
export { ApplicationImageProvider, ApplicationImage, type ApplicationImageProps } from "./Image.ts";
export type { ApplicationOutputs } from "./shared.ts";

import { ApplicationCompose } from "./Compose.ts";
import { ApplicationImage } from "./Image.ts";
import { Worker as ApplicationWorker } from "../Worker.ts";

export const Application = {
  Image: ApplicationImage,
  Compose: ApplicationCompose,
  Worker: ApplicationWorker,
} as const;

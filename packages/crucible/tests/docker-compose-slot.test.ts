import { describe, expect, test } from "vite-plus/test";

import {
  CRUCIBLE_BLUE_GREEN_SLOT_PLACEHOLDER,
  expandComposeBlueGreenPlaceholder,
} from "../src/Dokploy/dockerCompose.ts";

describe("expandComposeBlueGreenPlaceholder", () => {
  test("replaces marker in file mount content per slot", () => {
    const compose = {
      volumes: [
        {
          type: "file" as const,
          filePath: "i.html",
          mountPath: "/usr/share/nginx/html/index.html",
          content: `<p class="slot-${CRUCIBLE_BLUE_GREEN_SLOT_PLACEHOLDER}">${CRUCIBLE_BLUE_GREEN_SLOT_PLACEHOLDER}</p>`,
        },
      ],
    };
    const blue = expandComposeBlueGreenPlaceholder(compose, "blue");
    expect(blue?.volumes?.[0]?.type).toBe("file");
    if (blue?.volumes?.[0]?.type === "file") {
      expect(blue.volumes[0].content).toContain("slot-blue");
      expect(blue.volumes[0].content).toContain(">blue<");
    }
    const native = expandComposeBlueGreenPlaceholder(compose, undefined);
    if (native?.volumes?.[0]?.type === "file") {
      expect(native.volumes[0].content).toContain("slot-native");
    }
  });

  test("returns same compose reference when placeholder absent", () => {
    const compose = {
      volumes: [{ type: "file" as const, filePath: "x.txt", mountPath: "/x", content: "hi" }],
    };
    expect(expandComposeBlueGreenPlaceholder(compose, "green")).toBe(compose);
  });
});

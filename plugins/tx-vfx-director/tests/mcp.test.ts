import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MCP surface", () => {
  it("declares the focused editor, save and request-read tools", async () => {
    const source = await readFile(path.resolve("server/src/index.ts"), "utf8");
    const appSource = await readFile(path.resolve("web/src/App.tsx"), "utf8");
    expect(source).toContain('"open_vfx_editor"');
    expect(source).toContain('"save_vfx_request"');
    expect(source).toContain('"get_vfx_request"');
    expect(source).toContain("ui://tx-vfx-director/editor.html");
    expect(source).toContain("createVfxSession");
    expect(source).toContain("imagePath: z.string().min(1).optional()");
    expect(source).toContain("initialTargets:");
    expect(source).toContain("initialEffectGroups:");
    expect(source).not.toContain('visibility: ["app"]');
    expect(appSource).not.toContain(".callServerTool(");
    expect(appSource).toContain("app.updateModelContext");
    expect(appSource).toContain("imageContent(sourceDataUrl)");
    expect(appSource).toContain('schemaVersion: "vfx-director-inline/v2"');
    expect(appSource).toContain("buildRenderPlan");
    expect(appSource).toContain("renderTextOverlay");
  });
});

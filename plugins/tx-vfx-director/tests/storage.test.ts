import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendVfxSourceChunk,
  beginVfxSourceUpload,
  createVfxSession,
  createVfxSessionFromData,
  finishVfxSourceUpload,
  readVfxManifest,
  saveVfxRequest,
} from "../server/src/storage";

const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const dataUrl = `data:image/png;base64,${onePixelPng}`;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vfx-director-test-"));
  roots.push(root);
  const source = path.join(root, "source.png");
  const reference = path.join(root, "reference.png");
  await Promise.all([
    fs.writeFile(source, Buffer.from(onePixelPng, "base64")),
    fs.writeFile(reference, Buffer.from(onePixelPng, "base64")),
  ]);
  return { root, source, reference };
}

describe("VFX Director request storage", () => {
  it("creates a focused session and imports initial references", async () => {
    const { root, source, reference } = await fixture();
    const result = await createVfxSession({ imagePath: source, workspaceRoot: root, effectHint: "金色能量", referenceImagePaths: [reference] });
    expect(result.session.effectHint).toBe("金色能量");
    expect(result.initialReferences).toHaveLength(1);
    expect(result.initialReferences[0].roles).toEqual(["shape", "material"]);
    await expect(fs.stat(result.session.sourcePath)).resolves.toMatchObject({});
  });

  it("creates a source session from an editor import", async () => {
    const { root } = await fixture();
    const result = await createVfxSessionFromData({
      fileName: "clipboard.png",
      mimeType: "image/png",
      sourceDataUrl: dataUrl,
      workspaceRoot: root,
      effectHint: "林间辉光",
    });
    expect(result.session.sourceFileName).toBe("clipboard.png");
    expect(result.session.effectHint).toBe("林间辉光");
    expect(result.sourceDataUrl).toBe(dataUrl);
    await expect(fs.stat(result.session.sourcePath)).resolves.toMatchObject({});
  });

  it("streams a multi-megabyte source through small ordered chunks", async () => {
    const { root } = await fixture();
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 0xab);
    const base64 = bytes.toString("base64");
    const started = await beginVfxSourceUpload({
      fileName: "large-source.png",
      mimeType: "image/png",
      totalBytes: bytes.length,
      workspaceRoot: root,
    });
    let chunkIndex = 0;
    for (let offset = 0; offset < base64.length; offset += started.maxChunkChars) {
      await appendVfxSourceChunk({
        uploadId: started.uploadId,
        chunkIndex,
        chunk: base64.slice(offset, offset + started.maxChunkChars),
      });
      chunkIndex += 1;
    }
    const result = await finishVfxSourceUpload({ uploadId: started.uploadId });
    await expect(fs.stat(result.session.sourcePath)).resolves.toMatchObject({ size: bytes.length });
    await expect(fs.readFile(result.session.sourcePath)).resolves.toEqual(bytes);
  });

  it("writes a complete non-overwriting request manifest", async () => {
    const { root, source } = await fixture();
    const { session } = await createVfxSession({ imagePath: source, workspaceRoot: root });
    const result = await saveVfxRequest({
      sessionFile: session.sessionFile,
      width: 1920,
      height: 1080,
      brief: {
        effectDescription: "从手掌向右上方爆发金色能量",
        renderStage: "action",
        stageIntent: { anticipation: "蓄积", action: "爆发", dissipation: "消散" },
        palette: "暖金",
        preserve: "保持人物身份与构图",
        allowLighting: true,
        allowHaze: true,
        allowBloom: true,
        allowReflection: true,
      },
      annotations: [{ id: "a", kind: "flow", stage: "action", layer: "core", points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.2 }] }],
      guideDataUrl: dataUrl,
      influenceDataUrl: dataUrl,
      protectionDataUrl: dataUrl,
      references: [{ fileName: "shape.png", mimeType: "image/png", dataBase64: dataUrl, roles: ["shape"] }],
    });
    const manifest = await readVfxManifest(result.manifestPath);
    expect(manifest.schemaVersion).toBe("vfx-director-request/v1");
    expect(manifest.source.width).toBe(1920);
    expect(manifest.references[0].roles).toEqual(["shape"]);
    expect(manifest.guides.annotated).not.toBe(manifest.source.path);
  });

  it("rejects missing reference responsibilities", async () => {
    const { root, source } = await fixture();
    const { session } = await createVfxSession({ imagePath: source, workspaceRoot: root });
    await expect(saveVfxRequest({
      sessionFile: session.sessionFile,
      width: 100,
      height: 100,
      brief: {
        effectDescription: "能量",
        renderStage: "action",
        stageIntent: { anticipation: "", action: "", dissipation: "" },
        palette: "",
        preserve: "保持构图",
        allowLighting: true,
        allowHaze: true,
        allowBloom: true,
        allowReflection: true,
      },
      annotations: [{ id: "a", kind: "emitter", stage: "action", layer: "core", points: [{ x: 0.5, y: 0.5 }] }],
      guideDataUrl: dataUrl,
      influenceDataUrl: dataUrl,
      protectionDataUrl: dataUrl,
      references: [{ fileName: "bad.png", mimeType: "image/png", dataBase64: dataUrl, roles: [] }],
    })).rejects.toThrow("必须选择有效职责");
  });

  it("writes and reads a grouped v2 request with an exact text overlay", async () => {
    const { root, source } = await fixture();
    const { session } = await createVfxSession({ imagePath: source, workspaceRoot: root });
    const target = { id: "person-a", name: "人物 A", kind: "person" as const, color: "#58d6ff", confirmed: true, source: "manual" as const };
    const group = { id: "group-a", name: "人物 A 刀光", color: "#58d6ff", targetIds: [target.id], effectDescription: "蓝色环形刀光", palette: "蓝白", stage: "action" as const, layer: "core" as const, allowLighting: true, allowHaze: false, allowBloom: true, allowReflection: true, visible: true, locked: false, solo: false, order: 0 };
    const textLayer = { id: "title-a", name: "招式名", text: "破空斩", groupId: group.id, targetId: target.id, anchor: { x: 0.5, y: 0.2 }, orientation: "horizontal" as const, fontFamily: "KaiTi", fontSize: 80, fontWeight: 800, tracking: 8, fill: "#ffffff", stroke: "#000000", strokeWidth: 2, shadowColor: "#000000", shadowBlur: 12, rotation: 0, align: "center" as const, zIndex: 0, visible: true, locked: false };
    const result = await saveVfxRequest({
      sessionFile: session.sessionFile,
      width: 2048,
      height: 858,
      brief: { effectDescription: group.effectDescription, renderStage: "action", stageIntent: { anticipation: "蓄势", action: "爆发", dissipation: "消散" }, palette: group.palette, preserve: "保持身份和构图", allowLighting: true, allowHaze: false, allowBloom: true, allowReflection: true },
      annotations: [{ id: "ring-a", kind: "ring", stage: "action", layer: "core", groupId: group.id, targetId: target.id, points: [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }], geometry: { kind: "ellipse", center: { x: 0.5, y: 0.5 }, radiusX: 0.1, radiusY: 0.05 } }],
      guideDataUrl: dataUrl,
      influenceDataUrl: dataUrl,
      protectionDataUrl: dataUrl,
      textOverlayDataUrl: dataUrl,
      references: [{ fileName: "blade.png", mimeType: "image/png", dataBase64: dataUrl, roles: ["shape", "typography"], groupIds: [group.id] }],
      targets: [target],
      effectGroups: [group],
      textLayers: [textLayer],
    });
    const manifest = await readVfxManifest(result.manifestPath);
    expect(manifest.schemaVersion).toBe("vfx-director-request/v2");
    if (manifest.schemaVersion !== "vfx-director-request/v2") throw new Error("expected v2");
    expect(manifest.effectGroups[0].targetIds).toEqual([target.id]);
    expect(manifest.references[0].groupIds).toEqual([group.id]);
    expect(manifest.guides.textOverlay).toContain("overlay-text.png");
    expect(manifest.renderPlan.passes.at(-1)?.kind).toBe("packaging");
  });
});

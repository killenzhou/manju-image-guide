import { describe, expect, it } from "vitest";
import { buildRenderPlan } from "../server/src/render-plan";
import type { VfxEffectGroup, VfxTextLayer } from "../server/src/types";
import { DEFAULT_GEOMETRY_CONTROLS, geometryAnnotation } from "../web/src/editor-model";

function group(id: string, targetIds: string[], layer: VfxEffectGroup["layer"], order: number): VfxEffectGroup {
  return { id, name: id, color: "#58d6ff", targetIds, effectDescription: id, palette: "蓝白", stage: "action", layer, allowLighting: true, allowHaze: true, allowBloom: true, allowReflection: true, visible: true, locked: false, solo: false, order };
}

function textLayer(): VfxTextLayer {
  return { id: "text", name: "标题", text: "破空斩", anchor: { x: 0.5, y: 0.2 }, orientation: "horizontal", fontFamily: "KaiTi", fontSize: 80, fontWeight: 800, tracking: 8, fill: "#ffffff", stroke: "#000000", strokeWidth: 2, shadowColor: "#000000", shadowBlur: 8, rotation: 0, align: "center", zIndex: 0, visible: true, locked: false };
}

describe("v2 editor model", () => {
  it("keeps a simple multi-object shot in one VFX pass plus deterministic packaging", () => {
    const plan = buildRenderPlan([group("a", ["person-a"], "core", 0), group("b", ["person-b"], "secondary", 1)], [textLayer()]);
    expect(plan.mode).toBe("single");
    expect(plan.passes.map((pass) => pass.kind)).toEqual(["combined-vfx", "packaging"]);
  });

  it("stages conflicting core effects for the same person", () => {
    const plan = buildRenderPlan([group("fire", ["person-a"], "core", 0), group("shield", ["person-a"], "core", 1), group("fog", [], "environment", 2), group("trail", ["person-a"], "secondary", 3)], []);
    expect(plan.mode).toBe("staged");
    expect(plan.passes.map((pass) => pass.kind)).toEqual(["environment", "core", "core", "secondary"]);
  });

  it("creates stable ellipse, arc and spiral geometry with group binding", () => {
    const base = { id: "shape", start: { x: 0.5, y: 0.5 }, current: { x: 0.75, y: 0.65 }, stage: "action" as const, layer: "core" as const, groupId: "group-a", targetId: "person-a", controls: DEFAULT_GEOMETRY_CONTROLS };
    const ring = geometryAnnotation({ ...base, tool: "ring" });
    const arc = geometryAnnotation({ ...base, tool: "arc" });
    const spiral = geometryAnnotation({ ...base, tool: "spiral" });
    expect(ring.points.length).toBe(73);
    expect(ring.points[0].x).toBeCloseTo(ring.points.at(-1)!.x, 5);
    expect(arc.geometry?.kind).toBe("arc");
    expect(spiral.geometry?.turns).toBe(DEFAULT_GEOMETRY_CONTROLS.turns);
    expect([ring, arc, spiral].every((annotation) => annotation.groupId === "group-a" && annotation.targetId === "person-a")).toBe(true);
  });
});

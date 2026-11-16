import type { VfxEffectGroup, VfxRenderPass, VfxRenderPlan, VfxTextLayer } from "./types.js";

function ordered(groups: VfxEffectGroup[]) {
  return groups.filter((group) => group.visible).sort((a, b) => a.order - b.order);
}

export function buildRenderPlan(groups: VfxEffectGroup[], textLayers: VfxTextLayer[]): VfxRenderPlan {
  const active = ordered(groups);
  const visibleText = textLayers.filter((layer) => layer.visible).sort((a, b) => a.zIndex - b.zIndex);
  const coreCounts = new Map<string, number>();
  for (const group of active.filter((item) => item.layer === "core")) {
    for (const targetId of group.targetIds.length ? group.targetIds : ["scene"]) {
      coreCounts.set(targetId, (coreCounts.get(targetId) || 0) + 1);
    }
  }
  const simple = active.length <= 3 && [...coreCounts.values()].every((count) => count <= 1);
  const packagingPass: VfxRenderPass | undefined = visibleText.length ? {
    id: "pass-packaging",
    name: "精确文字与包装",
    kind: "packaging",
    effectGroupIds: [],
    textLayerIds: visibleText.map((layer) => layer.id),
    preservePreviousPasses: true,
  } : undefined;

  if (simple) {
    const passes: VfxRenderPass[] = active.length ? [{
      id: "pass-vfx-combined",
      name: "合并生成特效",
      kind: "combined-vfx",
      effectGroupIds: active.map((group) => group.id),
      textLayerIds: [],
      preservePreviousPasses: false,
    }] : [];
    if (packagingPass) passes.push(packagingPass);
    return {
      mode: "single",
      reason: "特效组不超过 3 个，且每个对象最多一个核心特效，可稳定合并生成。",
      passes,
    };
  }

  const passes: VfxRenderPass[] = [];
  const environmentIds = active.filter((group) => group.layer === "environment").map((group) => group.id);
  if (environmentIds.length) passes.push({
    id: "pass-environment",
    name: "环境与区域氛围",
    kind: "environment",
    effectGroupIds: environmentIds,
    textLayerIds: [],
    preservePreviousPasses: false,
  });
  active.filter((group) => group.layer === "core").forEach((group, index) => passes.push({
    id: `pass-core-${index + 1}`,
    name: `${group.name} · 核心特效`,
    kind: "core",
    effectGroupIds: [group.id],
    textLayerIds: [],
    preservePreviousPasses: passes.length > 0,
  }));
  const secondaryIds = active.filter((group) => group.layer === "secondary").map((group) => group.id);
  if (secondaryIds.length) passes.push({
    id: "pass-secondary",
    name: "拖尾、粒子与消散",
    kind: "secondary",
    effectGroupIds: secondaryIds,
    textLayerIds: [],
    preservePreviousPasses: passes.length > 0,
  });
  if (packagingPass) passes.push(packagingPass);
  return {
    mode: "staged",
    reason: "对象或核心特效较多，按环境、人物核心、次级拖尾和文字包装分阶段生成可减少串线。",
    passes,
  };
}

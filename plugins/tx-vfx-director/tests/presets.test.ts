import { describe, expect, it } from "vitest";
import {
  BUILT_IN_PRESETS,
  CUSTOM_PRESET_STORAGE_KEY,
  LEGACY_CUSTOM_PRESET_STORAGE_KEY,
  MAX_CUSTOM_PRESETS,
  PACKAGING_PRESETS,
  PRESET_REFERENCE_ROLES,
  loadCustomPresets,
  parseCustomPresets,
  type CustomVfxPreset,
} from "../web/src/presets";

const image = "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJQBOgCHwAP7+4AA=";

function customPreset(index: number): CustomVfxPreset {
  return {
    id: `custom-${index}`,
    name: `我的预设 ${index}`,
    category: "我的预设",
    source: "custom",
    createdAt: "2026-07-31T00:00:00.000Z",
    effectDescription: "测试烟雾",
    palette: "冷灰",
    stage: "action",
    layer: "secondary",
    tool: "flow",
    allowLighting: true,
    allowHaze: true,
    allowBloom: false,
    allowReflection: false,
    reference: {
      fileName: "preset.webp",
      mimeType: "image/webp",
      dataUrl: image,
      roles: [...PRESET_REFERENCE_ROLES],
    },
  };
}

describe("VFX presets", () => {
  it("ships the requested lightweight built-in effect recipes", () => {
    const names = BUILT_IN_PRESETS.map((preset) => preset.name);
    expect(names).toEqual(expect.arrayContaining(["烟雾", "火焰", "雾", "血雾与飞溅", "雪", "蓝色高亮气流", "雨", "风沙", "爆炸", "能量勾边", "拉丝黑烟", "环形气流", "冲击波环", "旋转能量", "刀光拖尾", "水墨刀光"]));
    expect(BUILT_IN_PRESETS.every((preset) => preset.effectDescription && preset.palette)).toBe(true);
  });

  it("ships both colorful fantasy and ink typography packaging", () => {
    expect(new Set(PACKAGING_PRESETS.map((preset) => preset.family))).toEqual(new Set(["彩色玄幻", "水墨书法"]));
    expect(PACKAGING_PRESETS.map((preset) => preset.name)).toEqual(expect.arrayContaining(["玄幻主标题", "人物介绍", "水墨书法标题", "竖排印章"]));
  });

  it("loads valid user image presets and limits their count", () => {
    const presets = Array.from({ length: MAX_CUSTOM_PRESETS + 2 }, (_, index) => customPreset(index));
    expect(parseCustomPresets(JSON.stringify(presets))).toHaveLength(MAX_CUSTOM_PRESETS);
  });

  it("ignores corrupt or unsafe stored preset records", () => {
    const invalid = { ...customPreset(1), reference: { ...customPreset(1).reference, dataUrl: "javascript:alert(1)" } };
    expect(parseCustomPresets(JSON.stringify([invalid]))).toEqual([]);
    expect(parseCustomPresets("not-json")).toEqual([]);
  });

  it("migrates legacy v1 presets into v2 storage", () => {
    const values = new Map<string, string>([[LEGACY_CUSTOM_PRESET_STORAGE_KEY, JSON.stringify([customPreset(1)])]]);
    const storage = { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadCustomPresets(storage)).toHaveLength(1);
    expect(values.has(CUSTOM_PRESET_STORAGE_KEY)).toBe(true);
  });
});

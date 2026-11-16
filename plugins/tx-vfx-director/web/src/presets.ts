import type { ReferenceRole, VfxGeometry, VfxLayer, VfxStage, VfxToolKind } from "../../server/src/types";

export type VfxPreset = {
  id: string;
  name: string;
  category: string;
  effectDescription: string;
  palette: string;
  stage: VfxStage;
  layer: VfxLayer;
  tool: VfxToolKind;
  allowLighting: boolean;
  allowHaze: boolean;
  allowBloom: boolean;
  allowReflection: boolean;
  geometry?: Partial<VfxGeometry>;
  reference?: {
    fileName: string;
    mimeType: "image/webp";
    dataUrl: string;
    roles: ReferenceRole[];
  };
};

export type CustomVfxPreset = VfxPreset & {
  source: "custom";
  createdAt: string;
};

export const CUSTOM_PRESET_STORAGE_KEY = "vfx-director.custom-presets.v2";
export const LEGACY_CUSTOM_PRESET_STORAGE_KEY = "vfx-director.custom-presets.v1";
export const MAX_CUSTOM_PRESETS = 8;
export const PRESET_REFERENCE_ROLES: ReferenceRole[] = ["shape", "motion", "material", "color-light", "density", "atmosphere", "layout", "typography"];

export type PackagingPreset = {
  id: string;
  name: string;
  family: "彩色玄幻" | "水墨书法";
  text: string;
  orientation: "horizontal" | "vertical";
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  tracking: number;
  fill: string;
  gradientTo?: string;
  stroke: string;
  strokeWidth: number;
  shadowColor: string;
  shadowBlur: number;
  rotation: number;
};

export const BUILT_IN_PRESETS: VfxPreset[] = [
  {
    id: "builtin-smoke",
    name: "烟雾",
    category: "烟火",
    effectDescription: "在标注区域生成具有清晰体积、自然翻卷和渐进消散的烟雾，服从场景风向、遮挡关系与景深。",
    palette: "中性灰至冷灰，受原镜头光源染色",
    stage: "dissipation",
    layer: "secondary",
    tool: "influence",
    allowLighting: true,
    allowHaze: true,
    allowBloom: false,
    allowReflection: false,
  },
  {
    id: "builtin-fire",
    name: "火焰",
    category: "烟火",
    effectDescription: "在发射点和影响区生成有明确火舌结构、热浪扭曲与少量火星的真实火焰，沿流向自然摆动。",
    palette: "白热核心、暖黄中层与橙红外缘",
    stage: "action",
    layer: "core",
    tool: "emitter",
    allowLighting: true,
    allowHaze: true,
    allowBloom: true,
    allowReflection: true,
  },
  {
    id: "builtin-fog",
    name: "雾",
    category: "环境",
    effectDescription: "在影响区增加贴合空间深度的柔和体积雾，远近密度有层次，保留主体轮廓和原场景结构。",
    palette: "服从原镜头色温，低饱和度",
    stage: "action",
    layer: "environment",
    tool: "influence",
    allowLighting: true,
    allowHaze: true,
    allowBloom: false,
    allowReflection: false,
  },
  {
    id: "builtin-blood",
    name: "血雾与飞溅",
    category: "粒子",
    effectDescription: "在标注区域增加克制、符合运动方向的暗红色血雾与少量飞溅颗粒，尺度、速度和遮挡关系自然。",
    palette: "深红、暗酒红与少量高光红",
    stage: "action",
    layer: "secondary",
    tool: "flow",
    allowLighting: false,
    allowHaze: true,
    allowBloom: false,
    allowReflection: true,
  },
  {
    id: "builtin-snow",
    name: "雪",
    category: "天气",
    effectDescription: "增加具有前中后景尺度差异的自然降雪，雪花沿流向飘落，近景略带运动模糊，主体保持清晰。",
    palette: "冷白与环境色反射",
    stage: "action",
    layer: "environment",
    tool: "flow",
    allowLighting: true,
    allowHaze: true,
    allowBloom: false,
    allowReflection: false,
  },
  {
    id: "builtin-airflow",
    name: "蓝色高亮气流",
    category: "能量",
    effectDescription: "沿流向增加半透明空气扰动、细微速度拉丝与局部折射，并加入蓝青色流动纹理和局部高亮边缘，表现高速气流但不过度遮挡主体。",
    palette: "蓝白高光、透明青蓝纹理，服从环境冷暖反射",
    stage: "action",
    layer: "secondary",
    tool: "flow",
    allowLighting: true,
    allowHaze: true,
    allowBloom: false,
    allowReflection: true,
  },
  {
    id: "builtin-rain",
    name: "雨",
    category: "天气",
    effectDescription: "增加符合镜头快门和风向的雨丝，包含前后景密度差异、少量表面湿润反光与自然景深。",
    palette: "冷灰蓝，服从原场景光照",
    stage: "action",
    layer: "environment",
    tool: "flow",
    allowLighting: true,
    allowHaze: true,
    allowBloom: false,
    allowReflection: true,
  },
  {
    id: "builtin-sandstorm",
    name: "风沙",
    category: "环境",
    effectDescription: "沿流向形成分层风沙与细颗粒尾流，近处颗粒清晰、远处形成体积尘雾，并保留主体识别度。",
    palette: "沙金、土黄与受环境影响的低饱和阴影",
    stage: "action",
    layer: "environment",
    tool: "flow",
    allowLighting: true,
    allowHaze: true,
    allowBloom: false,
    allowReflection: false,
  },
  {
    id: "builtin-explosion",
    name: "爆炸",
    category: "烟火",
    effectDescription: "从发射点生成具有白热核心、火球、冲击尘环、碎屑和外扩烟团的电影级爆炸，尺度符合场景。",
    palette: "白热核心、暖黄橙火焰与深灰烟尘",
    stage: "action",
    layer: "core",
    tool: "emitter",
    allowLighting: true,
    allowHaze: true,
    allowBloom: true,
    allowReflection: true,
  },
  {
    id: "builtin-energy-outline",
    name: "能量勾边",
    category: "能量",
    effectDescription: "沿轮廓增加贴合主体边缘的细致能量勾边，局部产生电弧、辉光和少量游离粒子，不改变主体形状。",
    palette: "蓝白核心与少量青紫辉光",
    stage: "action",
    layer: "core",
    tool: "contour",
    allowLighting: true,
    allowHaze: false,
    allowBloom: true,
    allowReflection: true,
  },
  {
    id: "builtin-black-smoke",
    name: "拉丝黑烟",
    category: "烟火",
    effectDescription: "沿流向生成细长、分叉、带速度拉丝的黑烟尾迹，烟丝边缘自然卷曲并逐渐稀释消散。",
    palette: "深灰黑、炭黑与少量环境反光",
    stage: "dissipation",
    layer: "secondary",
    tool: "flow",
    allowLighting: true,
    allowHaze: true,
    allowBloom: false,
    allowReflection: false,
  },
  {
    id: "builtin-petals",
    name: "飘花",
    category: "粒子",
    effectDescription: "沿流向增加少量自然飘动的花瓣，大小、旋转、景深和运动模糊有层次，避免规则重复。",
    palette: "柔和粉白与服从原镜头的暖色高光",
    stage: "action",
    layer: "secondary",
    tool: "flow",
    allowLighting: true,
    allowHaze: true,
    allowBloom: true,
    allowReflection: false,
  },
  {
    id: "builtin-circular-airflow",
    name: "环形气流",
    category: "环形与刀光",
    effectDescription: "沿椭圆环形轨迹生成半透明高速气流，带蓝白流动纹理、局部折射、速度拉丝和由粗到细的自然衰减。",
    palette: "蓝白高光、透明青蓝与少量环境反射",
    stage: "action",
    layer: "secondary",
    tool: "ring",
    geometry: { kind: "ellipse", widthStart: 0.022, widthEnd: 0.008, taper: true },
    allowLighting: true,
    allowHaze: true,
    allowBloom: true,
    allowReflection: true,
  },
  {
    id: "builtin-shockwave-ring",
    name: "冲击波环",
    category: "环形与刀光",
    effectDescription: "从中心向外形成一圈有厚度的冲击波，包含空气置换、压缩高光、轻微尘雾卷起与边缘运动模糊。",
    palette: "近乎无色的折射核心与少量冷蓝高光",
    stage: "action",
    layer: "core",
    tool: "ring",
    geometry: { kind: "ellipse", widthStart: 0.03, widthEnd: 0.016 },
    allowLighting: true,
    allowHaze: true,
    allowBloom: false,
    allowReflection: true,
  },
  {
    id: "builtin-rotating-energy",
    name: "旋转能量",
    category: "环形与刀光",
    effectDescription: "沿螺旋轨迹形成层层旋转的能量流，核心清晰、外缘带粒子和辉光，朝指定方向聚拢或扩散。",
    palette: "蓝青核心与紫色外辉光",
    stage: "action",
    layer: "core",
    tool: "spiral",
    geometry: { kind: "spiral", turns: 2.4, widthStart: 0.024, widthEnd: 0.006, taper: true },
    allowLighting: true,
    allowHaze: true,
    allowBloom: true,
    allowReflection: true,
  },
  {
    id: "builtin-blade-light-trail",
    name: "刀光拖尾",
    category: "环形与刀光",
    effectDescription: "沿刀刃运动轨迹生成扇形光刃拖尾，起段厚实、末端锐利收束，包含速度拉丝、轻微运动模糊与少量火花。",
    palette: "白亮核心、冷蓝外缘与少量暖色火花",
    stage: "action",
    layer: "core",
    tool: "blade-trail",
    geometry: { kind: "blade-trail", widthStart: 0.04, widthEnd: 0.006, taper: true },
    allowLighting: true,
    allowHaze: false,
    allowBloom: true,
    allowReflection: true,
  },
  {
    id: "builtin-ink-blade-trail",
    name: "水墨刀光",
    category: "环形与刀光",
    effectDescription: "沿刀势生成写意水墨拖尾，包含飞白、干湿笔触、墨滴和速度拉丝，轮廓有力量但不遮挡人物。",
    palette: "浓墨、淡墨与少量朱红点睛",
    stage: "action",
    layer: "secondary",
    tool: "blade-trail",
    geometry: { kind: "blade-trail", widthStart: 0.052, widthEnd: 0.004, taper: true },
    allowLighting: false,
    allowHaze: true,
    allowBloom: false,
    allowReflection: false,
  },
];

export const PACKAGING_PRESETS: PackagingPreset[] = [
  { id: "pkg-fantasy-title", name: "玄幻主标题", family: "彩色玄幻", text: "天地一剑", orientation: "horizontal", fontFamily: "STKaiti, KaiTi, serif", fontSize: 86, fontWeight: 800, tracking: 8, fill: "#fff3be", gradientTo: "#f4a93b", stroke: "#3a1608", strokeWidth: 3, shadowColor: "rgba(255,117,26,.72)", shadowBlur: 22, rotation: 0 },
  { id: "pkg-move-name", name: "招式名", family: "彩色玄幻", text: "破空斩", orientation: "horizontal", fontFamily: "STKaiti, KaiTi, serif", fontSize: 66, fontWeight: 800, tracking: 6, fill: "#eaf9ff", gradientTo: "#52bfff", stroke: "#092d57", strokeWidth: 2, shadowColor: "rgba(48,151,255,.78)", shadowBlur: 18, rotation: -7 },
  { id: "pkg-character-card", name: "人物介绍", family: "彩色玄幻", text: "沈苍\n剑阁首席", orientation: "vertical", fontFamily: "STKaiti, KaiTi, serif", fontSize: 48, fontWeight: 700, tracking: 5, fill: "#f7e8bd", gradientTo: "#dfbd65", stroke: "#3a2814", strokeWidth: 2, shadowColor: "rgba(0,0,0,.8)", shadowBlur: 12, rotation: 0 },
  { id: "pkg-element-title", name: "元素标题", family: "彩色玄幻", text: "雷霆领域", orientation: "horizontal", fontFamily: "STKaiti, KaiTi, serif", fontSize: 72, fontWeight: 800, tracking: 9, fill: "#d8fbff", gradientTo: "#7d69ff", stroke: "#14225a", strokeWidth: 3, shadowColor: "rgba(76,97,255,.85)", shadowBlur: 24, rotation: 0 },
  { id: "pkg-ink-title", name: "水墨书法标题", family: "水墨书法", text: "问道", orientation: "horizontal", fontFamily: "STKaiti, KaiTi, serif", fontSize: 104, fontWeight: 900, tracking: 12, fill: "#f4f0e6", stroke: "#111111", strokeWidth: 1, shadowColor: "rgba(0,0,0,.65)", shadowBlur: 9, rotation: -4 },
  { id: "pkg-ink-bio", name: "水墨人物小传", family: "水墨书法", text: "孤剑行千里\n一念破乾坤", orientation: "vertical", fontFamily: "FangSong, STFangsong, serif", fontSize: 42, fontWeight: 600, tracking: 6, fill: "#e9e2d2", stroke: "#151515", strokeWidth: 1, shadowColor: "rgba(0,0,0,.55)", shadowBlur: 8, rotation: 0 },
  { id: "pkg-bw-title-card", name: "黑白标题卡", family: "水墨书法", text: "苍元图", orientation: "horizontal", fontFamily: "STKaiti, KaiTi, serif", fontSize: 92, fontWeight: 900, tracking: 14, fill: "#ffffff", stroke: "#000000", strokeWidth: 4, shadowColor: "rgba(255,255,255,.18)", shadowBlur: 18, rotation: 0 },
  { id: "pkg-vertical-seal", name: "竖排印章", family: "水墨书法", text: "天命", orientation: "vertical", fontFamily: "STKaiti, KaiTi, serif", fontSize: 50, fontWeight: 900, tracking: 4, fill: "#f3e7d1", stroke: "#7a1010", strokeWidth: 4, shadowColor: "rgba(0,0,0,.5)", shadowBlur: 6, rotation: 0 },
];

function isReferenceRole(value: unknown): value is ReferenceRole {
  return typeof value === "string" && PRESET_REFERENCE_ROLES.includes(value as ReferenceRole);
}

export function parseCustomPresets(serialized: string | null): CustomVfxPreset[] {
  if (!serialized) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CustomVfxPreset => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Partial<CustomVfxPreset>;
      return candidate.source === "custom"
        && typeof candidate.id === "string"
        && typeof candidate.name === "string"
        && typeof candidate.effectDescription === "string"
        && typeof candidate.palette === "string"
        && ["anticipation", "action", "dissipation"].includes(String(candidate.stage))
        && ["core", "secondary", "environment"].includes(String(candidate.layer))
        && ["influence", "protect", "flow", "contour", "emitter", "text", "title", "ring", "arc", "spiral", "blade-trail"].includes(String(candidate.tool))
        && typeof candidate.reference?.dataUrl === "string"
        && candidate.reference.dataUrl.startsWith("data:image/webp;base64,")
        && Array.isArray(candidate.reference.roles)
        && candidate.reference.roles.every(isReferenceRole);
    }).slice(0, MAX_CUSTOM_PRESETS);
  } catch {
    return [];
  }
}

export function loadCustomPresets(storage: Pick<Storage, "getItem" | "setItem">): CustomVfxPreset[] {
  const current = parseCustomPresets(storage.getItem(CUSTOM_PRESET_STORAGE_KEY));
  if (current.length) return current;
  const legacy = parseCustomPresets(storage.getItem(LEGACY_CUSTOM_PRESET_STORAGE_KEY));
  if (legacy.length) storage.setItem(CUSTOM_PRESET_STORAGE_KEY, JSON.stringify(legacy));
  return legacy;
}

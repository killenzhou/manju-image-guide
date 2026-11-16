import { FxDraftStudio } from "./FxDraftStudio";
import { describeDraftForCodex, rasterizeDraftForCodex } from "./fx-draft-handoff";
import { emptyDraft, isFxDraft, type FxDraft } from "./fx-draft-model";
import { zipSync, strToU8 } from "fflate";
import { RECIPE_KEY, TxSkillPanel, readRecipes, type TxRecipe } from "./tx-pilot";
import "./tx-pilot.css";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import demoSourceUrl from "../../assets/design/demo-vfx-source.png?inline";
import { buildRenderPlan } from "../../server/src/render-plan";
import type {
  Point,
  ReferenceRole,
  VfxAnnotation,
  VfxBrief,
  VfxEffectGroup,
  VfxLayer,
  VfxSession,
  VfxStage,
  VfxTarget,
  VfxTargetKind,
  VfxTextLayer,
  VfxToolKind,
} from "../../server/src/types";
import {
  BUILT_IN_PRESETS,
  CUSTOM_PRESET_STORAGE_KEY,
  MAX_CUSTOM_PRESETS,
  PACKAGING_PRESETS,
  PRESET_REFERENCE_ROLES,
  loadCustomPresets,
  type CustomVfxPreset,
  type VfxPreset,
} from "./presets";
import {
  DEFAULT_GEOMETRY_CONTROLS,
  createEffectGroup,
  createTarget,
  createTextLayer,
  geometryAnnotation,
  groupSummary,
  visibleGroups,
  type GeometryControls,
} from "./editor-model";
import {
  computeImageRect,
  drawAnnotation,
  drawScene,
  drawTextLayer,
  renderTextOverlay,
  type Rect,
} from "./canvas-renderer";

type ToolResult = {
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
  content?: unknown[];
};

type ReferenceItem = {
  id: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  roles: ReferenceRole[];
  groupIds: string[];
  presetId?: string;
};

type TxBranch = { id: string; parent: string | null; name: string; delivery: "export" | "host"; width: number; height: number; result?: {dataUrl: string; fileName: string; mimeType: string} };
type ShotBase = {session:VfxSession; dataUrl:string; references:ReferenceItem[]; targets:VfxTarget[]; groups:VfxEffectGroup[]};
type TxProject = {
  version:"tx-vfx-shot/v1"; original:ShotBase; current:ShotBase; branches:TxBranch[]; parentBranch:string|null;
  annotations:VfxAnnotation[]; textLayers:VfxTextLayer[]; applied:Record<string,TxRecipe>; activeGroupId:string; tool:VfxToolKind;
  geometry:GeometryControls; preserve:string; fxDraft?:FxDraft;
};
const isImageData = (value: unknown): value is string => typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
function validateTxProject(value: unknown): asserts value is TxProject {
  const v = value as TxProject;
  const validBase = (item: ShotBase) => item && typeof item.session?.sourceFileName === "string" && isImageData(item.dataUrl) &&
    Array.isArray(item.references) && item.references.length <= 10 && item.references.every(ref=>ref && isImageData(ref.dataUrl) && Array.isArray(ref.roles) && Array.isArray(ref.groupIds)) &&
    Array.isArray(item.targets) && item.targets.every(target=>target && typeof target.id === "string") &&
    Array.isArray(item.groups) && item.groups.every(group=>group && typeof group.id === "string" && typeof group.effectDescription === "string" && Array.isArray(group.targetIds));
  if (!v || v.version!=="tx-vfx-shot/v1" || !validBase(v.original) || !validBase(v.current) || !Array.isArray(v.branches) ||
      !v.branches.every((item,i)=>item && typeof item.id==="string" && (item.parent===null || v.branches.slice(0,i).some(parent=>parent.id===item.parent)) &&
        (!item.result || isImageData(item.result.dataUrl))) ||
      (v.parentBranch!==null && !v.branches.some(item=>item.id===v.parentBranch && item.result)) ||
      !Array.isArray(v.annotations) || !v.annotations.every(item=>item && Array.isArray(item.points) && item.points.every(pt=>pt && Number.isFinite(pt.x) && Number.isFinite(pt.y))) ||
      !Array.isArray(v.textLayers) || !v.textLayers.every(item=>item && item.anchor && typeof item.text==="string") || !v.applied || !v.geometry ||
      !TOOLS.some(item=>item.id===v.tool) || typeof v.preserve!=="string" || (v.fxDraft!==undefined && !isFxDraft(v.fxDraft))) throw new Error("项目文件结构不正确");
}
const STANDALONE = window.parent === window;
const MAX_REFERENCES = 10;

function downloadRequest(request: { requestId: string }, imageBlocks: ContentBlock[]) {
  const files: Record<string, Uint8Array> = {
    "00-request.json": strToU8(JSON.stringify(request, null, 2)),
    "00-README.txt": strToU8("请按编号将干净源图、标注图、影响区、保护区及参考图一并交给 VFX Director 工作流。00-request.json 内含图片角色、分组与保护约束。仅生成干净底图，不带标记、文字或工具界面。"),
  };
  imageBlocks.forEach((block, i) => {
    if (block.type !== "image") return;
    const ext = block.mimeType === "image/jpeg" ? "jpg" : block.mimeType.split("/")[1];
    files[String(i + 1).padStart(2, "0") + "." + ext] = Uint8Array.from(atob(block.data), (char) => char.charCodeAt(0));
  });
  const archive = zipSync(files, { level: 0 });
  const url = URL.createObjectURL(new Blob([new Uint8Array(archive)], { type: "application/zip" }));
  downloadDataUrl(url, "TX-VFX-" + request.requestId.slice(0, 8) + ".zip");
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

type InitialReferencePayload = { fileName: string; mimeType: string; dataBase64: string; roles: ReferenceRole[] };
type LaunchOptions = { workspaceRoot: string; effectHint: string; initialTargets: VfxTarget[]; initialEffectGroups: VfxEffectGroup[] };
type IconName = VfxToolKind | "undo" | "redo" | "fit" | "clear" | "close" | "check" | "send" | "plus" | "image" | "object" | "group" | "download";

declare global {
  interface Window {
    openai?: { requestClose?: () => Promise<void> | void };
  }
}

const TOOLS: Array<{ id: VfxToolKind; label: string; icon: IconName }> = [
  { id: "influence", label: "影响区", icon: "influence" },
  { id: "protect", label: "保护区", icon: "protect" },
  { id: "flow", label: "流向", icon: "flow" },
  { id: "contour", label: "轮廓", icon: "contour" },
  { id: "emitter", label: "发射点", icon: "emitter" },
  { id: "ring", label: "环形", icon: "ring" },
  { id: "arc", label: "弧形", icon: "arc" },
  { id: "spiral", label: "螺旋", icon: "spiral" },
  { id: "blade-trail", label: "刀光拖尾", icon: "blade-trail" },
  { id: "text", label: "说明标注", icon: "text" },
  { id: "title", label: "文字定位", icon: "title" },
];

const STAGES: Array<{ id: VfxStage; label: string; hint: string }> = [
  { id: "anticipation", label: "蓄势", hint: "聚拢、预热、形成轮廓" },
  { id: "action", label: "爆发", hint: "主体效果最强的动作瞬间" },
  { id: "dissipation", label: "消散", hint: "余辉、烟粒、衰减和尾迹" },
];

const LAYERS: Array<{ id: VfxLayer; label: string; hint: string }> = [
  { id: "core", label: "核心", hint: "决定效果主体，优先生成" },
  { id: "secondary", label: "次级", hint: "拖尾、火星、碎屑和细节" },
  { id: "environment", label: "环境", hint: "天空、地面、雾、雨和全场氛围" },
];

const TARGET_KINDS: Array<{ id: VfxTargetKind; label: string }> = [
  { id: "person", label: "人物" },
  { id: "weapon", label: "武器" },
  { id: "prop", label: "道具" },
  { id: "sky", label: "天空" },
  { id: "ground", label: "地面" },
  { id: "environment", label: "环境" },
  { id: "custom", label: "自定义" },
];

const REFERENCE_ROLES: Array<{ id: ReferenceRole; label: string }> = [
  { id: "shape", label: "形态" },
  { id: "motion", label: "动势" },
  { id: "material", label: "材质" },
  { id: "color-light", label: "色彩光照" },
  { id: "density", label: "粒子密度" },
  { id: "atmosphere", label: "氛围" },
  { id: "layout", label: "版式" },
  { id: "typography", label: "字体" },
];

const DEFAULT_PRESERVE = "保持人物身份、面部、姿态、服装、构图、摄像机、场景几何和镜头原有文字不变。";
const GEOMETRY_TOOLS: VfxToolKind[] = ["ring", "arc", "spiral"];

function Icon({ name }: { name: IconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<IconName, React.ReactNode> = {
    influence: <path {...common} d="M6 7c2-3 10-3 12 0 3 2 3 8 0 10-3 3-10 3-12 0-3-2-3-8 0-10Z" strokeDasharray="3 2" />,
    protect: <path {...common} d="M12 3 5.5 5.5v5.8c0 4.2 2.7 7.5 6.5 9.7 3.8-2.2 6.5-5.5 6.5-9.7V5.5L12 3Z" />,
    flow: <><path {...common} d="M3 17c4-8 8-8 12-3l5-6" /><path {...common} d="m16 8 4 0 0 4" /></>,
    contour: <path {...common} d="M4 17c2-7 4-10 8-10 2 0 3-3 6-2 2 2 1 5-1 7-2 3-1 6-6 7-3 1-5 0-7-2Z" strokeDasharray="2.5 2" />,
    emitter: <><circle {...common} cx="12" cy="12" r="5" /><path {...common} d="M12 2v5M12 17v5M2 12h5M17 12h5" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /></>,
    text: <path {...common} d="M5 4h14M12 4v16M8 20h8" />,
    title: <><path {...common} d="M4 5h16M12 5v14M8 19h8" /><circle {...common} cx="19" cy="17" r="2" /></>,
    ring: <ellipse {...common} cx="12" cy="12" rx="9" ry="5.5" />,
    arc: <><path {...common} d="M4 16c3-9 13-11 17-3" /><path {...common} d="m18 9 3 4-5 1" /></>,
    spiral: <path {...common} d="M20 12c0-5-4-8-9-8-5 0-8 4-8 8s3 7 7 7 6-3 6-6-2-5-5-5-4 2-4 4 2 3 3 3" />,
    "blade-trail": <><path {...common} d="M3 18C8 6 14 5 21 6c-6 3-10 7-13 13Z" /><path {...common} d="M6 16c5-5 9-7 14-9" /></>,
    undo: <path {...common} d="m9 7-5 5 5 5M5 12h8a6 6 0 0 1 6 6" />,
    redo: <path {...common} d="m15 7 5 5-5 5M19 12h-8a6 6 0 0 0-6 6" />,
    fit: <path {...common} d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />,
    clear: <><path {...common} d="M4 7h16M9 3h6l1 4H8l1-4ZM7 7l1 14h8l1-14" /><path {...common} d="M10 11v6M14 11v6" /></>,
    close: <path {...common} d="m5 5 14 14M19 5 5 19" />,
    check: <><rect {...common} x="4" y="3" width="16" height="18" rx="2" /><path {...common} d="m8 12 3 3 6-7" /></>,
    send: <><path {...common} d="m4 20 16-8L4 4l3 8-3 8Z" /><path {...common} d="M7 12h13" /></>,
    plus: <path {...common} d="M12 5v14M5 12h14" />,
    image: <><rect {...common} x="3" y="4" width="18" height="16" rx="2" /><circle {...common} cx="9" cy="9" r="2" /><path {...common} d="m4 17 5-5 4 4 2-2 5 5" /></>,
    object: <><circle {...common} cx="12" cy="8" r="4" /><path {...common} d="M5 21c0-5 3-8 7-8s7 3 7 8" /></>,
    group: <><rect {...common} x="3" y="4" width="14" height="12" rx="2" /><path {...common} d="M7 20h14V8" /></>,
    download: <><path {...common} d="M12 3v12m0 0 5-5m-5 5-5-5" /><path {...common} d="M4 20h16" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function Segment<T extends string>({ items, value, onChange }: { items: Array<{ id: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return <div className="segment">{items.map((item) => <button aria-pressed={item.id === value} key={item.id} onClick={() => onChange(item.id)} type="button">{item.label}</button>)}</div>;
}

function fileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("无法读取图片"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function loadBrowserImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法显示"));
    image.src = dataUrl;
  });
}

async function compressPresetReference(file: File): Promise<string> {
  const sourceUrl = await fileAsDataUrl(file);
  const image = await loadBrowserImage(sourceUrl);
  const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法压缩预设参考图");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/webp", 0.78);
}

function imageContent(dataUrl: string): ContentBlock {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("图片数据编码无效");
  return { type: "image", mimeType: match[1], data: match[2] };
}

async function deliverVfxRequest(app:McpApp, request:{requestId:string}, content:ContentBlock[], prompt:string) {
  const capabilities=app.getHostCapabilities() || {};
  if(capabilities.updateModelContext?.text && capabilities.updateModelContext?.image){
    await app.updateModelContext({content,structuredContent:{vfxDirectorInlineRequest:request}});
    const result=await app.sendMessage({role:"user",content:[{type:"text",text:prompt}]});
    if(result.isError)throw new Error("Codex 未接收这次请求，请重试。");
  }else if(capabilities.message?.text && capabilities.message?.image){
    const result=await app.sendMessage({role:"user",content});
    if(result.isError)throw new Error("Codex 未接收这次请求，请重试。");
  }else throw new Error("请在支持图片提交的 Codex 对话中重新打开工作台。");
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.click();
}

function downloadJson(value: unknown, fileName: string) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  downloadDataUrl(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function demoPayload(): { session: VfxSession; sourceDataUrl: string; targets: VfxTarget[]; groups: VfxEffectGroup[] } {
  const workspaceRoot = "demo://workspace";
  const targets: VfxTarget[] = [
    { id: "demo-person", name: "画面人物", kind: "person", color: "#58d6ff", confirmed: false, source: "suggested", bounds: { x: 0.35, y: 0.18, width: 0.32, height: 0.72 } },
    { id: "demo-ground", name: "地面区域", kind: "ground", color: "#ffb547", confirmed: false, source: "suggested", bounds: { x: 0.05, y: 0.72, width: 0.9, height: 0.24 } },
  ];
  const group = { ...createEffectGroup(0, "围绕人物手势形成旋转上升的金色风沙能量", ["demo-person"]), id: "demo-main" };
  return {
    session: { schemaVersion: "1.0", id: "demo-session", workspaceRoot, sessionDir: `${workspaceRoot}/session`, sessionFile: `${workspaceRoot}/session/session.vfx-director.json`, sourcePath: `${workspaceRoot}/source.png`, originalSourcePath: `${workspaceRoot}/source.png`, sourceFileName: "demo-vfx-source.png", mimeType: "image/png", effectHint: group.effectDescription, createdAt: new Date().toISOString() },
    sourceDataUrl: demoSourceUrl,
    targets,
    groups: [group],
  };
}

function normalizeGroups(groups: VfxEffectGroup[], effectHint: string, targets: VfxTarget[]): VfxEffectGroup[] {
  if (!groups.length) return [createEffectGroup(0, effectHint, targets.filter((target) => target.kind === "person").slice(0, 1).map((target) => target.id))];
  return groups.map((group, index) => ({ ...createEffectGroup(index, effectHint), ...group, order: index, targetIds: Array.isArray(group.targetIds) ? group.targetIds : [] }));
}

export default function App() {
  const [draftOpen,setDraftOpen]=useState(()=>new URLSearchParams(location.search).has("paint"));
  const [fxDraft,setFxDraft]=useState<FxDraft>(emptyDraft);
  const [draftKey,setDraftKey]=useState(0);
  const [draftSend,setDraftSend]=useState<{busy:boolean; text:string; error?:boolean}>({busy:false,text:""});
  const sendDraftLock=useRef(false);
  const [quickMode, setQuickMode] = useState(true);
  const [txRecipes, setTxRecipes] = useState<TxRecipe[]>(readRecipes);
  const [txApplied, setTxApplied] = useState<Record<string, TxRecipe>>({});
  const [txPresetName, setTxPresetName] = useState("");
  const [branches, setBranches] = useState<TxBranch[]>([]);
  const [parentBranch, setParentBranch] = useState<string | null>(null);
  const [compareUrl, setCompareUrl] = useState("");
  const originalRef = useRef<ShotBase | null>(null);
  const loadingId = useRef(0);
  const [session, setSession] = useState<VfxSession | null>(null);
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [sourceDataUrl, setSourceDataUrl] = useState("");
  const [launchOptions, setLaunchOptions] = useState<LaunchOptions>({ workspaceRoot: "", effectHint: "", initialTargets: [], initialEffectGroups: [] });
  const [importingSource, setImportingSource] = useState(false);
  const [tool, setTool] = useState<VfxToolKind>("influence");
  const [targets, setTargets] = useState<VfxTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [newTargetName, setNewTargetName] = useState("");
  const [newTargetKind, setNewTargetKind] = useState<VfxTargetKind>("person");
  const [effectGroups, setEffectGroups] = useState<VfxEffectGroup[]>([createEffectGroup(0)]);
  const [activeGroupId, setActiveGroupId] = useState("");
  const [annotations, setAnnotations] = useState<VfxAnnotation[]>([]);
  const annotationsRef = useRef<VfxAnnotation[]>([]);
  const [draft, setDraft] = useState<VfxAnnotation | null>(null);
  const draftRef = useRef<VfxAnnotation | null>(null);
  const [undoStack, setUndoStack] = useState<VfxAnnotation[][]>([]);
  const [redoStack, setRedoStack] = useState<VfxAnnotation[][]>([]);
  const undoStackRef = useRef<VfxAnnotation[][]>([]);
  const redoStackRef = useRef<VfxAnnotation[][]>([]);
  const [annotationLabel, setAnnotationLabel] = useState("描述这条引导线代表的特效意图");
  const [geometryControls, setGeometryControls] = useState<GeometryControls>(DEFAULT_GEOMETRY_CONTROLS);
  const [preserve, setPreserve] = useState(DEFAULT_PRESERVE);
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [customPresets, setCustomPresets] = useState<CustomVfxPreset[]>(() => {
    try { return loadCustomPresets(localStorage); } catch { return []; }
  });
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [customPresetName, setCustomPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [textLayers, setTextLayers] = useState<VfxTextLayer[]>([]);
  const [activeTextId, setActiveTextId] = useState("");
  const [packagingPresetId, setPackagingPresetId] = useState("");
  const [status, setStatus] = useState("请选择或粘贴一张源图");
  const [errorText, setErrorText] = useState<string>();
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [displayMode, setDisplayMode] = useState("inline");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRectRef = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const activePointerRef = useRef<number | null>(null);
  const lastPointCommitRef = useRef<{ kind: VfxToolKind; point: Point; time: number } | null>(null);

  const activeGroup = useMemo(() => effectGroups.find((group) => group.id === activeGroupId) || effectGroups[0], [activeGroupId, effectGroups]);
  const activeText = useMemo(() => textLayers.find((layer) => layer.id === activeTextId), [activeTextId, textLayers]);
  const allPresets = useMemo<VfxPreset[]>(() => [...BUILT_IN_PRESETS, ...customPresets], [customPresets]);
  const selectedPreset = useMemo(() => allPresets.find((preset) => preset.id === selectedPresetId), [allPresets, selectedPresetId]);
  const renderPlan = useMemo(() => buildRenderPlan(effectGroups, textLayers), [effectGroups, textLayers]);

  const loadSource = useCallback((nextSession: VfxSession, sourceUrl: string, initialReferences: ReferenceItem[] = [], initialTargets: VfxTarget[] = [], initialGroups: VfxEffectGroup[] = [], keepHistory = false, afterLoad?:()=>void) => {
    const loadId = ++loadingId.current;
    const image = new Image();
    image.onload = () => {
      if (sourceUrl.startsWith("blob:")) URL.revokeObjectURL(sourceUrl);
      if (loadId !== loadingId.current) return;
      if (!keepHistory) {
        originalRef.current = {session: nextSession, dataUrl: sourceUrl, references: initialReferences, targets: initialTargets, groups: initialGroups};
        setBranches([]);
        setParentBranch(null);
      }
      setFxDraft(emptyDraft());
      setDraftKey(key=>key+1);
      setDraftSend({busy:false,text:""});
      setTxApplied({});
      setCompareUrl("");
      setPreflightOpen(false);
      annotationsRef.current = [];
      undoStackRef.current = [];
      redoStackRef.current = [];
      setAnnotations([]);
      setUndoStack([]);
      setRedoStack([]);
      setTextLayers([]);
      setActiveTextId("");
      lastPointCommitRef.current = null;
      const normalizedTargets = initialTargets.map((target, index) => ({ ...target, color: target.color || ["#58d6ff", "#ffb547", "#b986ff"][index % 3], confirmed: Boolean(target.confirmed), source: target.source || "suggested" }));
      const normalizedGroups = normalizeGroups(initialGroups, nextSession.effectHint, normalizedTargets);
      setSession(nextSession);
      setSourceImage(image);
      setSourceDataUrl(sourceUrl);
      setTargets(normalizedTargets);
      setSelectedTargetId(normalizedTargets[0]?.id || "");
      setEffectGroups(normalizedGroups);
      setActiveGroupId(normalizedGroups[0].id);
      setReferences(initialReferences);
      setStatus(normalizedTargets.length ? "Codex 已给出对象建议，请确认后绘制" : "源图已锁定 · 选一个技能开始");
      setErrorText(undefined);
      afterLoad?.();
    };
    image.onerror = () => {
      if (sourceUrl.startsWith("blob:")) URL.revokeObjectURL(sourceUrl);
      setErrorText("源图无法显示，请重新选择或粘贴图片");
    };
    image.src = sourceUrl;
  }, []);

  const acceptToolResult = useCallback((result: ToolResult) => {
    const launch = result.structuredContent?.launch as Partial<LaunchOptions> | undefined;
    const nextSession = result.structuredContent?.session as VfxSession | undefined;
    const payload = result._meta?.vfxDirector as { sourceDataUrl?: string; initialReferences?: InitialReferencePayload[] } | undefined;
    const nextLaunch: LaunchOptions = {
      workspaceRoot: launch?.workspaceRoot || "",
      effectHint: launch?.effectHint || "",
      initialTargets: launch?.initialTargets || [],
      initialEffectGroups: launch?.initialEffectGroups || [],
    };
    if (launch) {
      setLaunchOptions(nextLaunch);
      setStatus("请选择或粘贴一张源图");
    }
    if (nextSession && payload?.sourceDataUrl) {
      const initialReferences = (payload.initialReferences || []).map((reference) => ({ id: crypto.randomUUID(), fileName: reference.fileName, mimeType: reference.mimeType, dataUrl: reference.dataBase64, roles: reference.roles, groupIds: [] }));
      loadSource(nextSession, payload.sourceDataUrl, initialReferences, nextLaunch.initialTargets, nextLaunch.initialEffectGroups);
    }
  }, [loadSource]);

  const { app, error } = useApp({
    appInfo: { name: "VFX Director", version: "0.2.0" },
    capabilities: {},
    onAppCreated: (created: McpApp) => {
      created.ontoolresult = (result) => {
        acceptToolResult(result as ToolResult);
        void created.requestDisplayMode({ mode: "fullscreen" }).catch(() => undefined);
      };
      created.onhostcontextchanged = (context) => setDisplayMode(context.displayMode ?? "inline");
    },
  });

  const importSourceFile = useCallback(async (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setErrorText("仅支持 PNG、JPEG 和 WebP 图片"); return; }
    if (!file.size) { setErrorText("源图片为空"); return; }
    setImportingSource(true);
    setErrorText(undefined);
    setStatus("正在本地载入源图…");
    try {
      const dataUrl = await fileAsDataUrl(file);
      const workspaceRoot = launchOptions.workspaceRoot || "browser://vfx-director";
      const id = crypto.randomUUID();
      const nextSession: VfxSession = { schemaVersion: "1.0", id, workspaceRoot, sessionDir: "", sessionFile: "", sourcePath: "", originalSourcePath: "", sourceFileName: file.name || `pasted-source-${Date.now()}.png`, mimeType: file.type, effectHint: launchOptions.effectHint, createdAt: new Date().toISOString() };
      loadSource(nextSession, dataUrl, [], launchOptions.initialTargets, launchOptions.initialEffectGroups);
    } catch (importError) {
      setErrorText(`源图载入失败：${importError instanceof Error ? importError.message : "未知错误"}`);
      setStatus("请选择或粘贴一张源图");
    } finally { setImportingSource(false); }
  }, [launchOptions, loadSource]);

  const selectSource = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importSourceFile(file);
  }, [importSourceFile]);

  useEffect(() => {
    const pasteSource = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const item = Array.from(event.clipboardData?.items || []).find((candidate) => /^image\/(png|jpeg|webp)$/.test(candidate.type));
      const file = item?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void importSourceFile(file);
    };
    window.addEventListener("paste", pasteSource);
    return () => window.removeEventListener("paste", pasteSource);
  }, [importSourceFile]);

  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  useEffect(() => { if (error && !STANDALONE && !new URLSearchParams(location.search).has("demo")) setErrorText(`无法连接 Codex：${error.message}`); }, [error]);
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("demo")) return;
    const payload = demoPayload();
    loadSource({...payload.session, effectHint:""}, payload.sourceDataUrl);
  }, [loadSource]);

  const displayGroups = useMemo(() => visibleGroups(effectGroups), [effectGroups]);
  const displayGroupIds = useMemo(() => new Set(displayGroups.map((group) => group.id)), [displayGroups]);
  const displayAnnotations = useMemo(() => annotations.filter((annotation) => !annotation.groupId || displayGroupIds.has(annotation.groupId)), [annotations, displayGroupIds]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const container = stageRef.current;
    if (!canvas || !container || !sourceImage) return;
    const bounds = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(bounds.width * dpr));
    const pixelHeight = Math.max(1, Math.round(bounds.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${bounds.width}px`;
      canvas.style.height = `${bounds.height}px`;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rect = computeImageRect(bounds.width, bounds.height, sourceImage.naturalWidth, sourceImage.naturalHeight);
    imageRectRef.current = rect;
    drawScene({ context, image: sourceImage, rect, annotations: displayAnnotations, groups: displayGroups, targets, textLayers, activeTargetId: selectedTargetId, draft });
  }, [displayAnnotations, displayGroups, draft, selectedTargetId, sourceImage, targets, textLayers]);

  useEffect(() => {
    paint();
    const container = stageRef.current;
    if (!container || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(paint);
    observer.observe(container);
    return () => observer.disconnect();
  }, [paint]);

  const commit = useCallback((next: VfxAnnotation[]) => {
    const nextUndoStack = [...undoStackRef.current.slice(-49), structuredClone(annotationsRef.current)];
    undoStackRef.current = nextUndoStack;
    redoStackRef.current = [];
    setUndoStack(nextUndoStack);
    setRedoStack([]);
    annotationsRef.current = next;
    setAnnotations(next);
  }, []);

  const pointFromEvent = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const rect = imageRectRef.current;
    const x = event.clientX - bounds.left - rect.x;
    const y = event.clientY - bounds.top - rect.y;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height || !rect.width || !rect.height) return null;
    return { x: x / rect.width, y: y / rect.height };
  }, []);

  const updateText = useCallback((id: string, patchValue: Partial<VfxTextLayer>) => setTextLayers((current) => current.map((layer) => layer.id === id ? { ...layer, ...patchValue } : layer)), []);

  const beginDraw = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceImage || event.button !== 0 || !activeGroup) return;
    const point = pointFromEvent(event);
    if (!point) return;
    if (tool === "title") {
      if (!activeText) { setErrorText("请先在右侧添加一个包装文字层"); return; }
      if (activeText.locked) { setErrorText("当前文字层已锁定"); return; }
      updateText(activeText.id, { anchor: point });
      setStatus(`已定位“${activeText.name}”`);
      return;
    }
    if (activeGroup.locked) { setErrorText("当前特效组已锁定，解锁后才能绘制"); return; }
    const targetId = activeGroup.targetIds.includes(selectedTargetId) ? selectedTargetId : activeGroup.targetIds[0];
    let next: VfxAnnotation;
    if (GEOMETRY_TOOLS.includes(tool)) {
      next = geometryAnnotation({ id: crypto.randomUUID(), tool: tool as "ring" | "arc" | "spiral", start: point, current: { x: Math.min(1, point.x + 0.01), y: Math.min(1, point.y + 0.01) }, stage: activeGroup.stage, layer: activeGroup.layer, groupId: activeGroup.id, targetId, controls: geometryControls });
    } else {
      next = { id: crypto.randomUUID(), kind: tool, stage: activeGroup.stage, layer: activeGroup.layer, groupId: activeGroup.id, targetId, points: [point], label: tool === "text" ? annotationLabel.trim() || "特效说明" : undefined, ...(tool === "blade-trail" ? { geometry: { kind: "blade-trail", widthStart: geometryControls.widthStart, widthEnd: geometryControls.widthEnd, taper: geometryControls.taper } as const } : {}) };
    }
    if (tool === "emitter" || tool === "text") {
      const now = performance.now();
      const previous = lastPointCommitRef.current;
      if (previous && previous.kind === tool && now - previous.time < 300 && Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < 0.02) return;
      lastPointCommitRef.current = { kind: tool, point, time: now };
      commit([...annotationsRef.current, next]);
      return;
    }
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    draftRef.current = next;
    setDraft(next);
  }, [activeGroup, activeText, annotationLabel, commit, geometryControls, pointFromEvent, selectedTargetId, sourceImage, tool, updateText]);

  const continueDraw = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId || !draftRef.current || !activeGroup) return;
    const point = pointFromEvent(event);
    if (!point) return;
    let next: VfxAnnotation;
    if (GEOMETRY_TOOLS.includes(draftRef.current.kind)) {
      next = geometryAnnotation({ id: draftRef.current.id, tool: draftRef.current.kind as "ring" | "arc" | "spiral", start: draftRef.current.geometry?.center || draftRef.current.points[0], current: point, stage: activeGroup.stage, layer: activeGroup.layer, groupId: activeGroup.id, targetId: draftRef.current.targetId, controls: geometryControls });
    } else {
      const previous = draftRef.current.points.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.002) return;
      next = { ...draftRef.current, points: [...draftRef.current.points, point] };
    }
    draftRef.current = next;
    setDraft(next);
  }, [activeGroup, geometryControls, pointFromEvent]);

  const endDraw = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const completed = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (completed && completed.points.length > 1) commit([...annotationsRef.current, completed]);
  }, [commit]);

  const undo = useCallback(() => {
    const previous = undoStackRef.current.at(-1);
    if (!previous) return;
    const nextUndoStack = undoStackRef.current.slice(0, -1);
    const nextRedoStack = [structuredClone(annotationsRef.current), ...redoStackRef.current].slice(0, 50);
    undoStackRef.current = nextUndoStack;
    redoStackRef.current = nextRedoStack;
    setUndoStack(nextUndoStack);
    setRedoStack(nextRedoStack);
    annotationsRef.current = previous;
    setAnnotations(previous);
  }, []);

  const redo = useCallback(() => {
    const next = redoStackRef.current[0];
    if (!next) return;
    const nextUndoStack = [...undoStackRef.current.slice(-49), structuredClone(annotationsRef.current)];
    const nextRedoStack = redoStackRef.current.slice(1);
    undoStackRef.current = nextUndoStack;
    redoStackRef.current = nextRedoStack;
    setUndoStack(nextUndoStack);
    setRedoStack(nextRedoStack);
    annotationsRef.current = next;
    setAnnotations(next);
  }, []);

  const updateGroup = useCallback((id: string, patchValue: Partial<VfxEffectGroup>) => setEffectGroups((current) => current.map((group) => group.id === id ? { ...group, ...patchValue } : group)), []);

  const addGroup = useCallback(() => {
    const next = createEffectGroup(effectGroups.length, "", selectedTargetId ? [selectedTargetId] : []);
    setEffectGroups((current) => [...current, next]);
    setActiveGroupId(next.id);
  }, [effectGroups.length, selectedTargetId]);

  const duplicateGroup = useCallback((group: VfxEffectGroup) => {
    const clone = { ...group, id: crypto.randomUUID(), name: `${group.name} 副本`, order: effectGroups.length, solo: false, locked: false };
    const clonedAnnotations = annotationsRef.current.filter((annotation) => annotation.groupId === group.id).map((annotation) => ({ ...structuredClone(annotation), id: crypto.randomUUID(), groupId: clone.id }));
    setEffectGroups((current) => [...current, clone]);
    commit([...annotationsRef.current, ...clonedAnnotations]);
    setActiveGroupId(clone.id);
  }, [commit, effectGroups.length]);

  const deleteGroup = useCallback((group: VfxEffectGroup) => {
    if (effectGroups.length <= 1) { setErrorText("至少保留一个特效组"); return; }
    const nextGroups = effectGroups.filter((item) => item.id !== group.id).map((item, index) => ({ ...item, order: index }));
    setEffectGroups(nextGroups);
    setActiveGroupId(nextGroups[0].id);
    commit(annotationsRef.current.filter((annotation) => annotation.groupId !== group.id));
    setReferences((current) => current.map((reference) => ({ ...reference, groupIds: reference.groupIds.filter((id) => id !== group.id) })));
  }, [commit, effectGroups]);

  const moveGroup = useCallback((groupId: string, direction: -1 | 1) => {
    setEffectGroups((current) => {
      const sorted = current.slice().sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((group) => group.id === groupId);
      const swap = index + direction;
      if (index < 0 || swap < 0 || swap >= sorted.length) return current;
      [sorted[index], sorted[swap]] = [sorted[swap], sorted[index]];
      return sorted.map((group, order) => ({ ...group, order }));
    });
  }, []);

  const addTarget = useCallback(() => {
    const target = createTarget(newTargetName, newTargetKind, "manual", targets.length);
    setTargets((current) => [...current, target]);
    setSelectedTargetId(target.id);
    setNewTargetName("");
  }, [newTargetKind, newTargetName, targets.length]);

  const addSmartTemplate = useCallback(() => {
    const additions = [createTarget("人物 A", "person", "suggested", targets.length), createTarget("人物 B", "person", "suggested", targets.length + 1), createTarget("地面区域", "ground", "suggested", targets.length + 2), createTarget("天空区域", "sky", "suggested", targets.length + 3)];
    setTargets((current) => [...current, ...additions]);
    setSelectedTargetId(additions[0].id);
    if (activeGroup && !activeGroup.targetIds.length) updateGroup(activeGroup.id, { targetIds: [additions[0].id] });
    setStatus("已建立多人/场景对象模板，请删掉不需要的对象并确认名称");
  }, [activeGroup, targets.length, updateGroup]);

  const toggleGroupTarget = useCallback((groupId: string, targetId: string) => setEffectGroups((current) => current.map((group) => group.id === groupId ? { ...group, targetIds: group.targetIds.includes(targetId) ? group.targetIds.filter((id) => id !== targetId) : [...group.targetIds, targetId] } : group)), []);

  const addReferences = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type));
    event.target.value = "";
    const selected = files.slice(0, Math.max(0, 10 - references.length));
    if (!selected.length) return;
    const loaded = await Promise.all(selected.map(async (file) => ({ id: crypto.randomUUID(), fileName: file.name, mimeType: file.type, dataUrl: await fileAsDataUrl(file), roles: ["shape", "material"] as ReferenceRole[], groupIds: activeGroup ? [activeGroup.id] : [] })));
    setReferences((current) => [...current, ...loaded]);
  }, [activeGroup, references.length]);

  const toggleReferenceRole = useCallback((referenceId: string, role: ReferenceRole) => setReferences((current) => current.map((reference) => reference.id === referenceId ? { ...reference, roles: reference.roles.includes(role) ? reference.roles.filter((item) => item !== role) : [...reference.roles, role] } : reference)), []);

  const applyTx = useCallback((recipe: TxRecipe) => {
    if (!activeGroup || !sourceImage) return;
    if (activeGroup.locked) { setErrorText("先在高级面板解锁当前效果"); return; }
    const skillId = (id?: string) => id?.match(/^tx:(?:saved:tx:)?([^:]+):/)?.[1];
    const sameSkill = skillId(activeGroup.presetId) && skillId(activeGroup.presetId) === skillId(recipe.id);
    const isolate = quickMode && Boolean(activeGroup.effectDescription.trim()) && !sameSkill &&
      activeGroup.presetId !== recipe.id && annotationsRef.current.some(mark=>mark.groupId===activeGroup.id && mark.kind!=="protect");
    const newGroup = isolate ? createEffectGroup(effectGroups.length,"",activeGroup.targetIds) : undefined;
    const groupId = newGroup?.id || activeGroup.id;
    const removed = references.filter(item => item.presetId?.startsWith("tx:") && item.groupIds.length === 1 && item.groupIds[0] === groupId);
    const retained = references.filter(item => !removed.includes(item));
    if (recipe.reference && retained.length >= MAX_REFERENCES) { setErrorText("参考图已满，请在高级面板移除一张再应用技能"); return; }
    const settings: Partial<VfxEffectGroup> = {name: recipe.name, effectDescription: recipe.prompt, palette: recipe.palette, stage: recipe.stage, presetId: recipe.id, visible: true, allowHaze: false, allowBloom: false, allowReflection: false};
    if (newGroup) {
      setEffectGroups(current=>[...current.map(group=>group.id===activeGroup.id ? {...group,visible:false,solo:false} : group),{...newGroup,...settings,layer:"core"}]);
      setActiveGroupId(newGroup.id);
      const protect = annotationsRef.current.filter(mark=>mark.groupId===activeGroup.id && mark.kind==="protect");
      if (protect.length) commit([...annotationsRef.current,...protect.map(mark=>({...mark,id:crypto.randomUUID(),groupId:newGroup.id}))]);
    } else {
      updateGroup(groupId, settings);
      const retagged = annotationsRef.current.map(mark=>mark.groupId===groupId ? {...mark,stage:recipe.stage} : mark);
      annotationsRef.current = retagged;
      setAnnotations(retagged);
    }
    setReferences(recipe.reference ? [...retained, {...recipe.reference, id: crypto.randomUUID(), presetId: recipe.id, groupIds:[groupId]}] : retained);
    setTxApplied(current => ({...current,[groupId]:recipe}));
    setTool(recipe.tool);
    setGeometryControls({...DEFAULT_GEOMETRY_CONTROLS,...recipe.geometry});
    setErrorText(undefined);
    setPreflightOpen(false);
    setStatus((isolate ? "已保留上一效果并暂时隐藏 · " : "已应用 · ") + recipe.guide);
  }, [activeGroup, commit, effectGroups.length, quickMode, references, sourceImage, updateGroup]);

  const storeTxRecipes = useCallback((next: TxRecipe[]) => {
    try {
      localStorage.setItem(RECIPE_KEY, JSON.stringify(next));
      setTxRecipes(next);
      setErrorText(undefined);
      return true;
    } catch { setErrorText("本地预设空间已满或浏览器禁止保存"); return false; }
  }, []);
  const saveTxRecipe = useCallback(() => {
    if (!activeGroup?.effectDescription.trim()) return;
    const existing = txApplied[activeGroup.id];
    const name = txPresetName.trim() || activeGroup.name;
    const ref = references.find(item=>item.groupIds.includes(activeGroup.id) && item.roles.length);
    const brush = tool === "protect" || tool === "text" || tool === "title" ? (existing?.tool || "influence") : tool;
    const next: TxRecipe = {id:"tx:saved:"+(activeGroup.presetId || "manual")+":"+crypto.randomUUID(), name, prompt:activeGroup.effectDescription, palette:activeGroup.palette, stage:activeGroup.stage, tool:brush, guide: existing?.tool === brush ? existing.guide : "在新镜头重新绘制位置与范围。", geometry:geometryControls, reference:ref ? {dataUrl:ref.dataUrl,fileName:ref.fileName,mimeType:ref.mimeType,roles:ref.roles}:undefined};
    if (storeTxRecipes([next,...txRecipes.filter(item=>item.name!==name)].slice(0,15))) { setTxPresetName(""); setStatus("已保存「"+name+"」；新镜头应用后重新画位置。"); }
  }, [activeGroup, geometryControls, references, storeTxRecipes, tool, txApplied, txPresetName, txRecipes]);

  const importResult = useCallback(async (branch: TxBranch, file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setErrorText("结果仅支持 PNG、JPEG、WebP"); return; }
    try {
      const dataUrl = await fileAsDataUrl(file);
      const image = await loadBrowserImage(dataUrl);
      if (Math.abs((image.naturalWidth / image.naturalHeight) / (branch.width / branch.height) - 1) > .015) { setErrorText("结果画幅与该版本不一致，未导入"); return; }
      setBranches(current => current.map(item => item.id === branch.id && !item.result ? {...item,result:{dataUrl,fileName:file.name,mimeType:file.type}} : item));
      setErrorText(undefined);
      setStatus("已关联结果，可对比或以此继续分叉。");
    } catch { setErrorText("结果图读取失败"); }
  }, []);
  const forkFrom = useCallback((branch: TxBranch) => {
    if (!branch.result || !session) return;
    setParentBranch(branch.id);
    loadSource({...session, sourceFileName: branch.result.fileName, mimeType:branch.result.mimeType, effectHint:""}, branch.result.dataUrl, [], [], [], true);
  }, [loadSource, session]);
  const backToOriginal = useCallback(() => {
    const original = originalRef.current;
    if (!original) return;
    setParentBranch(null);
    loadSource(original.session, original.dataUrl, original.references, original.targets, original.groups, true);
  }, [loadSource]);

  const applyPreset = useCallback(() => {
    if (!selectedPreset || !activeGroup) { setErrorText("请先选择一个特效预设和特效组"); return; }
    updateGroup(activeGroup.id, { effectDescription: selectedPreset.effectDescription, palette: selectedPreset.palette, stage: selectedPreset.stage, layer: selectedPreset.layer, allowLighting: selectedPreset.allowLighting, allowHaze: selectedPreset.allowHaze, allowBloom: selectedPreset.allowBloom, allowReflection: selectedPreset.allowReflection, presetId: selectedPreset.id });
    setTool(selectedPreset.tool);
    if (selectedPreset.geometry) setGeometryControls((current) => ({ ...current, ...selectedPreset.geometry }));
    if (selectedPreset.reference && !references.some((reference) => reference.presetId === selectedPreset.id)) {
      if (references.length >= 10) { setErrorText("预设参数已应用，但参考图已满 10 张"); return; }
      setReferences((current) => [...current, { id: crypto.randomUUID(), fileName: selectedPreset.reference!.fileName, mimeType: selectedPreset.reference!.mimeType, dataUrl: selectedPreset.reference!.dataUrl, roles: [...selectedPreset.reference!.roles], groupIds: [activeGroup.id], presetId: selectedPreset.id }]);
    }
    setErrorText(undefined);
    setStatus(`已将“${selectedPreset.name}”应用到“${activeGroup.name}”`);
  }, [activeGroup, references, selectedPreset, updateGroup]);

  const saveImagePreset = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeGroup) return;
    const name = customPresetName.trim();
    if (!name) { setErrorText("先填写“我的预设名称”，再选择效果图"); return; }
    if (!activeGroup.effectDescription.trim()) { setErrorText("先填写当前特效组说明"); return; }
    if (customPresets.length >= MAX_CUSTOM_PRESETS && !customPresets.some((preset) => preset.name === name)) { setErrorText(`我的图片预设最多 ${MAX_CUSTOM_PRESETS} 个`); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setErrorText("预设参考图仅支持 PNG、JPEG 和 WebP"); return; }
    setSavingPreset(true);
    try {
      const dataUrl = await compressPresetReference(file);
      const preset: CustomVfxPreset = { id: `custom-${crypto.randomUUID()}`, name, category: "我的预设", source: "custom", createdAt: new Date().toISOString(), effectDescription: activeGroup.effectDescription.trim(), palette: activeGroup.palette.trim(), stage: activeGroup.stage, layer: activeGroup.layer, tool, allowLighting: activeGroup.allowLighting, allowHaze: activeGroup.allowHaze, allowBloom: activeGroup.allowBloom, allowReflection: activeGroup.allowReflection, geometry: GEOMETRY_TOOLS.includes(tool) || tool === "blade-trail" ? { ...geometryControls, kind: tool === "ring" ? "ellipse" : tool === "blade-trail" ? "blade-trail" : tool as "arc" | "spiral" } : undefined, reference: { fileName: `${name}.webp`, mimeType: "image/webp", dataUrl, roles: [...PRESET_REFERENCE_ROLES] } };
      const next = [preset, ...customPresets.filter((item) => item.name !== name)].slice(0, MAX_CUSTOM_PRESETS);
      localStorage.setItem(CUSTOM_PRESET_STORAGE_KEY, JSON.stringify(next));
      setCustomPresets(next);
      setSelectedPresetId(preset.id);
      setCustomPresetName("");
      setStatus(`已保存图片预设“${name}”`);
    } catch (presetError) { setErrorText(presetError instanceof Error ? presetError.message : "保存图片预设失败"); }
    finally { setSavingPreset(false); }
  }, [activeGroup, customPresetName, customPresets, geometryControls, tool]);

  const deleteSelectedPreset = useCallback(() => {
    if (!selectedPreset || !("source" in selectedPreset) || selectedPreset.source !== "custom") return;
    const next = customPresets.filter((preset) => preset.id !== selectedPreset.id);
    localStorage.setItem(CUSTOM_PRESET_STORAGE_KEY, JSON.stringify(next));
    setCustomPresets(next);
    setSelectedPresetId("");
  }, [customPresets, selectedPreset]);

  const addText = useCallback(() => {
    const layer = createTextLayer(textLayers.length);
    layer.groupId = activeGroup?.id;
    layer.targetId = selectedTargetId || undefined;
    setTextLayers((current) => [...current, layer]);
    setActiveTextId(layer.id);
    setTool("title");
  }, [activeGroup?.id, selectedTargetId, textLayers.length]);

  const addPackagingPreset = useCallback(() => {
    const preset = PACKAGING_PRESETS.find((item) => item.id === packagingPresetId);
    if (!preset) { setErrorText("请先选择文字包装预设"); return; }
    const layer = { ...createTextLayer(textLayers.length), ...preset, id: crypto.randomUUID(), name: preset.name, groupId: activeGroup?.id, targetId: selectedTargetId || undefined, anchor: { x: 0.5, y: 0.18 + textLayers.length * 0.07 }, align: "center" as const, zIndex: textLayers.length, visible: true, locked: false };
    setTextLayers((current) => [...current, layer]);
    setActiveTextId(layer.id);
    setTool("title");
    setStatus(`已添加“${preset.name}”，点击画面定位`);
  }, [activeGroup?.id, packagingPresetId, selectedTargetId, textLayers.length]);

  const exportImage = useCallback((mode: "guide" | "influence" | "protect") => {
    if (!sourceImage) throw new Error("源图尚未载入");
    const scale = Math.min(1, 2048 / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceImage.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建导出画布");
    if (mode === "guide") context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
    else { context.fillStyle = "#000000"; context.fillRect(0, 0, canvas.width, canvas.height); }
    const groupMap = new Map(displayGroups.map((group) => [group.id, group]));
    const explicit = new Set(displayAnnotations.filter(item=>item.kind==="influence").map(item=>item.groupId));
    let emitterNumber = 0;
    displayAnnotations.forEach((annotation) => {
      if (annotation.kind === "emitter") emitterNumber += 1;
      const group = annotation.groupId ? groupMap.get(annotation.groupId) : effectGroups[0];
      if (mode==="influence" && group?.presetId?.startsWith("tx:") && !explicit.has(annotation.groupId) && ["emitter","flow","contour","ring","arc","spiral","blade-trail"].includes(annotation.kind)) {
        if (annotation.points.length===1) {
          const pt=annotation.points[0];
          context.fillStyle="#fff";
          context.beginPath();
          context.arc(pt.x*canvas.width,pt.y*canvas.height,Math.min(canvas.width,canvas.height)*.045,0,Math.PI*2);
          context.fill();
        } else drawAnnotation(context,{...annotation,kind:"influence"},canvas.width,canvas.height,emitterNumber,group.color,"influence");
      } else drawAnnotation(context, annotation, canvas.width, canvas.height, emitterNumber, group?.color || "#ffb547", mode === "guide" ? undefined : mode);
    });
    if (mode === "guide") textLayers.filter((layer) => layer.visible).forEach((layer) => drawTextLayer(context, layer, canvas.width, canvas.height, sourceImage.naturalWidth));
    return canvas.toDataURL("image/png");
  }, [displayAnnotations, displayGroups, sourceImage, textLayers]);

  const exportPackage = useCallback(() => {
    if (!sourceImage || !session) { setErrorText("源图尚未载入"); return; }
    const overlay = renderTextOverlay(textLayers, sourceImage.naturalWidth, sourceImage.naturalHeight);
    if (textLayers.length) {
      downloadDataUrl(overlay, `${session.sourceFileName.replace(/\.[^.]+$/, "")}-text-overlay.png`);
      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = sourceImage.naturalWidth;
      previewCanvas.height = sourceImage.naturalHeight;
      const previewContext = previewCanvas.getContext("2d");
      if (previewContext) {
        previewContext.drawImage(sourceImage, 0, 0);
        textLayers.slice().sort((a, b) => a.zIndex - b.zIndex).forEach((layer) => drawTextLayer(previewContext, layer, previewCanvas.width, previewCanvas.height, previewCanvas.width));
        downloadDataUrl(previewCanvas.toDataURL("image/png"), `${session.sourceFileName.replace(/\.[^.]+$/, "")}-packaging-preview.png`);
      }
    }
    downloadJson({ schemaVersion: "vfx-director-package/v2", source: { fileName: session.sourceFileName, width: sourceImage.naturalWidth, height: sourceImage.naturalHeight }, targets, effectGroups, annotations, textLayers, references: references.map(({ dataUrl: _dataUrl, ...reference }) => reference), renderPlan, preserve }, `${session.sourceFileName.replace(/\.[^.]+$/, "")}-vfx-package.json`);
    setStatus(textLayers.length ? "已下载透明文字层、包装预览和结构化文件" : "已下载结构化 VFX 包装文件");
  }, [annotations, effectGroups, preserve, references, renderPlan, session, sourceImage, targets, textLayers]);

  const preflightErrors = useMemo(() => {
    const errors: string[] = [];
    if (!sourceImage || !session) errors.push("源图尚未载入");
    if (!displayAnnotations.some(mark=>mark.kind!=="protect" && mark.kind!=="text") && !textLayers.some(layer => layer.visible)) errors.push("至少绘制一条 VFX 指令或添加一个文字包装层");
    effectGroups.filter((group) => group.visible).forEach((group) => { if (!group.effectDescription.trim() && annotations.some((annotation) => annotation.groupId === group.id)) errors.push(quickMode ? "点左侧一个踏星技能即可生成；已画的笔迹会保留。" : "「"+group.name+"」还没有技能或特效说明"); });
    targets.filter((target) => target.source === "suggested" && !target.confirmed).forEach((target) => errors.push(`对象建议“${target.name}”尚未确认`));
    references.forEach((reference, index) => { if (!reference.roles.length) errors.push(`参考图 ${index + 1} 未选择职责`); });
    return errors;
  }, [annotations, displayAnnotations, effectGroups, quickMode, references, session, sourceImage, targets, textLayers]);

  const submit = useCallback(async (exportOnly = STANDALONE) => {
    setPreflightOpen(true);
    if (preflightErrors.length) return;
    if ((!exportOnly && !app) || !session || !sourceImage) { setErrorText("编辑器尚未连接 Codex"); return; }
    setSubmitting(true);
    setErrorText(undefined);
    setStatus("正在整理分组 VFX 请求…");
    try {
      const [guideDataUrl, influenceDataUrl, protectionDataUrl] = [exportImage("guide"), exportImage("influence"), exportImage("protect")];
      const activeGroups = visibleGroups(effectGroups);
      const activeIds = new Set(activeGroups.map((group) => group.id));
      const activeAnnotations = annotations.filter((annotation) => !annotation.groupId || activeIds.has(annotation.groupId));
      const activeTextLayers = textLayers.filter((layer) => layer.visible);
      const activePlan = buildRenderPlan(activeGroups, activeTextLayers);
      const textOverlayDataUrl = activeTextLayers.length ? renderTextOverlay(activeTextLayers, sourceImage.naturalWidth, sourceImage.naturalHeight) : "";
      const effectDescription = activeGroups.map((group) => `${group.name}（${groupSummary(group, targets)}）：${group.effectDescription}`).filter(Boolean).join("；");
      const brief: VfxBrief = { effectDescription, renderStage: activeGroup?.stage || "action", stageIntent: { anticipation: "按各组发射点蓄积并形成主要轮廓", action: effectDescription, dissipation: "沿各组既定流向拆分为余辉、粒子或烟雾并自然衰减" }, palette: activeGroups.map((group) => `${group.name}: ${group.palette}`).join("；"), preserve: preserve.trim(), allowLighting: activeGroups.some((group) => group.allowLighting), allowHaze: activeGroups.some((group) => group.allowHaze), allowBloom: activeGroups.some((group) => group.allowBloom), allowReflection: activeGroups.some((group) => group.allowReflection) };
      if (!sourceDataUrl) throw new Error("源图数据缺失，请重新选择图片");
      const requestId = crypto.randomUUID();
      const referenceStart = activeTextLayers.length ? 6 : 5;
      const activeReferences = references.filter(item => !item.groupIds.length || item.groupIds.some(id => activeIds.has(id)));
      const referenceSummary = activeReferences.map((reference, index) => ({ imageNumber: index + referenceStart, fileName: reference.fileName, roles: reference.roles, groupIds: reference.groupIds }));
      const request = { schemaVersion: "vfx-director-inline/v2", requestId, ...(parentBranch ? { txParentRequestId: parentBranch } : {}), source: { imageNumber: 1, fileName: session.sourceFileName, width: sourceImage.naturalWidth, height: sourceImage.naturalHeight }, guides: { annotatedImageNumber: 2, influenceImageNumber: 3, protectionImageNumber: 4, ...(activeTextLayers.length ? { exactTextOverlayImageNumber: 5 } : {}) }, targets, effectGroups: activeGroups, references: referenceSummary, brief, annotations: activeAnnotations, textLayers: activeTextLayers, renderPlan: activePlan };
      const imageOrder = activeTextLayers.length ? "1=干净源图，2=带标注引导图，3=影响区图，4=保护区图，5=精确透明文字包装层，6 起为编号参考图" : "1=干净源图，2=带标注引导图，3=影响区图，4=保护区图，5 起为编号参考图";
      const contextContent: ContentBlock[] = [
        { type: "text", text: `VFX Director inline request\n${JSON.stringify(request)}\n图片顺序：${imageOrder}。按 renderPlan 处理复杂多人镜头；每个 effectGroup 只影响其绑定对象与区域。模型只生成干净 VFX 底图，不得输出箭头、线框、编号、标注文字或任何 UI。textLayers 与第 5 张透明图是精确文字包装层，不得让模型重写或改字。` },
        imageContent(sourceDataUrl), imageContent(guideDataUrl), imageContent(influenceDataUrl), imageContent(protectionDataUrl),
        ...(textOverlayDataUrl ? [imageContent(textOverlayDataUrl)] : []),
        ...activeReferences.map((reference) => imageContent(reference.dataUrl)),
      ];
      const record = (delivery: TxBranch["delivery"]) => setBranches(current => [...current, {id:requestId,parent:parentBranch,name:activeGroup?.name || "特效",delivery,width:sourceImage.naturalWidth,height:sourceImage.naturalHeight}]);
      if (exportOnly) {
        downloadRequest(request, contextContent.filter(item => item.type === "image"));
        record("export");
        setStatus("已导出出图包；拿到结果后可导入对应版本。");
        return;
      }
      if (!app) return;
      await deliverVfxRequest(app,request,contextContent,`请使用 $tx-vfx-director 直接生成并在对话中展示这张踏星特效图。严格使用本次 VFX Director v2 inline request 附带的干净源图、引导和候选参考，保护非目标区域。无需导出或让我重复描述。Request ID: ${requestId}`);
      record("host");
      setStatus(`已发送到对话，等待出图 · ${activePlan.mode === "single" ? "单次" : `${activePlan.passes.length} 阶段`}计划提交`);
    } catch (submitError) {
      setErrorText(submitError instanceof Error ? submitError.message : "提交失败");
      setStatus("提交未完成");
    } finally { setSubmitting(false); }
  }, [activeGroup?.name, activeGroup?.stage, annotations, app, effectGroups, exportImage, parentBranch, preflightErrors.length, preserve, references, session, sourceDataUrl, sourceImage, targets, textLayers]);

  const submitHandDraft=useCallback(async()=>{
    if(sendDraftLock.current || submitting)return;
    if(STANDALONE){
      setDraftSend({busy:false,error:true,text:"这个页面是独立预览。请在 Codex 对话里打开「踏星特效工作台」，在手绘页直接出图；不需要导出出图包。"});
      return;
    }
    if(!app || !session || !sourceImage || !sourceDataUrl){
      setDraftSend({busy:false,error:true,text:"编辑器还没连接到 Codex 对话，请从对话重新打开工作台。"});
      return;
    }
    sendDraftLock.current=true;
    const loadId=loadingId.current;
    setDraftSend({busy:true,text:"正在发送镜头、手绘草稿和遮挡…"});
    try{
      const visible=describeDraftForCodex(fxDraft);
      if(!visible.length)throw new Error("请先画一层可见特效。");
      const rendered=rasterizeDraftForCodex(sourceImage,fxDraft);
      const requestId=crypto.randomUUID();
      const effectDescription="按手绘合成稿精修以下效果："+visible.map(l=>l.name).join("、")+"。保留草稿的落点、主轮廓、透视与遮挡，只提升材质、亮暗层次和局部细节。";
      const group={...createEffectGroup(0,effectDescription),name:"手绘特效草稿",palette:visible.map(l=>l.tone).filter((v,i,a)=>a.indexOf(v)===i).join("、"),allowLighting:false,allowHaze:false,allowBloom:false,allowReflection:false};
      const renderPlan=buildRenderPlan([group],[]);
      const brief:VfxBrief={effectDescription,renderStage:"action",stageIntent:{anticipation:"",action:effectDescription,dissipation:""},palette:group.palette,preserve:preserve.trim()||DEFAULT_PRESERVE,allowLighting:false,allowHaze:false,allowBloom:false,allowReflection:false};
      const request={schemaVersion:"vfx-director-inline/v2",mode:"hand-draft-refine",requestId,...(parentBranch?{txParentRequestId:parentBranch}:{}),source:{imageNumber:1,fileName:session.sourceFileName,width:sourceImage.naturalWidth,height:sourceImage.naturalHeight},guides:{annotatedImageNumber:2,influenceImageNumber:3,protectionImageNumber:4,draftAlphaImageNumber:5,guideWidth:rendered.width,guideHeight:rendered.height},draft:{visibleLayers:visible,hasProtection:rendered.hasProtection},targets:[],effectGroups:[group],references:[],annotations:[],textLayers:[],brief,renderPlan};
      const instruction="使用第 1 张干净源图作为唯一编辑底图，第 2 张为手绘合成草稿，第 3 张白亮部分为实际特效足迹，第 4 张白亮部分为保护区，第 5 张为独立透明特效草稿（不是文字层）。照手绘主形精修，保留起点、路径、透视、前后遮挡与画幅；其余场景、人物、机位和原有文字保持。第 4 张已扣除用户明确放在遮挡前的笔迹占位，仅在该足迹内保留前景特效。不要生成全屏发光、标注、蒙版、手柄或界面。直接在当前对话展示成图，不让用户下载或上传工程。";
      const content:ContentBlock[]=[
        {type:"text",text:`VFX Director inline request
${JSON.stringify(request)}
${instruction}`},
        imageContent(sourceDataUrl),imageContent(rendered.guide),imageContent(rendered.influence),imageContent(rendered.protect),imageContent(rendered.alpha),
      ];
      await deliverVfxRequest(app,request,content,`请使用 $tx-vfx-director 直接按这次手绘特效草稿精修镜头，并在当前对话展示生成结果。使用 inline 请求的干净源图、手绘合成稿、影响区、保护区和透明草稿；不需要我再导出工程。Request ID: ${requestId}`);
      if(loadId!==loadingId.current)return;
      setBranches(current=>[...current,{id:requestId,parent:parentBranch,name:"手绘特效精修",delivery:"host",width:sourceImage.naturalWidth,height:sourceImage.naturalHeight}]);
      setDraftSend({busy:false,text:"已发送到 Codex，等待对话出图。草稿已保留。"});
      void app.requestDisplayMode({mode:"inline"}).catch(()=>undefined);
    }catch(e){
      if(loadId===loadingId.current)setDraftSend({busy:false,error:true,text:e instanceof Error?e.message:"草稿提交失败，请重试。"});
    }finally{sendDraftLock.current=false;}
  },[app,fxDraft,parentBranch,preserve,session,sourceDataUrl,sourceImage,submitting]);

  const saveShot = () => {
    if (!session || !originalRef.current) return;
    const project: TxProject = {
      version:"tx-vfx-shot/v1",original:originalRef.current,current:{session,dataUrl:sourceDataUrl,references,targets,groups:effectGroups},
      branches,parentBranch,annotations,textLayers,applied:txApplied,activeGroupId:activeGroup?.id || "",tool,geometry:geometryControls,preserve,...(fxDraft.strokes.length?{fxDraft}:{}),
    };
    downloadJson(project, session.sourceFileName.replace(/\.[^.]+$/, "")+"-TX镜头工程.json");
    setStatus("已下载镜头工程 · 包含原图、绘制和版本。");
  };
  const reopenShot = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value="";
    if (!file) return;
    try {
      if (file.size > 160 * 1024 * 1024) throw new Error("工程文件大于 160 MB");
      const project: unknown = JSON.parse(await file.text());
      validateTxProject(project);
      const next = project.current;
      loadSource(next.session,next.dataUrl,next.references,next.targets,next.groups,true,()=>{
        originalRef.current=project.original;
        setBranches(project.branches);
        setParentBranch(project.parentBranch);
        annotationsRef.current=project.annotations;
        setAnnotations(project.annotations);
        setTextLayers(project.textLayers);
        setTxApplied(project.applied);
        setActiveGroupId(project.activeGroupId);
        setTool(project.tool);
        setGeometryControls(project.geometry);
        setPreserve(project.preserve);
        if(project.fxDraft){setFxDraft(project.fxDraft);setDraftOpen(true);}
        setStatus("已恢复镜头工程 · 可继续绘制或分叉。");
      });
    } catch (err) { setErrorText(err instanceof Error ? err.message : "镜头工程打开失败"); }
  };
  const selectedTool = TOOLS.find((item) => item.id === tool)!;

  if (!sourceImage || !session) {
    return <main className="source-picker">
      <button aria-label="关闭" className="source-picker-close" onClick={() => window.openai?.requestClose?.()} type="button"><Icon name="close" /></button>
      <section className="source-picker-panel">
        <div className="source-picker-mark"><Icon name="image" /></div>
        <h1>踏星 · 特效工作台</h1>
        <p>选择一张图片，或直接在此窗口按 Ctrl+V 粘贴。可手绘真实特效草稿，也可选技能、画引导再提交出图。</p>
        <label className="source-picker-button" data-disabled={importingSource}><Icon name="plus" /><span>{importingSource ? "正在导入…" : "选择图片"}</span><input accept="image/png,image/jpeg,image/webp" disabled={importingSource} onChange={selectSource} type="file" /></label>
        <label className="tx-demo tx-open-project">打开镜头工程<input aria-label="打开镜头工程" type="file" accept=".json,application/json" onChange={reopenShot}/></label>
        <button className="tx-demo" type="button" onClick={()=>{const sample=demoPayload();loadSource({...sample.session,effectHint:""},sample.sourceDataUrl);}}>打开演示镜头</button>
        <button className="tx-demo" type="button" onClick={()=>{const sample=demoPayload();setDraftOpen(true);loadSource({...sample.session,effectHint:""},sample.sourceDataUrl);}}>用演示镜头试笔刷</button>
        <div className="paste-hint"><kbd>Ctrl</kbd><span>+</span><kbd>V</kbd><span>粘贴图片</span></div>
        <small>支持 PNG、JPEG、WebP；图片先在编辑器本地载入</small>
        <div className="source-picker-status" data-error={Boolean(errorText)}>{errorText || status}</div>
      </section>
    </main>;
  }

  return <main className="app-shell tx-shell" data-draft={draftOpen} data-standalone={STANDALONE} data-quick={quickMode} data-display-mode={displayMode}>
    <header className="topbar">
      <div><h1>踏星 · 特效工作台</h1><span className="version-badge">试用版</span></div>
      <div className="top-actions">
        <button type="button" className="fxd-enter" onClick={()=>setDraftOpen(true)}>手绘草稿</button>
        <button className="tx-advanced-toggle" onClick={()=>setQuickMode(value=>!value)} aria-pressed={!quickMode} type="button">{quickMode ? "高级" : "返回简洁模式"}</button>
        <label className="source-replace" data-disabled={importingSource}><Icon name="image" /><span>{importingSource ? "导入中…" : "更换源图"}</span><input accept="image/png,image/jpeg,image/webp" disabled={importingSource} onChange={selectSource} type="file" /></label>
        <button disabled={!undoStack.length} onClick={undo} type="button"><Icon name="undo" />撤销</button>
        <button disabled={!redoStack.length} onClick={redo} type="button"><Icon name="redo" />重做</button>
        <button onClick={paint} type="button"><Icon name="fit" />适合图像</button>
        <button disabled={!annotations.length} onClick={() => commit([])} type="button"><Icon name="clear" />清除绘制</button>
        <button onClick={() => window.openai?.requestClose?.()} type="button"><Icon name="close" />关闭</button>
      </div>
    </header>

    <aside aria-label="VFX 绘制工具" className="toolrail">
      {TOOLS.filter(item => !quickMode || [tool, "emitter","flow","influence","protect", ...(activeGroup && txApplied[activeGroup.id] ? [txApplied[activeGroup.id].tool] : [])].includes(item.id)).map((item) => <button aria-pressed={item.id === tool} key={item.id} onClick={() => setTool(item.id)} title={item.label} type="button"><Icon name={item.icon} /><span>{item.label}</span></button>)}
    </aside>

    <aside className="workflow-panel">
      <div className="tx-library"><TxSkillPanel onApply={applyTx} recipes={txRecipes} onDelete={id=>storeTxRecipes(txRecipes.filter(item=>item.id!==id))}/></div>
      <section>
        <div className="section-heading"><h2><Icon name="object" />镜头对象</h2><span>{targets.length}</span></div>
        {!targets.length ? <button className="smart-start" onClick={addSmartTemplate} type="button">智能多人模板</button> : null}
        <div className="target-list">
          {targets.map((target) => <article className="target-item" data-active={target.id === selectedTargetId} key={target.id} onClick={() => setSelectedTargetId(target.id)}>
            <i style={{ background: target.color }} />
            <div><input aria-label={`${target.name}名称`} onChange={(event) => setTargets((current) => current.map((item) => item.id === target.id ? { ...item, name: event.target.value } : item))} onClick={(event) => event.stopPropagation()} value={target.name} /><small>{TARGET_KINDS.find((kind) => kind.id === target.kind)?.label}{target.source === "suggested" ? " · 智能建议" : ""}</small></div>
            <button className="confirm-target" data-confirmed={target.confirmed} onClick={(event) => { event.stopPropagation(); setTargets((current) => current.map((item) => item.id === target.id ? { ...item, confirmed: !item.confirmed } : item)); }} type="button">{target.confirmed ? "已确认" : "确认"}</button>
            <button aria-label={`删除${target.name}`} className="mini-danger" onClick={(event) => { event.stopPropagation(); setTargets((current) => current.filter((item) => item.id !== target.id)); setEffectGroups((current) => current.map((group) => ({ ...group, targetIds: group.targetIds.filter((id) => id !== target.id) }))); }} type="button">删除</button>
          </article>)}
        </div>
        <div className="target-builder"><input maxLength={30} onChange={(event) => setNewTargetName(event.target.value)} placeholder="对象名称" value={newTargetName} /><select onChange={(event) => setNewTargetKind(event.target.value as VfxTargetKind)} value={newTargetKind}>{TARGET_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select><button onClick={addTarget} type="button">添加</button></div>
      </section>

      <section className="group-section">
        <div className="section-heading"><h2><Icon name="group" />特效组</h2><button className="heading-add" onClick={addGroup} type="button">添加组</button></div>
        <p className="section-help">每个人物、武器或场景区域使用独立组，绘制和参考图不会串线。</p>
        <div className="group-list">
          {effectGroups.slice().sort((a, b) => a.order - b.order).map((group) => <article className="group-card" data-active={group.id === activeGroup?.id} key={group.id} onClick={() => setActiveGroupId(group.id)}>
            <header><i style={{ background: group.color }} /><input aria-label="特效组名称" onChange={(event) => updateGroup(group.id, { name: event.target.value })} onClick={(event) => event.stopPropagation()} value={group.name} /><span>{groupSummary(group, targets)}</span></header>
            <div className="group-flags">
              <button aria-pressed={group.visible} onClick={(event) => { event.stopPropagation(); updateGroup(group.id, { visible: !group.visible }); }} type="button">{group.visible ? "显示" : "隐藏"}</button>
              <button aria-pressed={group.locked} onClick={(event) => { event.stopPropagation(); updateGroup(group.id, { locked: !group.locked }); }} type="button">{group.locked ? "已锁" : "锁定"}</button>
              <button aria-pressed={group.solo} onClick={(event) => { event.stopPropagation(); updateGroup(group.id, { solo: !group.solo }); }} type="button">独显</button>
            </div>
            <div className="group-actions"><button onClick={(event) => { event.stopPropagation(); moveGroup(group.id, -1); }} type="button">上移</button><button onClick={(event) => { event.stopPropagation(); moveGroup(group.id, 1); }} type="button">下移</button><button onClick={(event) => { event.stopPropagation(); duplicateGroup(group); }} type="button">复制</button><button onClick={(event) => { event.stopPropagation(); deleteGroup(group); }} type="button">删除</button></div>
          </article>)}
        </div>
      </section>
    </aside>

    <section className="stage" ref={stageRef}>
      <canvas aria-label="VFX 源图与指令绘制区域" onPointerCancel={endDraw} onPointerDown={beginDraw} onPointerMove={continueDraw} onPointerUp={endDraw} ref={canvasRef} />
      {compareUrl && <img className="tx-comparison" src={compareUrl} alt="版本对比图" onClick={()=>setCompareUrl("")} />}
      <div className="stage-hint"><i style={{ background: activeGroup?.color }} />{activeGroup?.name} · {selectedTool.label}{!quickMode && <> · {STAGES.find((item) => item.id === activeGroup?.stage)?.label} · {LAYERS.find((item) => item.id === activeGroup?.layer)?.label}</>}</div>
      <div className="render-plan-pill" data-mode={renderPlan.mode}>{renderPlan.mode === "single" ? "智能单次生成" : `${renderPlan.passes.length} 阶段生成`}</div>
    </section>

    <aside className="inspector">
      <div className="tx-simple-inspector">
        <section className="tx-section">
          <div className="tx-eyebrow">CURRENT SHOT</div><h2>镜头特效</h2>
          {effectGroups.filter(group=>group.effectDescription.trim()).length ? effectGroups.filter(group=>group.effectDescription.trim()).map(group=><article key={group.id} className="tx-effect" data-active={group.id===activeGroup?.id}><button type="button" onClick={()=>{setActiveGroupId(group.id);const recipe=txApplied[group.id];if(recipe){setTool(recipe.tool);setGeometryControls({...DEFAULT_GEOMETRY_CONTROLS,...recipe.geometry});}}}>{group.name}</button><button type="button" onClick={()=>updateGroup(group.id,{visible:!group.visible})}>{group.visible?"隐藏":"显示"}</button></article>) : <p className="tx-muted">点左侧任一技能即可使用预设，无需建组或写说明。</p>}
          {activeGroup?.effectDescription.trim() && <><p className="tx-muted">{txApplied[activeGroup.id]?.guide || "选笔刷，在画布上标出位置。"}</p><details className="tx-details"><summary>调整提示词 / 保存复用</summary><textarea aria-label="当前镜头提示词" maxLength={700} value={activeGroup.effectDescription} onChange={e=>updateGroup(activeGroup.id,{effectDescription:e.target.value})}/><input aria-label="复用预设名称" value={txPresetName} maxLength={40} placeholder={activeGroup.name} onChange={e=>setTxPresetName(e.target.value)}/><button type="button" onClick={saveTxRecipe}>保存为特效预设</button></details></>}
        </section>
        <section className="tx-section">
          <div className="tx-eyebrow">HISTORY</div><h2>生成版本</h2>
          <div className="tx-inline"><button type="button" onClick={saveShot}>保存镜头工程</button><label className="tx-demo tx-open-project">打开工程<input aria-label="打开镜头工程" type="file" accept=".json,application/json" onChange={reopenShot}/></label></div>
          <p className="tx-muted">{parentBranch ? "当前底图：版本 "+(branches.findIndex(item=>item.id===parentBranch)+1) : "当前底图：原图"}</p>
          <div className="tx-inline"><button type="button" aria-pressed={Boolean(compareUrl && compareUrl===originalRef.current?.dataUrl)} onClick={()=>setCompareUrl(compareUrl === originalRef.current?.dataUrl ? "" : originalRef.current?.dataUrl || "")}>对比原图</button>{parentBranch && <button type="button" onClick={backToOriginal}>从原图继续</button>}</div>
          {!branches.length && <p className="tx-muted">提交或导出后会在这里建立版本。关窗前保存镜头工程，下次可恢复。</p>}
          {branches.map((branch,index)=><article className="tx-version" key={branch.id}><strong>V{index+1} · {branch.name}</strong><small>来自 {branch.parent ? "V"+(branches.findIndex(item=>item.id===branch.parent)+1) : "原图"} · {branch.result ? "已有结果" : branch.delivery === "host" ? "已提交 · 待导入结果" : "已导出 · 待导入结果"}</small>
            {branch.result ? <><img alt={"V"+(index+1)+" 结果"} src={branch.result.dataUrl}/><div className="tx-inline"><button type="button" onClick={()=>setCompareUrl(compareUrl===branch.result!.dataUrl ? "" : branch.result!.dataUrl)}>预览</button><button type="button" onClick={()=>forkFrom(branch)}>从此版继续</button></div></> : <label className="tx-file">导入结果图<input aria-label={"导入 V"+(index+1)+" 结果图"} type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void importResult(branch,e.target.files?.[0]);e.target.value="";}}/></label>}
          </article>)}
        </section>
      </div>
      {activeGroup ? <>
        <section className="active-group-editor">
          <div className="section-heading"><h2>当前特效组</h2><span style={{ color: activeGroup.color }}>{activeGroup.name}</span></div>
          <label>绑定对象</label>
          <div className="target-chips">{targets.map((target) => <button aria-pressed={activeGroup.targetIds.includes(target.id)} key={target.id} onClick={() => toggleGroupTarget(activeGroup.id, target.id)} type="button"><i style={{ background: target.color }} />{target.name}</button>)}</div>
          {!targets.length ? <p className="empty-note">未设置对象时，此组默认作用于全场景。</p> : null}
        </section>
        <section className="preset-section">
          <div className="section-heading"><h2>特效预设</h2><span>{customPresets.length}/{MAX_CUSTOM_PRESETS} 我的</span></div>
          <select aria-label="选择特效预设" onChange={(event) => setSelectedPresetId(event.target.value)} value={selectedPresetId}><option value="">选择预设…</option><optgroup label="内置预设">{BUILT_IN_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.category} · {preset.name}</option>)}</optgroup>{customPresets.length ? <optgroup label="我的图片预设">{customPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup> : null}</select>
          {selectedPreset?.reference ? <div className="preset-preview"><img alt={`${selectedPreset.name}预设参考`} src={selectedPreset.reference.dataUrl} /><span>应用后只绑定当前特效组。</span></div> : null}
          <div className="preset-actions"><button disabled={!selectedPreset} onClick={applyPreset} type="button">应用到当前组</button>{selectedPreset && "source" in selectedPreset && selectedPreset.source === "custom" ? <button className="danger-button" onClick={deleteSelectedPreset} type="button">删除</button> : null}</div>
          <div className="custom-preset-builder"><input aria-label="我的预设名称" maxLength={40} onChange={(event) => setCustomPresetName(event.target.value)} placeholder="我的预设名称" value={customPresetName} /><label className="preset-image-add" data-disabled={savingPreset}><Icon name="image" /><span>{savingPreset ? "正在保存…" : "上传效果图并保存当前组"}</span><input accept="image/png,image/jpeg,image/webp" disabled={savingPreset} onChange={saveImagePreset} type="file" /></label></div>
        </section>
        <section><h2>阶段</h2><Segment items={STAGES} onChange={(value) => updateGroup(activeGroup.id, { stage: value })} value={activeGroup.stage} /><p className="field-hint">{STAGES.find((item) => item.id === activeGroup.stage)?.hint}</p></section>
        <section><h2>层级</h2><Segment items={LAYERS} onChange={(value) => updateGroup(activeGroup.id, { layer: value })} value={activeGroup.layer} /><p className="field-hint">{LAYERS.find((item) => item.id === activeGroup.layer)?.hint}</p></section>
        {tool === "text" ? <section><label htmlFor="annotation-label">说明标注</label><input id="annotation-label" maxLength={80} onChange={(event) => setAnnotationLabel(event.target.value)} value={annotationLabel} /></section> : null}
        {GEOMETRY_TOOLS.includes(tool) || tool === "blade-trail" ? <section className="geometry-editor"><h2>轨迹参数</h2><div className="field-grid"><label>旋转°<input max={180} min={-180} onChange={(event) => setGeometryControls((current) => ({ ...current, rotation: Number(event.target.value) }))} type="number" value={geometryControls.rotation} /></label>{tool === "arc" ? <><label>起始°<input onChange={(event) => setGeometryControls((current) => ({ ...current, startAngle: Number(event.target.value) }))} type="number" value={geometryControls.startAngle} /></label><label>结束°<input onChange={(event) => setGeometryControls((current) => ({ ...current, endAngle: Number(event.target.value) }))} type="number" value={geometryControls.endAngle} /></label></> : null}{tool === "spiral" ? <label>圈数<input max={6} min={0.5} onChange={(event) => setGeometryControls((current) => ({ ...current, turns: Number(event.target.value) }))} step={0.1} type="number" value={geometryControls.turns} /></label> : null}<label>起始宽度<input max={0.12} min={0.002} onChange={(event) => setGeometryControls((current) => ({ ...current, widthStart: Number(event.target.value) }))} step={0.002} type="number" value={geometryControls.widthStart} /></label><label>末端宽度<input max={0.12} min={0.001} onChange={(event) => setGeometryControls((current) => ({ ...current, widthEnd: Number(event.target.value) }))} step={0.001} type="number" value={geometryControls.widthEnd} /></label></div><div className="constraint-toggles"><label><input checked={geometryControls.clockwise} onChange={(event) => setGeometryControls((current) => ({ ...current, clockwise: event.target.checked }))} type="checkbox" />顺时针</label><label><input checked={geometryControls.taper} onChange={(event) => setGeometryControls((current) => ({ ...current, taper: event.target.checked }))} type="checkbox" />末端收束</label></div></section> : null}
        <section><label htmlFor="effect-description">当前组特效说明</label><textarea id="effect-description" maxLength={700} onChange={(event) => updateGroup(activeGroup.id, { effectDescription: event.target.value })} placeholder="只描述这个对象或区域的形态、动势、材质和强度" value={activeGroup.effectDescription} /><span className="counter">{activeGroup.effectDescription.length}/700</span></section>
        <section><label htmlFor="palette">当前组色彩与光照</label><input id="palette" maxLength={180} onChange={(event) => updateGroup(activeGroup.id, { palette: event.target.value })} value={activeGroup.palette} /><div className="constraint-toggles"><label><input checked={activeGroup.allowLighting} onChange={(event) => updateGroup(activeGroup.id, { allowLighting: event.target.checked })} type="checkbox" />光照</label><label><input checked={activeGroup.allowHaze} onChange={(event) => updateGroup(activeGroup.id, { allowHaze: event.target.checked })} type="checkbox" />雾</label><label><input checked={activeGroup.allowBloom} onChange={(event) => updateGroup(activeGroup.id, { allowBloom: event.target.checked })} type="checkbox" />辉光</label><label><input checked={activeGroup.allowReflection} onChange={(event) => updateGroup(activeGroup.id, { allowReflection: event.target.checked })} type="checkbox" />反射</label></div></section>
      </> : null}

      <section className="text-packaging-section">
        <div className="section-heading"><h2>精确文字包装</h2><span>{textLayers.length}</span></div>
        <p className="section-help">文字单独生成透明层，避免模型改错中文。添加后用“文字定位”在画面点击位置。</p>
        <div className="packaging-add"><select onChange={(event) => setPackagingPresetId(event.target.value)} value={packagingPresetId}><option value="">选择包装预设…</option><optgroup label="彩色玄幻">{PACKAGING_PRESETS.filter((item) => item.family === "彩色玄幻").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup><optgroup label="水墨书法">{PACKAGING_PRESETS.filter((item) => item.family === "水墨书法").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup></select><button onClick={addPackagingPreset} type="button">添加预设</button><button onClick={addText} type="button">空白文字</button></div>
        <div className="text-layer-tabs">{textLayers.map((layer) => <button aria-pressed={layer.id === activeTextId} key={layer.id} onClick={() => setActiveTextId(layer.id)} type="button">{layer.name}</button>)}</div>
        {activeText ? <div className="text-layer-editor"><label>图层名称<input onChange={(event) => updateText(activeText.id, { name: event.target.value })} value={activeText.name} /></label><label>精确文字<textarea maxLength={120} onChange={(event) => updateText(activeText.id, { text: event.target.value })} value={activeText.text} /></label><div className="field-grid"><label>方向<select onChange={(event) => updateText(activeText.id, { orientation: event.target.value as VfxTextLayer["orientation"] })} value={activeText.orientation}><option value="horizontal">横排</option><option value="vertical">竖排</option></select></label><label>字体<select onChange={(event) => updateText(activeText.id, { fontFamily: event.target.value })} value={activeText.fontFamily}><option value="STKaiti, KaiTi, serif">楷体/书法</option><option value="FangSong, STFangsong, serif">仿宋</option><option value="Microsoft YaHei, sans-serif">现代黑体</option><option value="SimSun, serif">宋体</option></select></label><label>字号<input max={220} min={12} onChange={(event) => updateText(activeText.id, { fontSize: Number(event.target.value) })} type="number" value={activeText.fontSize} /></label><label>字距<input max={40} min={-5} onChange={(event) => updateText(activeText.id, { tracking: Number(event.target.value) })} type="number" value={activeText.tracking} /></label><label>旋转°<input max={180} min={-180} onChange={(event) => updateText(activeText.id, { rotation: Number(event.target.value) })} type="number" value={activeText.rotation} /></label><label>描边<input max={12} min={0} onChange={(event) => updateText(activeText.id, { strokeWidth: Number(event.target.value) })} type="number" value={activeText.strokeWidth} /></label><label>填充<input onChange={(event) => updateText(activeText.id, { fill: event.target.value })} type="color" value={activeText.fill} /></label><label>渐变<input onChange={(event) => updateText(activeText.id, { gradientTo: event.target.value })} type="color" value={activeText.gradientTo || activeText.fill} /></label><label>描边色<input onChange={(event) => updateText(activeText.id, { stroke: event.target.value })} type="color" value={activeText.stroke} /></label><label>阴影<input onChange={(event) => updateText(activeText.id, { shadowColor: event.target.value })} value={activeText.shadowColor} /></label></div><div className="text-layer-actions"><button aria-pressed={activeText.visible} onClick={() => updateText(activeText.id, { visible: !activeText.visible })} type="button">{activeText.visible ? "显示" : "隐藏"}</button><button aria-pressed={activeText.locked} onClick={() => updateText(activeText.id, { locked: !activeText.locked })} type="button">{activeText.locked ? "已锁" : "锁定"}</button><button onClick={() => setTool("title")} type="button">画面定位</button><button className="danger-button" onClick={() => { setTextLayers((current) => current.filter((layer) => layer.id !== activeText.id)); setActiveTextId(""); }} type="button">删除层</button></div></div> : null}
      </section>

      <section><div className="section-heading"><h2>参考图</h2><span>{references.length}/10</span></div><label className="reference-add"><Icon name="plus" /><span>添加到当前组</span><input accept="image/png,image/jpeg,image/webp" multiple onChange={addReferences} type="file" /></label><div className="reference-list">{references.map((reference, index) => <article className="reference-item" key={reference.id}><img alt={`参考图 ${index + 1}`} src={reference.dataUrl} /><div><strong>{index + 1}. {reference.fileName}</strong><select aria-label="参考图绑定组" onChange={(event) => setReferences((current) => current.map((item) => item.id === reference.id ? { ...item, groupIds: event.target.value ? [event.target.value] : [] } : item))} value={reference.groupIds[0] || ""}><option value="">全部特效组</option>{effectGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><div className="role-list">{REFERENCE_ROLES.map((role) => <button aria-pressed={reference.roles.includes(role.id)} key={role.id} onClick={() => toggleReferenceRole(reference.id, role.id)} type="button">{role.label}</button>)}</div></div><button aria-label={`删除参考图 ${index + 1}`} className="reference-remove" onClick={() => setReferences((current) => current.filter((item) => item.id !== reference.id))} type="button">删除</button></article>)}</div></section>
      <section><label htmlFor="preserve">全局保护约束</label><textarea className="constraints" id="preserve" maxLength={500} onChange={(event) => setPreserve(event.target.value)} value={preserve} /></section>
      <section className="render-plan"><div className="section-heading"><h2>智能渲染计划</h2><span>{renderPlan.mode === "single" ? "单次" : "分阶段"}</span></div><p>{renderPlan.reason}</p><ol>{renderPlan.passes.map((pass) => <li key={pass.id}>{pass.name}</li>)}</ol></section>
    </aside>

    <footer className="bottom-bar">
      <button className="preflight-button" onClick={() => setPreflightOpen((value) => !value)} type="button"><Icon name="check" />预检</button>

      <button className="package-button" onClick={exportPackage} type="button"><Icon name="download" />导出分层包</button>
      <div className="status" role="status" data-error={Boolean(errorText)}>{errorText || status}</div>
      <button className="submit-button" disabled={submitting} onClick={()=>void submit()} type="button"><Icon name="send" />{submitting ? "正在处理…" : STANDALONE ? "导出出图包" : "直接出图"}</button>
    </footer>

    {draftOpen&&<FxDraftStudio key={draftKey} image={sourceImage} fileName={session.sourceFileName} draft={fxDraft} onChange={next=>{setFxDraft(next);if(!sendDraftLock.current)setDraftSend({busy:false,text:""});}} onGenerate={()=>void submitHandDraft()} generation={draftSend} onSave={saveShot} onClose={()=>setDraftOpen(false)} onOpen={reopenShot}/>}
    {preflightOpen ? <div className="preflight-panel" role="status"><strong>{preflightErrors.length ? "预检未通过" : "预检通过"}</strong>{preflightErrors.length ? <ul>{preflightErrors.map((item) => <li key={item}>{item}</li>)}</ul> : <><p>{effectGroups.filter((group) => group.visible).length} 个可见特效组、{annotations.length} 条绘制、{textLayers.length} 个文字层已就绪。</p><p>{renderPlan.reason}</p></>}</div> : null}
  </main>;
}

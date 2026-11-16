import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import type {
  ReferenceRole,
  VfxAnnotation,
  VfxBrief,
  VfxEffectGroup,
  VfxReferenceInput,
  VfxRenderPlan,
  VfxRequestManifest,
  VfxSession,
  VfxTarget,
  VfxTextLayer,
} from "./types.js";
import { buildRenderPlan } from "./render-plan.js";

const SESSION_FILE = "session.vfx-director.json";
const allowedRoles = new Set<ReferenceRole>(["shape", "motion", "material", "color-light", "density", "atmosphere", "layout", "typography"]);
const MAX_SOURCE_CHUNK_CHARS = 256 * 1024;
type SourceUploadState = {
  uploadId: string;
  uploadDir: string;
  partialPath: string;
  workspaceRoot: string;
  fileName: string;
  mimeType: string;
  effectHint: string;
  totalBytes: number;
  nextChunkIndex: number;
  receivedBytes: number;
};
const sourceUploads = new Map<string, SourceUploadState>();

export function inside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function safeName(value: string): string {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "");
  return (cleaned || "vfx-asset").slice(0, 96);
}

function mimeFromPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  throw new Error("仅支持 PNG、JPEG 和 WebP 图片");
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  throw new Error(`不支持的图片类型：${mimeType}`);
}

export function dataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export function decodeImageDataUrl(value: string, expectedMime?: string): { bytes: Buffer; mimeType: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(value);
  if (!match) throw new Error("图片数据不是有效的 PNG、JPEG 或 WebP data URL");
  if (expectedMime && match[1] !== expectedMime) throw new Error("图片 MIME 类型与数据不一致");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) throw new Error("图片数据为空");
  return { bytes, mimeType: match[1] };
}

export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, filePath);
}

export async function createVfxSession(args: {
  imagePath: string;
  workspaceRoot?: string;
  effectHint?: string;
  referenceImagePaths?: string[];
}): Promise<{ session: VfxSession; sourceDataUrl: string; initialReferences: VfxReferenceInput[] }> {
  const workspaceRoot = path.resolve(args.workspaceRoot || process.cwd());
  const rootInfo = await fs.stat(workspaceRoot);
  if (!rootInfo.isDirectory()) throw new Error("工作区路径不是文件夹");
  const originalSourcePath = path.resolve(args.imagePath);
  const sourceInfo = await fs.stat(originalSourcePath);
  if (!sourceInfo.isFile()) throw new Error("源图片不存在或不是文件");
  const mimeType = mimeFromPath(originalSourcePath);
  const bytes = await fs.readFile(originalSourcePath);
  if (!bytes.length) throw new Error("源图片为空");

  const rootDir = path.join(workspaceRoot, "_vfx_director");
  if (!inside(workspaceRoot, rootDir)) throw new Error("VFX 工作目录必须位于当前工作区内");
  const id = randomUUID();
  const sessionDir = path.join(rootDir, "sessions", id);
  await fs.mkdir(sessionDir, { recursive: true });
  const extension = extensionForMime(mimeType);
  const sourcePath = path.join(sessionDir, `source${extension}`);
  await fs.copyFile(originalSourcePath, sourcePath, fsConstants.COPYFILE_EXCL);
  const sessionFile = path.join(sessionDir, SESSION_FILE);
  const session: VfxSession = {
    schemaVersion: "1.0",
    id,
    workspaceRoot,
    sessionDir,
    sessionFile,
    sourcePath,
    originalSourcePath,
    sourceFileName: path.basename(originalSourcePath),
    mimeType,
    effectHint: args.effectHint?.trim() || "",
    createdAt: new Date().toISOString(),
  };
  await atomicWriteJson(sessionFile, session);
  const initialReferences: VfxReferenceInput[] = [];
  for (const referencePath of (args.referenceImagePaths || []).slice(0, 9)) {
    const resolvedReference = path.resolve(referencePath);
    const referenceMimeType = mimeFromPath(resolvedReference);
    const referenceBytes = await fs.readFile(resolvedReference);
    if (!referenceBytes.length || referenceBytes.length > 64 * 1024 * 1024) throw new Error(`参考图无效或超过 64MB：${path.basename(resolvedReference)}`);
    initialReferences.push({
      fileName: path.basename(resolvedReference),
      mimeType: referenceMimeType,
      dataBase64: dataUrl(referenceBytes, referenceMimeType),
      roles: ["shape", "material"],
    });
  }
  return { session, sourceDataUrl: dataUrl(bytes, mimeType), initialReferences };
}

export async function createVfxSessionFromData(args: {
  fileName: string;
  mimeType: string;
  sourceDataUrl: string;
  workspaceRoot?: string;
  effectHint?: string;
}): Promise<{ session: VfxSession; sourceDataUrl: string; initialReferences: VfxReferenceInput[] }> {
  const workspaceRoot = path.resolve(args.workspaceRoot || process.cwd());
  const rootInfo = await fs.stat(workspaceRoot);
  if (!rootInfo.isDirectory()) throw new Error("工作区路径不是文件夹");
  const decoded = decodeImageDataUrl(args.sourceDataUrl, args.mimeType);
  const extension = extensionForMime(decoded.mimeType);
  const sourceFileName = `${safeName(path.parse(args.fileName || "source").name)}${extension}`;

  const rootDir = path.join(workspaceRoot, "_vfx_director");
  if (!inside(workspaceRoot, rootDir)) throw new Error("VFX 工作目录必须位于当前工作区内");
  const id = randomUUID();
  const sessionDir = path.join(rootDir, "sessions", id);
  await fs.mkdir(sessionDir, { recursive: true });
  const sourcePath = path.join(sessionDir, `source${extension}`);
  await fs.writeFile(sourcePath, decoded.bytes, { flag: "wx" });
  const sessionFile = path.join(sessionDir, SESSION_FILE);
  const session: VfxSession = {
    schemaVersion: "1.0",
    id,
    workspaceRoot,
    sessionDir,
    sessionFile,
    sourcePath,
    originalSourcePath: sourcePath,
    sourceFileName,
    mimeType: decoded.mimeType,
    effectHint: args.effectHint?.trim() || "",
    createdAt: new Date().toISOString(),
  };
  await atomicWriteJson(sessionFile, session);
  return { session, sourceDataUrl: dataUrl(decoded.bytes, decoded.mimeType), initialReferences: [] };
}

export async function beginVfxSourceUpload(args: {
  fileName: string;
  mimeType: string;
  totalBytes: number;
  workspaceRoot?: string;
  effectHint?: string;
}): Promise<{ uploadId: string; maxChunkChars: number }> {
  const workspaceRoot = path.resolve(args.workspaceRoot || process.cwd());
  const rootInfo = await fs.stat(workspaceRoot);
  if (!rootInfo.isDirectory()) throw new Error("工作区路径不是文件夹");
  extensionForMime(args.mimeType);
  if (!Number.isSafeInteger(args.totalBytes) || args.totalBytes < 1) {
    throw new Error("源图片大小无效");
  }
  const uploadsRoot = path.join(workspaceRoot, "_vfx_director", "uploads");
  if (!inside(workspaceRoot, uploadsRoot)) throw new Error("VFX 上传目录必须位于当前工作区内");
  await fs.mkdir(uploadsRoot, { recursive: true });
  const uploadId = randomUUID();
  const uploadDir = path.join(uploadsRoot, uploadId);
  await fs.mkdir(uploadDir, { recursive: false });
  const partialPath = path.join(uploadDir, "source.binary.partial");
  await fs.writeFile(partialPath, Buffer.alloc(0), { flag: "wx" });
  sourceUploads.set(uploadId, {
    uploadId,
    uploadDir,
    partialPath,
    workspaceRoot,
    fileName: args.fileName,
    mimeType: args.mimeType,
    effectHint: args.effectHint?.trim() || "",
    totalBytes: args.totalBytes,
    nextChunkIndex: 0,
    receivedBytes: 0,
  });
  return { uploadId, maxChunkChars: MAX_SOURCE_CHUNK_CHARS };
}

export async function appendVfxSourceChunk(args: {
  uploadId: string;
  chunkIndex: number;
  chunk: string;
}): Promise<{ nextChunkIndex: number; receivedBytes: number }> {
  const state = sourceUploads.get(args.uploadId);
  if (!state) throw new Error("源图上传会话不存在或已失效");
  if (args.chunkIndex !== state.nextChunkIndex) throw new Error("源图分块顺序无效");
  if (!args.chunk.length || args.chunk.length > MAX_SOURCE_CHUNK_CHARS || !/^[a-zA-Z0-9+/=]+$/.test(args.chunk)) {
    throw new Error("源图分块无效或过大");
  }
  const bytes = Buffer.from(args.chunk, "base64");
  if (!bytes.length || state.receivedBytes + bytes.length > state.totalBytes) throw new Error("源图分块总量超过声明大小");
  await fs.appendFile(state.partialPath, bytes);
  state.nextChunkIndex += 1;
  state.receivedBytes += bytes.length;
  return { nextChunkIndex: state.nextChunkIndex, receivedBytes: state.receivedBytes };
}

export async function finishVfxSourceUpload(args: { uploadId: string }) {
  const state = sourceUploads.get(args.uploadId);
  if (!state) throw new Error("源图上传会话不存在或已失效");
  try {
    const partialInfo = await fs.stat(state.partialPath);
    if (partialInfo.size !== state.totalBytes) throw new Error("源图分块不完整，请重新导入");
    const extension = extensionForMime(state.mimeType);
    const sourceFileName = `${safeName(path.parse(state.fileName || "source").name)}${extension}`;
    const rootDir = path.join(state.workspaceRoot, "_vfx_director");
    const id = randomUUID();
    const sessionDir = path.join(rootDir, "sessions", id);
    await fs.mkdir(sessionDir, { recursive: true });
    const sourcePath = path.join(sessionDir, `source${extension}`);
    await fs.rename(state.partialPath, sourcePath);
    const sessionFile = path.join(sessionDir, SESSION_FILE);
    const session: VfxSession = {
      schemaVersion: "1.0",
      id,
      workspaceRoot: state.workspaceRoot,
      sessionDir,
      sessionFile,
      sourcePath,
      originalSourcePath: sourcePath,
      sourceFileName,
      mimeType: state.mimeType,
      effectHint: state.effectHint,
      createdAt: new Date().toISOString(),
    };
    await atomicWriteJson(sessionFile, session);
    return { session, initialReferences: [] as VfxReferenceInput[] };
  } finally {
    sourceUploads.delete(args.uploadId);
    await fs.rm(state.uploadDir, { recursive: true, force: true });
  }
}

export async function loadVfxSession(sessionFile: string): Promise<VfxSession> {
  const resolved = path.resolve(sessionFile);
  const session = JSON.parse(await fs.readFile(resolved, "utf8")) as VfxSession;
  if (session.schemaVersion !== "1.0" || path.resolve(session.sessionFile) !== resolved) throw new Error("VFX 会话文件无效");
  const expectedRoot = path.join(path.resolve(session.workspaceRoot), "_vfx_director", "sessions");
  if (!inside(expectedRoot, resolved) || !inside(session.sessionDir, session.sourcePath)) throw new Error("VFX 会话路径越界");
  await fs.access(session.sourcePath);
  return session;
}

function validateReferences(references: VfxReferenceInput[]): void {
  if (references.length > 10) throw new Error("参考图最多 10 张");
  references.forEach((reference, index) => {
    if (!reference.roles.length || reference.roles.some((role) => !allowedRoles.has(role))) {
      throw new Error(`参考图 ${index + 1} 必须选择有效职责`);
    }
  });
}

export async function saveVfxRequest(args: {
  sessionFile: string;
  width: number;
  height: number;
  brief: VfxBrief;
  annotations: VfxAnnotation[];
  guideDataUrl: string;
  influenceDataUrl: string;
  protectionDataUrl: string;
  textOverlayDataUrl?: string;
  references: VfxReferenceInput[];
  targets?: VfxTarget[];
  effectGroups?: VfxEffectGroup[];
  textLayers?: VfxTextLayer[];
  renderPlan?: VfxRenderPlan;
}): Promise<{ requestId: string; manifestPath: string; requestDir: string; manifest: VfxRequestManifest }> {
  const session = await loadVfxSession(args.sessionFile);
  if (!Number.isInteger(args.width) || !Number.isInteger(args.height) || args.width < 1 || args.height < 1) {
    throw new Error("源图尺寸无效");
  }
  const isV2 = Boolean(args.targets || args.effectGroups || args.textLayers || args.renderPlan || args.textOverlayDataUrl);
  const targets = args.targets || [];
  const effectGroups = args.effectGroups || [];
  const textLayers = args.textLayers || [];
  if (!args.brief.effectDescription.trim() && !textLayers.length) throw new Error("请填写特效说明");
  if (!args.annotations.length && !textLayers.length) throw new Error("请至少绘制一条 VFX 指令或添加文字包装层");
  validateReferences(args.references);
  if (isV2) {
    if (!effectGroups.length) throw new Error("v2 请求至少需要一个特效组");
    const targetIds = new Set(targets.map((target) => target.id));
    const groupIds = new Set(effectGroups.map((group) => group.id));
    if (effectGroups.some((group) => group.targetIds.some((targetId) => !targetIds.has(targetId)))) throw new Error("特效组绑定了不存在的对象");
    if (args.annotations.some((annotation) => !annotation.groupId || !groupIds.has(annotation.groupId))) throw new Error("每条 v2 标注必须绑定有效特效组");
    if (textLayers.some((textLayer) => !textLayer.text.trim())) throw new Error("文字包装图层内容不能为空");
  }

  const requestId = randomUUID();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const requestsRoot = path.join(session.workspaceRoot, "_vfx_director", "requests");
  await fs.mkdir(requestsRoot, { recursive: true });
  const requestDir = path.join(requestsRoot, `${stamp}-${requestId.slice(0, 8)}`);
  await fs.mkdir(requestDir, { recursive: false });
  const sourceExtension = extensionForMime(session.mimeType);
  const sourcePath = path.join(requestDir, `source${sourceExtension}`);
  await fs.copyFile(session.sourcePath, sourcePath, fsConstants.COPYFILE_EXCL);

  const guidePath = path.join(requestDir, "guide-annotated.png");
  const influencePath = path.join(requestDir, "map-influence.png");
  const protectionPath = path.join(requestDir, "map-protection.png");
  await Promise.all([
    fs.writeFile(guidePath, decodeImageDataUrl(args.guideDataUrl, "image/png").bytes, { flag: "wx" }),
    fs.writeFile(influencePath, decodeImageDataUrl(args.influenceDataUrl, "image/png").bytes, { flag: "wx" }),
    fs.writeFile(protectionPath, decodeImageDataUrl(args.protectionDataUrl, "image/png").bytes, { flag: "wx" }),
  ]);
  let textOverlayPath: string | undefined;
  if (args.textOverlayDataUrl) {
    textOverlayPath = path.join(requestDir, "overlay-text.png");
    await fs.writeFile(textOverlayPath, decodeImageDataUrl(args.textOverlayDataUrl, "image/png").bytes, { flag: "wx" });
  }

  const referenceRecords: Array<{ index: number; path: string; fileName: string; roles: ReferenceRole[]; groupIds: string[] }> = [];
  for (const [index, reference] of args.references.entries()) {
    const decoded = decodeImageDataUrl(reference.dataBase64, reference.mimeType);
    const fileName = `reference-${String(index + 1).padStart(2, "0")}-${safeName(path.parse(reference.fileName).name)}${extensionForMime(decoded.mimeType)}`;
    const referencePath = path.join(requestDir, fileName);
    await fs.writeFile(referencePath, decoded.bytes, { flag: "wx" });
    referenceRecords.push({ index: index + 1, path: referencePath, fileName: reference.fileName, roles: [...new Set(reference.roles)], groupIds: [...new Set(reference.groupIds || [])] });
  }

  const constraints = [
    args.brief.preserve.trim(),
    "只增加已指定的 VFX；不输出箭头、轮廓、编号、标注说明或任何界面元素。",
    "保持源镜头纵横比、摄像机、人物身份与姿态、场景几何和构图。",
    ...(isV2 && textLayers.length ? ["模型只生成干净 VFX 底图；精确文字由独立透明包装层确定性合成，不让模型重绘文字。"] : []),
  ].filter(Boolean);
  const manifest: VfxRequestManifest = isV2 ? {
    schemaVersion: "vfx-director-request/v2",
    requestId,
    createdAt: new Date().toISOString(),
    source: { path: sourcePath, fileName: session.sourceFileName, width: args.width, height: args.height },
    guides: { annotated: guidePath, influence: influencePath, protection: protectionPath, ...(textOverlayPath ? { textOverlay: textOverlayPath } : {}) },
    references: referenceRecords,
    targets,
    effectGroups,
    annotations: args.annotations,
    textLayers,
    renderPlan: args.renderPlan || buildRenderPlan(effectGroups, textLayers),
    brief: args.brief,
    constraints,
  } : {
    schemaVersion: "vfx-director-request/v1",
    requestId,
    createdAt: new Date().toISOString(),
    source: { path: sourcePath, fileName: session.sourceFileName, width: args.width, height: args.height },
    guides: { annotated: guidePath, influence: influencePath, protection: protectionPath },
    references: referenceRecords.map(({ groupIds: _groupIds, ...record }) => record),
    annotations: args.annotations,
    brief: args.brief,
    constraints,
  };
  const manifestPath = path.join(requestDir, "manifest.vfx-director.json");
  await atomicWriteJson(manifestPath, manifest);
  const briefLines = [
    "# VFX Director 请求",
    "",
    `- Request ID: ${requestId}`,
    `- 最终阶段: ${args.brief.renderStage}`,
    `- 特效说明: ${args.brief.effectDescription}`,
    `- 色彩: ${args.brief.palette || "沿用镜头色彩"}`,
    "",
    "## 必须保留",
    ...constraints.map((item) => `- ${item}`),
    "",
    "## 参考图职责",
    ...(referenceRecords.length ? referenceRecords.map((item) => `- ${item.index}. ${item.fileName}: ${item.roles.join(", ")}${item.groupIds.length ? `；绑定组 ${item.groupIds.join(", ")}` : "；全局"}`) : ["- 无"]),
    ...(isV2 ? [
      "",
      "## 特效组",
      ...effectGroups.map((group) => `- ${group.name}: ${group.effectDescription || "未填写"}`),
      "",
      "## 智能渲染计划",
      ...(manifest.schemaVersion === "vfx-director-request/v2" ? manifest.renderPlan.passes.map((pass, index) => `- ${index + 1}. ${pass.name}`) : []),
      "",
      `## 精确文字层：${textLayers.length} 个`,
    ] : []),
    "",
  ];
  await fs.writeFile(path.join(requestDir, "brief.md"), briefLines.join("\n"), { encoding: "utf8", flag: "wx" });
  return { requestId, manifestPath, requestDir, manifest };
}

export async function readVfxManifest(manifestPath: string): Promise<VfxRequestManifest> {
  const resolved = path.resolve(manifestPath);
  const manifest = JSON.parse(await fs.readFile(resolved, "utf8")) as VfxRequestManifest;
  if (manifest.schemaVersion !== "vfx-director-request/v1" && manifest.schemaVersion !== "vfx-director-request/v2") throw new Error("VFX 请求格式无效");
  await Promise.all([
    fs.access(manifest.source.path),
    fs.access(manifest.guides.annotated),
    fs.access(manifest.guides.influence),
    fs.access(manifest.guides.protection),
    ...(manifest.schemaVersion === "vfx-director-request/v2" && manifest.guides.textOverlay ? [fs.access(manifest.guides.textOverlay)] : []),
    ...manifest.references.map((reference) => fs.access(reference.path)),
  ]);
  return manifest;
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createVfxSession,
  readVfxManifest,
  saveVfxRequest,
} from "./storage.js";

const VERSION = "0.6.0";
const EDITOR_URI = "ui://tx-vfx-director/editor.html";
const here = path.dirname(fileURLToPath(import.meta.url));
const widgetHtml = readFileSync(path.resolve(here, "../web/index.html"), "utf8");
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const localWrite = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

function textResult(text: string, structuredContent?: Record<string, unknown>, meta?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

function createServer(): McpServer {
  const server = new McpServer({ name: "tx-vfx-director", version: VERSION });

  registerAppResource(
    server,
    "VFX Director 单图编辑器",
    EDITOR_URI,
    { mimeType: RESOURCE_MIME_TYPE, description: "多对象、分区、环形刀光、参考图绑定和精确文字包装的单图 VFX 编辑器" },
    async () => ({ contents: [{ uri: EDITOR_URI, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml }] }),
  );

  registerAppTool(
    server,
    "open_vfx_editor",
    {
      title: "打开踏星特效工作台",
      description: "打开单图 VFX 指令编辑器；可在启动时预载用户明确选择的源图，也可稍后在编辑器内选择或粘贴。",
      inputSchema: {
        imagePath: z.string().min(1).optional().describe("用户明确选择的源图片绝对路径；提供时在启动阶段创建稳定会话"),
        referenceImagePaths: z.array(z.string().min(1)).max(9).optional().describe("同一请求中的参考图片绝对路径"),
        workspaceRoot: z.string().optional().describe("当前 Codex 工作区绝对路径"),
        effectHint: z.string().optional().describe("用户同时给出的简短 VFX 意图"),
        initialTargets: z.array(z.object({
          id: z.string().min(1),
          name: z.string().min(1),
          kind: z.enum(["person", "weapon", "prop", "sky", "ground", "environment", "custom"]),
          color: z.string().min(1),
          description: z.string().optional(),
          bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
          confirmed: z.boolean().default(false),
          source: z.enum(["suggested", "manual"]).default("suggested"),
        })).max(24).optional().describe("Codex 根据源图识别后建议的镜头对象，交由用户确认"),
        initialEffectGroups: z.array(z.any()).max(16).optional().describe("Codex 建议的特效组；每组独立绑定对象、区域和效果"),
      },
      annotations: localWrite,
      _meta: { ui: { resourceUri: EDITOR_URI } },
    },
    async (args) => {
      const launch = {
        workspaceRoot: args.workspaceRoot || "",
        effectHint: args.effectHint?.trim() || "",
        initialTargets: args.initialTargets || [],
        initialEffectGroups: args.initialEffectGroups || [],
      };
      if (!args.imagePath) {
        return textResult(
          "VFX Director 已打开。请在编辑器中选择或粘贴一张源图。",
          { launch },
        );
      }
      const prepared = await createVfxSession({
        imagePath: args.imagePath,
        referenceImagePaths: args.referenceImagePaths,
        workspaceRoot: args.workspaceRoot,
        effectHint: args.effectHint,
      });
      return textResult(
        `VFX Director 已准备源图 ${prepared.session.sourceFileName}。请在编辑器中绘制并提交。`,
        { launch, session: prepared.session },
        {
          vfxDirector: {
            sourceDataUrl: prepared.sourceDataUrl,
            initialReferences: prepared.initialReferences,
          },
        },
      );
    },
  );

  registerAppTool(
    server,
    "save_vfx_request",
    {
      title: "保存 VFX 请求",
      description: "保存 v1/v2 VFX 请求；v2 包含对象、特效组、几何轨迹、精确文字层、分组参考图和智能渲染计划。",
      inputSchema: {
        sessionFile: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        brief: z.any(),
        annotations: z.array(z.any()),
        guideDataUrl: z.string().min(32),
        influenceDataUrl: z.string().min(32),
        protectionDataUrl: z.string().min(32),
        textOverlayDataUrl: z.string().min(32).optional(),
        references: z.array(z.any()).max(10),
        targets: z.array(z.any()).max(24).optional(),
        effectGroups: z.array(z.any()).max(16).optional(),
        textLayers: z.array(z.any()).max(24).optional(),
        renderPlan: z.any().optional(),
      },
      annotations: localWrite,
      _meta: { ui: {} },
    },
    async (args) => {
      const saved = await saveVfxRequest(args as Parameters<typeof saveVfxRequest>[0]);
      return textResult(
        `VFX 请求已保存：${saved.manifestPath}`,
        { requestId: saved.requestId, manifestPath: saved.manifestPath, requestDir: saved.requestDir },
      );
    },
  );

  registerAppTool(
    server,
    "get_vfx_request",
    {
      title: "读取 VFX 请求",
      description: "读取编辑器已提交的 VFX Director manifest，并验证所有本地输入文件仍然存在。",
      inputSchema: { manifestPath: z.string().min(1) },
      annotations: readOnly,
      _meta: { ui: {} },
    },
    async ({ manifestPath }) => {
      const manifest = await readVfxManifest(manifestPath);
      return textResult(
        `VFX 请求 ${manifest.requestId} 已验证：源图 ${manifest.source.path}，参考图 ${manifest.references.length} 张。`,
        { manifest },
      );
    },
  );

  return server;
}

const server = createServer();
await server.connect(new StdioServerTransport());

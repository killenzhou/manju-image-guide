#!/usr/bin/env node
// nl-mcp.mjs — 年轮AI stdio MCP server（零依赖，Node>=20）
// 挂法（Devin CLI）:
//   devin mcp add --transport stdio -- nianlun node F:/alienbrainWork/TX/AI/nl-workbench/nl-mcp.mjs
// Claude Code / Cursor mcpServers:
//   { "nianlun": { "type": "stdio", "command": "node", "args": ["F:/alienbrainWork/TX/AI/nl-workbench/nl-mcp.mjs"] } }
import { createInterface } from 'node:readline';
import { call, G, P, TASK_QUERY, normPath, NlAuthError } from './nl-core.mjs';

const TOOLS = [
  { name: 'nl_user', description: '验证 token 并返回当前登录用户信息（userId/enterpriseId/邮箱）', inputSchema: { type: 'object', properties: {} } },
  { name: 'nl_canvas_detail', description: '读取年轮画布完整内容（nodes/edges/viewport/canvasConfig）', inputSchema: { type: 'object', properties: { canvasId: { type: 'string' } }, required: ['canvasId'] } },
  { name: 'nl_canvas_save', description: '创建或更新画布。新建：{projectId, canvasName}（不带 id）。更新：{id, canvasName, sourceMaterials:{nodes,edges,viewport,canvasConfig}}', inputSchema: { type: 'object', properties: { payload: { type: 'object' } }, required: ['payload'] } },
  { name: 'nl_canvas_lock', description: '画布编辑锁 acquire/renew/release', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['acquire', 'renew', 'release'] }, canvasId: { type: 'string' } }, required: ['action', 'canvasId'] } },
  { name: 'nl_plugin_page', description: '工作流插件分页列表（含 latestVersionId）', inputSchema: { type: 'object', properties: { current: { type: 'number' }, size: { type: 'number' } } } },
  { name: 'nl_plugin_versions', description: '插件画布版本列表', inputSchema: { type: 'object', properties: { canvasId: { type: 'string' } }, required: ['canvasId'] } },
  { name: 'nl_plugin_version', description: '插件版本详情（含输入参数 schema）', inputSchema: { type: 'object', properties: { versionId: { type: 'string' } }, required: ['versionId'] } },
  { name: 'nl_run_submit', description: '提交工作流 run（扣积分！先 calculatePoints 预估）', inputSchema: { type: 'object', properties: { pluginVersionId: { type: 'string' }, userInputJson: { type: 'object' } }, required: ['pluginVersionId'] } },
  { name: 'nl_run_calc', description: '工作流 run 费用预估（不扣积分）', inputSchema: { type: 'object', properties: { pluginVersionId: { type: 'string' }, userInputJson: { type: 'object' } }, required: ['pluginVersionId'] } },
  { name: 'nl_run_query', description: '查询工作流 run 状态', inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] } },
  { name: 'nl_task_query', description: '查询 AIGC 任务状态（video/img/audio/text/lipsync/tool）', inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, kind: { type: 'string', enum: ['video', 'img', 'audio', 'text', 'lipsync', 'tool'] }, key: { type: 'string' } }, required: ['taskId'] } },
  { name: 'nl_gen_video', description: '提交文/图生视频任务（扣积分！）', inputSchema: { type: 'object', properties: { payload: { type: 'object' } }, required: ['payload'] } },
  { name: 'nl_gen_img', description: '提交生图任务（扣积分！）', inputSchema: { type: 'object', properties: { payload: { type: 'object' } }, required: ['payload'] } },
  { name: 'nl_video_points', description: '视频生成费用预估（不扣积分）', inputSchema: { type: 'object', properties: { payload: { type: 'object' } } } },
  { name: 'nl_queue', description: 'AIGC 生成队列', inputSchema: { type: 'object', properties: {} } },
  { name: 'nl_points', description: '年糕积分汇总/配额/订阅', inputSchema: { type: 'object', properties: {} } },
  { name: 'nl_assets', description: '任务产物资产列表', inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] } },
  { name: 'nl_models', description: '可用模型与参数清单', inputSchema: { type: 'object', properties: {} } },
  { name: 'nl_voices', description: '音色库列表', inputSchema: { type: 'object', properties: {} } },
  { name: 'nl_raw', description: '原始调用任意 /business-center 端点（兜底）', inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] }, path: { type: 'string' }, json: { type: 'object' } }, required: ['method', 'path'] } }
];

async function dispatch(name, a = {}) {
  switch (name) {
    case 'nl_user': return G('/user/user-info');
    case 'nl_canvas_detail': return G('/ai/project/manage/canvasDetail', { id: a.canvasId });
    case 'nl_canvas_save': return P('/ai/project/manage/saveOrUpdate', a.payload || {});
    case 'nl_canvas_lock': return P(`/ai/project/manage/canvas/lock/${a.action}`, { canvasId: a.canvasId });
    case 'nl_plugin_page': return G('/pluginCanvas/plugin/page', { current: a.current || 1, size: a.size || 20 });
    case 'nl_plugin_versions': return G(`/pluginCanvas/version/list/${a.canvasId}`);
    case 'nl_plugin_version': return G(`/pluginCanvas/version/${a.versionId}`);
    case 'nl_run_submit': return P('/pluginRun/submit', { pluginVersionId: a.pluginVersionId, userInputJson: a.userInputJson || {} });
    case 'nl_run_calc': return P('/pluginRun/calculatePoints', { pluginVersionId: a.pluginVersionId, userInputJson: a.userInputJson || {} });
    case 'nl_run_query': return G('/pluginRun/query', { runId: a.runId });
    case 'nl_task_query': { const k = a.kind || 'video'; return G(TASK_QUERY[k] || k, a.key ? { taskId: a.taskId, key: a.key } : { taskId: a.taskId }); }
    case 'nl_gen_video': return P('/aipc/generateVideo', a.payload || {});
    case 'nl_gen_img': return P('/aipc/generateImg', a.payload || {});
    case 'nl_video_points': return P('/aipc/calculateVideoPoints', a.payload || {});
    case 'nl_queue': return G('/aipc/generationQueue');
    case 'nl_points': return { summary: await G('/memberCommodity/points/summary'), quota: await G('/memberCommodity/quota/current'), subscription: await G('/memberCommodity/subscription/current') };
    case 'nl_assets': return G('/ai/asset/getListByTaskId', { id: a.taskId });
    case 'nl_models': return G('/aipc/query/modelAndParam');
    case 'nl_voices': return G('/ai/voice/voiceList');
    case 'nl_raw': return call(a.method, normPath(a.path), a.method === 'GET' || a.method === 'DELETE' ? undefined : (a.json || {}), a.method === 'GET' || a.method === 'DELETE' ? a.json : undefined);
    default: throw new Error(`unknown tool ${name}`);
  }
}

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const err = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'nianlun-ai', version: '0.1.0' }
    });
  }
  if (method === 'notifications/initialized' || method === 'initialized') return;
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const data = await dispatch(params?.name, params?.arguments);
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
    } catch (e) {
      return ok(id, { content: [{ type: 'text', text: `ERROR: ${e.message}` }], isError: true });
    }
  }
  if (id !== undefined) return err(id, -32601, `method not found: ${method}`);
});
process.on('uncaughtException', (e) => {
  if (e instanceof NlAuthError) return; // dispatch 已包成 isError
  console.error('[nl-mcp]', e.message);
});

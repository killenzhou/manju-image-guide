#!/usr/bin/env node
// nl.mjs — 年轮AI (nl.nianlunai.com) 画布/AIGC 平台 CLI，踏星项目专用
// 认证：自动读浏览器 Local Storage token（annual-ring-token），无需手配
// 用法：
//   node nl.mjs user                              验证 token + 用户信息
//   node nl.mjs raw GET <path> [params-json]      通用 GET（query）
//   node nl.mjs raw POST <path> [body-json]       通用 POST
//   node nl.mjs raw PUT|DELETE <path> [json]
//   node nl.mjs queue                             AIGC 生成队列
//   node nl.mjs task <taskId> [video|img|audio|text|lipsync|tool] [--wait]
//   node nl.mjs run-submit <pluginVersionId> '<userInputJson>' [--calc-only]
//   node nl.mjs run <runId> [--wait]              pluginRun 查询/等待
//   node nl.mjs run-retry <runId> | run-restart <runId> | run-continue <runId>
//   node nl.mjs canvas <canvasId>                 画布详情
//   node nl.mjs canvas-save '<json>'              saveOrUpdate（不带 id = 新建画布）
//   node nl.mjs canvas-lock acquire|renew|release <canvasId>
//   node nl.mjs plugin-page [page] [size]         插件画布列表
//   node nl.mjs plugin-versions <canvasId>        插件版本列表
//   node nl.mjs models                            可用模型与参数
//   node nl.mjs points                            积分余额/配额
//   node nl.mjs assets <taskId>                   任务产物资产
//   node nl.mjs gen-video '<json>'                原始 generateVideo 提交（需谨慎：计费）
//   node nl.mjs token <value>                     手写 token 兜底（正常不需要）
import { writeFileSync } from 'node:fs';
import { call, G, P, TASK_QUERY, normPath, needToken, TOKEN_FILE, NlAuthError } from './nl-core.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollTask(kind, taskId, key) {
  const path = TASK_QUERY[kind];
  for (let i = 0; ; i++) {
    const r = await G(path, key ? { taskId, key } : { taskId });
    const st = r?.data?.status ?? r?.data?.taskStatus ?? r?.data?.state;
    console.log(`[${i}] ${JSON.stringify(r?.data ?? r).slice(0, 300)}`);
    if (['SUCCESS', 'SUCCEEDED', 'success', 'COMPLETED', 'FAILED', 'failed', 'FAIL'].includes(st)) return r;
    await sleep(10000);
  }
}
async function pollRun(runId) {
  for (let i = 0; ; i++) {
    const r = await G('/pluginRun/query', { runId });
    const st = r?.data?.status ?? r?.data?.runStatus ?? r?.data?.state;
    console.log(`[${i}] ${JSON.stringify(r?.data ?? r).slice(0, 300)}`);
    if (['SUCCESS', 'SUCCEEDED', 'success', 'COMPLETED', 'FAILED', 'failed', 'PAUSED'].includes(st)) return r;
    await sleep(10000);
  }
}

const out = (d) => console.log(JSON.stringify(d, null, 2));
const args = process.argv.slice(2);
const cmd = args[0];
const WANT = args.includes('--wait');
const J = (s, fb = {}) => { try { return JSON.parse(s); } catch { return fb; } };

try {
  switch (cmd) {
    case 'token': {
      if (!args[1]) { console.error('用法: node nl.mjs token <值>'); process.exit(2); }
      writeFileSync(TOKEN_FILE, args[1].trim() + '\n');
      console.log('token 已写入', TOKEN_FILE);
      break;
    }
    case 'user': out(await G('/user/user-info')); break;
    case 'queue': out(await G('/aipc/generationQueue')); break;
    case 'models': out(await G('/aipc/query/modelAndParam')); break;
    case 'points': {
      out({
        summary: await G('/memberCommodity/points/summary'),
        quota: await G('/memberCommodity/quota/current'),
        subscription: await G('/memberCommodity/subscription/current')
      });
      break;
    }
    case 'points-history': out(await P('/pointsRecords/listPage', J(args[1], { page: 1, size: 20 }))); break;
    case 'assets': out(await G('/ai/asset/getListByTaskId', { id: args[1] })); break;
    case 'task': {
      const taskId = args[1]; const kind = args[2] && !args[2].startsWith('--') ? args[2] : 'video';
      if (!taskId) { console.error('用法: node nl.mjs task <taskId> [video|img|audio|text|lipsync|tool] [--wait]'); process.exit(2); }
      out(WANT ? await pollTask(kind, taskId) : await G(TASK_QUERY[kind] || kind, { taskId }));
      break;
    }
    case 'run-submit': {
      const ver = args[1]; const input = J(args[2], {});
      if (process.argv.includes('--calc-only')) { out(await P('/pluginRun/calculatePoints', { pluginVersionId: ver, userInputJson: input })); break; }
      out(await P('/pluginRun/submit', { pluginVersionId: ver, userInputJson: input }));
      break;
    }
    case 'run': out(WANT ? await pollRun(args[1]) : await G('/pluginRun/query', { runId: args[1] })); break;
    case 'run-retry': out(await P('/pluginRun/retryCurrent', { runId: args[1] })); break;
    case 'run-restart': out(await P('/pluginRun/restart', { runId: args[1] })); break;
    case 'run-continue': out(await P('/pluginRun/pause/continue', { runId: args[1] })); break;
    case 'canvas': out(await G('/ai/project/manage/canvasDetail', { id: args[1] })); break;
    case 'canvas-save': out(await P('/ai/project/manage/saveOrUpdate', J(args[1], {}))); break;
    case 'canvas-lock': out(await P(`/ai/project/manage/canvas/lock/${args[1]}`, { canvasId: args[2] })); break;
    case 'canvas-snapshot': out(await P('/ai/project/manage/snapshot', { canvasId: args[1] })); break;
    case 'plugin-page': out(await G('/pluginCanvas/plugin/page', { current: args[1] || 1, size: args[2] || 20 })); break;
    case 'plugin-versions': out(await G(`/pluginCanvas/version/list/${args[1]}`)); break;
    case 'plugin-version': out(await G(`/pluginCanvas/version/${args[1]}`)); break;
    case 'gen-video': out(await P('/aipc/generateVideo', J(args[1], {}))); break;
    case 'gen-img': out(await P('/aipc/generateImg', J(args[1], {}))); break;
    case 'gen-audio': out(await P('/aipc/generateAudio', J(args[1], {}))); break;
    case 'tool-submit': out(await P('/aipc/toolTask/submit', J(args[1], {}))); break;
    case 'video-points': out(await P('/aipc/calculateVideoPoints', J(args[1], {}))); break;
    case 'outline': out(await G('/ai/main/creativeOutline', args[1] ? J(args[1]) : undefined)); break;
    case 'voices': out(await G('/ai/voice/voiceList')); break;
    case 'raw': {
      const [m, p, j] = [args[1]?.toUpperCase(), args[2], args[3]];
      if (!m || !p) { console.error('用法: node nl.mjs raw <METHOD> <path> [json]'); process.exit(2); }
      out(await call(m, normPath(p), m === 'GET' || m === 'DELETE' ? undefined : J(j, {}), m === 'GET' || m === 'DELETE' ? J(j, undefined) : undefined));
      break;
    }
    default:
      console.log('年轮AI CLI — 命令列表见文件头部注释。最常用: user | queue | task | run | canvas | points | raw');
  }
} catch (e) {
  if (e instanceof NlAuthError) { console.error(e.message); process.exit(3); }
  throw e;
}

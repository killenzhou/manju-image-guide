// nl-core.mjs — 年轮AI API 核心：token 自动获取 + 请求封装
// token 优先级：NL_TOKEN env > 浏览器 Local Storage leveldb 扫描 > .nl-token 文件
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TOKEN_FILE = join(HERE, '.nl-token');
export const BASE = 'https://nl.nianlunai.com/business-center';

function browserLsDirs() {
  const L = process.env.LOCALAPPDATA, R = process.env.APPDATA;
  const dirs = [];
  const push = (d) => { try { if (existsSync(d)) dirs.push(d); } catch {} };
  const chromeUd = join(L, 'Google/Chrome/User Data');
  try {
    for (const p of readdirSync(chromeUd)) {
      if (p === 'Default' || /^Profile/.test(p)) push(join(chromeUd, p, 'Local Storage/leveldb'));
    }
  } catch {}
  push(join(L, 'Microsoft/Edge/User Data/Default/Local Storage/leveldb'));
  push(join(L, 'BraveSoftware/Brave-Browser/User Data/Default/Local Storage/leveldb'));
  push(join(L, '360Chrome/Chrome/User Data/Default/Local Storage/leveldb'));
  try {
    const part = join(R, 'Antigravity/Partitions');
    for (const p of readdirSync(part)) push(join(part, p, 'Local Storage/leveldb'));
  } catch {}
  return dirs;
}

function scanTokenInFile(file) {
  let buf; try { buf = readFileSync(file); } catch { return null; }
  const needle = Buffer.from('nl.nianlunai.com\x00\x01token', 'latin1');
  let idx = -1, last = -1;
  while ((idx = buf.indexOf(needle, idx + 1)) > -1) last = idx;
  if (last < 0) return null;
  const tail = buf.slice(last + needle.length, last + needle.length + 48);
  const m = tail.toString('latin1').match(/^.?\x01?([0-9a-fA-F-]{32,})/);
  return m ? m[1] : null;
}

let _scanCache = undefined;
export function scanBrowserToken(refresh = false) {
  if (_scanCache !== undefined && !refresh) return _scanCache;
  for (const d of browserLsDirs()) {
    let files = [];
    try {
      files = readdirSync(d).filter((f) => /\.(log|ldb)$/.test(f))
        .map((f) => join(d, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    } catch { continue; }
    for (const f of files) {
      const t = scanTokenInFile(f);
      if (t) { _scanCache = t; return t; }
    }
  }
  _scanCache = null;
  return null;
}

export function fileToken() {
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf8').trim();
  return null;
}
export function writeToken(t) {
  writeFileSync(TOKEN_FILE, t.trim() + '\n');
}
export function getToken() {
  if (process.env.NL_TOKEN) return process.env.NL_TOKEN.trim();
  const s = scanBrowserToken();
  if (s) {
    if (s !== fileToken()) { try { writeToken(s); } catch {} }
    return s;
  }
  return fileToken();
}
export class NlAuthError extends Error {}
export function needToken() {
  const t = getToken();
  if (!t) throw new NlAuthError('无 token：请在本机浏览器登录 nl.nianlunai.com（自动读取），或 NL_TOKEN/.nl-token 提供');
  return t;
}

export async function call(method, path, body, params, _retried = false) {
  const token = needToken();
  let url = BASE + path;
  if (params && Object.keys(params).length) {
    url += '?' + new URLSearchParams(params).toString();
  }
  const res = await fetch(url, {
    method,
    headers: {
      'annual-ring-token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: 'https://nl.nianlunai.com',
      Referer: 'https://nl.nianlunai.com/home',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
    },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body ?? {})
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (data?.code === 401 && !_retried) {
    const fresh = scanBrowserToken(true);
    if (fresh && fresh !== token) {
      try { writeToken(fresh); } catch {}
      return call(method, path, body, params, true);
    }
    throw new NlAuthError('TOKEN 失效：请在浏览器重新登录 nl.nianlunai.com 后重试');
  }
  return data;
}
export const G = (p, params) => call('GET', p, null, params);
export const P = (p, b) => call('POST', p, b);

export const TASK_QUERY = {
  video: '/aipc/query/queryVideoTask',
  img: '/aipc/query/queryImgTask',
  audio: '/aipc/query/queryAudioTask',
  text: '/aipc/query/queryTextTask',
  lipsync: '/aipc/query/queryLipSyncVideoTask',
  tool: '/aipc/toolTask/query'
};
export const normPath = (p) => {
  if (!p) return p;
  const m = String(p).match(/^[A-Za-z]:\/.*\/Git\/(.*)$/);
  if (m) return '/' + m[1];
  return p.startsWith('/') ? p : '/' + p;
};

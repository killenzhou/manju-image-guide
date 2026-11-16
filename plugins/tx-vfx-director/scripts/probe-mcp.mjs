import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = process.env.VFX_DIRECTOR_PROBE_ROOT
  ? path.resolve(process.env.VFX_DIRECTOR_PROBE_ROOT)
  : scriptRoot;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "dist/server/index.mjs")],
  cwd: root,
  stderr: "pipe",
});
const client = new Client({ name: "vfx-director-probe", version: "0.1.0" });
const probeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vfx-director-probe-"));

try {
  const sourcePath = path.join(probeRoot, "source.png");
  await fs.writeFile(
    sourcePath,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  );
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ["get_vfx_request", "open_vfx_editor", "save_vfx_request"],
  );
  const opened = await client.callTool({ name: "open_vfx_editor", arguments: {} });
  assert.match(JSON.stringify(opened), /选择或粘贴一张源图/);
  const preloaded = await client.callTool({
    name: "open_vfx_editor",
    arguments: { imagePath: sourcePath, workspaceRoot: probeRoot, effectHint: "测试辉光" },
  });
  assert.match(JSON.stringify(preloaded), /已准备源图 source\.png/);
  assert.match(JSON.stringify(preloaded), /sourceDataUrl/);
  assert.match(JSON.stringify(preloaded), /测试辉光/);
  const resource = await client.readResource({ uri: "ui://tx-vfx-director/editor.html" });
  const html = resource.contents[0];
  assert.equal(html.mimeType, "text/html;profile=mcp-app");
  assert.match("text" in html ? html.text : "", /踏星 · 特效工作台/);
  process.stdout.write("MCP probe passed: editor resource and attached-image launch available.\n");
} finally {
  await client.close();
  await fs.rm(probeRoot, { recursive: true, force: true });
}

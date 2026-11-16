import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright-core";

const root=process.cwd(),out=path.join(root,"verification/direct-draft"),fixture=path.join(root,"verification/frames/EP001-65s.jpg");
await fs.mkdir(out,{recursive:true});
const current=await fs.readFile(path.join(root,"dist/web/index.html"));
const previous=await fs.readFile(path.join(root,"verification/direct-draft-baseline/dist/web/index.html"));
const bareHarness=await fs.readFile(path.join(root,"web/host-harness.html"),"utf8");
const harness=(mode,baseline)=>bareHarness
  .replace('src="/index.html"',baseline?'src="/baseline.html"':'src="/index.html"')
  .replace("const iframe =",`const wireMode=${JSON.stringify(mode)}; let rejectFirst=wireMode==="reject"; const iframe =`)
  .replace("updateModelContext: { text: {}, image: {} },",'...(wireMode==="message"?{}:{updateModelContext:{text:{},image:{}}}),')
  .replace('window.__vfxHostState.message = message.params;\n          send({ jsonrpc: "2.0", id: message.id, result: {} });',
    'window.__vfxHostState.message = message.params; const rejected=rejectFirst; rejectFirst=false; send({jsonrpc:"2.0",id:message.id,result:rejected?{isError:true}:{}});')
  .replace('send({ jsonrpc: "2.0", id: message.id, result: { mode: "fullscreen" } });',
    'window.__vfxHostState.lastDisplayMode=message.params?.mode; send({jsonrpc:"2.0",id:message.id,result:{mode:message.params?.mode||"inline"}});');
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,"http://127.0.0.1");
  res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
  res.end(u.pathname==="/host"?harness(u.searchParams.get("mode"),u.searchParams.has("baseline")):u.pathname==="/baseline.html"?previous:current);
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({executablePath:process.env.TX_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
const page=await browser.newPage({viewport:{width:1470,height:900},acceptDownloads:true});
const errors=[],downloads=[];
page.on("pageerror",e=>errors.push(e.message));page.on("download",d=>downloads.push(d.suggestedFilename()));
const btn=(scope,name)=>scope.getByRole("button",{name,exact:true});
const shots=(scope)=>scope.locator(".fxd-bottom [role=status]");
async function init(params=""){
  await page.goto("http://127.0.0.1:"+server.address().port+"/host"+params);
  const frame=page.frameLocator("iframe");
  await frame.locator(".source-picker-button input").setInputFiles(fixture);
  await btn(frame,"手绘草稿").click();
  await frame.getByRole("heading",{name:"手绘草稿"}).waitFor();
  return frame;
}
async function draw(scope,points){
  const b=await scope.getByLabel("手绘特效画布").boundingBox();
  assert.ok(b);
  const pos=([x,y])=>[b.x+b.width*x,b.y+b.height*y];
  await page.mouse.move(...pos(points[0]));await page.mouse.down();
  for(const p of points.slice(1))await page.mouse.move(...pos(p),{steps:8});
  await page.mouse.up();
}
const state=()=>page.evaluate(()=>window.__vfxHostState);
async function expectSent(frame){await shots(frame).filter({hasText:"已发送到 Codex，等待对话出图"}).waitFor({timeout:8000});}
async function saveContext(state,label){
  const context=state.context??state.message;
  const blocks=context.content.filter(i=>i.type==="image");
  assert.equal(blocks.length,5);
  assert.deepEqual(Buffer.from(blocks[0].data,"base64"),await fs.readFile(fixture));
  const request=context.structuredContent?.vfxDirectorInlineRequest??JSON.parse(context.content[0].text.split("\n")[1]);
  assert.equal(request.mode,"hand-draft-refine");
  assert.equal(request.guides.draftAlphaImageNumber,5);
  assert.equal(request.guides.exactTextOverlayImageNumber,undefined);
  assert.deepEqual(request.textLayers,[]);
  for(let i=1;i<blocks.length;i++)await fs.writeFile(path.join(out,`${label}-${i+1}.png`),Buffer.from(blocks[i].data,"base64"));
  await fs.writeFile(path.join(out,label+"-request.json"),JSON.stringify(request,null,2));
  return request;
}
try{
  let frame=await init("?baseline");
  assert.equal(await btn(frame,"直接出图").count(),0);
  assert.ok(await btn(frame,"导出透明 PNG").isVisible());
  console.log("Baseline 0.5.0: hand-draft footer only exports; no direct send control.");

  frame=await init();
  assert.equal(await btn(frame,"直接出图").isEnabled(),false);
  await draw(frame,[[.24,.50],[.41,.50],[.62,.50],[.76,.50]]);
  await btn(frame,"遮挡笔").click();
  await draw(frame,[[.48,.39],[.48,.50],[.48,.61]]);
  await btn(frame,"能量带").click();
  await draw(frame,[[.39,.50],[.48,.50],[.57,.50]]);
  await btn(frame,"直接出图").click();await expectSent(frame);
  const behind=await saveContext(await state(),"behind");
  assert.equal(behind.draft.visibleLayers.length,2);
  assert.equal(behind.draft.hasProtection,true);
  await frame.getByText("透视深度 · Z",{exact:true}).click();
  await frame.getByRole("checkbox",{name:"放在遮挡层之前"}).check();
  await btn(frame,"直接出图").click();await expectSent(frame);
  await page.waitForFunction(()=>window.__vfxHostState.lastDisplayMode==="inline");
  const sent=await state(),front=await saveContext(sent,"front");
  assert.equal(front.draft.visibleLayers[1].depth.front,true);
  assert.equal(sent.methods.filter(x=>x==="ui/update-model-context").length,2);
  assert.equal(sent.methods.filter(x=>x==="ui/message").length,2);
  assert.match(sent.message.content[0].text,/当前对话展示生成结果/);
  assert.match(sent.message.content[0].text,new RegExp(front.requestId));
  assert.equal(await frame.locator(".fxd-row").count(),3);
  await page.screenshot({path:path.join(out,"sent-state.png")});
  console.log("Hosted hand-draft: one click sent original + four guides, requested Codex inline, preserved all editable strokes, and triggered zero downloads.");

  frame=await init("?mode=message");
  await draw(frame,[[.20,.45],[.55,.49]]);
  await btn(frame,"直接出图").click();await expectSent(frame);
  const messageOnly=await state();
  assert.equal(messageOnly.methods.filter(x=>x==="ui/update-model-context").length,0);
  assert.equal(messageOnly.methods.filter(x=>x==="ui/message").length,1);
  await saveContext(messageOnly,"message-only");
  console.log("Image-message-only host: full draft request sent as one image message.");

  frame=await init("?mode=reject");
  await draw(frame,[[.30,.57],[.65,.52]]);
  await btn(frame,"直接出图").click();
  await shots(frame).filter({hasText:"未接收这次请求"}).waitFor();
  assert.ok(await btn(frame,"直接出图").isEnabled());
  assert.equal(await frame.locator(".fxd-row").count(),1);
  await btn(frame,"直接出图").click();await expectSent(frame);
  console.log("Rejected host response: kept the draft, reported the error and enabled a successful retry.");

  await page.goto(pathToFileURL(path.join(root,"dist/web/index.html")).href+"?paint");
  await page.locator(".source-picker-button input").setInputFiles(fixture);
  await page.getByRole("heading",{name:"手绘草稿"}).waitFor();
  await draw(page,[[.35,.45],[.55,.52]]);
  await btn(page,"直接出图").click();
  await shots(page).filter({hasText:"这个页面是独立预览"}).waitFor();
  assert.deepEqual(downloads,[]);
  assert.deepEqual(errors,[]);
  console.log("Standalone preview: no attempted host handoff and no file exported; tells user to open the embedded Codex workbench.");
}finally{
 await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}


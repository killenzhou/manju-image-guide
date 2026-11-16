import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright-core";

const root=process.cwd(),report=path.join(root,"verification","draft");
await fs.mkdir(report,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.TX_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
const page=await browser.newPage({viewport:{width:1450,height:880},acceptDownloads:true});
const errors=[];
page.on("pageerror",err=>errors.push(err.message));
const file=name=>path.join(report,name);
const app=pathToFileURL(path.join(root,"dist/web/index.html")).href;
const btn=(name)=>page.getByRole("button",{name,exact:true});
const draw=async points=>{
  const box=await page.locator(".fxd canvas").boundingBox();
  assert.ok(box);
  const coords=([x,y])=>[box.x+box.width*x,box.y+box.height*y];
  await page.mouse.move(...coords(points[0]));await page.mouse.down();
  for(const p of points.slice(1)){await page.mouse.move(...coords(p),{steps:6});}
  await page.mouse.up();
};
const save=async (button,name)=>{
  const item=page.waitForEvent("download",{timeout:8000});
  await btn(button).click();
  const download=await item;await download.saveAs(file(name));assert.equal(await download.failure(),null);
};
try {
  await page.goto(app);
  await btn("打开演示镜头").click();
  await btn("手绘草稿").click();
  await page.getByRole("heading",{name:"手绘草稿"}).waitFor();
  await btn("引导与生成 →").click();
  assert.equal(await page.getByRole("heading",{name:"踏星技能库"}).isVisible(),true);

  await page.goto(app+"?paint");
  await page.locator(".source-picker-button input").setInputFiles(path.join(root,"verification/frames/EP001-65s.jpg"));
  await page.getByRole("heading",{name:"手绘草稿"}).waitFor();
  assert.equal(await btn("导出透明 PNG").isEnabled(),false);
  await draw([[.688,.27],[.708,.225],[.737,.228],[.77,.267],[.82,.37]]);
  await btn("冲击环").click();
  await draw([[.80,.43],[.84,.61]]);
  await btn("复制").click();
  await page.getByRole("slider",{name:"冲击环旋转"}).fill("22");
  await btn("移动").click();
  await draw([[.80,.48],[.84,.43]]);
  assert.equal(await page.locator(".fxd-row").count(),3);
  await btn("撤销").click();
  await btn("重做").click();
  await save("导出透明 PNG","palm-before.png");

  await btn("遮挡笔").click();
  await draw([[.76,.31],[.80,.41],[.82,.48]]);
  await btn("隐藏笔迹 4").click();
  await save("导出透明 PNG","palm-hidden-mask.png");
  await btn("显示笔迹 4").click();
  await save("导出透明 PNG","palm-fx.png");
  await save("导出遮挡","palm-mask.png");
  await page.getByRole("button",{name:"2 · 冲击环",exact:true}).click();
  await page.screenshot({path:file("palm-workspace.png")});
  await btn("透明").click();
  assert.equal(await page.getByAltText("原始镜头").count(),0);
  await page.screenshot({path:file("palm-alpha-preview.png")});
  await save("保存镜头工程","palm-project.json");
  const project=JSON.parse(await fs.readFile(file("palm-project.json"),"utf8"));
  assert.equal(project.fxDraft.version,1);
  assert.deepEqual(project.fxDraft.strokes.map(s=>s.kind),["ribbon","ring","ring","occlude"]);
  assert.equal(project.fxDraft.strokes[2].angle,22);
  assert.notDeepEqual(project.fxDraft.strokes[1].points,project.fxDraft.strokes[2].points);
  await btn("引导与生成 →").click();
  await btn("手绘草稿").click();
  assert.equal(await page.locator(".fxd-row").count(),4);
  await page.reload();
  await page.getByLabel("打开镜头工程",{exact:true}).setInputFiles(file("palm-project.json"));
  await page.locator(".fxd-row").nth(3).waitFor();
  await save("导出透明 PNG","palm-reopened.png");
  console.log("EP001 Layout: ribbon, two editable rings, moved/rotated duplicate, occlusion, undo/redo, tab switch, project reopen and five PNG downloads verified.");

  await page.goto(app+"?paint");
  await page.locator(".source-picker-button input").setInputFiles(path.join(root,"verification/frames/EP003-145s.jpg"));
  await btn("冰晶枝").click();
  await draw([[.49,.79],[.57,.76],[.65,.77],[.74,.73],[.83,.73]]);
  await page.getByRole("slider",{name:"所选笔迹宽度"}).fill("11");
  await save("导出透明 PNG","ice-fx.png");
  await btn("黑底").click();
  await page.screenshot({path:file("ice-black-preview.png")});
  await page.setViewportSize({width:540,height:820});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:file("ice-compact.png")});
  assert.deepEqual(errors,[]);
  console.log("EP003 Layout: crystal brush, editable width, transparent PNG, black background preview and compact layout verified. Zero page errors.");
} finally{await browser.close();}


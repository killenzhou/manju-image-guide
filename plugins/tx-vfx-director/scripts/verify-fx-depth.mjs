import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright-core";
const root=process.cwd(),out=path.join(root,"verification/depth");
await fs.mkdir(path.join(out,"thumbnails"),{recursive:true});
const browser=await chromium.launch({executablePath:process.env.TX_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
const page=await browser.newPage({viewport:{width:1500,height:960},acceptDownloads:true});
const errors=[];page.on("pageerror",err=>errors.push(err.message));
const btn=name=>page.getByRole("button",{name,exact:true});
const app=pathToFileURL(path.join(root,"dist/web/index.html")).href+"?paint";
const fixture=path.join(root,"verification/frames/EP001-65s.jpg");
const canvas=page.getByLabel("手绘特效画布");
const depth=page.locator(".fxd-properties").getByText("透视深度 · Z",{exact:true});
const abs=async([x,y])=>{const b=await canvas.boundingBox();assert.ok(b);return [b.x+b.width*x,b.y+b.height*y];};
async function draw(points){await page.mouse.move(...await abs(points[0]));await page.mouse.down();for(const p of points.slice(1))await page.mouse.move(...await abs(p),{steps:5});await page.mouse.up();}
async function save(button,name){const waiting=page.waitForEvent("download",{timeout:8000});await btn(button).click();const d=await waiting;await d.saveAs(path.join(out,name));assert.equal(await d.failure(),null);}
async function project(name){await save("保存镜头工程",name);return JSON.parse(await fs.readFile(path.join(out,name),"utf8")).fxDraft;}
async function sampleLooks(group,count){
 const items=page.locator(".fxd-look-grid button");
 assert.equal(await items.count(),count);
 const data=await items.evaluateAll(cards=>cards.map(card=>({id:card.dataset.look,title:card.textContent,data:card.querySelector("canvas").toDataURL("image/png").split(",")[1]})));
 await Promise.all(data.map(item=>fs.writeFile(path.join(out,"thumbnails",item.id+".png"),Buffer.from(item.data,"base64"))));
 return data.map(({id,title})=>({group,id,title}));
}
try{
 await page.goto(app);
 await page.locator(".source-picker-button input").setInputFiles(fixture);
 await page.getByRole("heading",{name:"手绘草稿"}).waitFor();
 await btn("展开造型库 · 通用 20 / 踏星 10").click();
 const looks=await sampleLooks("通用",20);
 await btn("踏星 10").click();
 looks.push(...await sampleLooks("踏星",10));
 await fs.writeFile(path.join(out,"thumbnails.json"),JSON.stringify(looks,null,2));
 await page.getByLabel("搜索特效造型").fill("白雪");
 assert.equal(await page.locator(".fxd-look-grid button").count(),1);
 assert.match(await page.locator(".fxd-look-grid button").innerText(),/寒冰天赋/);
 await btn("通用 20").click();await page.locator('[data-look="silk"]').click();
 await draw([[.23,.53],[.35,.53],[.44,.53],[.53,.53],[.66,.53]]);
 await btn("编辑曲线").click();
 const before=await project("01-curve-base.json");
 assert.ok(before.strokes[0].curve.length>=4);
 await page.mouse.dblclick(...await abs([.375,.53]));
 const added=await project("02-curve-insert.json");
 assert.equal(added.strokes[0].curve.length,before.strokes[0].curve.length+1);
 const first=added.strokes[0].curve[0];
 await draw([[first.x,first.y],[first.x+.012,first.y-.064]]);
 const anchor=await project("03-curve-anchor.json");
 assert.ok(anchor.strokes[0].curve[0].y<first.y-.04);
 const handle=anchor.strokes[0].curve[0].out;
 await draw([[handle.x,handle.y],[handle.x+.025,handle.y-.12]]);
 const curve=await project("04-curve-handle.json");
 assert.ok(curve.strokes[0].curve[0].out.y<handle.y-.08);
 assert.equal(curve.strokes[0].curve[0].y,anchor.strokes[0].curve[0].y);
 await page.screenshot({path:path.join(out,"curve-editor.png")});
 await btn("删除锚点").click();
 const reduced=await project("05-curve-delete.json");
 assert.equal(reduced.strokes[0].curve.length,curve.strokes[0].curve.length-1);
 await page.locator('[data-look="blade"]').click();await btn("替换所选层造型").click();
 const replaced=await project("06-replaced.json");
 assert.deepEqual(replaced.strokes[0].curve,reduced.strokes[0].curve);
 assert.equal(replaced.strokes[0].preset,"blade");
 await save("导出透明 PNG","flat.png");
 await depth.click();await page.getByRole("slider",{name:"起点 Z",exact:true}).fill("-34");await page.getByRole("slider",{name:"终点 Z",exact:true}).fill("74");
 await btn("设置消失点").click();await canvas.click({position:{x:(await canvas.boundingBox()).width*.61,y:(await canvas.boundingBox()).height*.43}});
 await page.getByRole("slider",{name:"整层缩放",exact:true}).fill("145");await page.getByRole("slider",{name:"整层旋转",exact:true}).fill("-24");
 await btn("移动整层").click();await draw([[.39,.51],[.49,.45]]);
 const spatial=await project("07-depth-transform.json");
 assert.equal(spatial.strokes[0].depth.to,74);
 assert.equal(spatial.strokes[0].transform.scale,145);assert.equal(spatial.strokes[0].transform.rotate,-24);
 assert.ok(spatial.strokes[0].points[0].x>replaced.strokes[0].points[0].x+.07);
 assert.ok(Math.abs(spatial.vanish.x-.61)<.03);
 await save("导出透明 PNG","spatial.png");
 console.log("Bezier insert, anchor drag, independent tangent drag, delete, form swap preserving curve, and whole-layer XYZ placement verified.");

 await btn("踏星 10").click();await page.locator('[data-look="tx-wave-double"]').click();
 await draw([[.76,.47],[.81,.60]]);
 const ringDepth=page.locator(".fxd-properties").getByText("透视深度 · Z",{exact:true});
 const pitch=page.getByRole("slider",{name:"环面俯仰",exact:true});if(!await pitch.isVisible())await ringDepth.click();
 await pitch.fill("51");await page.getByRole("slider",{name:"环面偏转",exact:true}).fill("-23");
 await page.getByLabel("放在遮挡层之前").check();
 await btn("收起造型库").click();
 await btn("黑底").click();await page.screenshot({path:path.join(out,"depth-preview.png")});
 await save("导出透明 PNG","depth-final.png");
 const final=await project("08-project.json");
 assert.equal(final.strokes[1].preset,"tx-wave-double");assert.equal(final.strokes[1].depth.tilt,51);assert.equal(final.strokes[1].depth.front,true);
 await page.reload();
 await page.getByLabel("打开镜头工程",{exact:true}).setInputFiles(path.join(out,"08-project.json"));
 await page.locator(".fxd-row").nth(1).waitFor();
 await save("导出透明 PNG","depth-reopened.png");
 assert.deepEqual(errors,[]);
 console.log("30 actual brush thumbnails captured; TX recipe, tilted ring, front occlusion override, transparent export and project reload passed with zero browser page errors.");
}finally{await browser.close();}


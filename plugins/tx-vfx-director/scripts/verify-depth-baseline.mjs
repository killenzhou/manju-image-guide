import {chromium} from "playwright-core";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import path from "node:path";
const browser=await chromium.launch({executablePath:process.env.TX_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
try{
 const page=await browser.newPage();
 await page.goto(pathToFileURL(path.resolve("verification/depth-baseline/dist/web/index.html")).href);
 await page.getByRole("button",{name:"用演示镜头试笔刷",exact:true}).click();
 await page.getByRole("heading",{name:"手绘草稿"}).waitFor();
 assert.equal(await page.getByRole("button",{name:/造型库/}).count(),0);
 assert.ok(await page.getByRole("button",{name:"能量带",exact:true}).isVisible());
 console.log("Baseline 0.4.0 opens existing canvas and original brush controls, with no 0.5.0 library.");
}finally{await browser.close();}


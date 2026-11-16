import {chromium} from "playwright-core";
import {pathToFileURL} from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const browser=await chromium.launch({executablePath:process.env.TX_CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
try{
  const page=await browser.newPage();
  await page.goto(pathToFileURL(path.resolve("verification/draft-baseline/dist/web/index.html")).href);
  await page.getByRole("button",{name:"打开演示镜头",exact:true}).click();
  await page.getByRole("heading",{name:"踏星技能库"}).waitFor();
  assert.equal(await page.getByRole("button",{name:"手绘草稿",exact:true}).count(),0);
  assert.ok(await page.getByRole("button",{name:"导出出图包",exact:true}).isVisible());
  console.log("Baseline 0.3.0: guide workflow still opens, no visible-brush workspace.");
}finally{await browser.close();}


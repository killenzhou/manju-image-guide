import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
const original = process.argv[2];
assert.ok(original);
const browser=await chromium.launch({headless:true,executablePath:process.env.TX_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe"});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto(pathToFileURL(original).href+"?demo");
  await page.getByRole("heading",{name:"镜头对象"}).waitFor();
  assert.ok(await page.getByRole("heading",{name:"特效组",exact:true}).isVisible());
  assert.equal(await page.getByRole("heading",{name:"踏星技能库"}).count(),0);
  console.log("Baseline: original VFX Director still opens with object/group panels, no TX pilot UI.");
} finally { await browser.close(); }


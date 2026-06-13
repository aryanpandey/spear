// Capture dashboard screenshots with Playwright + the system Chrome.
// Env: BASE (dashboard URL), OUT (output dir).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.env.BASE || "http://127.0.0.1:4399";
const out = process.env.OUT || "docs/screenshots";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1800, height: 950 }, deviceScaleFactor: 2 });

// SSE keeps the connection open, so don't wait for networkidle.
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".narrative", { timeout: 15000 });
await page.waitForTimeout(1500); // let the digital rain paint a frame
await page.screenshot({ path: `${out}/today.png` });
console.log(`wrote ${out}/today.png`);

await page.click('button.tab:has-text("Board")');
await page.waitForSelector(".board .column");
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/board.png` });
console.log(`wrote ${out}/board.png`);

await browser.close();

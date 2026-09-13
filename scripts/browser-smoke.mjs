import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = path.join(root, "test-results");
fs.mkdirSync(results, { recursive: true });

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const contentTypes = { ".html": "text/html; charset=utf-8", ".png": "image/png" };
  response.writeHead(200, { "Content-Type": contentTypes[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(filename).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const browserPaths = process.platform === "win32"
  ? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const executablePath = browserPaths.find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error("Chrome or Chromium is required");

const browser = await chromium.launch({ executablePath, headless: true });
const base = `http://127.0.0.1:${server.address().port}`;
const errors = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const monitor = (page) => {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (entry) => { if (entry.type() === "error") errors.push(entry.text()); });
};

try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  monitor(desktop);
  await desktop.goto(`${base}/index.html#demo`, { waitUntil: "load" });
  await desktop.waitForFunction(() => window.__batyrGame.spriteReady);
  const desktopStage = await desktop.locator("#stage").boundingBox();
  assert(desktopStage && desktopStage.width / desktopStage.height > 2.9, "Desktop stage must keep its wide layout");
  assert(!(await desktop.locator("#touchControls").isVisible()), "Touch controls must stay hidden on desktop");
  assert((await desktop.evaluate(() => window.__batyrGame.viewport)).width === 900, "Desktop logical viewport must be 900 pixels wide");
  await desktop.screenshot({ path: path.join(results, "desktop.png") });
  await desktop.close();

  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const phone = await phoneContext.newPage();
  monitor(phone);
  await phone.goto(`${base}/index.html`, { waitUntil: "load" });
  await phone.waitForFunction(() => window.__batyrGame.spriteReady);
  const stage = await phone.locator("#stage").boundingBox();
  const jump = await phone.locator("#btnJump").boundingBox();
  const duck = await phone.locator("#btnDuck").boundingBox();
  assert(stage && stage.height >= 400 && stage.width <= 390, "Portrait game field must be large enough to play");
  assert(jump && duck && jump.height >= 70 && duck.height >= 70, "Touch buttons must be finger-sized");
  assert((await phone.evaluate(() => window.__batyrGame.viewport)).width === 480, "Portrait mode must use its mobile viewport");
  assert((await phone.evaluate(() => window.__batyrGame.viewport)).height === 540, "Portrait mode must use its tall mobile viewport");
  await phone.locator("#btnJump").tap();
  assert(await phone.evaluate(() => window.__batyrGame.rider.jumping), "Jump button must start the run and jump");
  await phone.locator("#btnPause").tap();
  assert((await phone.evaluate(() => window.__batyrGame.state)) === "pause", "Pause button must pause the game");
  await phone.locator("#btnContinue").tap();
  assert((await phone.evaluate(() => window.__batyrGame.state)) === "run", "Continue button must resume the game");
  await phone.mouse.move(duck.x + duck.width / 2, duck.y + duck.height / 2);
  await phone.mouse.down();
  assert(await phone.evaluate(() => window.__batyrGame.rider.ducking), "Duck button must remain active while held");
  await phone.mouse.up();
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: path.join(results, "phone-portrait.png") });
  await phoneContext.close();

  const landscapeContext = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const landscape = await landscapeContext.newPage();
  monitor(landscape);
  await landscape.goto(`${base}/index.html#demo`, { waitUntil: "load" });
  await landscape.waitForFunction(() => window.__batyrGame.spriteReady);
  const landscapeStage = await landscape.locator("#stage").boundingBox();
  const landscapeControls = await landscape.locator("#touchControls").boundingBox();
  assert(landscapeStage && landscapeControls, "Landscape controls must be visible");
  assert(landscapeStage.x + landscapeStage.width <= landscapeControls.x + 1, "Landscape controls must not cover the game field");
  assert(landscapeStage.height <= 374, "Landscape game field must fit inside the viewport");
  assert((await landscape.evaluate(() => window.__batyrGame.viewport)).width === 720, "Landscape mode must use its mobile viewport");
  await landscape.screenshot({ path: path.join(results, "phone-landscape.png") });
  await landscapeContext.close();

  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);
  console.log("Browser smoke OK: desktop, portrait phone, landscape phone, jump, duck and pause.");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

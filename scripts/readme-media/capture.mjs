// Screenshots and frames for the README. Saves PNGs to $OUT/readme/ and GIF frames to
// $OUT/frames/<name>/NNNN.png with a frames.json of durations. See README.md in this
// folder.
//
//   BASE=http://localhost:3051 DEMO_PASSWORD=… OUT=/tmp/orgtable-media \
//   CHROME=/path/to/browser node capture.mjs
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3051";
const pw = process.env.DEMO_PASSWORD;
if (!pw) throw new Error("DEMO_PASSWORD is missing (the same one used for seed-demo.mjs)");
const HERE = (process.env.OUT ?? "/tmp/orgtable-media").replace(/\/?$/, "/");
mkdirSync(HERE + "readme", { recursive: true });

// Any Chromium (Chrome, Brave, Edge…). Without CHROME, the one Playwright installs.
const browser = await chromium.launch(
  process.env.CHROME ? { executablePath: process.env.CHROME } : {},
);

async function open({ width = 1280, height = 800, dark = false, user = "lucia@example.com" } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: dark ? "dark" : "light",
    // English UI: the users have no saved language, so the browser's locale decides.
    locale: "en-US",
    timezoneId: "Atlantic/Canary",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", user);
  await page.fill("#password", pw);
  await Promise.all([page.waitForURL("**/boards"), page.click("button[type=submit]")]);
  return { ctx, page };
}

// Boards live at /<workspace>/<board> (docs/workspaces.md).
const isBoardPath = (url) => /^\/[a-z0-9-]+\/[a-z0-9-]+$/.test(new URL(url).pathname);

async function gotoBoard(page, title) {
  await page.goto(`${BASE}/boards`);
  await Promise.all([
    page.waitForURL(isBoardPath),
    page.getByRole("link", { name: new RegExp(`^${title}`) }).first().click(),
  ]);
  await page.waitForTimeout(800);
}

const shot = (page, name, opts = {}) =>
  page.screenshot({ path: `${HERE}readme/${name}.png`, ...opts });

/** Records frames while `act` runs. */
async function record(page, name, act, { every = 70 } = {}) {
  const dir = `${HERE}frames/${name}/`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = [];
  let n = 0;
  const grab = async (hold = every) => {
    const file = `${dir}${String(n++).padStart(4, "0")}.png`;
    await page.screenshot({ path: file });
    frames.push({ file, ms: hold });
  };
  await act(grab);
  writeFileSync(`${dir}frames.json`, JSON.stringify(frames));
}

async function smoothMove(page, grab, from, to, steps) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease-in-out
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await grab(60);
  }
}

const center = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

// --- 1. Light board and main GIF (drag + open a card) -----------------------------------
{
  const { ctx, page } = await open();
  await gotoBoard(page, "Website launch");
  await shot(page, "board-light");

  await record(page, "hero", async (grab) => {
    await grab(1200);
    const card = page.getByText("Team photos", { exact: true });
    const target = page.getByText("Sitemap and robots.txt", { exact: true });
    const from = await center(card);
    const tgt = await center(target);
    await page.mouse.move(from.x, from.y);
    await grab(250);
    await page.mouse.down();
    await page.mouse.move(from.x + 6, from.y + 6);
    await grab(80);
    await smoothMove(page, grab, { x: from.x + 6, y: from.y + 6 }, { x: tgt.x, y: tgt.y + 34 }, 16);
    await grab(300);
    await page.mouse.up();
    await page.waitForTimeout(350);
    await grab(1100);

    // Open a card's detail.
    const open = await center(page.getByText("Build the home page", { exact: true }));
    await smoothMove(page, grab, { x: tgt.x, y: tgt.y + 34 }, open, 8);
    await page.mouse.click(open.x, open.y);
    for (let i = 0; i < 4; i++) { await page.waitForTimeout(70); await grab(70); }
    await grab(2600);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await grab(900);
  });
  await ctx.close();
}

// --- 2. Card detail, calendar and filters in light mode ----------------------------------
{
  const { ctx, page } = await open();
  await gotoBoard(page, "Website launch");
  await page.getByText("Build the home page", { exact: true }).click();
  await page.waitForTimeout(600);
  await shot(page, "card-light");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const cal = page.getByRole("button", { name: /Calendar/ }).or(page.getByRole("tab", { name: /Calendar/ }));
  await cal.first().click();
  await page.waitForTimeout(600);
  await shot(page, "calendar-light");
  await page.goto(`${BASE}/boards`);
  await page.waitForTimeout(400);
  await shot(page, "boards-light");
  await page.goto(`${BASE}/settings`);
  await page.waitForTimeout(400);
  await shot(page, "settings-light");
  await ctx.close();
}

// --- 2b. Organizations and the instance administration -----------------------------------
{
  const { ctx, page } = await open();
  await page.goto(`${BASE}/northwind`);
  await page.waitForTimeout(400);
  await shot(page, "workspace-light");
  await page.goto(`${BASE}/northwind/settings`);
  await page.waitForTimeout(400);
  await shot(page, "org-members-light", { fullPage: true });
  await page.goto(`${BASE}/northwind/settings/general`);
  await page.waitForTimeout(400);
  await shot(page, "org-general-light", { fullPage: true });
  await page.goto(`${BASE}/admin/workspaces`);
  await page.waitForTimeout(400);
  await shot(page, "admin-light");
  await ctx.close();
}

// --- 2c. Public pages, signed out: the landing and signing up an organization ------------
for (const [dark, suffix] of [[false, "light"], [true, "dark"]]) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    colorScheme: dark ? "dark" : "light",
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(600);
  await shot(page, `landing-${suffix}`);
  if (!dark) {
    await page.goto(`${BASE}/register?type=organization`);
    await page.waitForTimeout(400);
    await shot(page, "register-light");
  }
  await ctx.close();
}

// --- 3. Board in dark mode and on mobile ---------------------------------------------------
{
  const { ctx, page } = await open({ dark: true });
  await gotoBoard(page, "Website launch");
  await shot(page, "board-dark");
  await page.getByText("Build the home page", { exact: true }).click();
  await page.waitForTimeout(600);
  await shot(page, "card-dark");
  await ctx.close();
}
{
  const { ctx, page } = await open({ width: 390, height: 844 });
  await gotoBoard(page, "Website launch");
  await shot(page, "board-mobile");
  await ctx.close();
}

// --- 4. Real time: two people on the same board -------------------------------------------
{
  const a = await open({ width: 900, height: 640 });
  const b = await open({ width: 900, height: 640, user: "marcos@example.com" });
  await gotoBoard(a.page, "Website launch");
  await gotoBoard(b.page, "Website launch");
  for (const p of [a.page, b.page]) await p.mouse.wheel(0, 0);
  const dirA = `${HERE}frames/realtime-a/`, dirB = `${HERE}frames/realtime-b/`;
  for (const d of [dirA, dirB]) { rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); }
  const frames = [];
  let n = 0;
  const grab = async (ms) => {
    const id = String(n++).padStart(4, "0");
    await Promise.all([
      a.page.screenshot({ path: `${dirA}${id}.png` }),
      b.page.screenshot({ path: `${dirB}${id}.png` }),
    ]);
    frames.push({ id, ms });
  };
  await grab(1200);
  const card = a.page.getByText("Monthly newsletter", { exact: true });
  const target = a.page.getByText("Pricing page copy", { exact: true });
  const from = await center(card);
  const tgt = await center(target);
  await a.page.mouse.move(from.x, from.y);
  await a.page.mouse.down();
  await a.page.mouse.move(from.x + 6, from.y + 6);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    await a.page.mouse.move(from.x + (tgt.x - from.x) * t, from.y + (tgt.y - 20 - from.y) * t);
    await grab(70);
  }
  await a.page.mouse.up();
  for (let i = 0; i < 14; i++) { await a.page.waitForTimeout(120); await grab(120); }
  await grab(1800);
  writeFileSync(`${HERE}frames/realtime.json`, JSON.stringify(frames));
  await a.ctx.close();
  await b.ctx.close();
}

await browser.close();
console.log("screenshots ready");

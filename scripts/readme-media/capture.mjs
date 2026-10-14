// Capturas y fotogramas para el README. Guarda PNG en $OUT/readme/ y fotogramas de GIF en
// $OUT/frames/<nombre>/NNNN.png con un frames.json de duraciones. Ver README.md de esta
// carpeta.
//
//   BASE=http://localhost:3051 DEMO_PASSWORD=… OUT=/tmp/orgtable-media \
//   CHROME=/ruta/al/navegador node capture.mjs
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3051";
const pw = process.env.DEMO_PASSWORD;
if (!pw) throw new Error("Falta DEMO_PASSWORD (la misma que se usó en seed-demo.mjs)");
const HERE = (process.env.OUT ?? "/tmp/orgtable-media").replace(/\/?$/, "/");
mkdirSync(HERE + "readme", { recursive: true });

// Cualquier Chromium (Chrome, Brave, Edge…). Sin CHROME, el que instale Playwright.
const browser = await chromium.launch(
  process.env.CHROME ? { executablePath: process.env.CHROME } : {},
);

async function open({ width = 1280, height = 800, dark = false, user = "lucia@example.com" } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: dark ? "dark" : "light",
    locale: "es-ES",
    timezoneId: "Atlantic/Canary",
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", user);
  await page.fill("#password", pw);
  await Promise.all([page.waitForURL("**/boards"), page.click("button[type=submit]")]);
  return { ctx, page };
}

async function gotoBoard(page, title) {
  await page.goto(`${BASE}/boards`);
  await Promise.all([page.waitForURL("**/board/**"), page.getByRole("link", { name: new RegExp(`^${title}`) }).click()]);
  await page.waitForTimeout(800);
}

const shot = (page, name) => page.screenshot({ path: `${HERE}readme/${name}.png` });

/** Graba fotogramas mientras `act` se ejecuta. */
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

// --- 1. Tablero en claro y GIF principal (arrastrar + abrir tarjeta) ---------------------
{
  const { ctx, page } = await open();
  await gotoBoard(page, "Lanzamiento de la web");
  await shot(page, "board-light");

  await record(page, "hero", async (grab) => {
    await grab(1200);
    const card = page.getByText("Fotos del equipo", { exact: true });
    const target = page.getByText("Sitemap y robots.txt", { exact: true });
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

    // Abrir el detalle de una tarjeta.
    const open = await center(page.getByText("Maquetar la home", { exact: true }));
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

// --- 2. Detalle de tarjeta, calendario y filtros en claro --------------------------------
{
  const { ctx, page } = await open();
  await gotoBoard(page, "Lanzamiento de la web");
  await page.getByText("Maquetar la home", { exact: true }).click();
  await page.waitForTimeout(600);
  await shot(page, "card-light");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const cal = page.getByRole("button", { name: /Calendario/ }).or(page.getByRole("tab", { name: /Calendario/ }));
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

// --- 3. Tablero en oscuro y en móvil ------------------------------------------------------
{
  const { ctx, page } = await open({ dark: true });
  await gotoBoard(page, "Lanzamiento de la web");
  await shot(page, "board-dark");
  await page.getByText("Maquetar la home", { exact: true }).click();
  await page.waitForTimeout(600);
  await shot(page, "card-dark");
  await ctx.close();
}
{
  const { ctx, page } = await open({ width: 390, height: 844 });
  await gotoBoard(page, "Lanzamiento de la web");
  await shot(page, "board-mobile");
  await ctx.close();
}

// --- 4. Tiempo real: dos personas en el mismo tablero ------------------------------------
{
  const a = await open({ width: 900, height: 640 });
  const b = await open({ width: 900, height: 640, user: "marcos@example.com" });
  await gotoBoard(a.page, "Lanzamiento de la web");
  await gotoBoard(b.page, "Lanzamiento de la web");
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
  const card = a.page.getByText("Newsletter mensual", { exact: true });
  const target = a.page.getByText("Textos de la página de precios", { exact: true });
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
console.log("capturas listas");

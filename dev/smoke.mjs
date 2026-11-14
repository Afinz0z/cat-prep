// Browser smoke test: starts the dev server with the demo members, signs in,
// opens every page on a phone and a laptop screen, then sits and submits the
// sample test. Fails on any page error, console error, error notice, or a page
// wider than the screen. Uses the Chrome already installed (no download).
// Run: npm run smoke
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const PORT = Number(process.env.SMOKE_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const PAGES = [
  "index.html", "board.html", "board.html#history", "board.html#improve", "topics.html",
  "practice.html#tests", "practice.html#reviews", "practice.html#errors", "practice.html#cards", "practice.html#drills",
  "practice.html#rc", "practice.html#choice", "practice.html#search", "practice.html#bookmarks",
  "mocks.html", "chat.html", "you.html", "exam-day.html",
];
const SIZES = [["phone", 390, 844], ["laptop", 1280, 800]];
// Optional data that is fine to be missing.
const IGNORE = [/data\/facts\.json/, /favicon/];

const server = spawn(process.execPath, ["dev/server.mjs", "--demo"], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("The dev server didn't start in 60 s.")), 60000);
  server.stdout.on("data", (b) => { if (String(b).includes("dev server on")) { clearTimeout(t); resolve(); } });
  server.on("exit", (code) => reject(new Error(`The dev server stopped (${code}).`)));
});

const browser = await chromium.launch({ channel: process.env.SMOKE_CHANNEL || "chrome", headless: true });
const problems = [];
const note = (where, what) => { problems.push(`${where}: ${what}`); console.log(`  problem: ${what}`); };

async function signedInPage(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${BASE}/index.html`);
  await page.fill('input[type="email"]', "asha@example.com");
  await page.fill('input[type="password"]', "demo-pass");
  await Promise.all([page.waitForLoadState("load"), page.click('form button[type="submit"]')]);
  await page.waitForSelector(".nav a", { timeout: 20000 });
  return { ctx, page };
}

function watch(page, where) {
  const onConsole = (m) => {
    if (m.type() !== "error") return;
    const text = `${m.text()} ${m.location()?.url || ""}`;
    if (!IGNORE.some((r) => r.test(text))) note(where, `console: ${m.text()}`);
  };
  const onError = (e) => note(where, `page error: ${e.message}`);
  page.on("console", onConsole);
  page.on("pageerror", onError);
  return () => { page.off("console", onConsole); page.off("pageerror", onError); };
}

for (const [label, w, h] of SIZES) {
  console.log(`\n${label} (${w}x${h})`);
  const { ctx, page } = await signedInPage(w, h);
  for (const [i, path] of PAGES.entries()) {
    const where = `${label} ${path}`;
    console.log(`- ${path}`);
    const stop = watch(page, where);
    // A query string forces a real load; a change of hash alone would not re-run the page.
    await page.goto(`${BASE}/${path.replace(/(#|$)/, `?smoke=${i}$1`)}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForFunction(() => !/^\s*Loading\.\.\.\s*$/.test(document.getElementById("main")?.innerText || ""), null, { timeout: 15000 })
      .catch(() => note(where, "still loading after 15 s"));
    await page.waitForTimeout(400);
    const errs = await page.$$eval("#main .notice.error", (n) => n.map((x) => x.textContent.trim()));
    for (const e of errs) note(where, `error notice: ${e}`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) note(where, `page is ${wide}px wider than the screen`);
    stop();
  }

  // Sit and submit the sample test.
  const where = `${label} sample test`;
  console.log("- sample test");
  const stop = watch(page, where);
  try {
    await page.goto(`${BASE}/test.html?id=dev-sample`);
    const button = (name) => page.getByRole("button", { name, exact: true });
    await button("Next").click();
    await page.check("#agree");
    await button("I am ready to begin").click();
    await page.locator(".q-pane .options label").first().click();
    await button("Save & Next").click();
    await page.locator(".q-pane .options label").nth(1).click();
    await button("Save & Next").click();
    await page.click(".submit-section");
    await page.click("dialog[open] .btn.primary");
    await page.waitForSelector(".results-page", { timeout: 20000 });
    const text = await page.locator(".results-page").innerText();
    if (!/Try again, untimed/.test(text)) note(where, "results page has no retry panel");
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (wide > 1) note(where, `results page is ${wide}px wider than the screen`);
  } catch (err) {
    note(where, `couldn't finish: ${err.message.split("\n")[0]}`);
  }
  stop();
  await ctx.close();
}

await browser.close();
server.kill();
console.log(problems.length ? `\n${problems.length} problem(s).` : "\nEvery page opened cleanly and the sample test submitted.");
process.exit(problems.length ? 1 : 0);

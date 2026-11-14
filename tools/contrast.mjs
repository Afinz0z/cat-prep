// Contrast check of the colour tokens in both themes against WCAG AA:
// 4.5:1 for body text, 3:1 for large text and for borders that carry meaning.
// Run: node tools/contrast.mjs   (exits 1 if any pair fails)
import { readFile } from "node:fs/promises";

const css = async (f) => readFile(new URL(`../web/css/${f}`, import.meta.url), "utf8");

// Pull "--name: #hex;" pairs out of the first block that opens with `selector {`.
function tokens(text, selector) {
  const at = text.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`No block for ${selector}`);
  const body = text.slice(at, text.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]));
}

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [text, background, minimum, what it is]
const SITE = [
  ["ink", "paper", 4.5, "body text"],
  ["ink", "ground", 4.5, "text on the page background"],
  ["ink-soft", "paper", 4.5, "muted text"],
  ["ink-soft", "paper-2", 4.5, "muted text in cards"],
  ["ink-soft", "ground", 4.5, "muted text on the page"],
  ["exam-ink", "paper", 4.5, "links"],
  ["on-exam", "exam", 4.5, "primary buttons"],
  ["on-exam", "top", 4.5, "top bar"],
  ["ink", "exam-soft", 4.5, "current plan block"],
  ["exam-ink", "exam-soft", 4.5, "current block time"],
  ["good", "paper", 4.5, "good marks"],
  ["bad", "paper", 4.5, "errors and bad marks"],
  ["warn", "paper", 4.5, "warnings"],
  ["ink", "warn-soft", 4.5, "notices"],
  ["marigold-ink", "marigold-soft", 4.5, "your row on tables"],
  ["ink", "marigold-soft", 4.5, "text in your row"],
  ["hero-ink", "hero", 4.5, "Today hero"],
  ["hero-soft", "hero", 4.5, "Today hero, muted"],
  ["marigold", "hero", 3, "days-left number (large)"],
  ["good", "good-soft", 4.5, "earned badges"],
  ["ink", "bad-soft", 4.5, "error notices"],
  ["btn-line", "paper", 3, "button and field borders"],
];
const EXAM = [
  ["x-ink", "x-page", 4.5, "question text"],
  ["x-soft", "x-page", 4.5, "muted text on the test screen"],
  ["x-ink", "x-strip", 4.5, "strip under the top bar"],
  ["x-ink", "x-panel", 4.5, "section banner"],
  ["x-top-ink", "x-top", 4.5, "test top bar"],
  ["x-good", "x-page", 4.5, "right answers"],
  ["x-bad", "x-page", 4.5, "wrong answers"],
  ["x-btn-line", "x-page", 3, "button borders"],
];

function check(name, t, pairs) {
  let fails = 0;
  for (const [fg, bg, min, what] of pairs) {
    if (!t[fg] || !t[bg]) continue;
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) fails += 1;
    console.log(`${ok ? "pass" : "FAIL"}  ${name.padEnd(10)} ${r.toFixed(2).padStart(5)} (needs ${min})  ${fg} on ${bg}: ${what}`);
  }
  return fails;
}

const site = await css("site.css");
const exam = await css("test.css");
let fails = 0;
fails += check("light", tokens(site, ":root"), SITE);
fails += check("dark", tokens(site, ':root[data-theme="dark"]'), SITE);
fails += check("exam", tokens(exam, "body.exam"), EXAM);
fails += check("exam dark", tokens(exam, ':root[data-theme="dark"] body.exam'), EXAM);
// The unread badge uses a fixed dark ink on the marigold in both themes.
for (const [name, t] of [["light", tokens(site, ":root")], ["dark", tokens(site, ':root[data-theme="dark"]')]]) {
  const r = ratio("#15212e", t.marigold);
  if (r < 4.5) fails += 1;
  console.log(`${r >= 4.5 ? "pass" : "FAIL"}  ${name.padEnd(10)} ${r.toFixed(2).padStart(5)} (needs 4.5)  badge ink on marigold`);
}
console.log(fails ? `\n${fails} pair(s) below WCAG AA.` : "\nEvery pair meets WCAG AA.");
process.exit(fails ? 1 : 0);

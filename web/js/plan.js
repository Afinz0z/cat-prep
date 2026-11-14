// The day plan from data/plan.json, with paper days taken from the group
// calendar once the admin has set it up on the Mocks page.
import { rpc } from "./db.js";
import { loadJson, istToday } from "./ui.js";

// Make (or reopen) today's mixed set or Sunday retest, then go to it.
export async function openComposed(kind) {
  const set = await rpc("cat_compose", { p_kind: kind });
  location.href = set.attemptId ? `test.html?attempt=${set.attemptId}` : `test.html?id=${encodeURIComponent(set.id)}`;
}

let cache = null;
export async function loadPlan() {
  cache = cache || loadJson("data/plan.json");
  return cache;
}

export const toMin = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
export function nowMin(d = new Date()) {
  const t = new Date(d.getTime() + 330 * 60000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}
export const isoDow = (day) => new Date(`${day}T00:00:00Z`).getUTCDay();

// calendar: rows from cat_calendar, or [] before the admin has filled it.
export function dayPlan(plan, calendar = [], day = istToday()) {
  const row = plan.days[day] || null;
  const group = calendar.filter((c) => !c.owner && c.paper);
  let paper = null;
  if (group.length) {
    const hit = group.find((c) => c.day === day);
    if (hit) paper = { id: hit.paper, title: hit.title, time: hit.time };
  } else if (row?.paper) {
    paper = { id: row.paper, title: null, time: "12:30" };
  }
  let key = row?.timetable ?? null;
  if (paper) key = "paper";
  else if (key === "paper") key = "learn";
  if (!row && !paper) key = null;
  const blocks = key ? plan.timetables[key] : [];
  return {
    day,
    phase: row?.phase || null,
    key,
    paper,
    notes: row || {},
    blocks,
    taper: key === "taper27" || key === "taper28",
  };
}

export function blockMinutes(b) {
  const from = toMin(b.from);
  const to = toMin(b.to);
  return from !== null && to !== null ? to - from : 0;
}

// The block running now, or the next one if none is.
export function currentBlock(blocks, at = nowMin()) {
  const running = blocks.find((b) => b.to && toMin(b.from) <= at && at < toMin(b.to));
  if (running) return { block: running, now: true };
  const next = blocks.find((b) => toMin(b.from) > at);
  return next ? { block: next, now: false } : null;
}

// Focus minutes per block from the times they reached the board. Each batch
// of minutes counts in the block that was running when it was sent.
export function actualByBlock(blocks, log) {
  const out = {};
  for (const r of log) {
    const at = nowMin(new Date(r.at));
    const b = blocks.find((x) => x.to && toMin(x.from) <= at && at < toMin(x.to) + 5);
    if (b) out[b.id] = (out[b.id] || 0) + r.minutes;
  }
  return out;
}

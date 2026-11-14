// The roadmap: steps in order of marks per hour of study, which ones you've
// cleared, and the score the cleared steps add up to. The Plan and Today pages use it.
import { rpc } from "./db.js";
import { loadJson } from "./ui.js";
import { estimate, ordinal } from "./percentile.js";

export const SECTION = { VARC: "Verbal", DILR: "DILR", QA: "Quant" };

export const roundHalfUp = (x) => Math.floor(x + 0.5);

export function marksText(low, high) {
  const a = roundHalfUp(low);
  const b = roundHalfUp(high);
  return a === b ? `+${a} marks` : `+${a} to +${b} marks`;
}

export function hoursText(h) {
  return h === 1 ? "1 hour" : `${h} hours`;
}

// First attempt at each test, and the best one since. Only the first counts for a check.
export function attemptsByTest(tries) {
  const out = {};
  const sorted = tries.slice().sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));
  for (const a of sorted) {
    const t = a.totals || {};
    const right = t.correct || 0;
    const total = right + (t.wrong || 0) + (t.skipped || 0);
    const row = out[a.testId];
    if (!row) {
      out[a.testId] = { first: { right, total, attemptId: a.attemptId }, best: { right, total }, tries: 1 };
      continue;
    }
    row.tries += 1;
    if (total && right * row.best.total > row.best.right * total) row.best = { right, total };
  }
  return out;
}

// Blanks count as not right: 6 of 10 passes 60%, and 1 of 1 answered with 9 blank does not.
export function passes(r, target) {
  return !!r && r.total > 0 && r.right * 100 >= target * r.total;
}

export function needed(total, target) {
  return Math.ceil((target * total) / 100);
}

export function stepState(step, mine, att) {
  const saved = mine[step.id] || null;
  if (step.check.self) {
    return { step, self: true, checks: [], passed: false, missed: false, cleared: !!saved, how: saved?.how || null };
  }
  const checks = step.check.tests.map((id) => {
    const a = att[id] || null;
    return { id, first: a?.first || null, best: a && a.tries > 1 ? a.best : null, pass: passes(a?.first, step.check.target) };
  });
  const passed = checks.every((c) => c.pass);
  const missed = !passed && checks.some((c) => c.first && !c.pass);
  return { step, self: false, checks, passed, missed, cleared: passed || !!saved, how: saved?.how || (passed ? "check" : null) };
}

export function nextStep(states) {
  return states.find((s) => !s.cleared) || null;
}

// Marks from the cleared steps only, in whatever order they were cleared, with
// each section held to its ceiling.
export function scoreNow(states, caps) {
  const lo = {};
  const hi = {};
  for (const k of Object.keys(caps)) { lo[k] = 0; hi[k] = 0; }
  for (const s of states) {
    if (!s.cleared) continue;
    lo[s.step.section] += s.step.low;
    hi[s.step.section] += s.step.high;
  }
  let low = 0;
  let high = 0;
  const bySection = {};
  for (const k of Object.keys(caps)) {
    const a = Math.min(lo[k], caps[k]);
    const b = Math.min(hi[k], caps[k]);
    low += a;
    high += b;
    bySection[k] = { low: a, high: b };
  }
  return { low: roundHalfUp(low), high: roundHalfUp(high), bySection };
}

// One short percentile label for a raw score. Above the published tables' 75th
// percentile it uses them; below that, the rough estimates.
export function pctShort(score, tables) {
  const e = estimate(score, "overall", tables);
  if (!e) return "";
  if (!e.below75) return `about the ${ordinal(e.high)}`;
  const rows = tables.roughLowOverall?.rows || [];
  if (!rows.length) return "under the 75th";
  const fits = rows.filter(([, lo, hi]) => score >= lo && score <= hi).map(([p]) => p);
  if (fits.length) return `about the ${ordinal(Math.max(...fits))}`;
  if (score < Math.min(...rows.map(([, lo]) => lo))) return `under the ${ordinal(Math.min(...rows.map(([p]) => p)))}`;
  return "under the 75th";
}

export function pctRange(low, high, tables) {
  const a = pctShort(low, tables);
  const b = pctShort(high, tables);
  return a === b ? a : `${a} to ${b}`;
}

export async function loadRoadmap() {
  const [data, tables, saved, tries] = await Promise.all([
    loadJson("data/roadmap.json"), loadJson("data/percentiles.json"), rpc("cat_roadmap"), rpc("cat_attempts"),
  ]);
  const att = attemptsByTest(tries);
  let cleared = saved;
  // A check passed on the site is saved too, so the rest of the group sees it.
  for (const step of data.steps) {
    if (cleared.mine[step.id]) continue;
    if (stepState(step, cleared.mine, att).passed) {
      cleared = await rpc("cat_roadmap_set", { p_step: step.id, p_cleared: true, p_how: "check" }).catch(() => cleared);
    }
  }
  return { data, tables, cleared, att, states: data.steps.map((s) => stepState(s, cleared.mine, att)) };
}

export function restate(rm, cleared) {
  rm.cleared = cleared;
  rm.states = rm.data.steps.map((s) => stepState(s, cleared.mine, rm.att));
  return rm;
}

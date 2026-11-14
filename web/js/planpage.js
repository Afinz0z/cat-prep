// The Plan page: the roadmap from step 1 down, the step you're on, and the
// score your cleared steps add up to.
import { rpc } from "./db.js";
import { el, boot, busy, fill, fmtDate, istToday, loadJson } from "./ui.js";
import { startReminders, cacheSettings } from "./reminders.js";
import {
  SECTION, loadRoadmap, restate, nextStep, scoreNow, pctShort, pctRange, marksText, hoursText, needed, roundHalfUp,
} from "./roadmap.js";

const main = document.getElementById("main");
let rm = null;
let tests = {};

function testName(id) {
  return tests[id]?.title || id;
}
function testCount(id) {
  return (tests[id]?.sections || []).reduce((n, s) => n + (s.count || 0), 0);
}

async function setCleared(button, step, cleared) {
  await busy(button, async () => {
    restate(rm, await rpc("cat_roadmap_set", { p_step: step.id, p_cleared: cleared, p_how: "trust" }));
    render();
  });
}

// ---- one step's check ---------------------------------------------------------
function checkBlock(s) {
  const st = s.step;
  if (s.self) {
    return el("div", { class: "stair-check" },
      el("p", {}, el("strong", {}, "Check: "), st.check.self),
      s.cleared
        ? el("p", { class: "row" }, el("span", { class: "good" }, "Marked as cleared."),
          el("button", { type: "button", class: "btn small quiet", onclick: (e) => setCleared(e.currentTarget, st, false) }, "Undo"))
        : el("button", { type: "button", class: "btn pill", onclick: (e) => setCleared(e.currentTarget, st, true) }, "Mark as cleared"));
  }
  const target = st.check.target;
  const lines = s.checks.map((c) => {
    const total = c.first?.total || testCount(c.id);
    const link = el("a", { href: `test.html?id=${encodeURIComponent(c.id)}` }, testName(c.id));
    if (!c.first) {
      return el("li", {}, link, total ? `: not taken yet. You need ${needed(total, target)} of ${total} right on the first try.` : ": not taken yet.");
    }
    const score = `${c.first.right} of ${c.first.total}`;
    if (c.pass) return el("li", {}, link, `: passed, ${score} on the first try.`);
    const best = c.best && c.best.right * c.first.total > c.first.right * c.best.total ? ` Your best since is ${c.best.right} of ${c.best.total}.` : "";
    return el("li", {}, link, `: ${score} on the first try, and the target was ${needed(c.first.total, target)}.${best}`);
  });
  return el("div", { class: "stair-check" },
    el("p", {}, el("strong", {}, `Check: ${target}% on ${s.checks.length === 1 ? "this set" : `each of these ${s.checks.length} sets`}`),
      ", counted on all the questions, so a blank counts as not right. Only the first try counts."),
    el("ul", {}, lines),
    s.missed && !s.cleared
      ? [
        el("p", {}, "Redo ", missedLinks(s), ", and the topic's questions in your ", el("a", { href: "practice.html#reviews" }, "review queue"), ". Then mark the step cleared."),
        el("button", { type: "button", class: "btn pill", onclick: (e) => setCleared(e.currentTarget, st, true) }, "Mark as cleared"),
      ]
      : null,
    s.cleared && s.how === "trust"
      ? el("p", { class: "row" }, el("span", { class: "good" }, "Marked as cleared after the redo."),
        el("button", { type: "button", class: "btn small quiet", onclick: (e) => setCleared(e.currentTarget, st, false) }, "Undo"))
      : null);
}

function missedLinks(s) {
  const missed = s.checks.filter((c) => c.first && !c.pass && c.first.attemptId);
  if (!missed.length) return "the questions you missed";
  return missed.length === 1
    ? el("a", { href: `test.html?attempt=${missed[0].first.attemptId}` }, "the questions you missed")
    : ["the questions you missed in ", missed.map((c, i) => [i ? " and " : "", el("a", { href: `test.html?attempt=${c.first.attemptId}` }, testName(c.id))])];
}

function statusText(s) {
  if (s.cleared) return s.how === "check" ? "Cleared on the check" : "Cleared";
  if (s.missed) return "Check missed";
  return "";
}

function faces(step) {
  const group = rm.cleared.group || [];
  const who = group.map((m, i) => ({ ...m, i })).filter((m) => !m.me && m.steps.includes(step.id));
  if (!who.length) return null;
  return el("span", { class: "faces", role: "img", "aria-label": `Cleared by ${who.map((m) => m.name).join(", ")}` },
    who.map((m) => el("span", { class: "face", title: m.name, style: `background: var(--tile-${(m.i % 6) + 1})` }, m.name.slice(0, 1).toUpperCase())));
}

// ---- the staircase --------------------------------------------------------------
function stepItem(s, next) {
  const st = s.step;
  const isNext = next === s;
  const status = statusText(s);
  const runLow = roundHalfUp(st.runLow);
  const runHigh = roundHalfUp(st.runHigh);
  return el("li", { id: st.id, class: `stair${s.cleared ? " cleared" : ""}${isNext ? " is-next" : ""}` },
    el("details", { open: isNext || location.hash === `#${st.id}` },
      el("summary", {},
        el("span", { class: "stair-n", "aria-hidden": "true" }, s.cleared ? "✓" : String(st.n)),
        el("span", { class: "stair-main" },
          el("span", { class: "stair-title" }, el("span", { class: "sr-only" }, `Step ${st.n}: `), st.title),
          el("span", { class: "stair-meta" }, `${SECTION[st.section]}, ${marksText(st.low, st.high)}, ${hoursText(st.hours)}`),
          status || isNext ? el("span", { class: `stair-status${s.cleared ? " good" : s.missed ? " warn" : ""}` }, status || "Next up") : null),
        el("span", { class: "stair-run" },
          el("span", { class: "stair-run-num" }, `${runLow} to ${runHigh}`),
          el("span", { class: "stair-run-pct" }, pctRange(runLow, runHigh, rm.tables))),
        faces(st)),
      el("div", { class: "stair-body" },
        el("p", {}, st.why),
        el("p", { class: "row" }, st.learn.map((l, i) => el("a", { class: i === 0 && !s.cleared ? "btn primary pill" : "btn pill", href: l.href }, l.label))),
        checkBlock(s))));
}

function paperItem(p) {
  const past = p.day < istToday();
  return el("li", { class: `stair-paper${past ? " past" : ""}` },
    el("span", { class: "stair-paper-day" }, fmtDate(p.day)),
    el("span", {}, el("strong", {}, `Paper: ${p.title}`), past ? ", done." : ", 12:30 to 14:30. The steps above should be cleared by then."));
}

function lineItem(line) {
  return el("li", { class: "stair-line" },
    el("span", {}, `${line.text} The steps below are for whoever gets there early.`));
}

function stairs(next) {
  const papers = {};
  for (const p of rm.data.papers) (papers[p.after] ||= []).push(p);
  const items = [];
  for (const s of rm.states) {
    items.push(stepItem(s, next));
    for (const p of papers[s.step.id] || []) items.push(paperItem(p));
    if (rm.data.line?.after === s.step.id) items.push(lineItem(rm.data.line));
  }
  return el("ol", { class: "stairs", "aria-label": "Roadmap steps in order" }, items);
}

// ---- top of the page ------------------------------------------------------------
function nextPanel(next) {
  if (!next) {
    return el("section", { class: "panel next-up span-7", "aria-labelledby": "next-h" },
      el("h2", { id: "next-h", class: "next-title" }, "Every step is cleared"),
      el("p", {}, "Keep them all warm with the review queue, mixed sets and timed sections until 27 Nov. Nothing new after that."));
  }
  const st = next.step;
  const [first, ...rest] = st.learn;
  const hasTests = !next.self;
  return el("section", { class: "panel next-up span-7", "aria-labelledby": "next-h" },
    el("p", { class: "next-where" }, `Step ${st.n} of ${rm.states.length}, ${SECTION[st.section]}`),
    el("h2", { id: "next-h", class: "next-title" }, st.title),
    el("p", { class: "next-adds" }, `${marksText(st.low, st.high)} a paper, for about ${hoursText(st.hours)} of work.`),
    el("p", {}, st.why),
    el("div", { class: "row" },
      first ? el("a", { class: "btn primary pill", href: first.href }, first.label) : null,
      rest.map((l) => el("a", { class: "btn pill", href: l.href }, l.label)),
      hasTests
        ? next.checks.filter((c) => !c.first).map((c) => el("a", { class: "btn pill", href: `test.html?id=${encodeURIComponent(c.id)}` }, `Check: ${testName(c.id)}`))
        : el("a", { class: "btn pill", href: `#${st.id}` }, "How to check it")),
    next.missed ? el("p", { class: "notice" }, "You've taken the check and missed the target. The step below shows your score and what to redo.") : null);
}

function scorePanel() {
  const done = rm.states.filter((s) => s.cleared).length;
  const score = scoreNow(rm.states, rm.data.caps);
  const steps = done === 1 ? "the 1 step" : `the ${done} steps`;
  return el("section", { class: "panel score-now span-5", "aria-labelledby": "score-h" },
    el("h2", { id: "score-h" }, "Your score now"),
    done
      ? [
        el("p", { class: "score-num" }, score.low === score.high ? String(score.low) : `${score.low} to ${score.high}`),
        el("p", {}, `marks a paper from ${steps} you've cleared, so ${pctRange(score.low, score.high, rm.tables)} percentile.`),
      ]
      : [
        el("p", { class: "score-num" }, "0"),
        el("p", {}, "Nothing cleared yet. Each step you clear adds its marks here."),
      ],
    goalBlock(score),
    el("p", { class: "muted small" }, `${done} of ${rm.states.length} steps cleared. This is an estimate from the roadmap, not a measured score; the papers on 18, 21, 24 and 26 Nov give real numbers. Percentiles: ${rm.tables.source} Below the 75th they're rough.`));
}

function goalBlock(score) {
  const g = rm.data.goal;
  if (!g) return null;
  return el("div", { class: "goal" },
    el("p", {}, el("strong", {}, "The goal: "),
      `the ${g.overallPct[0]}th to ${g.overallPct[1]}th percentile, about ${g.overall[0]} to ${g.overall[1]} marks in the ${g.slot} table, with the ${g.sectionPct}th or better in every section.`),
    el("ul", { class: "floors" }, Object.entries(g.floors).map(([k, need]) => {
      const s = score.bySection[k];
      const a = roundHalfUp(s.low);
      const b = roundHalfUp(s.high);
      const there = (s.low + s.high) / 2 >= need;
      return el("li", { class: there ? "good" : "" },
        el("span", { class: "floor-name" }, SECTION[k]),
        el("span", {}, `${a === b ? a : `${a} to ${b}`} now, ${roundHalfUp(need)} needed`));
    })));
}

function aboutBlock() {
  const d = rm.data;
  return el("details", { class: "panel about-roadmap" },
    el("summary", {}, "How the marks are worked out"),
    el("p", {}, "Each step is ranked by the marks it adds to a paper for each hour it takes. The marks are a low and a high estimate, because nothing has been measured yet."),
    el("ul", {}, d.assumptions.map((a) => el("li", {}, a))),
    el("p", {}, `Section ceilings used for the running score: Verbal ${d.caps.VARC}, DILR ${d.caps.DILR}, Quant ${d.caps.QA}.`),
    d.goal ? el("p", {}, `Every IIM sets a minimum percentile for each section, so a section left near zero rules out a call whatever the total. The order brings each section to its ${d.goal.sectionPct}th percentile (${d.goal.slot}, middle estimate) before taking any section past it. The IIMs' own rules:`) : null,
    d.goal ? el("ul", {}, d.goal.sources.map((s) => el("li", {}, el("a", { href: s.url, rel: "noopener", target: "_blank" }, s.label)))) : null,
    el("p", {}, "Sources:"),
    el("ul", {}, d.sources.map((s) => el("li", {}, el("a", { href: s.url, rel: "noopener", target: "_blank" }, s.label)))),
    el("p", { class: "muted small" }, `Updated ${fmtDate(d.updated)}.`));
}

function render() {
  const next = nextStep(rm.states);
  const done = rm.states.some((s) => s.cleared);
  fill(main,
    el("div", { class: "page-head" }, el("h1", {}, "Plan"),
      el("a", { class: "small", href: "index.html" }, "Today's timetable")),
    el("div", { class: "grid plan-top" }, nextPanel(next), scorePanel()),
    done ? null : el("p", { class: "notice" }, rm.data.before),
    el("h2", { class: "stairs-h" }, "The roadmap"),
    el("p", { class: "muted" }, "Every step in order, with the running score on the right once each step down to it is cleared. You can open any step; \"next up\" is always the first one you haven't cleared."),
    stairs(next),
    aboutBlock());
}

async function init() {
  const me = await boot("plan.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  try {
    const [r, idx] = await Promise.all([loadRoadmap(), loadJson("tests/index.json")]);
    rm = r;
    tests = Object.fromEntries(idx.map((t) => [t.id, t]));
  } catch (err) {
    fill(main, el("p", { class: "notice error" }, err.message));
    return;
  }
  render();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  window.addEventListener("hashchange", () => {
    const li = document.getElementById(location.hash.slice(1));
    const d = li?.querySelector("details");
    if (d) { d.open = true; li.scrollIntoView({ block: "start" }); }
  });
}

init();

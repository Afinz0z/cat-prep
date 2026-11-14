// Today: the plan for the day, the promise, the study timer, who's at the desk,
// the paper room on paper days, tasks, sleep and the evening check-in.
import { rpc } from "./db.js";
import {
  el, boot, busy, fmtMin, fmtClock, fmtTime, fmtDate, istToday, daysBetween, loadJson, showError, fill, local, setLocal, CAT_DAY,
} from "./ui.js";
import {
  startReminders, cacheSettings, getSettings, getFocus, startFocus, startBreak, stopTimer,
  focusTodayMs, syncFocus,
} from "./reminders.js";
import { loadPlan, dayPlan, toMin, nowMin, isoDow, currentBlock, actualByBlock, blockMinutes, openComposed } from "./plan.js";
import { loadRoadmap, nextStep, marksText, hoursText, SECTION } from "./roadmap.js";

const main = document.getElementById("main");
let me = null;
let today = null;
let promises = [];
let studyingNow = [];
let board = null;
let dailyTest = null;
let plan = null;
let dp = null;
let calendar = [];
let focusLog = [];
let readiness = {};
let topicNames = {};
let buddy = null;
let weekGoal = null;
let sleepWeek = [];
let lastCheckin = null;
let room = [];
let mocks = null;
let roadmap = null;

// ---- panels --------------------------------------------------------------------
const nextPanel = el("section", { class: "panel next-up span-12", "aria-labelledby": "nextup-h", hidden: true });
const noticePanel = el("section", { class: "panel alert span-12", "aria-labelledby": "notice-h", hidden: true });
const introPanel = el("section", { class: "panel span-12", "aria-labelledby": "intro-h", hidden: true });
const promisePanel = el("section", { class: "hero", "aria-labelledby": "promise-h" });
const planPanel = el("section", { class: "panel span-7", "aria-labelledby": "plan-h" });
const timerPanel = el("section", { class: "panel instrument span-5", "aria-labelledby": "timer-h" });
const paperPanel = el("section", { class: "panel promise span-12", "aria-labelledby": "paper-h", hidden: true });
const groupPanel = el("section", { class: "panel span-7", "aria-labelledby": "group-h" });
const practicePanel = el("section", { class: "panel span-5", "aria-labelledby": "practice-h" });
const checkinPanel = el("section", { class: "panel span-7", "aria-labelledby": "checkin-h" });
const sleepPanel = el("section", { class: "panel span-5", "aria-labelledby": "sleep-h" });
const weekPanel = el("section", { class: "panel span-7", "aria-labelledby": "week-h" });
const tasksPanel = el("section", { class: "panel span-5", "aria-labelledby": "tasks-h" });

const quietNow = () => { const m = nowMin(); return m >= 22 * 60 + 30 || m < 6 * 60; };

function serverFocusMin() {
  // Minutes on the board plus minutes this browser hasn't sent yet.
  const f = getFocus();
  const unsent = Math.max(0, Math.floor(focusTodayMs() / 60000) - (f.sentMin || 0));
  return (today?.focusMin || 0) + unsent;
}

function daysLeft() {
  const left = daysBetween(istToday(), CAT_DAY);
  if (left < 0) return null;
  return el("div", { class: "hero-days" },
    el("span", { class: "hero-num" }, left === 0 ? "0" : String(left)),
    el("span", { class: "hero-label" },
      el("strong", {}, left === 0 ? "CAT is today" : left === 1 ? "day to CAT" : "days to CAT"),
      el("span", {}, "Sunday 29 November")));
}

// ---- next roadmap step ------------------------------------------------------------
function renderNext() {
  if (!roadmap || istToday() >= "2026-11-27") { nextPanel.hidden = true; return; }
  nextPanel.hidden = false;
  const s = nextStep(roadmap.states);
  if (!s) {
    fill(nextPanel, el("h2", { id: "nextup-h" }, "Every roadmap step is cleared"),
      el("p", {}, "Keep them warm: review queue, mixed sets and timed sections."),
      el("a", { href: "plan.html" }, "The plan"));
    return;
  }
  const st = s.step;
  const done = roadmap.states.filter((x) => x.cleared).length;
  const checks = s.self ? [] : s.checks.filter((c) => !c.first);
  fill(nextPanel,
    el("p", { class: "next-where" }, `Next up: step ${st.n} of ${roadmap.states.length}, ${SECTION[st.section]}`),
    el("h2", { id: "nextup-h", class: "next-title" }, st.title),
    el("p", { class: "next-adds" }, `${marksText(st.low, st.high)} a paper, for about ${hoursText(st.hours)} of work.`),
    el("div", { class: "row" },
      st.learn.map((l, i) => el("a", { class: i === 0 ? "btn primary pill" : "btn pill", href: l.href }, l.label)),
      checks.map((c, i) => el("a", { class: "btn pill", href: `test.html?id=${encodeURIComponent(c.id)}` }, checks.length > 1 ? `Check ${i + 1}` : "Take the check")),
      el("a", { class: "btn small quiet", href: `plan.html#${st.id}` }, s.missed ? "Check missed: what to redo" : "The step on the Plan page")),
    el("p", { class: "muted small" }, `${done} of ${roadmap.states.length} steps cleared.`));
}

async function loadNext() {
  try {
    roadmap = await loadRoadmap();
  } catch {
    roadmap = null;
  }
  renderNext();
}

// ---- notice and first visit ------------------------------------------------------
function renderNotice() {
  const n = today?.notice;
  const seen = local("cat-notice-seen", "");
  if (!n || seen === n.at) { noticePanel.hidden = true; return; }
  noticePanel.hidden = false;
  fill(noticePanel,
    el("h2", { id: "notice-h" }, "From the admin"),
    el("p", { class: "post-body" }, n.text),
    el("div", { class: "row" },
      n.at ? el("span", { class: "muted small grow" }, `Posted ${fmtDate(n.at.slice(0, 10))}`) : null,
      el("button", { type: "button", class: "btn small", onclick: () => { setLocal("cat-notice-seen", n.at); renderNotice(); } }, "Got it")));
}

function renderIntro() {
  if (local("cat-intro-done", false)) { introPanel.hidden = true; return; }
  introPanel.hidden = false;
  fill(introPanel,
    el("h2", { id: "intro-h" }, "How this page works"),
    el("ol", {},
      el("li", {}, "Promise how many hours you'll study today. The group sees your promise next to what you actually do."),
      el("li", {}, "Start the study timer at the start of each block in today's plan, and tick the block when it's done."),
      el("li", {}, "Every day: the review queue and the Daily 5 on the Practice page."),
      el("li", {}, "On paper days, log the paper on the Mocks page the same afternoon, with the analysis.")),
    el("button", { type: "button", class: "btn primary", onclick: () => { setLocal("cat-intro-done", true); renderIntro(); } }, "Got it"));
}

// ---- promise ---------------------------------------------------------------------
function renderPromise() {
  const done = serverFocusMin();
  const target = today?.targetMin;
  const nudges = today?.nudges || [];
  const hourOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((h) => el("option", { value: String(h * 60), selected: target ? target === h * 60 : h === 6 }, `${h} hours`));
  const select = el("select", { "aria-label": "Hours you'll study today" }, hourOptions);
  const setBtn = el("button", { type: "button", class: "btn primary" }, target ? "Change" : "Promise it");
  setBtn.addEventListener("click", () => busy(setBtn, async () => {
    today = await rpc("cat_set_target", { p_minutes: Number(select.value) });
    renderPromise();
    loadPromises();
  }));
  const hour = Math.floor(nowMin() / 60);
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  fill(promisePanel, daysLeft(), el("div", { class: "hero-promise" },
    el("h2", { id: "promise-h" }, "Today's promise"),
    target
      ? [
        el("p", {}, el("span", { class: "big-num" }, fmtMin(done)), el("span", { class: "muted" }, ` of ${fmtMin(target)} promised`)),
        el("div", { class: `meter${done >= target ? " done" : ""}`, role: "progressbar", "aria-label": "Focus against your promise", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" },
          el("span", { style: `width:${pct}%` })),
        el("p", { class: "muted" }, done >= target
          ? (target >= 120 ? "Promise kept: 10 points are on the board." : "Done. Promises of 2 hours or more earn 10 points.")
          : `${fmtMin(target - done)} to go. Everyone in the group can see this.`),
      ]
      : [
        el("p", {}, "How long will you study today? Everyone sees your promise next to what you actually do."),
        hour >= 10 ? el("p", { class: "muted" }, "It's past 10:00, so set it now and start.") : el("p", { class: "muted" }, "Set it before 10:00. A promise of 2 hours or more that you keep earns 10 points."),
      ],
    el("div", { class: "row" }, select, setBtn),
    nudges.length
      ? el("div", { class: "notice" }, el("strong", {}, "Nudged today: "), nudges.map((n) => `${n.from} at ${fmtTime(n.at)}`).join(", "), ". Start a focus block.")
      : null));
}

// ---- the plan ----------------------------------------------------------------------
function blockTime(b) {
  return b.to ? `${b.from} to ${b.to}` : b.from;
}

function renderPlan() {
  if (!plan) { fill(planPanel, el("h2", { id: "plan-h" }, "Today's plan"), el("p", { class: "muted" }, "Loading...")); return; }
  const day = istToday();
  if (day === CAT_DAY) {
    fill(planPanel, el("h2", { id: "plan-h" }, "CAT is today"),
      el("p", { class: "nerves" }, plan.nerves),
      el("p", {}, "Use the section plan you settled on after the papers, not a new one. ", el("a", { href: "exam-day.html" }, "Exam-day page")));
    return;
  }
  if (!dp.key) {
    fill(planPanel, el("h2", { id: "plan-h" }, "Today's plan"),
      el("p", { class: "empty" }, day < "2026-11-14" ? "The plan starts on Saturday 14 November." : "The plan has ended. Good luck with the results."));
    return;
  }
  const ticks = new Set(today?.planTicks || []);
  const actual = actualByBlock(dp.blocks, focusLog);
  const cur = currentBlock(dp.blocks);
  const at = nowMin();
  const n = dp.notes;
  const items = dp.blocks.map((b) => {
    const id = `blk-${b.id}`;
    const box = el("input", { type: "checkbox", id, checked: ticks.has(b.id) });
    box.addEventListener("change", () => busy(box, async () => {
      today = await rpc("cat_plan_tick", { p_block: b.id, p_done: box.checked, p_total: dp.blocks.length });
      renderPlan();
    }));
    const planned = blockMinutes(b);
    const past = b.to ? toMin(b.to) <= at : toMin(b.from) <= at;
    const logged = actual[b.id] || 0;
    return el("li", { class: `${cur?.block === b ? (cur.now ? "now" : "next") : ""}${past && !ticks.has(b.id) ? " late" : ""}` },
      box,
      el("label", { for: id, class: "blk" },
        el("span", { class: "blk-time" }, blockTime(b)),
        el("span", { class: "blk-title" }, b.title),
        b.target ? el("span", { class: "blk-target" }, `Aim: ${b.target}`) : null,
        planned >= 20 && (past || cur?.block === b) ? el("span", { class: "blk-target" }, `Timer: ${logged} of ${planned} min`) : null),
      b.link ? el("a", { class: "btn small quiet", href: b.link }, "Open") : null);
  });
  const done = dp.blocks.filter((b) => ticks.has(b.id)).length;
  const textIn = el("input", { type: "text", maxlength: 160, value: today?.planText || "", placeholder: "e.g. Ratio set 2, then two DILR sets", "aria-label": "Your plan in one line" });
  const saveText = el("button", { type: "button", class: "btn small" }, "Share with the group");
  saveText.addEventListener("click", () => busy(saveText, async () => {
    today = await rpc("cat_set_plan_text", { p_text: textIn.value });
    saveText.textContent = "Shared";
    loadPromises();
  }));
  fill(planPanel,
    el("div", { class: "page-head" }, el("h2", { id: "plan-h" }, `Today's plan${dp.phase ? `: ${dp.phase.toLowerCase()} phase` : ""}`),
      el("span", { class: "muted small" }, `${done} of ${dp.blocks.length} ticked`)),
    dp.taper ? el("p", { class: "notice" }, "The last 48 hours: no full paper and nothing new. Formula cards, the error log, light RC, and a full night's sleep.") : null,
    dp.paper ? el("p", {}, el("strong", {}, "Paper day. "), `${paperName(dp.paper)} at ${dp.paper.time}.`, n.varcOrder ? ` VARC order to try: ${n.varcOrder}.` : "", n.mixed ? ` ${n.mixed}.` : "") : null,
    n.note ? el("p", { class: "day-note" }, n.note, " ", el("a", { href: "plan.html" }, "Open the plan")) : null,
    !dp.paper && (n.qa || n.dilr || n.varc) ? el("ul", { class: "day-notes" },
      n.qa ? el("li", {}, el("strong", {}, "QA: "), n.qa) : null,
      n.dilr ? el("li", {}, el("strong", {}, "DILR: "), n.dilr) : null,
      n.varc ? el("li", {}, el("strong", {}, "VARC: "), n.varc) : null) : null,
    el("ul", { class: "plan-blocks" }, items),
    el("div", { class: "row" }, textIn, saveText),
    el("p", { class: "muted small" }, "Tick every block for the Full plan day badge. The timer line shows focus minutes logged while each block was on."));
}

function paperName(p) {
  return p.title || { "cat-2024-s1": "CAT 2024 Slot 1", "cat-2024-s2": "CAT 2024 Slot 2", "cat-2025-s1": "CAT 2025 Slot 1", "cat-2025-s2": "CAT 2025 Slot 2", "cat-2025-s3": "CAT 2025 Slot 3" }[p.id] || p.id;
}

// ---- paper day -------------------------------------------------------------------------
const ROOM_STATES = [["started", "Started"], ["varc", "On VARC"], ["dilr", "On DILR"], ["qa", "On QA"], ["finished", "Finished"]];
function renderPaper() {
  if (!dp?.paper) { paperPanel.hidden = true; return; }
  paperPanel.hidden = false;
  const at = nowMin();
  const start = toMin(dp.paper.time) ?? 750;
  const near = at >= start - 40 && at < start + 5;
  const live = at >= start - 40 && at < start + 180;
  const mine = room.find((r) => r.me)?.state || null;
  const buttons = ROOM_STATES.map(([v, label]) => {
    const b = el("button", { type: "button", class: `btn small${mine === v ? " on" : ""}`, "aria-pressed": String(mine === v) }, label);
    b.addEventListener("click", () => busy(b, async () => {
      room = await rpc("cat_paper_progress", { p_paper_id: dp.paper.id, p_state: v });
      renderPaper();
    }));
    return b;
  });
  const lock = analysisLock();
  fill(paperPanel,
    el("h2", { id: "paper-h" }, `Paper day: ${paperName(dp.paper)} at ${dp.paper.time}`),
    lock ? el("p", { class: "notice" }, `Analyse ${lock} on the Mocks page before you start this one.`) : null,
    el("p", { class: near ? "nerves big" : "nerves" }, plan.nerves),
    near ? el("p", {}, "Phone in another room. Rough sheet and pen on the desk.") : null,
    el("h3", {}, "Paper room"),
    live
      ? [
        room.length ? el("ul", { class: "people" }, room.map((r) => el("li", {},
          el("span", { class: "who" }, r.name, r.me ? " (you)" : ""),
          el("span", { class: "grow muted" }, `${ROOM_STATES.find(([v]) => v === r.state)?.[1] || r.state}, since ${fmtTime(r.at)}`))))
          : el("p", { class: "empty" }, "Nobody has started yet. Mark yourself as started when the clock begins."),
        el("div", { class: "row" }, buttons),
      ]
      : el("p", { class: "muted" }, `The room opens at ${hhmm(start - 40)} and shows where everyone is in the paper.`),
    el("div", { class: "row small" }, el("a", { href: "exam-day.html#damage" }, "If a section goes badly"), el("a", { href: "mocks.html" }, "Log and analyse it on the Mocks page")));
}

function hhmm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// Name of the last calendar paper you logged but haven't analysed, if any.
function analysisLock() {
  if (!mocks || !dp?.paper) return null;
  const open = mocks.find((m) => m.paperId && m.paperId !== dp.paper.id && !m.analysedAt);
  return open ? open.source : null;
}

async function loadRoom() {
  if (!dp?.paper) return;
  try {
    room = await rpc("cat_paper_room", { p_paper_id: dp.paper.id });
  } catch {
    room = [];
  }
  renderPaper();
}

// ---- timer ------------------------------------------------------------------------------
let clockTimer = null;
function renderTimer() {
  const f = getFocus();
  const s = getSettings();
  const now = Date.now();
  const left = f.dueAt ? f.dueAt - now : 0;
  const clock = el("p", { class: `timer-clock mode-${f.mode}`, "aria-live": "off" },
    f.mode === "idle" ? "00:00" : left > 0 ? fmtClock(left) : `+${fmtClock(-left)}`);
  const modeText = f.mode === "focus" ? `Focus block, break after ${s.breakAfterMin} minutes` : f.mode === "break" ? `Break, ${s.breakLengthMin} minutes` : "Not running";
  const buttons = f.mode === "idle"
    ? [el("button", { type: "button", class: "btn primary", onclick: () => { startFocus(); renderTimer(); } }, "Start focus")]
    : f.mode === "focus"
      ? [el("button", { type: "button", class: "btn primary", onclick: () => { startBreak(); renderTimer(); } }, "Take a break"),
        el("button", { type: "button", class: "btn", onclick: () => { stopTimer(); renderTimer(); } }, "Stop")]
      : [el("button", { type: "button", class: "btn primary", onclick: () => { startFocus(); renderTimer(); } }, "Back to focus"),
        el("button", { type: "button", class: "btn", onclick: () => { stopTimer(); renderTimer(); } }, "Stop")];
  const br = today?.breaks;
  fill(timerPanel,
    el("h2", { id: "timer-h" }, "Study timer"),
    el("p", { class: "timer-mode" }, modeText),
    clock,
    el("div", { class: "row" }, buttons,
      f.mode !== "idle" ? el("button", { type: "button", class: "btn quiet", onclick: openFocusView }, "Full screen") : null),
    el("p", { class: "muted small" }, `Focus today: ${fmtMin(serverFocusMin())}.`,
      br && (br.taken || br.skipped) ? ` Breaks taken: ${br.taken}, skipped: ${br.skipped}.` : "",
      s.autoBreak ? " Breaks start by themselves after each block." : "",
      el("span", { class: "kbd-hint" }, " Keys: ", el("kbd", {}, "F"), " focus or stop, ", el("kbd", {}, "B"), " break.")));
  clearInterval(clockTimer);
  if (f.mode !== "idle") {
    clockTimer = setInterval(() => {
      const g = getFocus();
      if (g.mode !== f.mode) return renderTimer();
      const l = g.dueAt - Date.now();
      clock.textContent = l > 0 ? fmtClock(l) : `+${fmtClock(-l)}`;
      const fv = document.querySelector(".focus-view .timer-clock");
      if (fv) fv.textContent = clock.textContent;
    }, 1000);
  }
}

function openFocusView() {
  const f = getFocus();
  const view = el("div", { class: "focus-view", role: "dialog", "aria-label": "Focus view" },
    el("p", { class: "timer-mode" }, f.mode === "focus" ? "Focus block" : "Break"),
    el("p", { class: `timer-clock mode-${f.mode}` }, "--:--"),
    el("button", { type: "button", class: "btn", onclick: () => close() }, "Back to the page"));
  let wake = null;
  navigator.wakeLock?.request("screen").then((w) => { wake = w; }).catch(() => {});
  const close = () => {
    view.remove();
    wake?.release().catch(() => {});
    wake = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  view.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  document.body.append(view);
  view.querySelector("button").focus();
  document.documentElement.requestFullscreen?.().catch(() => {});
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) close(); }, { once: true });
}

// ---- the group ---------------------------------------------------------------------------
function renderGroup() {
  const nowBy = Object.fromEntries(studyingNow.map((n) => [n.name, n]));
  const quiet = quietNow();
  const items = promises.map((p) => {
    const live = nowBy[p.name];
    const status = live ? (live.mode === "focus" ? `studying for ${fmtMin((Date.now() - Date.parse(live.since)) / 60000)}` : "on a break") : "";
    const nudge = !p.me && p.focusMin < 30 && !quiet
      ? el("button", { type: "button", class: "btn small" }, "Nudge")
      : null;
    nudge?.addEventListener("click", () => busy(nudge, async () => {
      await rpc("cat_nudge", { p_name: p.name });
      nudge.textContent = "Nudged";
      nudge.disabled = true;
    }));
    return el("li", {},
      el("span", { class: "who" }, el("span", { class: `dot ${live?.mode || ""}`, "aria-hidden": "true" }), p.name, p.me ? " (you)" : ""),
      el("span", { class: "grow muted" },
        p.targetMin ? `promised ${fmtMin(p.targetMin)}, done ${fmtMin(p.focusMin)}` : `no promise yet, done ${fmtMin(p.focusMin)}`,
        p.planTotal ? `, ${p.ticks} of ${p.planTotal} blocks` : "",
        status ? `, ${status}` : "",
        p.planText ? el("span", { class: "plan-line" }, p.planText) : null),
      nudge);
  });
  fill(groupPanel,
    el("h2", { id: "group-h" }, "The group today"),
    items.length ? el("ul", { class: "people" }, items) : el("p", { class: "empty" }, "Nobody else has joined yet. Share the group code with them."),
    buddyLine(),
    el("p", { class: "muted small" }, quiet
      ? "Nudges are off from 22:30 to 06:00 so nobody is woken up."
      : "Green dot: in a focus block now. Amber: on a break. You can nudge anyone with under 30 minutes today, once each and 3 people a day."));
}

function buddyLine() {
  if (!buddy) return el("p", { class: "small" }, "No accountability buddy yet. ", el("a", { href: "you.html#buddy" }, "Pick one on the You page"), " to see their plan ticks here.");
  const total = dp?.blocks.length || 0;
  return el("div", { class: "notice" },
    el("strong", {}, `Your buddy ${buddy.name}: `),
    `${buddy.ticks.length}${total ? ` of ${total}` : ""} blocks ticked, ${fmtMin(buddy.focusMin)} of focus today.`,
    buddy.ticks.length && dp ? el("span", { class: "muted small" }, ` Done: ${[...new Set(dp.blocks.filter((b) => buddy.ticks.includes(b.id)).map((b) => b.title.split(/[,.:]/)[0]))].join("; ")}.`) : null);
}

// ---- practice -----------------------------------------------------------------------------
function renderPractice() {
  const due = today?.reviewsDue || 0;
  const day = istToday();
  const weak = Object.entries(readiness).filter(([t, r]) => t.startsWith("qa-") && r.sets >= 2 && r.total && r.solved / r.total < 0.5);
  const mixBtn = el("button", { type: "button", class: "btn" }, "Make the mixed set");
  mixBtn.addEventListener("click", () => busy(mixBtn, () => openComposed("mixed")));
  const retestBtn = isoDow(day) === 0 ? el("button", { type: "button", class: "btn" }, "Make the retest") : null;
  retestBtn?.addEventListener("click", () => busy(retestBtn, () => openComposed("retest")));
  fill(practicePanel,
    el("h2", { id: "practice-h" }, "Practice for today"),
    weak.length ? el("p", { class: "notice" }, el("strong", {}, "Weak after two sets: "),
      weak.map(([t, r], i) => [i ? ", " : "", el("a", { href: `topics.html#${t}` }, topicNames[t] || t), ` (${r.solved} of ${r.total})`]),
      ". Go back to the worked examples and the video before the next set.") : null,
    el("ul", { class: "list" },
      el("li", {}, el("span", { class: "grow" }, el("strong", {}, "Review queue: "),
        due ? `${due} question${due === 1 ? "" : "s"} you got wrong ${due === 1 ? "is" : "are"} due again.` : "nothing due today."),
      due ? el("a", { class: "btn primary", href: "practice.html#reviews" }, "Review now") : null),
      el("li", {}, el("span", { class: "grow" }, el("strong", {}, "Daily 5: "),
        dailyTest ? `${dailyTest.title}. Five quick questions, same for everyone.` : "no set for today."),
      dailyTest ? el("a", { class: "btn", href: `test.html?id=${encodeURIComponent(dailyTest.id)}` }, "Take it") : null),
      el("li", {}, el("span", { class: "grow" }, el("strong", {}, "Mixed set: "), "up to 10 questions from topics you started 3 to 5 days ago."), mixBtn),
      retestBtn ? el("li", {}, el("span", { class: "grow" }, el("strong", {}, "Sunday retest: "), "this week's misses, once more."), retestBtn) : null,
      day >= "2026-11-23" && day <= "2026-11-28" ? el("li", {}, el("span", { class: "grow" }, el("strong", {}, "QA basics retake: "), "30 fresh questions to compare with your first check."),
        el("a", { class: "btn", href: "test.html?id=qa-basics-retake" }, "Take it")) : null,
      el("li", {}, el("span", { class: "grow" }, el("strong", {}, "Speed drill: "), "two minutes of squares, tables or fractions."),
        el("a", { class: "btn quiet", href: "practice.html#drills" }, "Drill"))));
}

// ---- sleep and streak -----------------------------------------------------------------------
function bedSpread() {
  const beds = sleepWeek.map((s) => toMin(s.bed)).filter((m) => m !== null).map((m) => (m < 12 * 60 ? m + 24 * 60 : m));
  if (beds.length < 3) return null;
  return Math.max(...beds) - Math.min(...beds);
}

function renderSleep() {
  const slept = today?.sleepMin;
  const hours = el("input", { type: "number", inputmode: "decimal", min: 0, max: 14, step: 0.5, value: slept ? String(slept / 60) : "", "aria-label": "Hours slept last night", style: "width:5em" });
  const bed = el("input", { type: "time", value: today?.bedTime || "", "aria-label": "Bed time last night" });
  const wake = el("input", { type: "time", value: today?.wakeTime || "", "aria-label": "Wake time this morning" });
  const save = el("button", { type: "button", class: "btn" }, slept ? "Update" : "Log sleep");
  save.addEventListener("click", () => busy(save, async () => {
    today = await rpc("cat_sleep", { p_hours: Number(hours.value), p_bed: bed.value || null, p_wake: wake.value || null });
    sleepWeek = await rpc("cat_sleep_week").catch(() => sleepWeek);
    renderSleep();
  }));
  const spread = bedSpread();
  fill(sleepPanel,
    el("h2", { id: "sleep-h" }, "Sleep and streak"),
    el("p", {}, el("span", { class: "big-num" }, String(today?.streak || 0)), el("span", { class: "muted" }, " study days in a row")),
    el("p", { class: "muted small" }, "A day counts with an hour or more of focus. A short day doesn't break the streak if you logged your sleep that day and do 2 hours or more the next."),
    el("div", { class: "form-grid" },
      el("label", { class: "field" }, "Hours slept", hours),
      el("label", { class: "field" }, "Bed time", bed),
      el("label", { class: "field" }, "Woke at", wake)),
    el("div", { class: "row" }, save),
    slept !== null && slept !== undefined
      ? el("p", { class: slept >= 420 ? "good" : "muted" }, slept >= 420 ? `${fmtMin(slept)} logged. That's 5 points.` : `${fmtMin(slept)} logged. Seven hours or more earns 5 points, and keeps what you learned.`)
      : el("p", { class: "muted small" }, "Seven hours or more earns 5 points."),
    spread !== null ? el("p", { class: spread <= 60 ? "good small" : "small" },
      `Bed times over your last ${sleepWeek.length} logged nights spread over ${fmtMin(spread)}. ${spread <= 60 ? "That's regular." : "Within an hour of the same time every night helps memory most."}`) : null);
}

// ---- tasks --------------------------------------------------------------------------------
function renderTasks() {
  const tasks = today?.tasks || [];
  const input = el("input", { type: "text", maxlength: 120, placeholder: "e.g. Percentages practice set", "aria-label": "New task" });
  const add = el("button", { type: "submit", class: "btn" }, "Add");
  const form = el("form", { class: "row" }, input, add);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    busy(add, async () => {
      today = await rpc("cat_task_add", { p_text: input.value.trim() });
      renderTasks();
    });
  });
  const list = tasks.map((t) => {
    const id = `task-${t.id}`;
    const box = el("input", { type: "checkbox", id, checked: t.done });
    box.addEventListener("change", () => busy(box, async () => {
      today = await rpc("cat_task_done", { p_task_id: t.id, p_done: box.checked });
      renderTasks();
    }));
    const del = el("button", { type: "button", class: "btn quiet small", "aria-label": `Delete ${t.text}` }, "Delete");
    del.addEventListener("click", () => busy(del, async () => {
      today = await rpc("cat_task_delete", { p_task_id: t.id });
      renderTasks();
    }));
    return el("li", {}, box, el("label", { for: id }, t.text), del);
  });
  fill(tasksPanel,
    el("h2", { id: "tasks-h" }, "Today's tasks"),
    list.length ? el("ul", { class: "tasks" }, list) : el("p", { class: "empty" }, "No tasks yet. Write down anything the plan doesn't cover."),
    tasks.length < 8 ? form : el("p", { class: "muted small" }, "Eight tasks is the limit for a day."),
    el("p", { class: "muted small" }, "Each task you tick earns 3 points, up to 5 a day."));
}

// ---- evening check-in -----------------------------------------------------------------------
function renderCheckin() {
  const c = today?.checkin;
  const evening = nowMin() >= 18 * 60;
  const yesterdayFix = lastCheckin && lastCheckin.day !== istToday() && lastCheckin.fix ? lastCheckin.fix : null;
  if (!evening && !c) {
    fill(checkinPanel,
      el("h2", { id: "checkin-h" }, "End-of-day check-in"),
      yesterdayFix ? el("p", { class: "notice" }, el("strong", {}, "Your fix from yesterday: "), yesterdayFix) : null,
      el("p", { class: "empty" }, "Opens at 18:00: four lines on how today went and one thing to change tomorrow."));
    return;
  }
  const hours = el("input", { type: "number", min: 0, max: 16, step: 0.5, inputmode: "decimal", value: c?.hours ?? String(Math.round(serverFocusMin() / 30) / 2), style: "width:5em" });
  const best = el("input", { type: "text", maxlength: 200, value: c?.best || "", placeholder: "e.g. 9 of 10 on the ratio set" });
  const worst = el("input", { type: "text", maxlength: 200, value: c?.worst || "", placeholder: "e.g. lost 20 minutes on one DILR set" });
  const fix = el("input", { type: "text", maxlength: 200, value: c?.fix || "", placeholder: "e.g. leave a set after 4 minutes if no entry point" });
  const save = el("button", { type: "button", class: "btn primary" }, c ? "Update" : "Save check-in");
  save.addEventListener("click", () => busy(save, async () => {
    today = await rpc("cat_checkin", { p_hours: hours.value === "" ? null : Number(hours.value), p_best: best.value, p_worst: worst.value, p_fix: fix.value });
    renderCheckin();
  }));
  fill(checkinPanel,
    el("h2", { id: "checkin-h" }, "End-of-day check-in"),
    el("div", { class: "form-grid" },
      el("label", { class: "field" }, "Hours studied", hours),
      el("label", { class: "field wide" }, "Best thing today", best),
      el("label", { class: "field wide" }, "What went worst", worst),
      el("label", { class: "field wide" }, "One fix for tomorrow", fix)),
    el("div", { class: "row" }, save, c ? el("span", { class: "good small" }, "Saved. Tomorrow morning this page shows your fix.") : null));
}

// ---- the week ------------------------------------------------------------------------------
function renderWeek() {
  const rows = board?.rows || [];
  const top = rows.slice(0, 5);
  const mine = rows.findIndex((r) => r.me);
  const g = weekGoal;
  const goalPct = g?.goalHours ? Math.min(100, Math.round((g.doneMin / (g.goalHours * 60)) * 100)) : 0;
  fill(weekPanel,
    el("h2", { id: "week-h" }, "This week's race"),
    g?.goalHours ? el("div", { class: "stack" },
      el("p", {}, el("strong", {}, "Group goal: "), `${fmtMin(g.doneMin)} of ${g.goalHours} hours together since ${fmtDate(g.from)}.`),
      el("div", { class: `meter${goalPct >= 100 ? " done" : ""}`, role: "progressbar", "aria-label": "Group goal this week", "aria-valuenow": String(goalPct), "aria-valuemin": "0", "aria-valuemax": "100" }, el("span", { style: `width:${goalPct}%` })))
      : me?.isAdmin ? el("p", { class: "muted small" }, "Set a group goal in hours for the week on the You page.") : null,
    top.length ? el("ol", { class: "race" }, top.map((r, i) => raceRow(r, i, rows[0]?.points || 1))) : el("p", { class: "empty" }, "No points yet this week. Start the timer to get on the board."),
    mine >= 5 ? el("p", {}, `You're ${mine + 1} of ${rows.length} with ${rows[mine].points} points.`) : null,
    el("p", {}, el("a", { href: "board.html" }, "Full board and how points work")));
}

function raceRow(r, i, leader) {
  return el("li", { class: r.me ? "me" : "" },
    el("span", { class: "pos" }, String(i + 1)),
    el("span", { class: "name" }, r.name),
    el("span", { class: "track", "aria-hidden": "true" }, el("span", { style: `width:${leader > 0 ? Math.round((r.points / leader) * 100) : 0}%` })),
    el("span", { class: "pts" }, String(r.points)));
}

// ---- data --------------------------------------------------------------------------------
async function loadToday() {
  today = await rpc("cat_today");
  renderNotice();
  renderPromise();
  renderTimer();
  renderTasks();
  renderSleep();
  renderPractice();
  renderPlan();
  renderCheckin();
}
async function loadPromises() {
  try {
    promises = await rpc("cat_promises");
    renderGroup();
  } catch (err) {
    showError(err);
  }
}
async function loadBoard() {
  try {
    [board, weekGoal] = await Promise.all([rpc("cat_board", { p_range: "week" }), rpc("cat_week_goal").catch(() => null)]);
    renderWeek();
  } catch {
    /* the race panel stays empty */
  }
}
async function loadSide() {
  const [index, topics, rd, bd, sw, ci, log] = await Promise.all([
    loadJson("tests/index.json").catch(() => []),
    loadJson("data/topics.json").catch(() => ({ topics: [] })),
    rpc("cat_readiness").catch(() => ({})),
    rpc("cat_buddy").catch(() => null),
    rpc("cat_sleep_week").catch(() => []),
    rpc("cat_checkins").catch(() => []),
    rpc("cat_focus_log").catch(() => []),
  ]);
  dailyTest = index.find((t) => t.id === `daily-${istToday()}`) || null;
  topicNames = Object.fromEntries(topics.topics.map((t) => [t.id, t.name]));
  readiness = rd || {};
  buddy = bd;
  sleepWeek = sw || [];
  lastCheckin = ci?.[0] || null;
  focusLog = log || [];
  renderPractice();
  renderGroup();
  renderSleep();
  renderCheckin();
  renderPlan();
}
async function loadPlanData() {
  try {
    [plan, calendar] = await Promise.all([loadPlan(), rpc("cat_calendar").catch(() => [])]);
    dp = dayPlan(plan, calendar);
    if (dp.paper) mocks = await rpc("cat_mocks").catch(() => null);
  } catch (err) {
    showError(err);
    return;
  }
  renderPlan();
  renderPaper();
  loadRoom();
}

function shortcuts(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.querySelector("dialog[open]")) return;
  const k = e.key.toLowerCase();
  const f = getFocus();
  if (k === "f") { if (f.mode === "focus") stopTimer(); else startFocus(); renderTimer(); }
  else if (k === "b" && f.mode === "focus") { startBreak(); renderTimer(); }
  else return;
  e.preventDefault();
}

async function init() {
  me = await boot("index.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  fill(main,
    el("div", { class: "page-head" }, el("h1", {}, `Today, ${me.name}`),
      el("a", { href: "exam-day.html", class: "small" }, "Exam-day page")),
    el("div", { class: "grid" }, nextPanel, promisePanel, noticePanel, introPanel, paperPanel, planPanel, timerPanel, groupPanel, practicePanel,
      checkinPanel, sleepPanel, weekPanel, tasksPanel));
  renderIntro();
  renderTimer();
  renderPlan();
  try {
    await loadToday();
  } catch (err) {
    main.prepend(el("p", { class: "notice error" }, err.message));
  }
  loadPlanData();
  loadNext();
  loadPromises();
  loadBoard();
  loadSide();
  syncFocus();
  window.addEventListener("cat:today", (e) => { today = e.detail; renderPromise(); renderSleep(); renderTimer(); });
  window.addEventListener("cat:reminders", () => { renderTimer(); });
  window.addEventListener("cat:now", (e) => { studyingNow = e.detail || []; renderGroup(); });
  window.addEventListener("cat:pulse", (e) => {
    studyingNow = e.detail.now || [];
    renderGroup();
    if (e.detail.nudges !== (today?.nudges || []).length) loadToday().catch(() => {});
  });
  window.addEventListener("keydown", shortcuts);
  setInterval(() => { loadPromises(); renderPromise(); renderPlan(); renderPaper(); }, 60000);
  setInterval(() => { loadBoard(); rpc("cat_focus_log").then((l) => { focusLog = l; renderPlan(); }).catch(() => {}); rpc("cat_buddy").then((b) => { buddy = b; renderGroup(); }).catch(() => {}); }, 5 * 60000);
  setInterval(loadRoom, 60000);
}

init();

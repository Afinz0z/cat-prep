// Today: the promise, the study timer, who's at the desk, tasks, sleep.
import { rpc } from "./db.js";
import { el, boot, busy, toast, fmtMin, fmtClock, fmtTime, istToday, loadJson, showError, fill } from "./ui.js";
import {
  startReminders, cacheSettings, getSettings, getFocus, startFocus, startBreak, stopTimer,
  focusTodayMs, syncFocus,
} from "./reminders.js";

const main = document.getElementById("main");
let me = null;
let today = null;
let promises = [];
let studyingNow = [];
let board = null;
let dailyTest = null;

// ---- panels --------------------------------------------------------------------
const promisePanel = el("section", { class: "panel promise span-7", "aria-labelledby": "promise-h" });
const timerPanel = el("section", { class: "panel span-5", "aria-labelledby": "timer-h" });
const groupPanel = el("section", { class: "panel span-7", "aria-labelledby": "group-h" });
const tasksPanel = el("section", { class: "panel span-6", "aria-labelledby": "tasks-h" });
const sleepPanel = el("section", { class: "panel span-5", "aria-labelledby": "sleep-h" });
const practicePanel = el("section", { class: "panel span-6", "aria-labelledby": "practice-h" });
const weekPanel = el("section", { class: "panel span-12", "aria-labelledby": "week-h" });

function serverFocusMin() {
  // Minutes on the board plus minutes this browser hasn't sent yet.
  const f = getFocus();
  const unsent = Math.max(0, Math.floor(focusTodayMs() / 60000) - (f.sentMin || 0));
  return (today?.focusMin || 0) + unsent;
}

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
  const hour = new Date(Date.now() + 330 * 60000).getUTCHours();
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  fill(promisePanel, 
    el("h2", { id: "promise-h" }, "Today's promise"),
    target
      ? [
        el("p", {}, el("span", { class: "big-num" }, fmtMin(done)), el("span", { class: "muted" }, ` of ${fmtMin(target)} promised`)),
        el("div", { class: `meter${done >= target ? " done" : ""}`, role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" },
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
      : null);
}

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
  fill(timerPanel, 
    el("h2", { id: "timer-h" }, "Study timer"),
    el("p", { class: "timer-mode" }, modeText),
    clock,
    el("div", { class: "row" }, buttons,
      f.mode !== "idle" ? el("button", { type: "button", class: "btn quiet", onclick: openFocusView }, "Full screen") : null),
    el("p", { class: "muted small" }, `Focus today: ${fmtMin(serverFocusMin())}.`,
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

function renderGroup() {
  const nowBy = Object.fromEntries(studyingNow.map((n) => [n.name, n]));
  const items = promises.map((p) => {
    const live = nowBy[p.name];
    const status = live ? (live.mode === "focus" ? `studying for ${fmtMin((Date.now() - Date.parse(live.since)) / 60000)}` : "on a break") : "";
    const nudge = !p.me && p.focusMin < 30
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
        status ? `, ${status}` : ""),
      nudge);
  });
  fill(groupPanel, 
    el("h2", { id: "group-h" }, "The group today"),
    items.length ? el("ul", { class: "people" }, items) : el("p", { class: "empty" }, "Nobody else has joined yet."),
    el("p", { class: "muted small" }, "Green dot: in a focus block now. Amber: on a break. You can nudge anyone with under 30 minutes today, once a day."));
}

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
    list.length ? el("ul", { class: "tasks" }, list) : el("p", { class: "empty" }, "No tasks yet. Write down the first thing you'll do."),
    tasks.length < 8 ? form : el("p", { class: "muted small" }, "Eight tasks is the limit for a day."),
    el("p", { class: "muted small" }, "Each task you tick earns 3 points, up to 5 a day."));
}

function renderSleep() {
  const slept = today?.sleepMin;
  const hours = el("input", { type: "number", inputmode: "decimal", min: 0, max: 14, step: 0.5, value: slept ? String(slept / 60) : "", "aria-label": "Hours slept last night", style: "width:6em" });
  const save = el("button", { type: "button", class: "btn" }, slept ? "Update" : "Log sleep");
  save.addEventListener("click", () => busy(save, async () => {
    today = await rpc("cat_sleep", { p_hours: Number(hours.value) });
    renderSleep();
  }));
  fill(sleepPanel, 
    el("h2", { id: "sleep-h" }, "Sleep and streak"),
    el("p", {}, el("span", { class: "big-num" }, String(today?.streak || 0)), el("span", { class: "muted" }, " study days in a row (an hour or more of focus each)")),
    el("div", { class: "row" }, el("label", {}, "Last night: ", hours, " hours"), save),
    slept !== null && slept !== undefined
      ? el("p", { class: slept >= 420 ? "good" : "muted" }, slept >= 420 ? `${fmtMin(slept)} logged. That's 5 points.` : `${fmtMin(slept)} logged. Seven hours or more earns 5 points, and keeps what you learned.`)
      : el("p", { class: "muted small" }, "Seven hours or more earns 5 points."));
}

function renderPractice() {
  const due = today?.reviewsDue || 0;
  fill(practicePanel, 
    el("h2", { id: "practice-h" }, "Practice for today"),
    el("ul", { class: "list" },
      el("li", {}, el("span", { class: "grow" }, el("strong", {}, "Review queue: "),
        due ? `${due} question${due === 1 ? "" : "s"} you got wrong ${due === 1 ? "is" : "are"} due again.` : "nothing due today."),
      due ? el("a", { class: "btn primary", href: "practice.html#reviews" }, "Review now") : null),
      el("li", {}, el("span", { class: "grow" }, el("strong", {}, "Daily 5: "),
        dailyTest ? `${dailyTest.title}. Five quick questions, same for everyone, ranked by marks then time.` : "no set for today."),
      dailyTest ? el("a", { class: "btn", href: `test.html?id=${encodeURIComponent(dailyTest.id)}` }, "Take it") : null),
      el("li", {}, el("span", { class: "grow" }, el("strong", {}, "Speed drill: "), "two minutes of squares, tables or fractions."),
        el("a", { class: "btn", href: "practice.html#drills" }, "Drill"))));
}

function renderWeek() {
  const rows = board?.rows || [];
  const top = rows.slice(0, 5);
  const mine = rows.findIndex((r) => r.me);
  fill(weekPanel, 
    el("h2", { id: "week-h" }, "This week's race"),
    top.length ? el("ol", { class: "race" }, top.map((r, i) => raceRow(r, i, rows[0]?.points || 1))) : el("p", { class: "empty" }, "No points yet this week."),
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

// ---- data ----------------------------------------------------------------------
async function loadToday() {
  today = await rpc("cat_today");
  renderPromise();
  renderTimer();
  renderTasks();
  renderSleep();
  renderPractice();
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
    board = await rpc("cat_board", { p_range: "week" });
    renderWeek();
  } catch {
    /* the race panel stays empty */
  }
}
async function loadDaily() {
  try {
    const index = await loadJson("tests/index.json");
    dailyTest = index.find((t) => t.id === `daily-${istToday()}`) || null;
  } catch {
    dailyTest = null;
  }
  renderPractice();
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
      el("a", { href: "exam-day.html", class: "small" }, "Exam-day checklist")),
    el("div", { class: "grid" }, promisePanel, timerPanel, groupPanel, sleepPanel, tasksPanel, practicePanel, weekPanel));
  renderTimer();
  try {
    await loadToday();
  } catch (err) {
    main.prepend(el("p", { class: "notice error" }, err.message));
  }
  loadPromises();
  loadBoard();
  loadDaily();
  syncFocus();
  window.addEventListener("cat:today", (e) => { today = e.detail; renderPromise(); renderSleep(); });
  window.addEventListener("cat:reminders", () => { renderTimer(); });
  window.addEventListener("cat:now", (e) => { studyingNow = e.detail || []; renderGroup(); });
  window.addEventListener("cat:pulse", (e) => {
    studyingNow = e.detail.now || [];
    renderGroup();
    if (e.detail.nudges !== (today?.nudges || []).length) loadToday().catch(() => {});
  });
  window.addEventListener("keydown", shortcuts);
  setInterval(() => { loadPromises(); renderPromise(); }, 60000);
  setInterval(loadBoard, 5 * 60000);
}

init();

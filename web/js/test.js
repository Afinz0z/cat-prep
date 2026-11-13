// CAT-style test player: instructions, timed sections, palette, results,
// and the discussion thread for each question once you've submitted.
import { rpc } from "./db.js";
import {
  el, richText, fmtClock, fmtDuration, fmtDateTime, boot, loadJson, confirmBox, busy, showError, markPostsSeen, fill,
  setTheme,
} from "./ui.js";
import { startReminders, cacheSettings, markTestRunning, getFocus, startFocus } from "./reminders.js";
import { createCalculator } from "./calculator.js";

const params = new URLSearchParams(location.search);
const screen = document.getElementById("main");
const timeLeftEl = document.getElementById("timeLeft");
const tabsEl = document.getElementById("sectionTabs");
const titleEl = document.getElementById("testTitle");
const calcBtn = document.getElementById("calcBtn");
const instrBtn = document.getElementById("instrBtn");
const paperBtn = document.getElementById("paperBtn");
const themeBtn = document.getElementById("themeBtn");
const dialog = document.getElementById("dialog");
const calc = createCalculator(document.getElementById("calc"));

// The legend wording and order follow the TCS iON screen.
const STATUS_LABEL = {
  answered: "Answered",
  notAnswered: "Not Answered",
  notVisited: "Not Visited",
  marked: "Marked for Review",
  answeredMarked: "Answered & Marked for Review",
};
const RESULT_LABEL = { correct: "Correct", wrong: "Wrong", skipped: "Blank" };
const RESULT_SHORT = { correct: "got it right", wrong: "got it wrong", skipped: "left it blank" };
const LETTERS = ["A", "B", "C", "D", "E"];

let test = null;
let member = null;
let state = null;
let draft = null;
let viewStartedAt = null;
let ticker = null;
let lastGroupId = null;
let lastGroupScroll = 0;

const storeKey = () => `cat-attempt-${test.id}`;
const save = () => {
  try {
    localStorage.setItem(storeKey(), JSON.stringify(state));
  } catch {
    /* storage full or blocked: the test still runs, but won't survive a reload */
  }
};
const section = () => test.sections[state.sectionIndex];
const question = () => section().questions[state.current];
const loadTest = (id) => loadJson(`tests/${encodeURIComponent(id)}.json`);

function statusOf(s) {
  if (!s.visited) return "notVisited";
  if (s.answer !== null && s.marked) return "answeredMarked";
  if (s.answer !== null) return "answered";
  if (s.marked) return "marked";
  return "notAnswered";
}

function showMessage(...nodes) {
  fill(screen, el("div", { class: "center-msg" }, ...nodes));
}

// ---- instructions ----------------------------------------------------------------
function instructionsContent() {
  const rows = test.sections.map((s) =>
    el("tr", {}, el("td", {}, s.name), el("td", {}, `${s.questions.length}`), el("td", {}, `${s.minutes} min`)));
  return [
    el("p", { class: "source-note" }, test.sourceNote || ""),
    el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, el("th", {}, "Section"), el("th", {}, "Questions"), el("th", {}, "Time"))),
      el("tbody", {}, rows)),
    el("h3", {}, "For this test"),
    el("ul", {}, (test.instructions || []).map((line) => el("li", {}, line))),
    el("h3", {}, "How the screen works (same as CAT)"),
    el("ul", {},
      el("li", {}, "Save & Next saves your answer and moves on. Mark for Review & Next saves it and flags it for a second look. A flagged answer still counts."),
      el("li", {}, "An answer you haven't saved doesn't count. If you jump to another question from the palette without saving, it's lost."),
      el("li", {}, "Clear Response removes the saved answer for the question on screen."),
      el("li", {}, "Type-in answers use the on-screen keypad, as in CAT. The physical keyboard doesn't type into them."),
      el("li", {}, "Each section has its own clock. When it runs out, the section ends and you can't go back to it."),
      el("li", {}, "If the page reloads by accident, the test resumes on this device. The clock keeps running in the meantime."),
      el("li", {}, "Only your first attempt counts for the board. After you submit, each question gets a discussion where the group compares approaches.")),
    legend(null, "legend legend-static"),
  ];
}

// counts: null on the instructions page, where the shapes stay empty.
function legend(counts, cls = "legend") {
  return el("div", { class: cls }, Object.entries(STATUS_LABEL).map(([key, label]) =>
    el("span", { class: key === "answeredMarked" ? "legend-item wide" : "legend-item" },
      el("span", { class: `pal pal-sample st-${key}` }, counts ? String(counts[key]) : ""),
      key === "answeredMarked" ? `${label} (will be considered for evaluation)` : label)));
}

// The grey stand-in for the candidate photo in the palette panel.
function silhouette() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 44 52");
  svg.setAttribute("class", "cand-photo");
  svg.setAttribute("aria-hidden", "true");
  const head = document.createElementNS(ns, "circle");
  head.setAttribute("cx", "22");
  head.setAttribute("cy", "19");
  head.setAttribute("r", "9");
  const body = document.createElementNS(ns, "path");
  body.setAttribute("d", "M5 52c0-11 7.6-18 17-18s17 7 17 18z");
  svg.append(head, body);
  return svg;
}

// Every question in the current section, as the Question Paper button shows it in CAT.
function questionPaper() {
  if (state?.phase !== "running") return;
  const sec = section();
  const shown = new Set();
  const items = [];
  sec.questions.forEach((q, i) => {
    const g = q.group ? (sec.groups || []).find((x) => x.id === q.group) : null;
    if (g && !shown.has(g.id)) {
      shown.add(g.id);
      items.push(el("div", { class: "qp-group" }, el("h3", {}, g.title || "Passage"), richText(g.text)));
    }
    items.push(el("div", { class: "qp-item" },
      el("strong", {}, `Question No. ${i + 1}`),
      el("div", { class: "q-text" }, richText(q.text)),
      q.type === "tita"
        ? el("p", { class: "muted small" }, "Type in the answer.")
        : el("ol", { class: "qp-options", type: "A" }, q.options.map((o) => el("li", {}, o)))));
  });
  dialog.classList.add("qp");
  fill(dialog, el("h2", {}, `Question Paper: ${sec.name}`), items,
    el("div", { class: "dialog-actions" }, el("button", { type: "button", class: "btn primary", onclick: () => dialog.close() }, "Close")));
  dialog.addEventListener("close", () => dialog.classList.remove("qp"), { once: true });
  dialog.showModal();
}

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}
function paintThemeBtn() {
  themeBtn.setAttribute("aria-pressed", String(isDark()));
}

function showInstructions() {
  tabsEl.replaceChildren();
  timeLeftEl.textContent = "--:--";
  const agree = el("input", { type: "checkbox", id: "agree" });
  const start = el("button", { type: "button", class: "btn primary", disabled: true, onclick: beginTest }, "I am ready to begin");
  agree.addEventListener("change", () => { start.disabled = !agree.checked; });
  fill(screen, el("div", { class: "instructions" },
    el("h1", {}, test.title),
    ...instructionsContent(),
    el("p", { class: "agree" }, agree, el("label", { for: "agree" }, " I have read the instructions.")),
    el("div", { class: "row" }, start, el("a", { href: "practice.html", class: "btn quiet" }, "Back to Practice"))));
}

// ---- running the test ----------------------------------------------------------
function beginTest() {
  const now = Date.now();
  state = {
    testId: test.id,
    clientAttemptId: crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`,
    startedAt: new Date(now).toISOString(),
    phase: "running",
    sectionIndex: 0,
    sectionStartedAt: now,
    sectionDeadline: now + test.sections[0].minutes * 60000,
    current: 0,
    sections: [],
    q: {},
  };
  for (const s of test.sections) {
    for (const q of s.questions) state.q[q.id] = { answer: null, marked: false, visited: false, visits: 0, timeSpentSec: 0 };
  }
  if (getFocus().mode !== "focus") startFocus({ prompt: false }); // test time counts as focus time
  save();
  runExam();
}

function runExam() {
  paperBtn.disabled = false;
  window.addEventListener("beforeunload", warnOnLeave);
  window.addEventListener("pagehide", () => { if (state?.phase === "running") { leaveQuestion(); save(); } });
  visit(state.current);
  startTicker();
}

function warnOnLeave(e) {
  if (state?.phase === "running") {
    e.preventDefault();
    e.returnValue = "";
  }
}

function leaveQuestion() {
  if (viewStartedAt === null || !state) return;
  const s = state.q[question().id];
  s.timeSpentSec += (Date.now() - viewStartedAt) / 1000;
  viewStartedAt = null;
}

function visit(index) {
  leaveQuestion();
  state.current = index;
  const s = state.q[question().id];
  s.visited = true;
  s.visits += 1;
  draft = s.answer;
  viewStartedAt = Date.now();
  save();
  renderExam();
}

function commit(marked) {
  const s = state.q[question().id];
  const value = draft === null || draft === undefined ? "" : String(draft).trim();
  s.answer = value === "" || value === "-" || value === "." ? null : value;
  s.marked = marked;
  visit((state.current + 1) % section().questions.length);
}

function clearResponse() {
  const s = state.q[question().id];
  s.answer = null;
  draft = null;
  save();
  renderExam();
}

function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(tick, 250);
  tick();
}

let lastBeat = 0;
function tick() {
  if (!state || state.phase !== "running") return;
  const left = state.sectionDeadline - Date.now();
  timeLeftEl.textContent = fmtClock(left);
  timeLeftEl.classList.toggle("low", left < 5 * 60000);
  if (Date.now() - lastBeat > 20000) {
    markTestRunning(true);
    lastBeat = Date.now();
  }
  if (left <= 0) finishSection("time");
}

function endSection(reason) {
  leaveQuestion();
  const endAt = reason === "time" ? state.sectionDeadline : Date.now();
  state.sections[state.sectionIndex] = {
    name: section().name,
    timeUsedSec: Math.round((endAt - state.sectionStartedAt) / 1000),
    endedBy: reason,
  };
  calc.close();
  if (dialog.open) dialog.close();
  if (state.sectionIndex < test.sections.length - 1) {
    state.sectionIndex += 1;
    state.sectionStartedAt = endAt;
    state.sectionDeadline = endAt + section().minutes * 60000;
    state.current = 0;
    save();
    return "next";
  }
  state.phase = "submitting";
  state.payload = buildPayload();
  save();
  return "done";
}

function finishSection(reason) {
  const outcome = endSection(reason);
  if (outcome === "next") {
    visit(0);
    showBanner(`${section().name} has started. ${section().minutes} minutes on the clock.`);
  } else {
    submit();
  }
}

// After a reload, end every section whose clock ran out while the page was closed.
function catchUp() {
  let outcome = null;
  while (state.phase === "running" && Date.now() >= state.sectionDeadline) outcome = endSection("time");
  return outcome;
}

function buildPayload() {
  const questions = [];
  for (const s of test.sections) {
    for (const q of s.questions) {
      const st = state.q[q.id];
      questions.push({
        id: q.id,
        answer: st.answer,
        status: statusOf(st),
        timeSpentSec: Math.round(st.timeSpentSec * 10) / 10,
        visits: st.visits,
      });
    }
  }
  return {
    testId: test.id,
    clientAttemptId: state.clientAttemptId,
    startedAt: state.startedAt,
    sections: state.sections,
    questions,
  };
}

let retryOnline = null;
async function submit() {
  clearInterval(ticker);
  markTestRunning(false);
  window.removeEventListener("beforeunload", warnOnLeave);
  timeLeftEl.textContent = "00:00";
  showMessage(el("p", {}, "Submitting your answers..."));
  try {
    const rec = await rpc("cat_submit", { p_attempt: state.payload });
    try {
      localStorage.removeItem(storeKey());
    } catch {
      /* nothing saved to remove */
    }
    if (retryOnline) window.removeEventListener("online", retryOnline);
    history.replaceState(null, "", `test.html?attempt=${encodeURIComponent(rec.attemptId)}`);
    renderResults(rec);
  } catch (err) {
    // The answers stay in this browser and go up as soon as the connection is back.
    if (!retryOnline) {
      retryOnline = () => submit();
      window.addEventListener("online", retryOnline);
    }
    showMessage(
      el("p", {}, "Your answers are saved in this browser but haven't reached the site yet."),
      el("p", { class: "muted" }, err.message),
      el("p", {}, "They'll send by themselves when the internet is back, or press the button."),
      el("button", { type: "button", class: "btn primary", onclick: submit }, "Try again"));
  }
}

function showBanner(text) {
  const banner = el("div", { class: "section-banner", role: "status" }, text);
  document.body.append(banner);
  setTimeout(() => banner.remove(), 6000);
}

// ---- exam rendering --------------------------------------------------------------
function renderTabs() {
  fill(tabsEl, ...test.sections.map((s, i) => {
    const cls = i === state.sectionIndex ? "current" : i < state.sectionIndex ? "done" : "upcoming";
    return el("li", { class: cls, "aria-current": i === state.sectionIndex ? "step" : null }, s.name);
  }));
}

function keypad(input) {
  const pressKey = (k) => {
    let cur = draft === null || draft === undefined ? "" : String(draft);
    if (k === "Backspace") cur = cur.slice(0, -1);
    else if (k === "Clear All") cur = "";
    else if (k === "-") cur = cur === "" ? "-" : cur;
    else if (k === ".") cur = cur.includes(".") ? cur : `${cur}.`;
    else if (cur.length < 15) cur += k;
    draft = cur === "" ? null : cur;
    input.value = cur;
  };
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", ".", "-"];
  return el("div", { class: "keypad" },
    el("button", { type: "button", class: "key key-wide", onclick: () => pressKey("Backspace") }, "Backspace"),
    keys.map((k) => el("button", { type: "button", class: "key", onclick: () => pressKey(k) }, k)),
    el("button", { type: "button", class: "key key-wide", onclick: () => pressKey("Clear All") }, "Clear All"));
}

function answerArea(q) {
  if (q.type === "tita") {
    const input = el("input", { class: "tita-input", type: "text", readonly: true, value: draft ?? "", "aria-label": "Your answer", inputmode: "none" });
    return el("div", { class: "tita" }, el("label", { class: "tita-label" }, "Your answer"), input, keypad(input));
  }
  return el("fieldset", { class: "options" },
    el("legend", { class: "sr-only" }, "Options"),
    q.options.map((text, i) => {
      const letter = LETTERS[i];
      const radio = el("input", { type: "radio", name: `opt-${q.id}`, value: letter, checked: draft === letter });
      radio.addEventListener("change", () => { draft = letter; });
      return el("label", { class: "option" }, radio, el("span", { class: "opt-letter" }, `${letter}.`), el("span", {}, text));
    }));
}

function renderExam() {
  renderTabs();
  const sec = section();
  const q = question();
  const group = q.group ? (sec.groups || []).find((g) => g.id === q.group) : null;
  const oldPane = screen.querySelector(".group-pane");
  if (oldPane && lastGroupId) lastGroupScroll = oldPane.scrollTop;

  const qPane = el("div", { class: "q-pane" },
    el("div", { class: "q-text" }, richText(q.text)),
    q.hint ? el("p", { class: "q-hint" }, q.hint) : null,
    answerArea(q));
  const groupPane = group
    ? el("article", { class: "group-pane" }, el("h2", {}, group.title || ""), richText(group.text))
    : null;

  const counts = { answered: 0, notAnswered: 0, notVisited: 0, marked: 0, answeredMarked: 0 };
  const palette = sec.questions.map((item, i) => {
    const st = statusOf(state.q[item.id]);
    counts[st] += 1;
    return el("button", {
      type: "button",
      class: `pal st-${st}${i === state.current ? " current" : ""}`,
      title: STATUS_LABEL[st],
      "aria-label": `Question ${i + 1}, ${STATUS_LABEL[st]}`,
      onclick: () => visit(i),
    }, String(i + 1));
  });

  const aside = el("aside", { class: "palette-area", "aria-label": "Question palette" },
    el("div", { class: "candidate" }, silhouette(), el("span", { class: "cand-name" }, member?.name || "")),
    legend(counts),
    el("h2", { class: "palette-title" }, sec.name),
    el("p", { class: "palette-choose" }, "Choose a Question"),
    el("div", { class: "palette" }, palette),
    test.strict ? null : el("button", { type: "button", class: "btn submit-section", onclick: askSubmitSection },
      state.sectionIndex < test.sections.length - 1 ? "Submit section" : "Submit test"));

  const tita = q.type === "tita";
  const mainArea = el("section", { class: "q-area" },
    el("div", { class: "q-meta" },
      el("span", {}, "Question Type : ", el("strong", {}, tita ? "TITA" : "MCQ")),
      el("span", { class: "q-marks" }, "Marks for correct answer: ", el("strong", { class: "plus" }, "3"),
        " | Negative Marks: ", el("strong", { class: "minus" }, tita ? "0" : "1"))),
    el("div", { class: "q-num" }, `Question No. ${state.current + 1}`),
    el("div", { class: group ? "q-body split" : "q-body" }, groupPane, qPane),
    el("div", { class: "q-actions" },
      el("button", { type: "button", class: "btn", onclick: () => commit(true) }, "Mark for Review & Next"),
      el("button", { type: "button", class: "btn", onclick: clearResponse }, "Clear Response"),
      el("button", { type: "button", class: "btn primary", onclick: () => commit(false) }, "Save & Next")));

  fill(screen, el("div", { class: "exam-grid" }, mainArea, aside));
  if (groupPane) {
    groupPane.scrollTop = group.id === lastGroupId ? lastGroupScroll : 0;
    lastGroupId = group.id;
  } else {
    lastGroupId = null;
  }
}

async function askSubmitSection() {
  const counts = { answered: 0, notAnswered: 0, notVisited: 0, marked: 0, answeredMarked: 0 };
  for (const q of section().questions) counts[statusOf(state.q[q.id])] += 1;
  const last = state.sectionIndex === test.sections.length - 1;
  const ok = await confirmBox(last ? "Submit the test?" : `Submit ${section().name}?`, [
    `Answered: ${counts.answered + counts.answeredMarked} (of which marked for review: ${counts.answeredMarked}). Not answered: ${counts.notAnswered + counts.marked}. Not visited: ${counts.notVisited}.`,
    `You still have ${fmtClock(state.sectionDeadline - Date.now())} on the clock. Once submitted, you can't come back to this section.`,
  ], last ? "Submit test" : "Submit section");
  if (ok && state.phase === "running") finishSection("submit");
}

// ---- results -------------------------------------------------------------------------
function pct(x) {
  return x === null || x === undefined ? "none attempted" : `${Math.round(x * 100)}%`;
}

function timeAnalysis(rec, qdefs) {
  const qs = rec.questions;
  const attempted = qs.filter((q) => q.result !== "skipped");
  const onWrong = qs.filter((q) => q.result === "wrong").reduce((s, q) => s + q.timeSpentSec, 0);
  const onBlank = qs.filter((q) => q.result === "skipped").reduce((s, q) => s + q.timeSpentSec, 0);
  const onRight = qs.filter((q) => q.result === "correct").reduce((s, q) => s + q.timeSpentSec, 0);
  const slow = qs.slice().sort((a, b) => b.timeSpentSec - a.timeSpentSec).slice(0, 3).filter((q) => q.timeSpentSec > 0);
  const wrongMcq = qs.filter((q) => q.result === "wrong" && qdefs[q.id]?.type === "mcq").length;
  const wrongTita = qs.filter((q) => q.result === "wrong" && qdefs[q.id]?.type === "tita").length;
  return el("section", { class: "panel" },
    el("h2", {}, "Where the time and marks went"),
    el("ul", {},
      el("li", {}, `On questions you got right: ${fmtDuration(onRight)}${rec.totals.correct ? `, about ${fmtDuration(onRight / rec.totals.correct)} each` : ""}.`),
      el("li", { class: onWrong > onRight ? "bad" : null }, `On questions you got wrong: ${fmtDuration(onWrong)}. That time bought nothing.`),
      el("li", {}, `On questions you left blank: ${fmtDuration(onBlank)}.`),
      attempted.length ? null : el("li", {}, "No questions attempted."),
      slow.length ? el("li", {}, "Slowest: ", slow.map((q) => `Q${q.number} (${fmtDuration(q.timeSpentSec)}, ${RESULT_LABEL[q.result].toLowerCase()})`).join(", "), ".") : null,
      el("li", { class: wrongMcq ? "bad" : null }, wrongMcq
        ? `Negative marking cost you ${wrongMcq} mark${wrongMcq === 1 ? "" : "s"} (${wrongMcq} wrong multiple-choice). Without those guesses you'd have ${rec.totals.marks + wrongMcq}.`
        : "No marks lost to negative marking."),
      wrongTita ? el("li", {}, `${wrongTita} wrong type-in answer${wrongTita === 1 ? "" : "s"} cost nothing. Always answer type-in questions.`) : null));
}

function download(rec) {
  const blob = new Blob([JSON.stringify(rec, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `${rec.testId}-attempt-${rec.attemptId}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function dailyRanking(rec) {
  if (!rec.testId.startsWith("daily-")) return null;
  try {
    const rows = await rpc("cat_daily", { p_test_id: rec.testId });
    return el("section", { class: "panel" }, el("h2", {}, "Today's Daily 5 ranking"),
      el("div", { class: "table-wrap" }, el("table", { class: "plain" },
        el("thead", {}, el("tr", {}, el("th", {}, "#"), el("th", {}, "Name"), el("th", { class: "n" }, "Marks"), el("th", { class: "n" }, "Right"), el("th", { class: "n" }, "Wrong"), el("th", { class: "n" }, "Time"))),
        el("tbody", {}, rows.map((r, i) => el("tr", { class: r.me ? "me" : "" },
          el("td", {}, String(i + 1)), el("td", {}, r.name), el("td", { class: "n" }, String(r.marks)),
          el("td", { class: "n" }, String(r.correct)), el("td", { class: "n" }, String(r.wrong)), el("td", { class: "n" }, fmtDuration(r.timeSec))))))),
      el("p", { class: "muted small" }, "First attempts only. Ties go to whoever was faster."));
  } catch {
    return null;
  }
}

async function renderResults(rec) {
  titleEl.textContent = `${rec.testTitle}: results`;
  document.title = `${rec.testTitle}: results`;
  calcBtn.hidden = true;
  instrBtn.hidden = true;
  paperBtn.hidden = true;
  document.querySelector(".section-bar").hidden = true;
  tabsEl.replaceChildren();
  timeLeftEl.textContent = "--:--";
  if (!test || test.id !== rec.testId) test = await loadTest(rec.testId);
  const qdefs = Object.fromEntries(test.sections.flatMap((s) => s.questions.map((q) => [q.id, q])));
  const t = rec.totals;
  const timeUsed = rec.sections.reduce((sum, s) => sum + (s.timeUsedSec || 0), 0);
  const lastRetry = {};
  for (const r of rec.retries || []) Object.assign(lastRetry, r.results);
  const revealed = Boolean(rec.revealedAt);
  const all = await rpc("cat_attempts").catch(() => []);
  const firstId = all.filter((a) => a.testId === rec.testId).sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))[0]?.attemptId;
  const isFirst = firstId === undefined || firstId === rec.attemptId;
  const summaryInfo = await rpc("cat_thread_summary", { p_test_id: rec.testId }).catch(() => ({ open: false }));
  rpc("cat_pulse", { p_chat_after: 0, p_posts_after: 0 }).then((p) => markPostsSeen(p.postsLatest)).catch(() => {});

  const summary = el("table", { class: "plain summary" }, el("tbody", {},
    el("tr", {}, el("th", {}, "Marks"), el("td", {}, `${t.marks}`)),
    el("tr", {}, el("th", {}, "Correct"), el("td", {}, `${t.correct}`)),
    el("tr", {}, el("th", {}, "Wrong"), el("td", {}, `${t.wrong}`)),
    el("tr", {}, el("th", {}, "Left blank"), el("td", {}, `${t.skipped}`)),
    el("tr", {}, el("th", {}, "Accuracy"), el("td", {}, pct(t.accuracy))),
    el("tr", {}, el("th", {}, "Time used"), el("td", {}, fmtDuration(timeUsed)))));

  const head = ["No.", "Your answer", "Result", "Time", "Visits"];
  if (Object.keys(lastRetry).length) head.push("Retry");
  if (revealed) head.push("Correct answer");
  head.push("Group");
  const rows = [];
  for (const q of rec.questions) {
    const info = summaryInfo.questions?.[q.id];
    const threadRow = el("tr", { class: "thread-row", hidden: true }, el("td", { colspan: String(head.length) }));
    const discuss = el("button", { type: "button", class: "btn small" },
      info ? `${info.posts} approach${info.posts === 1 ? "" : "es"}` : "Discuss");
    discuss.addEventListener("click", () => toggleThread(rec, q, qdefs[q.id], threadRow, discuss));
    rows.push(el("tr", { class: `res-${q.result}`, id: `q-${q.id}` },
      el("td", {}, String(q.number)),
      el("td", {}, q.answer ?? ""),
      el("td", { class: "res-cell" }, RESULT_LABEL[q.result] + (q.status === "answeredMarked" ? ", marked" : "")),
      el("td", {}, fmtDuration(q.timeSpentSec)),
      el("td", {}, String(q.visits)),
      Object.keys(lastRetry).length ? el("td", {}, lastRetry[q.id] ? RESULT_LABEL[lastRetry[q.id]] : "") : null,
      revealed ? el("td", {}, String(rec.reveal?.[q.id]?.answer ?? "")) : null,
      el("td", {}, info ? el("span", { class: "muted small" }, `${info.right} of ${info.done} right `) : null, discuss)));
    rows.push(threadRow);
  }
  const table = el("div", { class: "table-wrap" }, el("table", { class: "plain results" },
    el("thead", {}, el("tr", {}, head.map((h) => el("th", {}, h)))), el("tbody", {}, rows)));

  const toRetry = rec.questions.filter((q) => q.result !== "correct" && lastRetry[q.id] !== "correct");
  const retryBlock = revealed || !toRetry.length ? null : retryPanel(rec, toRetry, qdefs);
  const revealBlock = revealed ? solutionsPanel(rec, qdefs) : el("section", { class: "panel" },
    el("h2", {}, "Correct answers"),
    el("p", {}, "They stay hidden so you can retry first. Once you show them, retries close for this attempt."),
    el("button", { type: "button", class: "btn", onclick: () => askReveal(rec) }, "Show correct answers and solutions"));
  const dl = el("button", { type: "button", class: "btn" }, "Download my results");
  dl.addEventListener("click", () => download(rec));

  fill(screen, el("div", { class: "results-page" },
    el("h1", {}, `${rec.testTitle}: results`),
    el("p", { class: "source-note" }, `Submitted ${fmtDateTime(rec.submittedAt)}.`,
      isFirst ? " This is your first attempt, so it counts for the board." : " A later attempt: the board keeps your first."),
    el("div", { class: "results-top" }, summary,
      el("div", { class: "panel" },
        el("h2", {}, "Next step"),
        el("p", {}, "Retry the wrong ones first. Then open the group column on each question to compare approaches; the quickest method is often not the one you used."),
        el("div", { class: "row" }, el("a", { class: "btn", href: "practice.html" }, "Back to Practice"), dl))),
    await dailyRanking(rec),
    timeAnalysis(rec, qdefs),
    retryBlock,
    el("h2", {}, "Question by question"),
    table,
    revealBlock));
  const target = location.hash.match(/^#q-(.+)$/)?.[1];
  if (target) {
    const row = document.getElementById(`q-${target}`);
    row?.scrollIntoView({ block: "center" });
    row?.querySelector("td:last-child button")?.click();
  }
}

// ---- discussion threads --------------------------------------------------------------
async function toggleThread(rec, q, def, row, button) {
  if (!row.hidden) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  const cell = row.firstChild;
  fill(cell, el("p", { class: "muted" }, "Loading the discussion..."));
  try {
    paintThread(rec, q, def, cell, await rpc("cat_thread", { p_test_id: rec.testId, p_question_id: q.id }), button);
  } catch (err) {
    fill(cell, el("p", { class: "notice error" }, err.message));
  }
}

function paintThread(rec, q, def, cell, th, button) {
  button.textContent = `${th.posts.length} approach${th.posts.length === 1 ? "" : "es"}`;
  const text = el("textarea", { maxlength: 1500, placeholder: "How did you get it? Steps, the trick you spotted, or where you went wrong." });
  const post = el("button", { type: "button", class: "btn primary" }, "Post approach");
  post.addEventListener("click", () => busy(post, async () => {
    if (!text.value.trim()) return;
    paintThread(rec, q, def, cell, await rpc("cat_thread_post", { p_test_id: rec.testId, p_question_id: q.id, p_text: text.value }), button);
  }));
  const note = el("input", { type: "text", maxlength: 500, value: th.bookmark?.note || "", placeholder: "Note to yourself (optional)", "aria-label": "Bookmark note" });
  const mark = el("button", { type: "button", class: "btn" }, th.bookmark ? "Update bookmark" : "Bookmark");
  mark.addEventListener("click", () => busy(mark, async () => {
    await rpc("cat_bookmark_set", { p_test_id: rec.testId, p_question_id: q.id, p_on: true, p_note: note.value });
    th.bookmark = { note: note.value };
    paintThread(rec, q, def, cell, th, button);
  }));
  const unmark = th.bookmark ? el("button", { type: "button", class: "btn quiet" }, "Remove bookmark") : null;
  unmark?.addEventListener("click", () => busy(unmark, async () => {
    await rpc("cat_bookmark_set", { p_test_id: rec.testId, p_question_id: q.id, p_on: false, p_note: "" });
    th.bookmark = null;
    paintThread(rec, q, def, cell, th, button);
  }));
  fill(cell, el("div", { class: "thread" },
    el("p", {}, el("strong", {}, `Q${q.number}. `), def?.text || ""),
    def?.type === "mcq" ? el("p", { class: "muted small" }, def.options.map((o, i) => `${LETTERS[i]}. ${o}`).join("   ")) : null,
    el("p", { class: "muted small" }, `You ${RESULT_SHORT[th.mine] || "didn't attempt it"} first time. ${th.right} of ${th.done} in the group got it right first time. Approaches can give the answer away, so retry first if you want to.`),
    th.posts.length ? th.posts.map((p) => postItem(rec, q, def, cell, p, button)) : el("p", { class: "empty" }, "No approaches yet. Be the first; 40 characters or more earns 3 points."),
    el("div", { class: "stack" }, text, el("div", { class: "row" }, post)),
    el("div", { class: "row" }, note, mark, unmark)));
}

function postItem(rec, q, def, cell, p, button) {
  const vote = p.me ? null : el("button", { type: "button", class: `btn small${p.voted ? " on" : ""}`, "aria-pressed": String(p.voted) }, p.voted ? "Helpful (yours)" : "Helpful");
  vote?.addEventListener("click", () => busy(vote, async () => {
    paintThread(rec, q, def, cell, await rpc("cat_post_vote", { p_post_id: p.id, p_on: !p.voted }), button);
  }));
  const del = p.me ? el("button", { type: "button", class: "btn quiet small" }, "Delete") : null;
  del?.addEventListener("click", () => busy(del, async () => {
    await rpc("cat_post_delete", { p_post_id: p.id });
    paintThread(rec, q, def, cell, await rpc("cat_thread", { p_test_id: rec.testId, p_question_id: q.id }), button);
  }));
  return el("div", { class: "post" },
    el("div", { class: "post-head" }, el("strong", {}, p.name), el("span", {}, RESULT_SHORT[p.result] || ""), el("span", {}, fmtDateTime(p.at)),
      el("span", {}, `${p.votes} found it helpful`)),
    el("p", { class: "post-body" }, p.text),
    el("div", { class: "row" }, vote, del));
}

function retryPanel(rec, list, qdefs) {
  const inputs = {};
  const items = list.map((q) => {
    const def = qdefs[q.id];
    let field;
    if (def.type === "tita") {
      field = el("input", { type: "text", class: "retry-input", inputmode: "decimal", "aria-label": `Retry answer for question ${q.number}` });
      inputs[q.id] = () => field.value;
    } else {
      const name = `retry-${q.id}`;
      field = el("div", {}, def.options.map((text, i) =>
        el("label", { class: "option" }, el("input", { type: "radio", name, value: LETTERS[i] }), el("span", { class: "opt-letter" }, `${LETTERS[i]}.`), el("span", {}, text))));
      inputs[q.id] = () => field.querySelector("input:checked")?.value || "";
    }
    return el("li", { class: "retry-item" },
      el("p", {}, el("strong", {}, `Q${q.number}. `), def.text || ""),
      el("p", { class: "muted" }, q.answer ? `You answered ${q.answer}.` : "You left it blank."),
      field);
  });
  const status = el("p", { class: "status-line", role: "status" });
  const check = el("button", { type: "button", class: "btn primary" }, "Check my retries");
  check.addEventListener("click", async () => {
    const answers = {};
    for (const [id, read] of Object.entries(inputs)) {
      const v = read().trim();
      if (v) answers[id] = v;
    }
    if (!Object.keys(answers).length) {
      status.textContent = "Type at least one answer first.";
      return;
    }
    await busy(check, async () => {
      renderResults(await rpc("cat_retry", { p_attempt_id: rec.attemptId, p_answers: answers }));
    });
  });
  return el("section", { class: "panel" },
    el("h2", {}, `Try again, untimed (${list.length})`),
    el("p", {}, "These are the questions you got wrong or left blank. The keyboard works here. You'll only see right or wrong, not the answer."),
    el("ol", { class: "retry-list" }, items),
    check,
    status);
}

function solutionsPanel(rec, qdefs) {
  return el("section", { class: "panel" },
    el("h2", {}, "Solutions"),
    el("ol", { class: "solutions" }, rec.questions.map((q) => {
      const rv = rec.reveal?.[q.id] || {};
      return el("li", { value: String(q.number) },
        el("p", {}, qdefs[q.id]?.text || ""),
        el("p", {}, el("strong", {}, `Answer: ${rv.answer ?? ""}. `), rv.solution || ""));
    })));
}

async function askReveal(rec) {
  const ok = await confirmBox("Show the correct answers?", [
    "After this you can't retry the questions in this attempt.",
    "It's usually better to retry the wrong ones first, then look.",
  ], "Show answers");
  if (!ok) return;
  try {
    renderResults(await rpc("cat_reveal", { p_attempt_id: rec.attemptId }));
  } catch (err) {
    showError(err);
  }
}

// ---- start -------------------------------------------------------------------------
async function init() {
  paintThemeBtn();
  themeBtn.addEventListener("click", () => { setTheme(isDark() ? "light" : "dark"); paintThemeBtn(); });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", paintThemeBtn);
  paperBtn.addEventListener("click", questionPaper);
  const me = await boot("test.html");
  member = me;
  if (!me) {
    calcBtn.hidden = true;
    instrBtn.hidden = true;
    paperBtn.hidden = true;
    titleEl.textContent = "CAT prep group";
    return;
  }
  cacheSettings(me.settings);
  startReminders({ inTest: true });
  calcBtn.addEventListener("click", () => calc.toggle());
  instrBtn.addEventListener("click", () => {
    if (!test) return;
    fill(dialog, el("h2", {}, "Instructions"), ...instructionsContent(),
      el("div", { class: "dialog-actions" }, el("button", { type: "button", class: "btn primary", onclick: () => dialog.close() }, "Close")));
    dialog.showModal();
  });
  try {
    const attemptId = params.get("attempt");
    if (attemptId) return renderResults(await rpc("cat_attempt", { p_attempt_id: Number(attemptId) }));
    const id = params.get("id");
    if (!id) return showMessage(el("p", {}, "No test chosen."), el("a", { href: "practice.html" }, "Pick one on the Practice page"));
    test = await loadTest(id);
  } catch (err) {
    return showMessage(el("p", {}, err.message), el("a", { href: "practice.html" }, "Back to Practice"));
  }
  titleEl.textContent = test.title;
  document.title = test.title;
  if (test.calculator === false) calcBtn.hidden = true;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(storeKey()) || "null");
  } catch {
    saved = null;
  }
  if (saved?.phase === "submitting") {
    state = saved;
    return submit();
  }
  if (saved?.phase === "running") {
    state = saved;
    if (catchUp() === "done") return submit();
    showBanner("Test resumed. The clock kept running while the page was closed.");
    return runExam();
  }
  showInstructions();
}

init();

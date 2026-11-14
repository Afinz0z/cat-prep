// Practice: site tests, the review queue, the error log, formula cards, speed
// drills, the RC log, the DILR set-choice drill, search and bookmarks.
import { rpc } from "./db.js";
import { el, boot, busy, loadJson, istToday, fmtDate, fmtDateTime, fmtTime, showError, fill } from "./ui.js";
import { startReminders, cacheSettings } from "./reminders.js";
import { createCalculator } from "./calculator.js";
import { openComposed, isoDow } from "./plan.js";
import { errorsView, searchView, cardsView, rcView, choiceView } from "./practice-more.js";

const main = document.getElementById("main");
const LETTERS = ["A", "B", "C", "D", "E"];
const testCache = {};
let index = [];
let attempts = [];

async function testDef(id) {
  testCache[id] = testCache[id] || loadJson(`tests/${encodeURIComponent(id)}.json`);
  return testCache[id];
}
function findQuestion(test, qid) {
  for (const s of test.sections) for (const q of s.questions) if (q.id === qid) return q;
  return null;
}
function firstAttempts() {
  const first = {};
  for (const a of attempts.slice().sort((x, y) => Date.parse(x.submittedAt) - Date.parse(y.submittedAt))) {
    if (!first[a.testId]) first[a.testId] = a;
  }
  return first;
}

// ---- tests ---------------------------------------------------------------------
function testItem(t, first, today) {
  const a = first[t.id];
  const count = t.sections.reduce((n, x) => n + x.count, 0);
  const minutes = t.sections.reduce((n, x) => n + x.minutes, 0);
  const locked = t.opensOn && t.opensOn > today;
  return el("li", {},
    el("span", { class: "grow" }, el("strong", {}, t.title), el("br"),
      el("span", { class: "muted small" }, `${count} questions, ${minutes} minutes`, t.difficulty ? `, ${t.difficulty}` : "",
        a ? `. First try: ${a.totals.marks} marks, ${a.totals.correct} right, ${a.totals.wrong} wrong.` : ".",
        locked ? ` Opens on ${fmtDate(t.opensOn)}, so the first try is fresh.` : "")),
    a ? el("a", { class: "btn", href: `test.html?attempt=${a.attemptId}` }, "Results and discussion") : null,
    locked ? el("button", { type: "button", class: "btn", disabled: true }, "Not open yet")
      : el("a", { class: a ? "btn quiet" : "btn primary", href: `test.html?id=${encodeURIComponent(t.id)}` }, a ? "Take again" : "Start"));
}

function composedPanel(today) {
  const sunday = isoDow(today) === 0;
  const mixed = el("button", { type: "button", class: "btn primary" }, "Today's mixed set");
  mixed.addEventListener("click", () => busy(mixed, () => openComposed("mixed")));
  const retest = el("button", { type: "button", class: "btn", disabled: !sunday }, sunday ? "This week's retest" : "Retest opens on Sunday");
  retest.addEventListener("click", () => busy(retest, () => openComposed("retest")));
  return el("section", { class: "panel" },
    el("h2", {}, "Mixed sets and the Sunday retest"),
    el("p", { class: "muted" }, "A mixed set is 10 questions from topics you started 3 to 5 days ago, in random order, so you have to pick the method before you solve. On Sundays the retest gives you back the questions you missed that week. Each is worth 10 points."),
    el("div", { class: "row" }, mixed, retest));
}

async function cosolvePanel(today) {
  const sets = index.filter((t) => String(t.topic || "").startsWith("dilr-"));
  const [list, people] = await Promise.all([rpc("cat_cosolves"), rpc("cat_profiles")]);
  const titles = Object.fromEntries(index.map((t) => [t.id, t.title]));
  const panel = el("section", { class: "panel", id: "cosolve" });
  const listHost = el("div");
  const paint = (rows) => fill(listHost, rows.length ? el("ul", { class: "list" }, rows.map((c) => el("li", {},
    el("span", { class: "grow" }, el("strong", {}, titles[c.testId] || c.testId), el("br"),
      el("span", { class: "muted small" }, `${c.mine ? `With ${c.partner}` : `${c.host} invited you`}, starting at ${fmtTime(c.startsAt)}${fmtDate(c.startsAt) === fmtDate(today) ? "" : ` on ${fmtDate(c.startsAt)}`}.`)),
    el("a", { class: "btn primary", href: `test.html?id=${encodeURIComponent(c.testId)}&cosolve=${c.id}` }, "Open"))))
    : el("p", { class: "muted small" }, "No invitations right now."));
  paint(list);
  const others = people.filter((x) => !x.me);
  if (!others.length || !sets.length) {
    fill(panel, el("h2", {}, "Co-solve a DILR set"), listHost);
    return panel;
  }
  const set = el("select", { "aria-label": "Set" }, sets.map((t) => el("option", { value: t.id }, t.title)));
  const who = el("select", { "aria-label": "Who" }, others.map((x) => el("option", { value: x.name }, x.name)));
  const mins = el("input", { type: "number", min: 1, max: 120, value: "10", inputmode: "numeric", style: "width:5em", "aria-label": "Minutes from now" });
  const send = el("button", { type: "submit", class: "btn" }, "Invite");
  const form = el("form", { class: "row" }, set, who, el("span", {}, "in"), mins, el("span", {}, "min"), send);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(send, async () => paint(await rpc("cat_cosolve_create", { p_test_id: set.value, p_partner: who.value, p_in_min: Number(mins.value) })));
  });
  fill(panel, el("h2", {}, "Co-solve a DILR set"),
    el("p", { class: "muted" }, "Sit the same set at the same time with one other person: one shared clock, each on your own screen, and a shared whiteboard once you've both finished. They see the invitation here."),
    form, listHost);
  return panel;
}

async function testsView() {
  const first = firstAttempts();
  const today = istToday();
  const topicOf = (t) => String(t.topic || "");
  const groups = [
    ["Checks", index.filter((t) => t.kind === "check")],
    ["QA practice sets", index.filter((t) => t.kind === "practice" && topicOf(t).startsWith("qa-"))],
    ["DILR sets", index.filter((t) => t.kind === "practice" && topicOf(t).startsWith("dilr-"))],
    ["VARC sets", index.filter((t) => t.kind === "practice" && topicOf(t).startsWith("varc-"))],
    ["Daily 5", index.filter((t) => t.kind === "daily" && t.day <= today).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 7)],
  ].filter(([, list]) => list.length);
  const cos = await cosolvePanel(today).catch((err) => el("p", { class: "notice error" }, err.message));
  return el("div", { class: "stack" },
    composedPanel(today),
    groups.map(([title, list]) => el("section", { class: "panel" },
      el("h2", {}, title),
      el("ul", { class: "list" }, list.map((t) => testItem(t, first, today))))),
    cos,
    el("p", { class: "muted small" }, "All questions here are original, written for this group, apart from reading passages taken from public-domain books. Full CAT previous papers are linked on the Mocks page."));
}

// ---- review queue ----------------------------------------------------------------
const STAGE_TEXT = [
  "First look again. Right now brings it back in 3 days.",
  "Second look. Right now brings it back in 7 days.",
  "Last look. Right now clears it.",
];

async function reviewsView() {
  const host = el("div", { class: "stack" }, el("p", { class: "muted" }, "Loading..."));
  const r = await rpc("cat_reviews");
  const items = [];
  for (const item of r.due) {
    let q = null;
    try {
      q = findQuestion(await testDef(item.testId), item.questionId);
    } catch {
      q = null;
    }
    items.push(reviewItem(item, q));
  }
  fill(host, el("section", { class: "panel" },
    el("h2", {}, r.due.length ? `${r.due.length} due today` : "Nothing due today"),
    el("p", { class: "muted" }, `Every question you get wrong or leave blank on a first attempt comes back the next day, then after 3 days and 7 days, until you get it right three times in a row. A wrong answer starts it over. ${r.upcoming} more coming up, ${r.cleared} cleared so far.`),
    items.length ? items : el("p", { class: "empty" }, "Take a practice set; anything you miss lands here tomorrow.")));
  return host;
}

function reviewItem(item, q) {
  const status = el("p", { class: "status-line", role: "status" });
  let read;
  let field;
  if (!q) {
    field = el("p", { class: "muted" }, "This question couldn't be loaded.");
    read = () => "";
  } else if (q.type === "mcq") {
    const name = `rv-${item.testId}-${item.questionId}`;
    field = el("div", {}, q.options.map((text, i) => el("label", { class: "option" },
      el("input", { type: "radio", name, value: LETTERS[i] }), el("span", { class: "opt-letter" }, `${LETTERS[i]}.`), el("span", {}, text))));
    read = () => field.querySelector("input:checked")?.value || "";
  } else {
    field = el("input", { type: "text", inputmode: "decimal", class: "retry-input", "aria-label": "Your answer" });
    read = () => field.value;
  }
  const check = el("button", { type: "button", class: "btn primary" }, "Check");
  const box = el("div", { class: "review-item" },
    el("p", { class: "muted small" }, `${item.testTitle}, question ${item.questionId.replace(/^q/, "")}. ${STAGE_TEXT[item.stage] || ""}`),
    q ? el("p", {}, q.text) : null,
    field,
    el("div", { class: "row" }, check),
    status);
  check.addEventListener("click", () => busy(check, async () => {
    const answer = read().trim();
    if (!answer) {
      status.textContent = "Pick or type an answer first.";
      return;
    }
    const res = await rpc("cat_review_answer", { p_test_id: item.testId, p_question_id: item.questionId, p_answer: answer });
    check.hidden = true;
    status.className = `status-line ${res.result === "correct" ? "good" : "error"}`;
    status.textContent = res.result === "correct"
      ? (res.cleared ? "Right. Cleared from the queue." : `Right. Back on ${fmtDate(res.dueOn)}.`)
      : `Not right. It comes back tomorrow.${res.answer === null || res.answer === undefined ? " The answer stays hidden until you show it on that test's results page." : ""}`;
    if (res.answer !== null && res.answer !== undefined) {
      box.append(el("p", {}, el("strong", {}, `Answer: ${res.answer}. `), res.solution || ""));
    }
    // Saying why the answer is right fixes it better than reading the solution.
    if (res.result === "correct") {
      const why = el("input", { type: "text", maxlength: 300, placeholder: "In one line, why is it right?", "aria-label": "Why it's right" });
      const keep = el("button", { type: "button", class: "btn small" }, "Keep it");
      keep.addEventListener("click", () => busy(keep, async () => {
        if (!why.value.trim()) return;
        await rpc("cat_explain", { p_test_id: item.testId, p_question_id: item.questionId, p_text: why.value });
        keep.replaceWith(el("span", { class: "good small" }, "Kept with your notes."));
      }));
      box.append(el("div", { class: "row" }, why, keep));
    }
  }));
  return box;
}

// ---- speed drills ------------------------------------------------------------------
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const FRACTIONS = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5], [1, 6], [5, 6], [1, 7], [2, 7], [3, 7], [1, 8], [3, 8], [5, 8], [7, 8], [1, 9], [2, 9], [4, 9], [1, 11], [2, 11], [1, 12], [5, 12], [7, 12], [1, 16], [3, 16], [1, 20], [1, 25]];
const KINDS = {
  fractions: {
    title: "Fractions to percentages",
    hint: "Type the percentage, to 2 decimals where needed. 1/8 is 12.5.",
    make() {
      const [a, b] = FRACTIONS[rand(0, FRACTIONS.length - 1)];
      return { text: `${a}/${b} = ?%`, answer: (100 * a) / b, tol: 0.06 };
    },
  },
  squares: {
    title: "Squares 11 to 35",
    hint: "Type the square.",
    make() {
      const n = rand(11, 35);
      return { text: `${n}² = ?`, answer: n * n };
    },
  },
  tables: {
    title: "Tables 12 to 25",
    hint: "Type the product.",
    make() {
      const a = rand(12, 25);
      const b = rand(3, 9);
      return { text: `${a} × ${b} = ?`, answer: a * b };
    },
  },
  percent: {
    title: "Percent of a number",
    hint: "Type the value.",
    make() {
      const p = [5, 10, 12.5, 15, 20, 25, 30, 35, 37.5, 40, 45, 60, 62.5, 75, 80, 120, 125, 150][rand(0, 17)];
      const n = rand(2, 48) * 20;
      return { text: `${p}% of ${n} = ?`, answer: (p * n) / 100, tol: 0.001 };
    },
  },
  mixed: {
    title: "Mixed",
    hint: "A mix of all four.",
    make() {
      const k = ["fractions", "squares", "tables", "percent"][rand(0, 3)];
      return KINDS[k].make();
    },
  },
  calculator: {
    title: "On-screen calculator",
    hint: "Use only the calculator below, the way CAT makes you. Round to 2 decimals.",
    make() {
      const t = rand(0, 2);
      if (t === 0) {
        const a = rand(110, 999);
        const b = rand(12, 99);
        return { text: `${a} × ${b} = ?`, answer: a * b };
      }
      if (t === 1) {
        const a = rand(1000, 9999);
        const b = rand(7, 97);
        return { text: `${a} ÷ ${b} = ?`, answer: Math.round((a / b) * 100) / 100, tol: 0.011 };
      }
      const a = rand(101, 999);
      const p = rand(3, 47);
      return { text: `${p}% of ${a} = ?`, answer: Math.round(a * p) / 100, tol: 0.011 };
    },
  },
};

function drillsView() {
  const host = el("div", { class: "stack" });
  const select = el("select", { "aria-label": "Drill" }, Object.entries(KINDS).map(([k, d]) => el("option", { value: k }, d.title)));
  const play = el("section", { class: "panel" });
  const boardHost = el("section", { class: "panel" });
  const calcHost = document.getElementById("calc");
  const calc = calcHost ? createCalculator(calcHost) : null;

  async function showBoard(kind, rows) {
    rows = rows || await rpc("cat_speed_board", { p_kind: kind });
    fill(boardHost, el("h2", {}, `${KINDS[kind].title}: group bests`),
      el("table", { class: "plain" },
        el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", { class: "n" }, "Today"), el("th", { class: "n" }, "Best"))),
        el("tbody", {}, rows.map((r) => el("tr", { class: r.me ? "me" : "" },
          el("td", {}, r.name), el("td", { class: "n" }, r.today ?? ""), el("td", { class: "n" }, r.best ?? ""))))));
  }

  function idle() {
    const kind = select.value;
    calc?.close();
    const start = el("button", { type: "button", class: "btn primary" }, "Start a 2-minute round");
    start.addEventListener("click", () => run(kind));
    fill(play, el("h2", {}, "Speed drill"),
      el("p", { class: "muted" }, "Two minutes, as many as you can. Each finished round earns 2 points, up to 5 rounds a day; the board keeps your best."),
      el("div", { class: "row" }, select, start));
    showBoard(kind).catch(showError);
  }

  function run(kind) {
    const d = KINDS[kind];
    const ends = Date.now() + 120000;
    let score = 0;
    let wrong = 0;
    let cur = d.make();
    const q = el("p", { class: "drill-q" }, cur.text);
    const input = el("input", { type: "text", inputmode: "decimal", class: "drill-input", autocomplete: "off", "aria-label": "Answer" });
    const clock = el("span", { class: "num" }, "2:00");
    const tally = el("span", {}, "0 right");
    const feedback = el("p", { class: "status-line", role: "status" });
    const form = el("form", { class: "row" }, input, el("button", { type: "submit", class: "btn primary" }, "Enter"),
      el("button", { type: "button", class: "btn", onclick: () => { cur = d.make(); q.textContent = cur.text; input.value = ""; input.focus(); } }, "Skip"));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = Number(input.value.replace(/[,\s%]/g, ""));
      if (input.value.trim() === "" || !Number.isFinite(v)) return;
      if (Math.abs(v - cur.answer) <= (cur.tol ?? 0.0001)) {
        score += 1;
        feedback.className = "status-line good";
        feedback.textContent = "Right";
      } else {
        wrong += 1;
        feedback.className = "status-line error";
        feedback.textContent = `${cur.text.replace("?", Number(cur.answer.toFixed(2)))}`;
      }
      tally.textContent = `${score} right`;
      cur = d.make();
      q.textContent = cur.text;
      input.value = "";
    });
    fill(play, el("h2", {}, d.title), el("p", { class: "muted" }, d.hint),
      el("div", { class: "drill-bar" }, el("span", {}, "Time left ", clock), tally), q, form, feedback);
    if (kind === "calculator") calc?.open();
    input.focus();
    const timer = setInterval(async () => {
      const left = ends - Date.now();
      clock.textContent = `${Math.floor(Math.max(0, left) / 60000)}:${String(Math.ceil(Math.max(0, left) / 1000) % 60).padStart(2, "0")}`;
      if (left > 0) return;
      clearInterval(timer);
      calc?.close();
      fill(play, el("h2", {}, `${d.title}: ${score} right`),
        el("p", {}, `${wrong} wrong. Saving...`));
      try {
        const rows = await rpc("cat_speed_save", { p_kind: kind, p_score: Math.min(score, 120) });
        idle();
        play.prepend(el("p", { class: "notice" }, `Last round: ${score} right, ${wrong} wrong. Saved.`));
        showBoard(kind, rows);
      } catch (err) {
        showError(err);
        idle();
      }
    }, 250);
  }

  select.addEventListener("change", idle);
  idle();
  host.append(play, boardHost);
  return host;
}

// ---- bookmarks -------------------------------------------------------------------
async function bookmarksView() {
  const list = await rpc("cat_bookmarks");
  const first = firstAttempts();
  return el("section", { class: "panel" },
    el("h2", {}, "Bookmarked questions"),
    el("p", { class: "muted" }, "Bookmark a question from a test's results page, with a note for yourself."),
    list.length ? el("ul", { class: "list" }, list.map((b) => el("li", {},
      el("span", { class: "grow" }, el("strong", {}, `${b.testTitle}, question ${b.questionId.replace(/^q/, "")}`),
        b.note ? el("span", {}, `: ${b.note}`) : null, el("br"), el("span", { class: "muted small" }, fmtDateTime(b.at))),
      first[b.testId] ? el("a", { class: "btn small", href: `test.html?attempt=${first[b.testId].attemptId}#q-${b.questionId}` }, "Open") : null)))
      : el("p", { class: "empty" }, "No bookmarks yet."));
}

async function init() {
  const me = await boot("practice.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  try {
    [index, attempts] = await Promise.all([loadJson("tests/index.json"), rpc("cat_attempts")]);
  } catch (err) {
    fill(main, el("p", { class: "notice error" }, err.message));
    return;
  }
  const host = el("div");
  const views = {
    tests: ["Tests", testsView],
    reviews: ["Review queue", reviewsView],
    errors: ["Error log", errorsView],
    cards: ["Formula cards", cardsView],
    drills: ["Speed drills", drillsView],
    rc: ["RC log", rcView],
    choice: ["Set choice", () => choiceView(index)],
    search: ["Search", searchView],
    bookmarks: ["Bookmarks", bookmarksView],
  };
  const tabs = el("div", { class: "tabs", role: "tablist" });
  const show = async (key) => {
    for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.key === key));
    history.replaceState(null, "", `#${key}`);
    fill(host, el("p", { class: "muted" }, "Loading..."));
    try {
      fill(host, await views[key][1]());
    } catch (err) {
      fill(host, el("p", { class: "notice error" }, err.message));
    }
  };
  for (const [key, [label]] of Object.entries(views)) tabs.append(el("button", { type: "button", role: "tab", "data-key": key, onclick: () => show(key) }, label));
  fill(main, el("div", { class: "page-head" }, el("h1", {}, "Practice")), tabs, host);
  const start = location.hash.slice(1);
  show(views[start] ? start : "tests");
}

init();

// Full mocks: the group calendar, logging with analysis, trend, head-to-head, goal.
import { rpc } from "./db.js";
import { el, boot, busy, loadJson, istToday, fmtDate, confirmBox, showError, fill } from "./ui.js";
import { startReminders, cacheSettings } from "./reminders.js";
import { estimate } from "./percentile.js";

const main = document.getElementById("main");
const CAUSES = [
  ["c1", "Conceptual gap", "Go back to that topic's video and practice set, and set it to Learning on the Topics page."],
  ["c2", "Calculation or execution error", "Write each step, do a two-minute speed drill daily, and recheck the last line before saving."],
  ["c3", "Misreading", "Read the last line of the question twice. Watch for NOT, units and 'at least'."],
  ["c4", "Poor question selection", "Spend the first 5 minutes of DILR choosing sets. In QA, move on from anything not clear in 30 seconds."],
  ["c5", "Time-management failure", "Check the clock at 15 and 30 minutes in every section, and drop a question after 3 minutes."],
  ["c6", "Guessing or over-attempting", "Only answer a multiple-choice question when you can cut it to two options. Type-in answers carry no penalty."],
  ["c7", "Missed an easier question", "After each section, note the easy ones you skipped. Practise a first pass that only takes easy ones."],
];
let me = null;
let papers = null;
let mocks = [];
let tables = null;

function paperTitle(id) {
  return papers.papers.find((p) => p.id === id)?.title || id;
}

// ---- calendar and previous papers ---------------------------------------------------
async function calendarPanel() {
  const today = istToday();
  const results = await Promise.all(papers.calendar.map((c) => rpc("cat_paper", { p_paper_id: c.paper }).catch(() => [])));
  return el("section", { class: "panel span-12" },
    el("h2", {}, "Group mock calendar"),
    el("p", { class: "muted" }, papers.calendar_note),
    el("div", { class: "table-wrap" }, el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, el("th", {}, "Day"), el("th", {}, "Paper"), el("th", {}, "Links"), el("th", {}, "Done so far"))),
      el("tbody", {}, papers.calendar.map((c, i) => {
        const p = papers.papers.find((x) => x.id === c.paper);
        const done = results[i];
        return el("tr", { class: c.day === today ? "me" : "" },
          el("td", {}, `${fmtDate(c.day)}${c.day === today ? " (today)" : ""}, ${c.time}`),
          el("td", {}, p.title),
          el("td", {}, el("a", { href: p.test, target: "_blank", rel: "noopener" }, "Take it timed"), " or ",
            el("a", { href: p.paper, target: "_blank", rel: "noopener" }, "questions and solutions")),
          el("td", {}, done.length ? done.map((d) => `${d.name} ${d.total}`).join(", ") : el("span", { class: "muted" }, "nobody yet")));
      })))),
    el("p", { class: "muted small" }, papers.source, " The time is the afternoon slot; sit it at your own slot's start time if you can."));
}

function papersPanel() {
  const mine = new Set(mocks.map((m) => m.paperId).filter(Boolean));
  const out = el("div");
  const list = el("ul", { class: "list" }, papers.papers.map((p) => {
    const who = el("span", { class: "muted small" });
    const btn = el("button", { type: "button", class: "btn small" }, "Who has done it");
    btn.addEventListener("click", () => busy(btn, async () => {
      const rows = await rpc("cat_paper", { p_paper_id: p.id });
      who.textContent = rows.length ? rows.map((r) => `${r.name} ${r.total}`).join(", ") : "nobody yet";
    }));
    return el("li", {},
      el("span", { class: "grow" }, el("strong", {}, p.title), mine.has(p.id) ? el("span", { class: "good" }, " done") : null,
        el("span", { class: "muted small" }, ` ${p.pattern}`), el("br"), who),
      el("a", { href: p.test, target: "_blank", rel: "noopener", class: "btn small" }, "Timed test"),
      el("a", { href: p.paper, target: "_blank", rel: "noopener", class: "btn quiet small" }, "Paper"),
      btn);
  }));
  out.append(el("section", { class: "panel span-12" }, el("h2", {}, "All previous papers, 2017 to 2025"),
    el("p", { class: "muted" }, "2024 and 2025 follow the 2026 pattern (68 questions, 40 minutes a section). Older papers have different counts but the same kind of questions."),
    list));
  return out.firstChild;
}

// ---- log a mock ---------------------------------------------------------------------------
function logPanel(refresh) {
  const date = el("input", { type: "date", value: istToday(), max: istToday(), required: true });
  const paper = el("select", {},
    el("option", { value: "" }, "Other mock (type its name)"),
    el("optgroup", { label: "Group calendar" }, papers.calendar.map((c) => el("option", { value: c.paper, selected: c.day === istToday() }, `${paperTitle(c.paper)} (${fmtDate(c.day)})`))),
    el("optgroup", { label: "Previous papers" }, papers.papers.map((p) => el("option", { value: p.id }, p.title))));
  const other = el("input", { type: "text", maxlength: 60, placeholder: "e.g. TIME AIMCAT 2612" });
  const otherLabel = el("label", { class: "field" }, "Mock name", other);
  const sync = () => { otherLabel.hidden = Boolean(paper.value); };
  paper.addEventListener("change", sync);
  sync();
  const numberField = (label, min, max) => {
    const input = el("input", { type: "number", min, max, step: 1, required: true });
    return [el("label", { class: "field" }, label, input), input];
  };
  const [varcL, varc] = numberField("VARC marks", -24, 72);
  const [dilrL, dilr] = numberField("DILR marks", -22, 66);
  const [qaL, qa] = numberField("QA marks", -22, 66);
  const slot = el("input", { type: "checkbox", id: "slot-time" });
  const small = (label) => {
    const input = el("input", { type: "number", min: 0, max: 24, step: 1, inputmode: "numeric" });
    return [el("label", { class: "field" }, label, input), input];
  };
  const att = ["VARC", "DILR", "QA"].map((s) => small(`${s} attempted`));
  const wr = ["VARC", "DILR", "QA"].map((s) => small(`${s} wrong`));
  const causeInputs = CAUSES.map(([code, label]) => {
    const input = el("input", { type: "number", min: 0, max: 204, step: 1, inputmode: "numeric" });
    return [code, el("label", { class: "field" }, label, input), input];
  });
  const note = el("textarea", { maxlength: 500, placeholder: "What went wrong, in a line or two" });
  const status = el("p", { class: "status-line", role: "status" });
  const submit = el("button", { type: "submit", class: "btn primary" }, "Log the mock");
  const form = el("form", { class: "stack" },
    el("div", { class: "form-grid" },
      el("label", { class: "field" }, "Date taken", date),
      el("label", { class: "field wide" }, "Paper", paper),
      otherLabel, varcL, dilrL, qaL),
    el("p", {}, slot, el("label", { for: "slot-time" }, " I started it at my CAT slot's start time (10 more points)")),
    el("details", {}, el("summary", {}, el("strong", {}, "Analysis: attempts, wrong answers, and where the marks went")),
      el("p", { class: "muted small" }, "Fill this in after you've checked every question. Marks lost means the +3 you didn't get plus any -1, so a wrong MCQ you should have solved costs 4."),
      el("div", { class: "form-grid" }, att.map(([l]) => l), wr.map(([l]) => l)),
      el("h3", {}, "Marks lost, by cause"),
      el("div", { class: "form-grid" }, causeInputs.map(([, l]) => l)),
      el("label", { class: "field" }, "Note", note)),
    el("div", { class: "row" }, submit), status);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const intOrNull = (i) => (i.value === "" ? null : Math.round(Number(i.value)));
    const analysis = { attempted: {}, wrong: {}, causes: {} };
    ["varc", "dilr", "qa"].forEach((s, i) => {
      if (intOrNull(att[i][1]) !== null) analysis.attempted[s] = intOrNull(att[i][1]);
      if (intOrNull(wr[i][1]) !== null) analysis.wrong[s] = intOrNull(wr[i][1]);
    });
    for (const [code, , input] of causeInputs) if (intOrNull(input) !== null) analysis.causes[code] = intOrNull(input);
    if (note.value.trim()) analysis.note = note.value.trim();
    busy(submit, async () => {
      mocks = await rpc("cat_mock_add", {
        p_taken_on: date.value,
        p_source: paper.value ? paperTitle(paper.value) : other.value.trim(),
        p_paper_id: paper.value || null,
        p_varc: intOrNull(varc), p_dilr: intOrNull(dilr), p_qa: intOrNull(qa),
        p_at_slot_time: slot.checked,
        p_analysis: analysis,
      });
      form.reset();
      date.value = istToday();
      sync();
      status.textContent = "Logged. 30 points are on the board.";
      refresh();
    });
  });
  return el("section", { class: "panel span-7" }, el("h2", {}, "Log a full mock"), form);
}

// ---- goal and projection ----------------------------------------------------------
function goalPanel() {
  const best = mocks.slice().sort((a, b) => b.total - a.total)[0];
  const last = mocks[0];
  const score = el("input", { type: "number", min: -68, max: 204, step: 1, value: me.goalScore ?? "", style: "width:6em" });
  const pctIn = el("input", { type: "number", min: 0, max: 100, step: 0.1, value: me.goalPct ?? "", style: "width:6em" });
  const save = el("button", { type: "button", class: "btn" }, "Save goal");
  save.addEventListener("click", () => busy(save, async () => {
    me = (await rpc("cat_set_goal", { p_score: score.value === "" ? null : Number(score.value), p_pct: pctIn.value === "" ? null : Number(pctIn.value) })).member;
    save.textContent = "Saved";
  }));
  const est = (m) => {
    if (!m || !tables) return null;
    const e = estimate(m.total, "overall", tables);
    return e ? e.text : null;
  };
  return el("section", { class: "panel span-5" },
    el("h2", {}, "Goal and projection"),
    el("div", { class: "row" }, el("label", {}, "Target marks ", score), el("label", {}, "Target percentile ", pctIn), save),
    best ? el("ul", {},
      el("li", {}, `Best so far: ${best.total} on ${best.source}, which is ${est(best) || "not on the tables"}.`),
      last && last !== best ? el("li", {}, `Latest: ${last.total} on ${last.source}, ${est(last) || "not on the tables"}.`) : null,
      me.goalScore !== null && me.goalScore !== undefined ? el("li", { class: best.total >= me.goalScore ? "good" : null },
        best.total >= me.goalScore ? "Your best already reaches the target." : `${me.goalScore - best.total} marks to go on your best paper.`) : null)
      : el("p", { class: "empty" }, "Log a mock to see where you stand."),
    el("p", { class: "muted small" }, tables?.source || "", " Coaching mocks often run harder than CAT, so a mock score can understate you."));
}

// ---- my mocks, causes, trend --------------------------------------------------------
function chart(list) {
  const pts = list.slice().reverse();
  if (pts.length < 2) return el("p", { class: "muted" }, "The trend chart appears after your second mock.");
  const W = 640, H = 220, L = 34, R = 10, T = 10, B = 26;
  const vals = pts.flatMap((m) => [m.total, m.varc, m.dilr, m.qa]);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(10, ...vals);
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v) => T + ((hi - v) * (H - T - B)) / (hi - lo || 1);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "chart");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Marks across ${pts.length} mocks: total from ${pts[0].total} to ${pts.at(-1).total}`);
  const add = (tag, attrs, text) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    svg.append(n);
  };
  const step = Math.max(10, Math.ceil((hi - lo) / 5 / 10) * 10);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    add("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid-line" });
    add("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, String(v));
  }
  pts.forEach((m, i) => add("text", { x: x(i), y: H - 8, "text-anchor": "middle" }, fmtDate(m.takenOn).split(" ").slice(1).join(" ")));
  const series = [["total", "var(--ink)", 2.5], ["varc", "var(--bar)", 1.5], ["dilr", "var(--good)", 1.5], ["qa", "var(--bar-me)", 1.5]];
  for (const [key, color, w] of series) {
    add("polyline", { points: pts.map((m, i) => `${x(i)},${y(m[key])}`).join(" "), fill: "none", style: `stroke:${color}`, "stroke-width": w });
    pts.forEach((m, i) => add("circle", { cx: x(i), cy: y(m[key]), r: key === "total" ? 3.5 : 2.5, style: `fill:${color}` }));
  }
  return el("div", {}, svg, el("div", { class: "legend-row" },
    el("span", { style: "color:var(--ink)" }, "Total"), el("span", { style: "color:var(--bar)" }, "VARC"),
    el("span", { style: "color:var(--good)" }, "DILR"), el("span", { style: "color:var(--bar-me)" }, "QA")));
}

function minePanel(refresh) {
  const totals = {};
  for (const m of mocks) for (const [code, v] of Object.entries(m.analysis?.causes || {})) totals[code] = (totals[code] || 0) + v;
  const ranked = CAUSES.filter(([code]) => totals[code]).sort((a, b) => totals[b[0]] - totals[a[0]]);
  const rows = mocks.map((m) => {
    const del = el("button", { type: "button", class: "btn quiet small" }, "Delete");
    del.addEventListener("click", async () => {
      if (!(await confirmBox("Delete this mock?", [`${m.source} on ${fmtDate(m.takenOn)}, ${m.total} marks. Its points come off the board.`], "Delete"))) return;
      busy(del, async () => { mocks = await rpc("cat_mock_delete", { p_mock_id: m.id }); refresh(); });
    });
    const a = m.analysis || {};
    return el("tr", {},
      el("td", {}, fmtDate(m.takenOn)), el("td", {}, m.source, m.atSlotTime ? el("span", { class: "muted small" }, " at slot time") : null),
      el("td", { class: "n" }, String(m.varc)), el("td", { class: "n" }, String(m.dilr)), el("td", { class: "n" }, String(m.qa)),
      el("td", { class: "n" }, el("strong", {}, String(m.total))),
      el("td", {}, a.attempted ? ["varc", "dilr", "qa"].map((s) => a.attempted[s] ?? "?").join(" / ") : ""),
      el("td", {}, del));
  });
  return el("section", { class: "panel span-12" },
    el("h2", {}, "Your mocks"),
    mocks.length ? el("div", { class: "table-wrap" }, el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, ["Date", "Paper", "VARC", "DILR", "QA", "Total", "Attempted V/D/Q", ""].map((h, i) => el("th", { class: i >= 2 && i <= 5 ? "n" : null }, h)))),
      el("tbody", {}, rows))) : el("p", { class: "empty" }, "None logged yet."),
    chart(mocks),
    ranked.length ? [el("h3", {}, "Your biggest leaks"),
      el("ol", {}, ranked.map(([code, label, fix], i) => el("li", {}, el("strong", {}, `${label}: ${totals[code]} marks. `), i < 3 ? fix : "")))] : null);
}

async function headToHead() {
  const ids = [...new Set(mocks.map((m) => m.paperId).filter(Boolean))];
  const host = el("div");
  const select = el("select", { "aria-label": "Paper" }, ids.length
    ? ids.map((id) => el("option", { value: id }, paperTitle(id)))
    : el("option", { value: "" }, "Log a previous paper first"));
  const show = async () => {
    if (!select.value) return;
    const rows = await rpc("cat_paper", { p_paper_id: select.value });
    const best = { varc: Math.max(...rows.map((r) => r.varc)), dilr: Math.max(...rows.map((r) => r.dilr)), qa: Math.max(...rows.map((r) => r.qa)) };
    fill(host, el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, ["Name", "VARC", "DILR", "QA", "Total"].map((h, i) => el("th", { class: i ? "n" : null }, h)))),
      el("tbody", {}, rows.map((r) => el("tr", { class: r.me ? "me" : "" },
        el("td", {}, r.name),
        ["varc", "dilr", "qa"].map((s) => el("td", { class: `n${r[s] === best[s] && rows.length > 1 ? " good" : ""}` }, String(r[s]))),
        el("td", { class: "n" }, el("strong", {}, String(r.total))))))),
    el("p", { class: "muted small" }, "Each person's first sitting of this paper. Green marks the best in each section."));
  };
  select.addEventListener("change", () => show().catch(showError));
  if (ids.length) show().catch(showError);
  return el("section", { class: "panel span-12" }, el("h2", {}, "Head-to-head"),
    el("p", { class: "muted" }, "Pick a paper you've sat to compare section by section with everyone else who sat it."),
    select, host);
}

async function render() {
  const grid = el("div", { class: "grid" });
  const refresh = () => render().catch(showError);
  grid.append(logPanel(refresh), goalPanel(), minePanel(refresh), await calendarPanel(), await headToHead(), papersPanel());
  fill(main, el("div", { class: "page-head" }, el("h1", {}, "Mocks")), grid);
}

async function init() {
  me = await boot("mocks.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  try {
    [papers, mocks, tables] = await Promise.all([loadJson("data/papers.json"), rpc("cat_mocks"), loadJson("data/percentiles.json").catch(() => null)]);
    await render();
  } catch (err) {
    fill(main, el("p", { class: "notice error" }, err.message));
  }
}

init();

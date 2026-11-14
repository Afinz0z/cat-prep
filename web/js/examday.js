// Exam-day page: the last four days, the bag, rules for the hall, what to do
// when a section goes wrong, a score calculator, marks needed per percentile
// and the group's target IIMs. Checklist ticks are kept on this device.
import { rpc } from "./db.js";
import { el, boot, busy, local, setLocal, fill, loadJson } from "./ui.js";
import { startReminders, cacheSettings } from "./reminders.js";
import { estimate, ordinal } from "./percentile.js";

const main = document.getElementById("main");
let me = null;

const PLAN = [
  ["Thursday 26 November", [
    "Last full paper (CAT 2025 Slot 3 on the group calendar), at your slot time.",
    "Analyse it the same afternoon with the seven causes. Note three rules for Sunday.",
    "No new topics from here on.",
  ]],
  ["Friday 27 November", [
    "No full paper. Formula cards from memory, the error log, two RC passages untimed.",
    "One 40-minute VARC section at 12:30 at most.",
  ]],
  ["Saturday 28 November", [
    "Light revision only: formula cards, the review queue, two RC passages. No full mock.",
    "Check the route to the centre and how long it takes at that hour.",
    "Pack the bag (list below) and lay out clothes.",
    "Water through the day, an early dinner, lights out at 23:00 as on other nights.",
  ]],
  ["Sunday 29 November", [
    "Wake at least three hours before the reporting time on your admit card.",
    "A light meal you're used to. Nothing new.",
    "Leave early enough to reach before the reporting time with time to spare.",
  ]],
];

const BAG = [
  "Admit card, printed as its instructions say",
  "Original photo ID with the same name as the admit card",
  "Anything else the admit card asks for (read its instructions the day before)",
  "Only what the admit card allows into the hall; everything else stays at home or in the car",
  "Directions to the centre saved offline",
];

const IN_EXAM = [
  "The order is fixed: VARC, then DILR, then QA, 40 minutes each. You can't go back to a section.",
  "DILR: spend the first 5 minutes reading every set and pick one easy and one moderate set to start.",
  "Answer every type-in question; a wrong one costs nothing.",
  "Answer a multiple-choice question only when you can cut it to two options.",
  "Anything not clear in 30 seconds in QA: mark it and move on, come back if time is left.",
  "When a section ends, let it go. The next one starts from zero.",
];

// What to do when something goes wrong in the hall.
const DAMAGE = [
  ["VARC felt bad", "It's one section of three, and everyone found the same paper hard. Breathe out slowly three times, then start DILR with the 5-minute set scan as planned."],
  ["A DILR set has eaten 15 minutes", "Leave it, even half done. The next set gives marks faster than the last step of this one."],
  ["QA opens with hard questions", "Scroll through all 22 first. Take the type-in answers and anything you can finish in 2 minutes, then come back."],
  ["A formula won't come back", "Work it from a small case: 100 for percentages, 2 and 3 for powers, a 3-4-5 triangle for geometry."],
  ["Your mind goes blank", "Put the pen down, breathe out slowly for 30 seconds, then read the last line of the question again."],
  ["The screen freezes or the system acts up", "Raise your hand and tell the invigilator straight away. Don't try to fix it yourself."],
  ["You're running out of time", "In the last 3 minutes, answer every type-in you've worked on. Leave unsure multiple-choice questions blank."],
];

function checklist(key, items) {
  const ticks = local(key, {}) || {};
  return el("ul", { class: "checklist" }, items.map((text, i) => {
    const id = `${key}-${i}`;
    const box = el("input", { type: "checkbox", id, checked: Boolean(ticks[i]) });
    box.addEventListener("change", () => {
      const t = local(key, {}) || {};
      t[i] = box.checked;
      setLocal(key, t);
    });
    return el("li", {}, box, el("label", { for: id }, text));
  }));
}

function damagePanel() {
  return el("section", { class: "panel span-6", id: "damage" }, el("h2", {}, "When something goes wrong"),
    el("dl", { class: "damage" }, DAMAGE.map(([when, what]) => [el("dt", {}, when), el("dd", {}, what)])));
}

async function rulesPanel() {
  const mocks = await rpc("cat_mocks").catch(() => []);
  const lines = mocks.flatMap((m) => [...(m.analysis?.skip || []).map((x) => `Skip: ${x}`), ...(m.analysis?.try || []).map((x) => `Try: ${x}`)]).slice(0, 8);
  const text = el("textarea", { maxlength: 1200, rows: 5, placeholder: "e.g. In DILR, skip any set with more than six people and three variables.\nIn QA, type-in answers first." }, me.rules || "");
  const save = el("button", { type: "button", class: "btn" }, "Save my rules");
  const status = el("p", { class: "status-line", role: "status" });
  save.addEventListener("click", () => busy(save, async () => {
    me = (await rpc("cat_set_rules", { p_text: text.value })).member;
    status.textContent = "Saved. Read them on Sunday morning.";
  }));
  return el("section", { class: "panel span-6" }, el("h2", {}, "My rules for Sunday"),
    el("p", { class: "muted small" }, "Three to five rules from your mock analyses, in your own words. Read them before you leave."),
    text, el("div", { class: "row" }, save), status,
    lines.length ? [el("h3", {}, "From your analyses"), el("ul", {}, lines.map((x) => el("li", {}, x)))] : null);
}

// Raw marks from right and wrong counts, with the percentile estimate.
function calculatorPanel(tables) {
  const secs = [["varc", "VARC", 24], ["dilr", "DILR", 22], ["qa", "QA", 22]];
  const out = el("div", { class: "calc-out", role: "status" });
  const inputs = secs.map(([k, label, n]) => {
    const f = (aria) => el("input", { type: "number", min: 0, max: n, step: 1, inputmode: "numeric", value: "", "aria-label": `${label} ${aria}`, style: "width:4.5em" });
    return { k, label, right: f("multiple choice right"), wrong: f("multiple choice wrong"), tita: f("type-in right") };
  });
  const v = (i) => Math.max(0, Number(i.value) || 0);
  const paint = () => {
    const marks = inputs.map((s) => ({ ...s, m: 3 * v(s.right) - v(s.wrong) + 3 * v(s.tita) }));
    const total = marks.reduce((n, s) => n + s.m, 0);
    const e = tables ? estimate(total, "overall", tables) : null;
    fill(out,
      el("p", {}, el("strong", {}, `${total} marks`), e ? `, ${e.text}` : ""),
      el("p", { class: "muted small" }, marks.map((s) => {
        const se = tables ? estimate(s.m, s.k, tables) : null;
        return `${s.label} ${s.m}${se ? ` (${se.text})` : ""}`;
      }).join(". "), "."));
  };
  for (const s of inputs) for (const i of [s.right, s.wrong, s.tita]) i.addEventListener("input", paint);
  paint();
  return el("section", { class: "panel span-6" }, el("h2", {}, "Score calculator"),
    el("p", { class: "muted small" }, "+3 for a right answer, -1 for a wrong multiple-choice answer, 0 for a wrong type-in answer or a blank."),
    el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, ["", "MCQ right", "MCQ wrong", "Type-in right"].map((h, i) => el("th", { class: i ? "n" : null }, h)))),
      el("tbody", {}, inputs.map((s) => el("tr", {}, el("th", { scope: "row" }, s.label),
        el("td", { class: "n" }, s.right), el("td", { class: "n" }, s.wrong), el("td", { class: "n" }, s.tita))))),
    out,
    el("p", { class: "muted small" }, tables?.source || ""));
}

// Marks needed for each percentile, as a range across the CAT 2025 slots.
function neededPanel(tables) {
  if (!tables?.slots) return null;
  const slots = Object.values(tables.slots);
  const pcts = [...new Set(slots.flatMap((s) => s.overall.map(([p]) => p)))].filter((p) => p >= 80).sort((a, b) => a - b);
  const range = (sec, p) => {
    const rows = slots.map((s) => (s[sec] || []).find(([q]) => q === p)).filter(Boolean);
    if (!rows.length) return "";
    const lo = Math.min(...rows.map((r) => r[1]));
    const hi = Math.max(...rows.map((r) => r[2]));
    return lo === hi ? String(lo) : `${lo} to ${hi}`;
  };
  // Slot 2 is the afternoon slot, the group's slot this year.
  const s2 = Object.entries(tables.slots).find(([k]) => k.startsWith("Slot 2"))?.[1];
  const slot2 = (p) => {
    const r = s2?.overall.find(([q]) => q === p);
    return r ? (r[1] === r[2] ? String(r[1]) : `${r[1]} to ${r[2]}`) : "";
  };
  return el("section", { class: "panel span-6" }, el("h2", {}, "Marks needed"),
    el("p", { class: "muted small" }, "Raw marks that reached each percentile in CAT 2025: the afternoon slot, then the lowest to highest across all three slots. Section columns matter because IIMs set section cutoffs too."),
    el("div", { class: "table-wrap" }, el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, ["Percentile", "Slot 2 overall", "All slots", "VARC", "DILR", "QA"].map((h, i) => el("th", { class: i ? "n" : null }, h)))),
      el("tbody", {}, pcts.map((p) => el("tr", { class: me.goalPct && Math.abs(me.goalPct - p) < 0.5 ? "me" : "" },
        el("td", {}, ordinal(p)), el("td", { class: "n" }, slot2(p)),
        ["overall", "varc", "dilr", "qa"].map((sec) => el("td", { class: "n" }, range(sec, p)))))))),
    el("p", { class: "muted small" }, tables.source));
}

async function iimPanel(facts) {
  const people = await rpc("cat_profiles").catch(() => []);
  const withTargets = people.filter((x) => x.iims || x.goalScore !== null || x.goalPct !== null);
  const iims = Array.isArray(facts?.iims) ? facts.iims : [];
  return el("section", { class: "panel span-12", id: "iims" }, el("h2", {}, "Target IIMs"),
    withTargets.length ? el("div", { class: "table-wrap" }, el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, ["Name", "Aiming for", "Target marks", "Target percentile"].map((h, i) => el("th", { class: i >= 2 ? "n" : null }, h)))),
      el("tbody", {}, withTargets.map((x) => el("tr", { class: x.me ? "me" : "" },
        el("td", {}, x.name), el("td", {}, x.iims || ""), el("td", { class: "n" }, x.goalScore ?? ""), el("td", { class: "n" }, x.goalPct ?? ""))))))
      : el("p", { class: "empty" }, "Nobody has named target IIMs yet. Add yours on the You page."),
    el("p", { class: "small" }, el("a", { href: "you.html#buddy" }, "Set your target IIMs")),
    iims.length ? [el("h3", {}, "How each IIM shortlists"),
      el("p", { class: "muted small" }, "Percentile cutoffs for the interview shortlist, and how much of the shortlist score CAT makes up. The rest is usually 10th and 12th marks, the degree, work experience and diversity points."),
      el("div", { class: "table-wrap" }, el("table", { class: "plain iims" },
        el("thead", {}, el("tr", {}, ["IIM", "Overall cutoff", "Section cutoffs", "How CAT counts"].map((h) => el("th", {}, h)))),
        el("tbody", {}, iims.map((x) => el("tr", {},
          el("td", {}, x.link ? el("a", { href: x.link, target: "_blank", rel: "noopener" }, x.name) : x.name),
          el("td", { "data-label": "Overall cutoff" }, cap(x.overall)), el("td", { "data-label": "Section cutoffs" }, cap(x.sectional)),
          el("td", { class: "small", "data-label": "How CAT counts" }, cap(x.catWeight), x.note ? el("details", {}, el("summary", {}, "More"), el("p", {}, x.note)) : null)))))),
      el("p", { class: "muted small" }, facts.iimsSource || "")] : null);
}
function cap(s) {
  const t = String(s ?? "");
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

async function init() {
  me = await boot("exam-day.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  const [tables, facts] = await Promise.all([loadJson("data/percentiles.json").catch(() => null), loadJson("data/facts.json").catch(() => null)]);
  const [rules, iims] = await Promise.all([rulesPanel(), iimPanel(facts)]);
  fill(main,
    el("div", { class: "page-head" }, el("h1", {}, "Exam day"),
      el("button", { type: "button", class: "btn no-print", onclick: () => window.print() }, "Print")),
    el("p", { class: "notice" }, "Your admit card's instructions win over anything on this page. Read them in full on Saturday."),
    el("div", { class: "grid" },
      el("section", { class: "panel span-6" }, el("h2", {}, "The last four days"),
        PLAN.map(([day, items], i) => [el("h3", {}, day), checklist(`cat-plan48-${i}`, items)])),
      el("section", { class: "panel span-6" },
        el("h2", {}, "The bag"), checklist("cat-bag", BAG),
        el("h2", {}, "In the hall"), checklist("cat-hall", IN_EXAM)),
      damagePanel(), rules,
      calculatorPanel(tables), neededPanel(tables),
      iims));
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

init();

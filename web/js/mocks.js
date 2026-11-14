// Full mocks: the group calendar and your own papers, logging with analysis,
// debriefs, trend, head-to-head, goal with section targets, and spending.
import { rpc } from "./db.js";
import { el, boot, busy, loadJson, istToday, fmtDate, fmtDateTime, confirmBox, showError, fill } from "./ui.js";
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
const KIND = { free: "Previous paper", paid: "Paid mock", official: "Official mock", sectional: "Sectional" };
const SECS = [["varc", "VARC"], ["dilr", "DILR"], ["qa", "QA"]];
const BUDGET = { preferred: 2000, max: 5000 };
let me = null;
let papers = null;
let facts = null;
let mocks = [];
let calendar = [];
let tables = null;

const paperOf = (id) => papers.papers.find((p) => p.id === id) || null;
const paperTitle = (id) => paperOf(id)?.title || id;
const unanalysed = () => mocks.find((m) => !m.analysedAt);

// ---- calendar ------------------------------------------------------------------------
function icsText(rows) {
  const pad = (n) => String(n).padStart(2, "0");
  const esc = (t) => String(t).replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const at = (day, min) => `${day.replace(/-/g, "")}T${pad(Math.floor(min / 60) % 24)}${pad(min % 60)}00`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//cat-prep//mock calendar//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VTIMEZONE", "TZID:Asia/Kolkata", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0530",
    "TZOFFSETTO:+0530", "TZNAME:IST", "END:STANDARD", "END:VTIMEZONE"];
  for (const r of rows) {
    const [h, m] = r.time.split(":").map(Number);
    const start = h * 60 + m;
    const link = r.link || paperOf(r.paper)?.test;
    lines.push("BEGIN:VEVENT", `UID:cat-prep-${r.id}@afinz0z.github.io`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Asia/Kolkata:${at(r.day, start)}`, `DTEND;TZID=Asia/Kolkata:${at(r.day, start + 120)}`,
      `SUMMARY:${esc(r.title)}`, link ? `URL:${link}` : null, link ? `DESCRIPTION:${esc(link)}` : null,
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Paper in 30 minutes. Rough sheets out, phone in another room.",
      "TRIGGER:-PT30M", "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).join("\r\n");
}
function downloadIcs() {
  const url = URL.createObjectURL(new Blob([icsText(calendar)], { type: "text/calendar" }));
  const a = el("a", { href: url, download: "cat-mock-calendar.ics" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function debriefBox(paperId) {
  const host = el("div", { class: "debrief" });
  const paint = (r) => {
    if (!r.open) {
      fill(host, el("p", { class: "muted small" }, r.count
        ? `${r.count} post${r.count === 1 ? "" : "s"} here. They open once you've logged this paper, so nobody spoils it for you.`
        : "The debrief opens once you've logged this paper."));
      return;
    }
    const text = el("textarea", { maxlength: 1500, rows: 2, placeholder: "Which set or question cost you, and what you'd do differently" });
    const send = el("button", { type: "submit", class: "btn small" }, "Post");
    const form = el("form", { class: "stack" }, text, el("div", { class: "row" }, send));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      busy(send, async () => paint(await rpc("cat_paper_post", { p_paper_id: paperId, p_text: text.value })));
    });
    fill(host, r.posts.length ? el("ul", { class: "thread" }, r.posts.map((x) => el("li", { class: x.me ? "me" : "" },
      el("p", { class: "muted small" }, `${x.name}, ${fmtDateTime(x.at)}`), el("p", {}, x.text))))
      : el("p", { class: "muted small" }, "No posts yet. Start the debrief."), form);
  };
  paint(await rpc("cat_paper_posts", { p_paper_id: paperId }));
  return host;
}

async function calendarPanel(refresh) {
  const today = istToday();
  const panel = el("section", { class: "panel span-12", id: "calendar" });
  const group = calendar.filter((c) => !c.owner);
  const ids = [...new Set(calendar.map((c) => c.paper).filter(Boolean))];
  const done = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await rpc("cat_paper", { p_paper_id: id }).catch(() => [])])));
  const editable = (c) => typeof c.id === "number" && (c.mine || (!c.owner && me.isAdmin));

  const row = (c) => {
    const p = paperOf(c.paper);
    const who = c.paper ? done[c.paper] || [] : [];
    const debriefHost = el("div");
    const debrief = c.paper ? el("button", { type: "button", class: "btn small quiet" }, "Debrief") : null;
    debrief?.addEventListener("click", () => busy(debrief, async () => {
      if (debriefHost.childElementCount) { debriefHost.replaceChildren(); return; }
      fill(debriefHost, await debriefBox(c.paper));
    }));
    let tools = null;
    if (editable(c)) {
      const day = el("input", { type: "date", value: c.day, "aria-label": "New day" });
      const time = el("input", { type: "time", value: c.time, "aria-label": "New time" });
      const move = el("button", { type: "button", class: "btn small" }, "Move");
      move.addEventListener("click", () => busy(move, async () => {
        calendar = await rpc("cat_calendar_move", { p_id: c.id, p_day: day.value, p_time: time.value });
        refresh();
      }));
      const del = el("button", { type: "button", class: "btn small quiet" }, "Remove");
      del.addEventListener("click", async () => {
        if (!(await confirmBox("Remove this paper from the calendar?", [`${c.title} on ${fmtDate(c.day)}.${c.owner ? "" : " Everyone in the group loses it."}`], "Remove"))) return;
        busy(del, async () => { calendar = await rpc("cat_calendar_delete", { p_id: c.id }); refresh(); });
      });
      tools = el("details", { class: "edit" }, el("summary", { class: "small" }, "Change"), el("div", { class: "row" }, day, time, move, del));
    }
    return [el("tr", { class: c.day === today ? "me" : "" },
      el("td", {}, `${fmtDate(c.day)}${c.day === today ? " (today)" : ""}, ${c.time}`),
      el("td", {}, c.title, el("br"), el("span", { class: "muted small" }, c.owner ? `${KIND[c.kind] || c.kind}, ${c.mine ? "yours only" : c.owner}` : KIND[c.kind] || c.kind)),
      el("td", {}, p ? [el("a", { href: p.test, target: "_blank", rel: "noopener" }, "Take it timed"), " or ",
        el("a", { href: p.paper, target: "_blank", rel: "noopener" }, "questions and solutions")]
        : c.link ? el("a", { href: c.link, target: "_blank", rel: "noopener" }, "Open") : ""),
      el("td", {}, c.paper ? (who.length ? who.map((d) => `${d.name} ${d.total}`).join(", ") : el("span", { class: "muted" }, "nobody yet")) : ""),
      el("td", {}, debrief, tools)),
    el("tr", { class: "sub" }, el("td", { colspan: 5 }, debriefHost))];
  };

  // Admin: load the plan's list once, then edit it.
  let importBtn = null;
  if (!group.length && me.isAdmin) {
    importBtn = el("button", { type: "button", class: "btn primary" }, "Put the plan's papers on the group calendar");
    importBtn.addEventListener("click", () => busy(importBtn, async () => {
      calendar = await rpc("cat_admin_calendar_import", { p_items: papers.calendar.map((c) => ({
        day: c.day, time: c.time, title: paperTitle(c.paper), paper: c.paper, kind: "free", link: paperOf(c.paper)?.test || null })) });
      refresh();
    }));
  }
  // Fallback while the group calendar is empty: the plan's list from papers.json.
  const shown = group.length ? calendar : [...papers.calendar.map((c, i) => ({
    id: `plan-${i}`, day: c.day, time: c.time, paper: c.paper, title: paperTitle(c.paper), kind: "free", owner: null, mine: false })),
  ...calendar.filter((c) => c.mine)].sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time));

  // Your own papers, such as a paid mock (#40). Group papers too for the admin.
  const day = el("input", { type: "date", min: "2026-11-01", max: "2027-01-31", value: today, required: true });
  const time = el("input", { type: "time", value: "12:30", required: true });
  const title = el("input", { type: "text", maxlength: 80, required: true, placeholder: "e.g. TIME AIMCAT 2612" });
  const kind = el("select", {}, ["paid", "official", "sectional", "free"].map((k) => el("option", { value: k }, KIND[k])));
  const link = el("input", { type: "url", maxlength: 300, placeholder: "https://... (optional)" });
  const forGroup = el("input", { type: "checkbox", id: "cal-group" });
  const add = el("button", { type: "submit", class: "btn" }, "Add to the calendar");
  const form = el("form", { class: "stack" },
    el("div", { class: "form-grid" },
      el("label", { class: "field" }, "Day", day), el("label", { class: "field" }, "Start", time),
      el("label", { class: "field wide" }, "Paper", title), el("label", { class: "field" }, "Kind", kind),
      el("label", { class: "field wide" }, "Link", link)),
    me.isAdmin ? el("p", {}, forGroup, el("label", { for: "cal-group" }, " For the whole group (admin)")) : null,
    el("div", { class: "row" }, add));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(add, async () => {
      calendar = await rpc("cat_calendar_add", { p_day: day.value, p_time: time.value, p_title: title.value, p_paper_id: null,
        p_kind: kind.value, p_link: link.value.trim() || null, p_group: forGroup.checked });
      refresh();
    });
  });

  const om = facts?.officialMock;
  const addBox = el("details", {}, el("summary", {}, "Add your own paper, such as a paid mock or the official mock"), form);
  const ics = el("button", { type: "button", class: "btn small", disabled: !calendar.length }, "Download for my phone's calendar (.ics)");
  ics.addEventListener("click", downloadIcs);
  fill(panel,
    el("div", { class: "page-head" }, el("h2", {}, "Mock calendar"), ics),
    el("p", { class: "muted" }, papers.calendar_note),
    importBtn ? el("p", {}, importBtn) : null,
    om ? el("div", { class: "notice" }, el("p", {}, el("strong", {}, `${om.title}. `), om.when, ` ${om.note}`),
      el("div", { class: "row" }, el("a", { class: "btn small", href: om.link, target: "_blank", rel: "noopener" }, "Open iimcat.ac.in"),
        calendar.some((c) => c.mine && c.kind === "official") ? null : el("button", { type: "button", class: "btn small", onclick: () => {
          title.value = "CAT 2026 official mock";
          kind.value = "official";
          link.value = om.link;
          addBox.open = true;
          day.focus();
        } }, "Put it on my calendar"))) : null,
    el("div", { class: "table-wrap" }, el("table", { class: "plain cal" },
      el("thead", {}, el("tr", {}, ["Day", "Paper", "Links", "Done so far", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, shown.map(row)))),
    addBox,
    el("p", { class: "muted small" }, papers.source, " Times are the afternoon slot; sit it at your own slot's start time if you can."));
  return panel;
}

function papersPanel() {
  const mine = new Set(mocks.map((m) => m.paperId).filter(Boolean));
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
  return el("section", { class: "panel span-12" }, el("h2", {}, "All previous papers, 2017 to 2025"),
    el("p", { class: "muted" }, "2024 and 2025 follow the 2026 pattern (68 questions, 40 minutes a section). Older papers have different counts but the same kind of questions."),
    list);
}

// ---- analysis fields, shared by the log form and the editor ------------------------------
function analysisFields(a = {}) {
  const small = (label, value, min = 0, max = 24) => {
    const input = el("input", { type: "number", min, max, step: 1, inputmode: "numeric", value: value ?? "" });
    return [el("label", { class: "field" }, label, input), input];
  };
  const att = SECS.map(([k, s]) => small(`${s} attempted`, a.attempted?.[k]));
  const wr = SECS.map(([k, s]) => small(`${s} wrong`, a.wrong?.[k]));
  const causeInputs = CAUSES.map(([code, label]) => {
    const input = el("input", { type: "number", min: 0, max: 204, step: 1, inputmode: "numeric", value: a.causes?.[code] ?? "" });
    return [code, el("label", { class: "field" }, label, input), input];
  });
  const lines = (key, n) => Array.from({ length: n }, (_, i) => el("input", { type: "text", maxlength: 120, value: a[key]?.[i] || "",
    "aria-label": `${key === "skip" ? "Skip next time" : "Try next time"} ${i + 1}` }));
  const skip = lines("skip", 3);
  const tryNext = lines("try", 3);
  const [resolveL, resolve] = small("Marks on the untimed redo", a.resolve, -68, 204);
  const order = el("select", {}, el("option", { value: "" }, "Not noted"),
    el("option", { value: "rc", selected: a.varcOrder === "rc" }, "Reading passages first"),
    el("option", { value: "va", selected: a.varcOrder === "va" }, "Verbal questions first"));
  const note = el("textarea", { maxlength: 500, placeholder: "What went wrong, in a line or two" }, a.note || "");
  const nodes = [
    el("p", { class: "muted small" }, "Fill this in after you've checked every question. Marks lost means the +3 you didn't get plus any -1, so a wrong MCQ you should have solved costs 4."),
    el("div", { class: "form-grid" }, att.map(([l]) => l), wr.map(([l]) => l)),
    el("h3", {}, "Marks lost, by cause"),
    el("div", { class: "form-grid" }, causeInputs.map(([, l]) => l)),
    el("h3", {}, "Three questions to skip next time"),
    el("p", { class: "muted small" }, "The ones you sank time into and should have left on the first look. Say why, e.g. \"DILR set 3: six variables, no clear start\"."),
    el("div", { class: "stack tight" }, skip),
    el("h3", {}, "Three questions to try next time"),
    el("p", { class: "muted small" }, "Ones you skipped that turned out easy once you saw the solution."),
    el("div", { class: "stack tight" }, tryNext),
    el("div", { class: "form-grid" }, resolveL, el("label", { class: "field" }, "VARC order this time", order)),
    el("p", { class: "muted small" }, "The untimed redo: sit the questions you got wrong or skipped again with no clock, before reading solutions. The gap between that and your score is marks you have but didn't reach in time."),
    el("label", { class: "field" }, "Note", note),
  ];
  const int = (i) => (i.value === "" ? null : Math.round(Number(i.value)));
  const read = () => {
    const out = { attempted: {}, wrong: {}, causes: {} };
    SECS.forEach(([k], i) => {
      if (int(att[i][1]) !== null) out.attempted[k] = int(att[i][1]);
      if (int(wr[i][1]) !== null) out.wrong[k] = int(wr[i][1]);
    });
    for (const [code, , input] of causeInputs) if (int(input) !== null) out.causes[code] = int(input);
    out.skip = skip.map((i) => i.value.trim()).filter(Boolean);
    out.try = tryNext.map((i) => i.value.trim()).filter(Boolean);
    if (int(resolve) !== null) out.resolve = int(resolve);
    if (order.value) out.varcOrder = order.value;
    if (note.value.trim()) out.note = note.value.trim();
    return out;
  };
  return { nodes, read };
}

// ---- log a mock ---------------------------------------------------------------------------
function logPanel(refresh) {
  const date = el("input", { type: "date", value: istToday(), max: istToday(), required: true });
  const group = calendar.filter((c) => !c.owner && c.paper);
  const planList = group.length ? group.map((c) => ({ paper: c.paper, day: c.day })) : papers.calendar;
  const paper = el("select", {},
    el("option", { value: "" }, "Other mock (type its name)"),
    el("optgroup", { label: "Group calendar" }, planList.map((c) => el("option", { value: c.paper, selected: c.day === istToday() }, `${paperTitle(c.paper)} (${fmtDate(c.day)})`))),
    el("optgroup", { label: "Previous papers" }, papers.papers.map((p) => el("option", { value: p.id }, p.title))));
  const mineToday = calendar.find((c) => c.mine && c.day === istToday());
  const other = el("input", { type: "text", maxlength: 60, placeholder: "e.g. TIME AIMCAT 2612", value: mineToday && !paper.value ? mineToday.title : "" });
  const otherLabel = el("label", { class: "field" }, "Mock name", other);
  const sync = () => { otherLabel.hidden = Boolean(paper.value); };
  paper.addEventListener("change", sync);
  sync();
  const numberField = (label, min, max) => {
    const input = el("input", { type: "number", min, max, step: 1, required: true, inputmode: "numeric" });
    return [el("label", { class: "field" }, label, input), input];
  };
  const [varcL, varc] = numberField("VARC marks", -24, 72);
  const [dilrL, dilr] = numberField("DILR marks", -22, 66);
  const [qaL, qa] = numberField("QA marks", -22, 66);
  const slot = el("input", { type: "checkbox", id: "slot-time" });
  const fields = analysisFields();
  const status = el("p", { class: "status-line", role: "status" });
  const submit = el("button", { type: "submit", class: "btn primary" }, "Log the mock");
  // Analyse each paper before the next one.
  const pending = unanalysed();
  const anyway = el("input", { type: "checkbox", id: "log-anyway" });
  const syncLock = () => { submit.disabled = Boolean(pending) && !anyway.checked; };
  anyway.addEventListener("change", syncLock);
  syncLock();
  const form = el("form", { class: "stack" },
    pending ? el("div", { class: "notice" },
      el("p", {}, el("strong", {}, `Analyse ${pending.source} first. `), "A paper you haven't analysed teaches you very little, and the next one repeats the same leaks."),
      el("p", { class: "row" }, el("a", { class: "btn small", href: `#analyse-${pending.id}`, onclick: () => setTimeout(() => document.getElementById(`analyse-${pending.id}`)?.click(), 0) }, "Analyse it now"),
        el("span", {}, anyway, el("label", { for: "log-anyway" }, " Log this one anyway")))) : null,
    el("div", { class: "form-grid" },
      el("label", { class: "field" }, "Date taken", date),
      el("label", { class: "field wide" }, "Paper", paper),
      otherLabel, varcL, dilrL, qaL),
    el("p", {}, slot, el("label", { for: "slot-time" }, " I started it at my CAT slot's start time (10 more points)")),
    el("details", {}, el("summary", {}, el("strong", {}, "Analysis (10 points once saved)")), fields.nodes),
    el("div", { class: "row" }, submit), status);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const intOrNull = (i) => (i.value === "" ? null : Math.round(Number(i.value)));
    busy(submit, async () => {
      mocks = await rpc("cat_mock_add", {
        p_taken_on: date.value,
        p_source: paper.value ? paperTitle(paper.value) : other.value.trim(),
        p_paper_id: paper.value || null,
        p_varc: intOrNull(varc), p_dilr: intOrNull(dilr), p_qa: intOrNull(qa),
        p_at_slot_time: slot.checked,
        p_analysis: fields.read(),
      });
      status.textContent = mocks[0]?.analysedAt ? "Logged with its analysis." : "Logged. Analyse it this afternoon, before the next paper.";
      refresh();
    });
  });
  return el("section", { class: "panel span-7" }, el("h2", {}, "Log a full mock"), form);
}

// ---- goal, section targets and personal bests ------------------------------------------
function goalPanel(refresh) {
  const best = mocks.slice().sort((a, b) => b.total - a.total)[0];
  const last = mocks[0];
  const score = el("input", { type: "number", min: -68, max: 204, step: 1, value: me.goalScore ?? "", style: "width:6em", inputmode: "numeric" });
  const pctIn = el("input", { type: "number", min: 0, max: 100, step: 0.1, value: me.goalPct ?? "", style: "width:6em", inputmode: "decimal" });
  const sec = SECS.map(([k, label]) => [k, label, el("input", { type: "number", min: -24, max: 72, step: 1, value: me.goalSec?.[k] ?? "", style: "width:5em", inputmode: "numeric", "aria-label": `${label} target` })]);
  const save = el("button", { type: "button", class: "btn" }, "Save targets");
  save.addEventListener("click", () => busy(save, async () => {
    const p = {};
    for (const [k, , input] of sec) if (input.value !== "") p[k] = Number(input.value);
    me = (await rpc("cat_set_goal", { p_score: score.value === "" ? null : Number(score.value), p_pct: pctIn.value === "" ? null : Number(pctIn.value), p_sec: p })).member;
    refresh();
  }));
  const est = (m) => {
    if (!m || !tables) return null;
    const e = estimate(m.total, "overall", tables);
    return e ? e.text : null;
  };
  const bestSec = Object.fromEntries(SECS.map(([k]) => [k, mocks.slice().sort((a, b) => b[k] - a[k])[0]]));
  return el("section", { class: "panel span-5" },
    el("h2", {}, "Goal and projection"),
    el("div", { class: "form-grid" },
      el("label", { class: "field" }, "Target marks", score), el("label", { class: "field" }, "Target percentile", pctIn),
      sec.map(([, label, input]) => el("label", { class: "field" }, `${label} target`, input))),
    el("p", { class: "muted small" }, "Section targets matter because each IIM sets a cutoff per section, not just overall."),
    el("div", { class: "row" }, save),
    best ? el("ul", {},
      el("li", {}, `Best so far: ${best.total} on ${best.source}, which is ${est(best) || "not on the tables"}.`),
      last && last !== best ? el("li", {}, `Latest: ${last.total} on ${last.source}, ${est(last) || "not on the tables"}.`) : null,
      me.goalScore !== null && me.goalScore !== undefined ? el("li", { class: best.total >= me.goalScore ? "good" : null },
        best.total >= me.goalScore ? "Your best already reaches the target." : `${me.goalScore - best.total} marks to go on your best paper.`) : null) : null,
    best ? [el("h3", {}, "Personal bests by section"),
      el("table", { class: "plain" }, el("tbody", {}, SECS.map(([k, label]) => {
        const m = bestSec[k];
        const target = me.goalSec?.[k];
        return el("tr", {}, el("td", {}, label), el("td", { class: `n${target !== undefined && m[k] >= target ? " good" : ""}` }, String(m[k])),
          el("td", { class: "muted small" }, `${m.source}, ${fmtDate(m.takenOn)}`),
          el("td", { class: "n muted small" }, target !== undefined ? (m[k] >= target ? "target met" : `${target - m[k]} to target`) : ""));
      })))] : el("p", { class: "empty" }, "Log a mock to see where you stand."),
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
  const editor = el("div", { id: "analysis-editor" });
  const openEditor = (m) => {
    const f = analysisFields(m.analysis || {});
    const save = el("button", { type: "submit", class: "btn primary" }, "Save the analysis");
    const form = el("form", { class: "panel stack" }, el("h3", {}, `Analysis: ${m.source}, ${fmtDate(m.takenOn)}`), f.nodes,
      el("div", { class: "row" }, save, el("button", { type: "button", class: "btn quiet", onclick: () => editor.replaceChildren() }, "Close")));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      busy(save, async () => { mocks = await rpc("cat_mock_analysis", { p_mock_id: m.id, p_analysis: f.read() }); refresh(); });
    });
    fill(editor, form);
    form.scrollIntoView({ block: "start" });
  };
  const rows = mocks.map((m) => {
    const del = el("button", { type: "button", class: "btn quiet small" }, "Delete");
    del.addEventListener("click", async () => {
      if (!(await confirmBox("Delete this mock?", [`${m.source} on ${fmtDate(m.takenOn)}, ${m.total} marks. Its points come off the board.`], "Delete"))) return;
      busy(del, async () => { mocks = await rpc("cat_mock_delete", { p_mock_id: m.id }); refresh(); });
    });
    const analyse = el("button", { type: "button", id: `analyse-${m.id}`, class: `btn small${m.analysedAt ? "" : " primary"}`, onclick: () => openEditor(m) }, m.analysedAt ? "Edit analysis" : "Analyse");
    const a = m.analysis || {};
    return el("tr", {},
      el("td", {}, fmtDate(m.takenOn)), el("td", {}, m.source, m.atSlotTime ? el("span", { class: "muted small" }, " at slot time") : null),
      el("td", { class: "n" }, String(m.varc)), el("td", { class: "n" }, String(m.dilr)), el("td", { class: "n" }, String(m.qa)),
      el("td", { class: "n" }, el("strong", {}, String(m.total))),
      el("td", {}, a.attempted ? SECS.map(([k]) => a.attempted[k] ?? "?").join(" / ") : ""),
      el("td", { class: "n" }, a.resolve !== undefined ? `${a.resolve} (+${a.resolve - m.total})` : ""),
      el("td", {}, el("span", { class: "row nowrap" }, analyse, del)));
  });
  const lastLines = mocks.find((m) => m.analysis?.skip?.length || m.analysis?.try?.length);
  return el("section", { class: "panel span-12" },
    el("h2", {}, "Your mocks"),
    mocks.length ? el("div", { class: "table-wrap" }, el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, ["Date", "Paper", "VARC", "DILR", "QA", "Total", "Attempted V/D/Q", "Untimed redo", ""].map((h, i) => el("th", { class: (i >= 2 && i <= 5) || i === 7 ? "n" : null }, h)))),
      el("tbody", {}, rows))) : el("p", { class: "empty" }, "None logged yet."),
    editor,
    chart(mocks),
    lastLines ? [el("h3", {}, `Carry into the next paper (from ${lastLines.source})`),
      el("div", { class: "grid-2" },
        el("div", {}, el("p", { class: "small" }, el("strong", {}, "Skip")), el("ul", {}, (lastLines.analysis.skip || []).map((x) => el("li", {}, x)))),
        el("div", {}, el("p", { class: "small" }, el("strong", {}, "Try")), el("ul", {}, (lastLines.analysis.try || []).map((x) => el("li", {}, x)))))] : null,
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
        SECS.map(([s]) => el("td", { class: `n${r[s] === best[s] && rows.length > 1 ? " good" : ""}` }, String(r[s]))),
        el("td", { class: "n" }, el("strong", {}, String(r.total))))))),
    el("p", { class: "muted small" }, "Each person's first sitting of this paper. Green marks the best in each section."));
  };
  select.addEventListener("change", () => show().catch(showError));
  if (ids.length) show().catch(showError);
  return el("section", { class: "panel span-12" }, el("h2", {}, "Head-to-head"),
    el("p", { class: "muted" }, "Pick a paper you've sat to compare section by section with everyone else who sat it."),
    select, host);
}

// ---- spending ---------------------------------------------------------------------------
async function spendPanel() {
  let rows = await rpc("cat_spend");
  const panel = el("section", { class: "panel span-12", id: "budget" });
  const item = el("input", { type: "text", maxlength: 80, required: true, placeholder: "e.g. TIME AIMCAT pack" });
  const amount = el("input", { type: "number", min: 0, max: 100000, step: 1, required: true, inputmode: "numeric", style: "width:8em" });
  const day = el("input", { type: "date", value: istToday(), max: istToday() });
  const add = el("button", { type: "submit", class: "btn" }, "Add");
  const form = el("form", { class: "row" }, el("label", { class: "field" }, "What", item), el("label", { class: "field" }, "Rupees", amount),
    el("label", { class: "field" }, "Day", day), add);
  const body = el("div");
  const paint = () => {
    const total = rows.reduce((s, r) => s + r.amount, 0);
    const p = Math.min(100, Math.round((total / BUDGET.max) * 100));
    fill(body,
      el("div", { class: `meter line-budget${total > BUDGET.max ? " over" : ""}`, role: "meter", "aria-valuemin": 0, "aria-valuemax": BUDGET.max, "aria-valuenow": total, "aria-label": "Spent against the limit" },
        el("span", { style: `width:${p}%` })),
      el("p", { class: total > BUDGET.preferred ? "warn" : "" }, `₹${total.toLocaleString("en-IN")} spent. The plan is ₹${BUDGET.preferred.toLocaleString("en-IN")}, ₹${BUDGET.max.toLocaleString("en-IN")} at most.`,
        total > BUDGET.max ? " Over the limit." : total > BUDGET.preferred ? " Past the plan; check the next purchase twice." : ""),
      rows.length ? el("table", { class: "plain" }, el("tbody", {}, rows.map((r) => {
        const del = el("button", { type: "button", class: "btn quiet small" }, "Delete");
        del.addEventListener("click", () => busy(del, async () => { rows = await rpc("cat_spend_delete", { p_id: r.id }); paint(); }));
        return el("tr", {}, el("td", {}, fmtDate(r.day)), el("td", {}, r.item), el("td", { class: "n" }, `₹${r.amount.toLocaleString("en-IN")}`), el("td", {}, del));
      }))) : null);
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(add, async () => {
      rows = await rpc("cat_spend_add", { p_item: item.value, p_amount: Number(amount.value), p_day: day.value || null });
      form.reset();
      day.value = istToday();
      paint();
    });
  });
  paint();
  fill(panel, el("h2", {}, "Mock budget"), el("p", { class: "muted" }, "Only you see this. Log what you pay for mocks or test series."), form, body);
  return panel;
}

async function render() {
  const grid = el("div", { class: "grid" });
  const refresh = () => render().catch(showError);
  const [cal, h2h, spend] = await Promise.all([calendarPanel(refresh), headToHead(), spendPanel().catch((e) => el("p", { class: "notice error" }, e.message))]);
  grid.append(cal, logPanel(refresh), goalPanel(refresh), minePanel(refresh), h2h, spend, papersPanel());
  fill(main, el("div", { class: "page-head" }, el("h1", {}, "Mocks")), grid);
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

async function init() {
  me = await boot("mocks.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  try {
    [papers, mocks, tables, calendar, facts] = await Promise.all([
      loadJson("data/papers.json"), rpc("cat_mocks"), loadJson("data/percentiles.json").catch(() => null),
      rpc("cat_calendar").catch(() => []), loadJson("data/facts.json").catch(() => null)]);
    await render();
  } catch (err) {
    fill(main, el("p", { class: "notice error" }, err.message));
  }
}

init();

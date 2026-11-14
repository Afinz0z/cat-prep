// More Practice tabs: the error log, search, formula cards from memory,
// the RC speed log and the DILR set-choice drill.
import { rpc } from "./db.js";
import { el, busy, loadJson, istToday, fmtDate, fmtDateTime, fmtDuration, fmtClock, fill, local, setLocal, richText } from "./ui.js";

const CAUSES = [
  ["c1", "Conceptual gap"], ["c2", "Calculation slip"], ["c3", "Misreading"], ["c4", "Poor selection"],
  ["c5", "Time management"], ["c6", "Guess or over-attempt"], ["c7", "Missed an easier one"],
];
const CONF = { sure: "Sure", unsure: "Unsure", guess: "Guess" };
const RESULT = { wrong: "Wrong", skipped: "Blank" };

let topicsCache = null;
async function topicNames() {
  topicsCache = topicsCache || loadJson("data/topics.json").then((d) => d.topics).catch(() => []);
  return topicsCache;
}

// ---- error log --------------------------------------------------------------------
export async function errorsView() {
  const [errors, conf, easy, topics] = await Promise.all([
    rpc("cat_errors"), rpc("cat_confidence"), rpc("cat_missed_easy"), topicNames(),
  ]);
  const names = Object.fromEntries(topics.map((t) => [t.id, t.name]));
  const host = el("div", { class: "stack" });
  const filter = el("select", { "aria-label": "Show" },
    el("option", { value: "all" }, "Every miss"),
    el("option", { value: "untagged" }, "Not tagged yet"),
    el("option", { value: "queue" }, "Still in the review queue"),
    el("optgroup", { label: "By cause" }, CAUSES.map(([v, l]) => el("option", { value: v }, l))));
  filter.value = local("cat-errors-filter", "all");
  const list = el("div", { class: "table-wrap" });
  const paint = () => {
    setLocal("cat-errors-filter", filter.value);
    const f = filter.value;
    const rows = errors.filter((e) => f === "all" || (f === "untagged" ? !e.cause : f === "queue" ? e.inQueue : e.cause === f));
    fill(list, rows.length ? el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, ["Test", "No.", "Result", "Topic", "How sure", "Cause", "Queue", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, rows.map((e) => {
        const sel = el("select", { "aria-label": `Cause for ${e.testTitle} question ${e.number}` },
          el("option", { value: "" }, "Not tagged"), CAUSES.map(([v, l]) => el("option", { value: v, selected: e.cause === v }, l)));
        sel.addEventListener("change", () => busy(sel, async () => {
          await rpc("cat_cause_set", { p_test_id: e.testId, p_question_id: e.questionId, p_cause: sel.value || null });
          e.cause = sel.value || null;
          if (filter.value !== "all") paint();
          tally();
        }));
        return el("tr", {},
          el("td", {}, e.testTitle, el("br"), el("span", { class: "muted small" }, fmtDate(e.at))),
          el("td", {}, String(e.number)),
          el("td", {}, RESULT[e.result] || e.result),
          el("td", {}, names[e.topic] || e.topic || ""),
          el("td", {}, CONF[e.conf] || ""),
          el("td", {}, sel),
          el("td", {}, e.cleared ? "Cleared" : e.inQueue ? "In it" : ""),
          el("td", {}, el("a", { class: "btn small", href: `test.html?attempt=${e.attemptId}#q-${e.questionId}` }, "Open")));
      }))) : el("p", { class: "empty" }, errors.length ? "Nothing matches that filter." : "No misses logged yet. Every question you get wrong or leave blank on a first try lands here."));
  };
  const tallyHost = el("p", { class: "muted" });
  const tally = () => {
    const by = {};
    for (const e of errors) if (e.cause) by[e.cause] = (by[e.cause] || 0) + 1;
    const top = CAUSES.filter(([v]) => by[v]).sort((a, b) => by[b[0]] - by[a[0]]);
    const untagged = errors.filter((e) => !e.cause).length;
    fill(tallyHost, top.length ? `Most common: ${top.slice(0, 3).map(([v, l]) => `${l.toLowerCase()} (${by[v]})`).join(", ")}. ` : "", untagged ? `${untagged} not tagged yet.` : "Every miss is tagged.");
  };
  filter.addEventListener("change", paint);
  paint();
  tally();
  const confRows = Object.entries(CONF).filter(([v]) => conf[v]).map(([v, label]) => {
    const r = conf[v];
    return el("li", {}, `${label}: ${r.right} of ${r.answered} right (${Math.round((r.right / r.answered) * 100)}%)`);
  });
  fill(host,
    el("section", { class: "panel" },
      el("h2", {}, "Error log"),
      el("p", { class: "muted" }, "Every question you got wrong or left blank on a first try, and every miss in a mixed set or retest. Tag each with a cause; the tags add up to your biggest leaks."),
      el("div", { class: "row" }, filter), tallyHost, list),
    el("section", { class: "panel" },
      el("h2", {}, "How sure you were"),
      confRows.length ? [el("ul", {}, confRows),
        el("p", { class: "muted small" }, "If your Sure answers are often wrong, slow down on the last step. If your Guesses on multiple choice come out right less than a quarter of the time, the guessing is costing marks.")]
        : el("p", { class: "empty" }, "Tag your answers Sure, Unsure or Guess during a test and the split shows here.")),
    el("section", { class: "panel" },
      el("h2", {}, "Easy ones you missed"),
      el("p", { class: "muted" }, "Questions you left blank that most of the group got right, with a typical right answer in under 2 minutes."),
      easy.length ? el("ul", { class: "list" }, easy.map((m) => el("li", {},
        el("span", { class: "grow" }, `${m.testTitle}, question ${m.number}: ${m.groupRight} of ${m.groupDone} got it, median ${fmtDuration(m.medianSec)}.`),
        el("a", { class: "btn small", href: `test.html?attempt=${m.attemptId}#q-${m.questionId}` }, "Open"))))
        : el("p", { class: "empty" }, "None so far.")));
  return host;
}

// ---- search -------------------------------------------------------------------------
export function searchView() {
  const input = el("input", { type: "search", maxlength: 60, placeholder: "e.g. alligation, successive, circular", "aria-label": "Search approaches, notes and explanations" });
  const out = el("div");
  let timer = null;
  const run = async () => {
    const q = input.value.trim();
    if (q.length < 2) { fill(out, el("p", { class: "muted" }, "Type two letters or more.")); return; }
    const rows = await rpc("cat_search", { p_q: q });
    fill(out, rows.length ? el("ul", { class: "list" }, rows.map((r) => el("li", {},
      el("span", { class: "grow" },
        el("strong", {}, `${r.testTitle}, question ${String(r.questionId).replace(/^.*~/, "").replace(/^q/, "")}`),
        el("span", { class: "muted small" }, ` ${r.kind === "approach" ? `approach by ${r.name}` : r.kind === "bookmark" ? "your bookmark note" : "your explanation"}, ${fmtDateTime(r.at)}`),
        el("br"), r.text),
      el("a", { class: "btn small", href: `test.html?id=${encodeURIComponent(r.testId)}` }, "Open the test"))))
      : el("p", { class: "empty" }, "Nothing found. Approaches only show for tests you've submitted."));
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run().catch(() => {}), 300); });
  return el("section", { class: "panel" }, el("h2", {}, "Search"),
    el("p", { class: "muted" }, "Searches the group's approaches on tests you've submitted, your bookmark notes, and your why-it's-right explanations."),
    input, out);
}

// ---- formula cards from memory ---------------------------------------------------------
export async function cardsView() {
  const topics = (await topicNames()).filter((t) => t.notes);
  const [recall, notes] = await Promise.all([
    rpc("cat_recall"),
    Promise.all(topics.map((t) => loadJson(`data/notes/${t.id}.json`).then((n) => [t, n]).catch(() => null))),
  ]);
  const today = istToday();
  const cards = [];
  for (const pair of notes.filter(Boolean)) {
    const [t, n] = pair;
    n.blocks.forEach((b, i) => {
      const id = `${t.id}#${i}`;
      const r = recall[id];
      cards.push({ id, topic: t, block: b, r, due: !r || (!r.cleared && r.dueOn <= today) });
    });
  }
  const due = cards.filter((c) => c.due && c.r);
  const fresh = cards.filter((c) => !c.r);
  const cleared = cards.filter((c) => c.r?.cleared).length;
  const host = el("div", { class: "stack" });
  const deck = el("div", { class: "stack" });
  let mode = local("cat-cards-mode", "due");
  const pick = el("select", { "aria-label": "Which cards" },
    el("option", { value: "due", selected: mode === "due" }, `Due again (${due.length})`),
    el("option", { value: "new", selected: mode === "new" }, `Not tried yet (${fresh.length})`),
    el("optgroup", { label: "One topic" }, topics.map((t) => el("option", { value: t.id, selected: mode === t.id }, t.name))));
  const paint = () => {
    mode = pick.value;
    setLocal("cat-cards-mode", mode);
    const list = mode === "due" ? due : mode === "new" ? fresh : cards.filter((c) => c.topic.id === mode);
    fill(deck, list.length ? list.map(card) : el("p", { class: "empty" }, mode === "due" ? "Nothing due. Pick a topic to start its cards." : "No cards here."));
  };
  pick.addEventListener("change", paint);
  function card(c) {
    const lines = el("ul", { hidden: true }, c.block.lines.map((l) => el("li", {}, l)));
    const show = el("button", { type: "button", class: "btn small" }, "Show the card");
    const yes = el("button", { type: "button", class: "btn small primary", hidden: true }, "I had it all");
    const no = el("button", { type: "button", class: "btn small", hidden: true }, "I missed some");
    const status = el("p", { class: "status-line", role: "status" });
    show.addEventListener("click", () => { lines.hidden = false; show.hidden = true; yes.hidden = false; no.hidden = false; });
    const mark = (ok, btn) => busy(btn, async () => {
      const r = (await rpc("cat_recall_mark", { p_card: c.id, p_ok: ok }))[c.id];
      yes.hidden = true;
      no.hidden = true;
      status.className = `status-line ${ok ? "good" : "error"}`;
      status.textContent = r.cleared ? "Cleared: three times right." : ok ? `Back on ${fmtDate(r.dueOn)}.` : "Back tomorrow.";
    });
    yes.addEventListener("click", () => mark(true, yes));
    no.addEventListener("click", () => mark(false, no));
    return el("div", { class: "note-card" },
      el("p", { class: "muted small" }, c.topic.name, c.r ? `, right ${c.r.hits} and missed ${c.r.misses} so far` : ""),
      el("h3", {}, c.block.heading),
      el("p", { class: "small" }, "Write everything on this card on paper first. Then show it and check."),
      lines, el("div", { class: "row" }, show, yes, no), status);
  }
  fill(host, el("section", { class: "panel" },
    el("h2", {}, "Formula cards from memory"),
    el("p", { class: "muted" }, `Write a card from memory, then check it. A miss brings it back tomorrow; right after 1, 3 and 7 days clears it. ${cleared} of ${cards.length} cleared.`),
    el("div", { class: "row" }, pick)), deck);
  paint();
  return host;
}

// ---- RC speed log --------------------------------------------------------------------------
export async function rcView() {
  let rows = await rpc("cat_rc_log");
  const host = el("section", { class: "panel" });
  const words = el("input", { type: "number", min: 100, max: 3000, step: 10, inputmode: "numeric", required: true, style: "width:7em" });
  const min = el("input", { type: "number", min: 0, max: 60, step: 1, inputmode: "numeric", required: true, style: "width:5em", "aria-label": "Minutes" });
  const sec = el("input", { type: "number", min: 0, max: 59, step: 1, inputmode: "numeric", value: "0", style: "width:5em", "aria-label": "Seconds" });
  const right = el("input", { type: "number", min: 0, max: 10, step: 1, inputmode: "numeric", required: true, style: "width:5em" });
  const total = el("input", { type: "number", min: 1, max: 10, step: 1, inputmode: "numeric", value: "4", required: true, style: "width:5em" });
  const source = el("input", { type: "text", maxlength: 80, placeholder: "e.g. CAT 2024 Slot 1, RC 2" });
  const add = el("button", { type: "submit", class: "btn primary" }, "Log it");
  const form = el("form", { class: "stack" },
    el("div", { class: "form-grid" },
      el("label", { class: "field" }, "Words in the passage", words),
      el("label", { class: "field" }, "Time to read and answer", el("span", { class: "row" }, min, "min", sec, "s")),
      el("label", { class: "field" }, "Right", right),
      el("label", { class: "field" }, "Questions", total),
      el("label", { class: "field wide" }, "Which passage", source)),
    el("div", { class: "row" }, add));
  const table = el("div", { class: "table-wrap" });
  const paint = () => {
    const recent = rows.slice(0, 5);
    const acc = recent.length ? Math.round((recent.reduce((s, r) => s + r.right, 0) / recent.reduce((s, r) => s + r.total, 0)) * 100) : null;
    fill(table,
      acc !== null ? el("p", { class: acc >= 70 ? "good" : "" }, `Last ${recent.length}: ${acc}% right against the 70% target, ${Math.round(recent.reduce((s, r) => s + (r.words / r.seconds) * 60, 0) / recent.length)} words a minute on average.`) : null,
      rows.length ? el("table", { class: "plain" },
        el("thead", {}, el("tr", {}, ["When", "Passage", "Words", "Time", "Words a minute", "Right", ""].map((h, i) => el("th", { class: i >= 2 && i <= 5 ? "n" : null }, h)))),
        el("tbody", {}, rows.map((r) => {
          const del = el("button", { type: "button", class: "btn quiet small" }, "Delete");
          del.addEventListener("click", () => busy(del, async () => { rows = await rpc("cat_rc_log_delete", { p_id: r.id }); paint(); }));
          return el("tr", {}, el("td", {}, fmtDateTime(r.at)), el("td", {}, r.source || ""),
            el("td", { class: "n" }, String(r.words)), el("td", { class: "n" }, fmtClock(r.seconds * 1000)),
            el("td", { class: "n" }, String(Math.round((r.words / r.seconds) * 60))),
            el("td", { class: `n${r.right / r.total >= 0.7 ? " good" : ""}` }, `${r.right} of ${r.total}`), el("td", {}, del));
        }))) : el("p", { class: "empty" }, "No passages logged yet. Time your next RC passage and log it here."));
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(add, async () => {
      rows = await rpc("cat_rc_log_add", {
        p_words: Number(words.value), p_seconds: Number(min.value || 0) * 60 + Number(sec.value || 0),
        p_right: Number(right.value), p_total: Number(total.value), p_source: source.value,
      });
      form.reset();
      total.value = "4";
      sec.value = "0";
      paint();
    });
  });
  paint();
  fill(host, el("h2", {}, "RC speed log"),
    el("p", { class: "muted" }, "About 10 minutes a passage is the pace that fits 4 RC sets into VARC. Count the words roughly: lines times words in a typical line."),
    form, table);
  return host;
}

// ---- DILR set choice -----------------------------------------------------------------------
// Four set openings, five minutes to pick two, then how hard each really was.
export async function choiceView(index) {
  const sets = index.filter((t) => String(t.topic || "").startsWith("dilr-"));
  const host = el("section", { class: "panel" });
  const history = local("cat-choice-history", []) || [];
  const intro = () => fill(host,
    el("h2", {}, "DILR set choice"),
    el("p", { class: "muted" }, "In the exam, the first 5 minutes of DILR go on reading every set and picking two to start with. Here you see four set openings with no titles. Pick the two you'd start with, then see how hard each one was and how the group did."),
    history.length ? el("p", {}, `Your last rounds: ${history.slice(-5).map((h) => `${h.good} of 2`).join(", ")} picks among the two easiest.`) : null,
    el("button", { type: "button", class: "btn primary", onclick: () => start().catch((e) => fill(host, el("p", { class: "notice error" }, e.message))) }, "Start a round"));
  async function start() {
    const four = sets.slice().sort(() => Math.random() - 0.5).slice(0, 4);
    if (four.length < 4) { fill(host, el("p", { class: "empty" }, "Four DILR sets are needed for a round.")); return; }
    const defs = await Promise.all(four.map((t) => loadJson(`tests/${encodeURIComponent(t.id)}.json`)));
    const picked = new Set();
    const ends = Date.now() + 5 * 60000;
    const clock = el("span", { class: "room-clock" }, "5:00");
    const done = el("button", { type: "button", class: "btn primary", disabled: true }, "Go with these two");
    const cards = defs.map((d, i) => {
      const g = d.sections[0].groups?.[0];
      const box = el("input", { type: "checkbox", id: `set-${i}` });
      box.addEventListener("change", () => {
        if (box.checked) picked.add(i); else picked.delete(i);
        if (picked.size > 2) { box.checked = false; picked.delete(i); }
        done.disabled = picked.size !== 2;
      });
      return el("div", { class: "note-card" },
        el("p", {}, box, el("label", { for: `set-${i}` }, el("strong", {}, ` Set ${"ABCD"[i]}`))),
        el("div", { class: "set-opening" }, richText(g?.text || d.sections[0].questions[0].text)),
        el("p", { class: "muted small" }, `${d.sections[0].questions.length} questions`));
    });
    const timer = setInterval(() => {
      const left = ends - Date.now();
      clock.textContent = fmtClock(Math.max(0, left));
      if (left <= 0) { clearInterval(timer); finish(); }
    }, 500);
    async function finish() {
      clearInterval(timer);
      const rank = { easy: 0, medium: 1, hard: 2 };
      const stats = await Promise.all(four.map((t) => rpc("cat_thread_summary", { p_test_id: t.id }).catch(() => null)));
      const rows = four.map((t, i) => {
        const qs = Object.values(stats[i]?.questions || {});
        const right = qs.reduce((s, q) => s + (q.right || 0), 0);
        const doneN = qs.reduce((s, q) => s + (q.done || 0), 0);
        return { i, t, level: t.difficulty || "medium", open: Boolean(stats[i]?.open), rate: doneN ? Math.round((right / doneN) * 100) : null };
      });
      const easiest = rows.slice().sort((a, b) => rank[a.level] - rank[b.level] || (b.rate ?? -1) - (a.rate ?? -1)).slice(0, 2).map((r) => r.i);
      const good = [...picked].filter((i) => easiest.includes(i)).length;
      history.push({ day: istToday(), good });
      setLocal("cat-choice-history", history.slice(-20));
      fill(host, el("h2", {}, `You picked ${good} of the 2 easiest`),
        el("table", { class: "plain" },
          el("thead", {}, el("tr", {}, ["Set", "Your pick", "How hard", "Group solve rate", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows.map((r) => el("tr", { class: easiest.includes(r.i) ? "me" : "" },
            el("td", {}, `Set ${"ABCD"[r.i]}: ${r.t.title}`), el("td", {}, picked.has(r.i) ? "Picked" : ""),
            el("td", {}, r.level), el("td", {}, r.rate !== null ? `${r.rate}%` : r.open ? "nobody yet" : "shows once you solve it"),
            el("td", {}, el("a", { class: "btn small", href: `test.html?id=${encodeURIComponent(r.t.id)}` }, "Solve it")))))),
        el("p", { class: "muted small" }, "Highlighted rows are the two easiest by the set's level, then by the group's first-try solve rate. Look for a clear first step and a small number of cases."),
        el("button", { type: "button", class: "btn", onclick: () => start().catch(() => {}) }, "Another round"));
    }
    done.addEventListener("click", finish);
    fill(host, el("div", { class: "page-head" }, el("h2", {}, "Pick two sets"), clock), el("div", { class: "grid-2" }, cards), el("div", { class: "row" }, done));
  }
  intro();
  return host;
}

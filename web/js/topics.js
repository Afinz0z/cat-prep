// Topics in priority order, with checked videos, formula cards and practice sets.
import { rpc } from "./db.js";
import { el, boot, busy, loadJson, local, setLocal, showError, fill, toast } from "./ui.js";
import { startReminders, cacheSettings } from "./reminders.js";

const main = document.getElementById("main");
const STATUS = [
  ["not-started", "Not started"],
  ["learning", "Learning"],
  ["basic", "Solves basic"],
  ["cat-level", "Solves CAT level"],
  ["revise", "Needs revision"],
];
const CALL_LABEL = { must: "Must", should: "Should", optional: "Optional", skip: "Skip" };
let data = null;
let progress = null;
let attempts = {};
let index = {};
let readiness = {};
let board = [];
let qtypes = {};
let checkByTopic = {};
const notesCache = {};
const workedCache = {};

function seconds(t) {
  const parts = String(t).split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((s, n) => s * 60 + n, 0);
}
function watchUrl(id, t) {
  const s = t ? seconds(t) : 0;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}${s ? `&t=${s}s` : ""}`;
}
function fmtLen(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function nextVideo(topic) {
  const watched = new Set(progress.videos);
  const order = ["primary", "backup", "extra"];
  const lang = local("cat-video-lang", "any");
  const pool = topic.videos.filter((v) => lang === "any" || v.language.startsWith(lang));
  const list = (pool.length ? pool : topic.videos).slice().sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return list.find((v) => !watched.has(v.id)) || null;
}

function videoItem(v, isNext) {
  const watched = progress.videos.includes(v.id);
  const box = el("input", { type: "checkbox", checked: watched, id: `v-${v.id}` });
  box.addEventListener("change", () => busy(box, async () => {
    progress = await rpc("cat_video_set", { p_video: v.id, p_watched: box.checked });
    render();
    const topic = data.topics.find((t) => t.videos.some((x) => x.id === v.id));
    const set = topic && practiceSets(topic).find((id) => !(id in attempts));
    if (box.checked && set) {
      toast({ title: "Now the practice set", body: "Solving fresh questions within the hour is what makes the video stick.",
        actions: [{ label: "Start it", primary: true, onClick: () => { location.href = `test.html?id=${encodeURIComponent(set)}`; } }], autoHideMs: 12000 });
    }
  }));
  const start = /^\d/.test(v.watch) ? v.watch.split(" ")[0] : null;
  return el("li", { class: `${v.role}${isNext ? " next" : ""}` },
    isNext ? el("p", { class: "small" }, el("strong", {}, "Watch this next")) : null,
    el("a", { class: "vt", href: watchUrl(v.id, start), target: "_blank", rel: "noopener" }, v.title),
    el("p", { class: "muted small" },
      `${v.channel}, ${fmtLen(v.durationSec)}, ${v.language}. `,
      v.role === "primary" ? "Main pick. " : v.role === "backup" ? "Backup if the main one doesn't suit you. " : "Extra for a gap. ",
      v.watch && v.watch !== "all" ? `Watch ${v.watch}. ` : "Watch all of it. ",
      v.checked === "captions" ? "Checked against its captions." : "Checked from its chapter list only.",
      v.embed ? "" : " Opens on YouTube only."),
    v.covers?.length ? el("details", {}, el("summary", { class: "small" }, "What it covers"),
      el("ul", { class: "covers" }, v.covers.map((c) => el("li", {},
        el("a", { href: watchUrl(v.id, c.t), target: "_blank", rel: "noopener" }, c.t), ` ${c.what}`)))) : null,
    v.gaps ? el("p", { class: "muted small" }, `Gaps: ${v.gaps}`) : null,
    el("p", { class: "small" }, box, el("label", { for: `v-${v.id}` }, " Watched (5 points)")));
}

const cardLabel = (t) => (t.section === "QA" ? "Formula card" : "Method card");

async function toggleNotes(topic, host, button) {
  if (host.childElementCount) {
    host.replaceChildren();
    button.textContent = cardLabel(topic);
    return;
  }
  try {
    const n = notesCache[topic.id] || (notesCache[topic.id] = await loadJson(`data/notes/${topic.id}.json`));
    fill(host, el("div", { class: "note-card" },
      el("h3", {}, n.title),
      n.blocks.map((b) => [el("h4", {}, b.heading), el("ul", {}, b.lines.map((l) => el("li", {}, l)))]),
      el("p", { class: "no-print small" }, el("button", { type: "button", class: "btn small", onclick: () => window.print() }, "Print"))));
    button.textContent = "Hide card";
  } catch (err) {
    showError(err);
  }
}

const practiceSets = (t) => (Array.isArray(t.practice) ? t.practice : t.practice ? [t.practice] : []);
const pct = (r) => (r && r.total ? Math.round((r.solved / r.total) * 100) : null);

// Solved share against the 70% line that counts as ready.
function readyMeter(t) {
  const r = readiness[t.id];
  const p = pct(r);
  if (p === null) return null;
  const weak = r.sets >= 2 && p < 50;
  return el("div", { class: "ready" },
    el("div", { class: `meter line-70${p >= 70 ? " done" : ""}`, role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": p,
      "aria-label": `${t.name} readiness` }, el("span", { style: `width:${p}%` })),
    el("p", { class: "small" }, `${r.solved} of ${r.total} right on first tries and reviews (${p}%). 70% is the line for ready.`),
    weak ? el("p", { class: "notice" }, "Under half right after two sets. Watch the backup video or the worked examples, then clear the misses in the review queue before a third set.") : null);
}

// Best in the group on this topic, and a link to ask them.
function boardBlock(t) {
  const rows = board.map((m) => ({ ...m, r: m.topics[t.id] })).filter((m) => m.r && m.r.total)
    .sort((a, b) => pct(b.r) - pct(a.r) || b.r.total - a.r.total);
  if (!rows.length) return null;
  const best = rows.find((m) => !m.me && m.r.total >= 4 && pct(m.r) >= 60);
  return el("details", {},
    el("summary", { class: "small" }, "The group on this topic"),
    el("table", { class: "plain" }, el("tbody", {}, rows.map((m) => el("tr", { class: m.me ? "me" : "" },
      el("td", {}, m.name), el("td", { class: "n" }, `${m.r.solved} of ${m.r.total}`), el("td", { class: "n" }, `${pct(m.r)}%`))))),
    best ? el("p", { class: "small" }, el("a", { href: `chat.html?ask=${encodeURIComponent(best.name)}&topic=${encodeURIComponent(t.name)}` }, `Ask ${best.name} how they approach it`)) : null);
}

// Worked examples. A type you've already got right twice stays folded.
async function toggleWorked(topic, host, button) {
  if (host.childElementCount) {
    host.replaceChildren();
    button.textContent = "Worked examples";
    return;
  }
  try {
    const w = workedCache[topic.id] || (workedCache[topic.id] = await loadJson(`data/worked/${topic.id}.json`));
    fill(host, el("div", { class: "note-card worked" },
      el("h3", {}, `${topic.name}: worked examples`),
      w.examples.map((x) => {
        const body = [el("p", {}, x.problem), el("ol", {}, x.steps.map((st) => el("li", {}, st))), el("p", {}, el("strong", {}, `Answer: ${x.answer}`))];
        if ((qtypes[x.qtype] || 0) < 2) return el("section", {}, el("h4", {}, x.title), body);
        const more = el("div", { hidden: true }, body);
        const show = el("button", { type: "button", class: "btn small quiet" }, "Show it anyway");
        show.addEventListener("click", () => { more.hidden = false; show.remove(); });
        return el("section", {}, el("h4", {}, x.title), el("p", { class: "muted small" }, `You've got this type right ${qtypes[x.qtype]} times, so it's folded.`), show, more);
      })));
    button.textContent = "Hide examples";
  } catch (err) {
    showError(err);
  }
}

function topicBlock(t) {
  const status = progress.topics[t.id] || "not-started";
  const select = el("select", { "aria-label": `Your status for ${t.name}` }, STATUS.map(([v, label]) => el("option", { value: v, selected: v === status }, label)));
  select.addEventListener("change", () => busy(select, async () => {
    progress = await rpc("cat_topic_set", { p_topic: t.id, p_status: select.value });
    render();
  }));
  const g = progress.group[t.id] || { basic: 0, catLevel: 0 };
  const nv = t.videos.length ? nextVideo(t) : null;
  const notesHost = el("div");
  const notesBtn = t.notes ? el("button", { type: "button", class: "btn small" }, cardLabel(t)) : null;
  notesBtn?.addEventListener("click", () => toggleNotes(t, notesHost, notesBtn));
  const workedHost = el("div");
  const workedBtn = t.worked ? el("button", { type: "button", class: "btn small" }, "Worked examples") : null;
  workedBtn?.addEventListener("click", () => toggleWorked(t, workedHost, workedBtn));
  const sets = practiceSets(t);
  const nextSet = sets.find((id) => !(id in attempts));
  const check = checkByTopic[t.id];
  const showVideos = local("cat-open-topics", {})[t.id] ?? (t.call === "must" && status !== "cat-level");
  const videos = el("details", { open: showVideos },
    el("summary", {}, `${t.videos.length} video${t.videos.length === 1 ? "" : "s"}`),
    el("ul", { class: "videos" }, t.videos.map((v) => videoItem(v, nv && v.id === nv.id))));
  videos.addEventListener("toggle", () => {
    const open = local("cat-open-topics", {});
    open[t.id] = videos.open;
    setLocal("cat-open-topics", open);
  });
  return el("article", { class: "topic", id: t.id },
    el("div", { class: "topic-head" },
      el("span", { class: `call call-${t.call}` }, CALL_LABEL[t.call]),
      el("h3", {}, t.name),
      select),
    el("p", { class: "topic-meta" },
      `In the group: ${g.basic} of ${progress.members} solve basic questions, ${g.catLevel} solve CAT-level ones.`,
      check ? ` Your basics check: ${check.right} of ${check.total} on this topic.` : "",
      t.videos.length && nv ? "" : t.videos.length ? " You've watched every video here." : " No videos picked yet; ask in the chat."),
    readyMeter(t),
    el("div", { class: "row" },
      sets.map((id, i) => {
        const done = attempts[id];
        const info = index[id];
        const n = info ? info.sections.reduce((k, x) => k + x.count, 0) : null;
        return el("a", { class: `btn small${id === nextSet ? " primary" : ""}`, href: `test.html?id=${encodeURIComponent(id)}` },
          done === undefined ? `Set ${i + 1}${n ? ` (${n} questions${info.difficulty ? `, ${info.difficulty}` : ""})` : ""}` : `Set ${i + 1}: ${done} marks first time`);
      }),
      workedBtn, notesBtn),
    workedHost,
    notesHost,
    boardBlock(t),
    t.videos.length ? videos : null);
}

let section = local("cat-topic-section", "QA");
// After the basics check, Must QA topics go weakest first; ties keep the rank order.
const byCheck = () => Object.keys(checkByTopic).length && local("cat-order-check", true) !== false;
function render() {
  const host = document.getElementById("topic-list");
  const rate = (t) => (checkByTopic[t.id] ? checkByTopic[t.id].right / checkByTopic[t.id].total : 2);
  const topics = data.topics.filter((t) => t.section === section)
    .sort((a, b) => (byCheck() && a.call === "must" && b.call === "must" ? rate(a) - rate(b) : 0) || a.rank - b.rank);
  const groups = ["must", "should", "optional", "skip"].map((call) => [call, topics.filter((t) => t.call === call)]).filter(([, list]) => list.length);
  fill(host, ...groups.map(([call, list]) => el("section", { class: "panel" },
    el("h2", {}, `${CALL_LABEL[call]} (${list.length})`),
    el("p", { class: "muted" }, data.calls[call]),
    call === "must" && section === "QA" && byCheck() ? el("p", { class: "muted small" }, "Ordered by your basics check, weakest first.") : null,
    list.map(topicBlock))));
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

async function basicsByTopic(attemptId) {
  const [a, def] = await Promise.all([rpc("cat_attempt", { p_attempt_id: attemptId }), loadJson("tests/qa-basics-check.json")]);
  const topicOf = {};
  for (const x of def.sections) for (const q of x.questions) topicOf[q.id] = q.topic;
  const out = {};
  for (const q of a.questions) {
    const t = topicOf[q.id];
    if (!t) continue;
    out[t] = out[t] || { right: 0, total: 0 };
    out[t].total += 1;
    if (q.result === "correct") out[t].right += 1;
  }
  return out;
}

// Every formula card in one printout, one topic after another.
async function printAllCards(button) {
  await busy(button, async () => {
    const list = data.topics.filter((t) => t.notes);
    const notes = await Promise.all(list.map((t) => notesCache[t.id] || (notesCache[t.id] = loadJson(`data/notes/${t.id}.json`))));
    const sheet = el("div", { id: "print-cards" }, notes.map((n) => el("section", { class: "print-card" },
      el("h2", {}, n.title), n.blocks.map((b) => [el("h4", {}, b.heading), el("ul", {}, b.lines.map((l) => el("li", {}, l)))]))));
    document.getElementById("print-cards")?.remove();
    document.body.append(sheet);
    document.body.classList.add("printing-cards");
    const done = () => { document.body.classList.remove("printing-cards"); sheet.remove(); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  });
}

async function init() {
  const me = await boot("topics.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  try {
    let idx;
    [data, progress, idx, readiness, board, qtypes] = await Promise.all([
      loadJson("data/topics.json"), rpc("cat_progress"), loadJson("tests/index.json"),
      rpc("cat_readiness").catch(() => ({})), rpc("cat_topic_board").catch(() => []), rpc("cat_qtype_counts").catch(() => ({})),
    ]);
    index = Object.fromEntries(idx.map((t) => [t.id, t]));
    const tries = await rpc("cat_attempts");
    const sorted = tries.slice().sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));
    for (const a of sorted) if (!(a.testId in attempts)) attempts[a.testId] = a.totals.marks;
    const check = sorted.find((a) => a.testId === "qa-basics-check");
    if (check) checkByTopic = await basicsByTopic(check.attemptId).catch(() => ({}));
  } catch (err) {
    fill(main, el("p", { class: "notice error" }, err.message));
    return;
  }
  const hit = data.topics.find((t) => `#${t.id}` === location.hash);
  if (hit) section = hit.section;
  const tabs = el("div", { class: "tabs", role: "tablist" }, ["QA", "DILR", "VARC"].map((s) => {
    const b = el("button", { type: "button", role: "tab", "aria-selected": String(s === section) }, s);
    b.addEventListener("click", () => {
      section = s;
      setLocal("cat-topic-section", s);
      for (const x of tabs.children) x.setAttribute("aria-selected", String(x === b));
      render();
    });
    return b;
  }));
  const lang = el("select", { "aria-label": "Which videos to suggest first" },
    [["any", "Suggest any language"], ["English", "Suggest English first"], ["Hindi", "Suggest Hindi-English first"]].map(([v, l]) =>
      el("option", { value: v, selected: v === local("cat-video-lang", "any") }, l)));
  lang.addEventListener("change", () => { setLocal("cat-video-lang", lang.value); render(); });
  const order = el("input", { type: "checkbox", id: "order-check", checked: local("cat-order-check", true) !== false });
  order.addEventListener("change", () => { setLocal("cat-order-check", order.checked); render(); });
  const printBtn = el("button", { type: "button", class: "btn small" }, "Print all formula cards");
  printBtn.addEventListener("click", () => printAllCards(printBtn).catch(showError));
  fill(main,
    el("div", { class: "page-head" }, el("h1", {}, "Topics"), el("div", { class: "row" }, lang, printBtn)),
    Object.keys(checkByTopic).length ? el("p", { class: "small" }, order, el("label", { for: "order-check" }, " Put my weakest Must topics from the basics check first")) : null,
    el("p", { class: "muted" }, "Ranked by marks per hour of study for the time left. A topic counts as done when you solve fresh questions on it without help, not when the video ends. Every video was opened and checked on 13 or 14 Nov; nobody has watched them all end to end, so say in the chat if one is weak."),
    tabs,
    el("div", { id: "topic-list", class: "stack" }));
  render();
}

init();

// Topics in priority order, with checked videos, formula cards and practice sets.
import { rpc } from "./db.js";
import { el, boot, busy, loadJson, local, setLocal, showError, fill } from "./ui.js";
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
const notesCache = {};

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

async function toggleNotes(topic, host, button) {
  if (host.childElementCount) {
    host.replaceChildren();
    button.textContent = "Formula card";
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
  const notesBtn = t.notes ? el("button", { type: "button", class: "btn small" }, "Formula card") : null;
  notesBtn?.addEventListener("click", () => toggleNotes(t, notesHost, notesBtn));
  const done = t.practice ? attempts[t.practice] : null;
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
      t.videos.length && nv ? "" : t.videos.length ? " You've watched every video here." : " No videos picked yet; ask in the chat."),
    el("div", { class: "row" },
      t.practice ? el("a", { class: `btn small${done === undefined ? " primary" : ""}`, href: `test.html?id=${t.practice}` },
        done === undefined ? "Practice set (10 questions)" : `Practice set: ${done} marks first time`) : null,
      notesBtn),
    notesHost,
    t.videos.length ? videos : null);
}

let section = local("cat-topic-section", "QA");
function render() {
  const host = document.getElementById("topic-list");
  const topics = data.topics.filter((t) => t.section === section).sort((a, b) => a.rank - b.rank);
  const groups = ["must", "should", "optional", "skip"].map((call) => [call, topics.filter((t) => t.call === call)]).filter(([, list]) => list.length);
  fill(host, ...groups.map(([call, list]) => el("section", { class: "panel" },
    el("h2", {}, `${CALL_LABEL[call]} (${list.length})`),
    el("p", { class: "muted" }, data.calls[call]),
    list.map(topicBlock))));
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

async function init() {
  const me = await boot("topics.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  try {
    [data, progress] = await Promise.all([loadJson("data/topics.json"), rpc("cat_progress")]);
    const tries = await rpc("cat_attempts");
    for (const a of tries.slice().reverse()) if (!(a.testId in attempts)) attempts[a.testId] = a.totals.marks;
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
  fill(main, 
    el("div", { class: "page-head" }, el("h1", {}, "Topics"), lang),
    el("p", { class: "muted" }, "Ranked by marks per hour of study for the time left. A topic counts as done when you solve fresh questions on it without help, not when the video ends. Every video was opened and checked on 13 or 14 Nov; nobody has watched them all end to end, so say in the chat if one is weak."),
    tabs,
    el("div", { id: "topic-list", class: "stack" }));
  render();
}

init();

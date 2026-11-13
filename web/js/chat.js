// Group chat with likes and @mentions, and study rooms that share one clock.
import { rpc } from "./db.js";
import { el, boot, busy, fmtDateTime, fmtTime, fmtClock, markChatSeen, showError, fill } from "./ui.js";
import { startReminders, cacheSettings, startFocus, getFocus } from "./reminders.js";

const main = document.getElementById("main");
let me = null;
let messages = [];
let lastId = 0;
const log = el("div", { class: "chat-log", "aria-live": "polite", "aria-label": "Messages", tabindex: "0" });
const roomsHost = el("div");

function bodyWithMentions(text) {
  return String(text).split(/(@[A-Za-z0-9._-]{2,20})/g).filter((p) => p !== "")
    .map((p) => (p.startsWith("@") ? el("span", { class: "mention-tag" }, p) : p));
}

function messageNode(m) {
  const mentioned = !m.me && m.text.toLowerCase().includes(`@${me.name.toLowerCase()}`);
  const like = el("button", { type: "button", class: `btn small${m.liked ? " on" : ""}`, "aria-pressed": String(m.liked) },
    m.likes ? `Like ${m.likes}` : "Like");
  const del = m.me ? el("button", { type: "button", class: "btn quiet small" }, "Delete") : null;
  const node = el("div", { class: `msg${m.me ? " me" : ""}${mentioned ? " mention" : ""}`, "data-id": String(m.id) },
    el("div", { class: "msg-head" }, el("strong", {}, m.name), el("span", {}, fmtDateTime(m.at)), like, del),
    el("div", { class: "msg-body" }, bodyWithMentions(m.text)));
  like.addEventListener("click", () => busy(like, async () => {
    await rpc("cat_chat_like", { p_message_id: m.id, p_on: !m.liked });
    m.liked = !m.liked;
    m.likes += m.liked ? 1 : -1;
    node.replaceWith(messageNode(m));
  }));
  del?.addEventListener("click", () => busy(del, async () => {
    await rpc("cat_chat_delete", { p_message_id: m.id });
    messages = messages.filter((x) => x.id !== m.id);
    paint(false);
  }));
  return node;
}

function paint(stick = true) {
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  fill(log, ...(messages.length ? messages.map(messageNode) : [el("p", { class: "empty" }, "No messages yet. Say what you're studying today.")]));
  if (stick || atBottom) log.scrollTop = log.scrollHeight;
}

async function poll(first = false) {
  try {
    const fresh = await rpc("cat_chat", { p_after: first ? 0 : lastId });
    if (first) messages = fresh;
    else messages = messages.concat(fresh.filter((m) => !messages.some((x) => x.id === m.id))).slice(-300);
    if (fresh.length || first) {
      lastId = Math.max(lastId, ...messages.map((m) => m.id));
      paint(first);
    }
    if (!document.hidden) markChatSeen(lastId);
  } catch (err) {
    if (first) showError(err);
  }
}

function composer() {
  const text = el("textarea", { maxlength: 1000, enterkeyhint: "send", placeholder: "Message the group. Type @name to ping someone.", "aria-label": "Message" });
  const send = el("button", { type: "submit", class: "btn primary" }, "Send");
  const form = el("form", { class: "chat-form" }, text, send);
  const go = () => busy(send, async () => {
    if (!text.value.trim()) return;
    await rpc("cat_chat_send", { p_text: text.value });
    text.value = "";
    await poll();
    log.scrollTop = log.scrollHeight;
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); go(); });
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      go();
    }
  });
  return form;
}

// ---- study rooms ---------------------------------------------------------------------
let rooms = [];
let roomTimer = null;
function paintRooms() {
  const now = Date.now();
  const title = el("input", { type: "text", maxlength: 60, placeholder: "e.g. QA practice hour", "aria-label": "Room name", required: true });
  const local = new Date(now + 5 * 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const starts = el("input", { type: "datetime-local", value: local, "aria-label": "Starts at" });
  const mins = el("select", { "aria-label": "Length" }, [25, 50, 90, 120, 180].map((m) => el("option", { value: String(m), selected: m === 50 }, `${m} minutes`)));
  const create = el("button", { type: "submit", class: "btn" }, "Open a room");
  const form = el("form", { class: "stack" }, title, el("div", { class: "row" }, starts, mins, create));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    busy(create, async () => {
      rooms = await rpc("cat_room_create", { p_title: title.value, p_starts_at: new Date(starts.value).toISOString(), p_minutes: Number(mins.value) });
      paintRooms();
    });
  });
  const items = rooms.map((r) => {
    const start = Date.parse(r.startsAt);
    const end = start + r.minutes * 60000;
    const live = now >= start && now < end;
    const clock = el("span", { class: "room-clock" }, live ? fmtClock(end - now) : fmtTime(r.startsAt));
    const join = el("button", { type: "button", class: `btn small${r.joined ? " on" : ""}` }, r.joined ? "Joined" : "Join");
    join.addEventListener("click", () => busy(join, async () => {
      rooms = await rpc("cat_room_join", { p_room_id: r.id, p_on: !r.joined });
      paintRooms();
    }));
    const focus = live && r.joined && getFocus().mode !== "focus"
      ? el("button", { type: "button", class: "btn small primary", onclick: () => { startFocus(); paintRooms(); } }, "Start my focus timer") : null;
    const del = r.mine ? el("button", { type: "button", class: "btn quiet small" }, "Close room") : null;
    del?.addEventListener("click", () => busy(del, async () => { rooms = await rpc("cat_room_delete", { p_room_id: r.id }); paintRooms(); }));
    return el("div", { class: "room", "data-end": String(end), "data-start": String(start), "data-live": live ? "1" : "0" },
      el("p", {}, el("strong", {}, r.title), el("span", { class: "muted small" }, ` hosted by ${r.host}`)),
      el("p", {}, live ? "Running, time left " : "Starts at ", clock, live ? "" : el("span", { class: "muted small" }, `, for ${r.minutes} minutes`)),
      el("p", { class: "muted small" }, r.people.length ? `In it: ${r.people.join(", ")}` : "Nobody in it yet"),
      el("div", { class: "row" }, join, focus, del));
  });
  fill(roomsHost, 
    el("h2", {}, "Study rooms"),
    el("p", { class: "muted small" }, "One shared clock. Join, start your own focus timer, and study together, on a call or just here."),
    items.length ? items : el("p", { class: "empty" }, "No rooms open."),
    el("h3", {}, "Open a room"), form);
  clearInterval(roomTimer);
  roomTimer = setInterval(() => {
    const t = Date.now();
    for (const node of roomsHost.querySelectorAll(".room")) {
      const s = Number(node.dataset.start);
      const e = Number(node.dataset.end);
      const live = t >= s && t < e;
      if (live !== (node.dataset.live === "1") || t >= e) {
        loadRooms();
        return;
      }
      if (live) node.querySelector(".room-clock").textContent = fmtClock(e - t);
    }
  }, 1000);
}
async function loadRooms() {
  try {
    rooms = await rpc("cat_rooms");
    paintRooms();
  } catch (err) {
    showError(err);
  }
}

async function init() {
  me = await boot("chat.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  fill(main, el("div", { class: "page-head" }, el("h1", {}, "Chat")),
    el("div", { class: "grid" },
      el("section", { class: "panel span-8" }, log, composer(),
        el("p", { class: "muted small" }, el("span", { class: "kbd-hint" }, "Enter sends, Shift and Enter makes a new line. "), "Talk about approaches to a test question in that question's discussion on its results page, so nobody sees an answer before they've tried it.")),
      el("section", { class: "panel span-4" }, roomsHost)));
  await poll(true);
  loadRooms();
  setInterval(() => { if (!document.hidden) poll(); }, 8000);
  setInterval(loadRooms, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { poll(); markChatSeen(lastId); } });
}

init();

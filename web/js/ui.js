// Shared page parts: element helper, formatting, header and navigation,
// theme and text size, toasts, dialogs, and the sign-in and join forms.
import * as db from "./db.js";

export const CAT_DAY = "2026-11-29";

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name === "class") node.className = value;
    else if (name === "text") node.textContent = value;
    else if (name === "html") node.innerHTML = value; // only for markup this site writes itself
    else if (name.startsWith("on") && typeof value === "function") node.addEventListener(name.slice(2), value);
    else if (value === true) node.setAttribute(name, "");
    else node.setAttribute(name, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// replaceChildren() turns arrays into "[object ...]" text and null into "null".
// fill() flattens nested arrays and skips null, undefined and false, like el().
export function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export function richText(text = "") {
  const frag = document.createDocumentFragment();
  for (const para of String(text).split(/\n\s*\n/)) frag.append(el("p", {}, para));
  return frag;
}

// ---- formatting --------------------------------------------------------------
export function istToday(d = new Date()) {
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
export function fmtMin(min) {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}
export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
export function fmtClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h ? `${h}:${mm}` : mm;
}
export function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function fmtDate(day) {
  if (!day) return "";
  const d = new Date(`${String(day).slice(0, 10)}T00:00:00`);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

// ---- small stores in this browser -------------------------------------------
export function local(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function setLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: the setting lasts for this page only */
  }
}

// ---- theme and text size -----------------------------------------------------
const THEMES = ["system", "light", "dark", "sunset"];
// Minutes since midnight in India, whatever the device's time zone.
const istMin = () => {
  const d = new Date();
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
};
export function currentTheme() {
  const t = local("cat-theme", "system");
  return THEMES.includes(t) ? t : "system";
}
// "sunset" is light by day and dark from 18:00 to 06:30.
function applyTheme() {
  let t = currentTheme();
  if (t === "sunset") t = istMin() >= 1080 || istMin() < 390 ? "dark" : "light";
  if (t === "system") delete document.documentElement.dataset.theme;
  else if (document.documentElement.dataset.theme !== t) document.documentElement.dataset.theme = t;
}
// A warmer page from 21:00 to 06:00, if switched on for this device.
export function applyWarm() {
  const on = local("cat-warm", false) === true && (istMin() >= 1260 || istMin() < 360);
  document.documentElement.classList.toggle("warm", on);
}
export function setTheme(t) {
  setLocal("cat-theme", t);
  applyTheme();
  window.dispatchEvent(new CustomEvent("cat:theme"));
}
setInterval(() => { applyTheme(); applyWarm(); }, 60000);
export function applyTextSize(pct) {
  const v = Math.min(130, Math.max(90, Number(pct) || 100));
  setLocal("cat-text", v);
  document.documentElement.style.fontSize = v === 100 ? "" : `${v}%`;
}

// ---- toasts and dialogs ------------------------------------------------------
function toastHost() {
  let host = document.getElementById("toasts");
  if (!host) {
    host = el("div", { id: "toasts", class: "toasts", "aria-live": "polite" });
    document.body.append(host);
  }
  return host;
}

export function toast({ kind = "info", title, body, actions = [], autoHideMs = 0 }) {
  const box = el("div", { class: `toast toast-${kind}`, role: kind === "error" ? "alert" : "status" });
  const close = () => box.remove();
  box.append(
    el("strong", { class: "toast-title" }, title),
    body ? el("p", {}, body) : null,
    el("div", { class: "toast-actions" },
      actions.map((a) => el("button", {
        type: "button",
        class: a.primary ? "btn primary" : "btn",
        onclick: async () => { close(); await a.onClick?.(); },
      }, a.label)),
      el("button", { type: "button", class: "btn quiet", onclick: close }, "Dismiss")));
  toastHost().append(box);
  if (autoHideMs) setTimeout(close, autoHideMs);
  return box;
}

export function showError(err) {
  toast({ kind: "error", title: "That didn't work", body: err?.message || String(err), autoHideMs: 9000 });
}

let dialogEl = null;
function dialog() {
  dialogEl = dialogEl || document.getElementById("dialog");
  if (!dialogEl) {
    dialogEl = el("dialog", { id: "dialog", class: "dialog" });
    document.body.append(dialogEl);
  }
  return dialogEl;
}

export function confirmBox(title, lines, okLabel) {
  const d = dialog();
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; d.close(); resolve(v); } };
    d.replaceChildren(
      el("h2", {}, title),
      ...lines.map((line) => el("p", {}, line)),
      el("div", { class: "dialog-actions" },
        el("button", { type: "button", class: "btn", onclick: () => done(false) }, "Go back"),
        el("button", { type: "button", class: "btn primary", onclick: () => done(true) }, okLabel)));
    d.onclose = () => done(false);
    d.showModal();
  });
}

export function infoBox(title, ...nodes) {
  const d = dialog();
  d.replaceChildren(el("h2", {}, title), ...nodes,
    el("div", { class: "dialog-actions" }, el("button", { type: "button", class: "btn primary", onclick: () => d.close() }, "Close")));
  d.onclose = null;
  d.showModal();
}

// Run an action from a button: disable it while it runs, show errors as a toast.
export async function busy(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    showError(err);
    return undefined;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---- header ------------------------------------------------------------------
const NAV = [
  ["index.html", "Today"],
  ["plan.html", "Plan"],
  ["board.html", "Board"],
  ["topics.html", "Topics"],
  ["practice.html", "Practice"],
  ["mocks.html", "Mocks"],
  ["chat.html", "Chat"],
  ["you.html", "You"],
];

function countdownText() {
  const left = daysBetween(istToday(), CAT_DAY);
  if (left > 1) return [el("strong", {}, String(left)), " days to CAT"];
  if (left === 1) return [el("strong", {}, "Tomorrow"), " is CAT day"];
  if (left === 0) return [el("strong", {}, "Today"), " is CAT day"];
  return ["CAT 2026 is over"];
}

function themeButton() {
  const label = () => `Theme: ${currentTheme()}`;
  const btn = el("button", { type: "button", class: "theme-btn", title: "Switch between system, light, dark and sunset (dark from 18:00)" }, label());
  btn.addEventListener("click", () => {
    setTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]);
    btn.textContent = label();
  });
  return btn;
}

// Keyboard and screen-reader users can jump past the navigation.
function skipLink() {
  if (document.querySelector(".skip-link")) return;
  const main = document.getElementById("main");
  if (main && !main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  document.body.prepend(el("a", { class: "skip-link", href: "#main" }, "Skip to the page"));
}

// A plain line at the top while the device has no connection.
function offlineBar() {
  const bar = el("div", { class: "offline-bar", role: "status", hidden: navigator.onLine },
    "You're offline. A test you're in the middle of is kept on this device: submit it once you're back online. Nothing else can be saved until then.");
  document.body.prepend(bar);
  window.addEventListener("offline", () => { bar.hidden = false; });
  window.addEventListener("online", () => { bar.hidden = true; });
}

function renderHeader(page, member) {
  const host = document.getElementById("top");
  if (!host) return;
  const links = member ? NAV.map(([href, label]) => el("li", {},
    el("a", { href, "aria-current": href === page ? "page" : null, "data-nav": href }, label))) : [];
  host.className = "top-bar";
  host.replaceChildren(
    el("div", { class: "top-inner" },
      el("a", { class: "brand", href: "index.html" }, "CAT prep group"),
      el("div", { class: "top-meta" },
        el("span", {}, countdownText()),
        member ? el("span", {}, member.name) : null,
        themeButton())),
    el("nav", { "aria-label": "Site" }, el("ul", { class: "nav" }, links)));
}

export function setNavBadge(href, count) {
  const a = document.querySelector(`[data-nav="${href}"]`);
  if (!a) return;
  a.querySelector(".badge-count")?.remove();
  if (count > 0) a.append(el("span", { class: "badge-count", "aria-label": `${count} new` }, count > 99 ? "99+" : String(count)));
}

// ---- profiles: group code, "Who's studying?", PIN --------------------------------
// The group code is kept on this device after the first use, so the profiles
// can be listed again without typing it. It is never shown on screen.
const CODE_KEY = "cat-group-code";

function statusLine() {
  return el("p", { class: "status-line", role: "status" });
}

function gate(main, ...children) {
  main.replaceChildren(el("div", { class: "gate" }, ...children));
}

function gateError(main, err) {
  gate(main, el("div", { class: "notice error" }, err.message),
    el("button", { type: "button", class: "btn", onclick: () => location.reload() }, "Try again"));
}

function onSubmit(form, button, status, working, fn) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    status.className = "status-line";
    status.textContent = working;
    try {
      await fn();
    } catch (err) {
      status.className = "status-line error";
      status.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

// The admin changed the code since this device saved it.
function codeChanged(main, err) {
  if (!/group code is wrong/i.test(err.message)) return false;
  setLocal(CODE_KEY, "");
  codeScreen(main, "The group code has changed. Ask whoever runs the group for the new one.");
  return true;
}

const pinInput = () => el("input", { type: "password", inputmode: "numeric", pattern: "[0-9]{4}", minlength: 4, maxlength: 4, autocomplete: "off", required: true });

// Profiles take the six tile colours in joining order, so the first six all differ.
function face(p, i, big = false) {
  return el("span", { class: big ? "tile-face big" : "tile-face", style: `background: var(--tile-${(i % 6) + 1})`, "aria-hidden": "true" },
    [...p.name][0].toUpperCase());
}

function codeScreen(main, note = null) {
  const code = el("input", { type: "text", autocomplete: "off", required: true, spellcheck: "false", autocapitalize: "characters" });
  const status = statusLine();
  const submit = el("button", { type: "submit", class: "btn primary" }, "Continue");
  const form = el("form", { class: "panel" },
    el("h1", {}, "Find your group"),
    note ? el("p", { class: "notice" }, note) : null,
    el("p", { class: "muted" }, "Type the group code from whoever runs the group. This device remembers it, so you only type it once."),
    el("label", { class: "field" }, "Group code", code),
    el("div", { class: "row" }, submit), status);
  onSubmit(form, submit, status, "Checking the code...", async () => {
    const value = code.value.trim();
    const list = await db.rpc("cat_profile_list", { p_code: value });
    setLocal(CODE_KEY, value);
    tilesScreen(main, value, list);
  });
  gate(main, form);
  code.focus();
}

function tilesScreen(main, code, list) {
  const admin = list.find((p) => p.isAdmin) || null;
  const tiles = list.map((p, i) => el("li", {},
    el("button", { type: "button", class: "tile", onclick: () => pinScreen(main, code, list, p, admin) },
      face(p, i), el("span", { class: "tile-name" }, p.name))));
  tiles.push(el("li", {},
    el("button", { type: "button", class: "tile add", onclick: () => addScreen(main, code, list) },
      el("span", { class: "tile-face", "aria-hidden": "true" }, "+"), el("span", { class: "tile-name" }, "Add a profile"))));
  main.replaceChildren(el("div", { class: "who" },
    el("h1", {}, "Who's studying?"),
    list.length ? null : el("p", { class: "muted" }, "Nobody has a profile yet. The first profile made runs the group."),
    el("ul", { class: "tiles" }, tiles),
    el("button", { type: "button", class: "btn quiet small", onclick: () => { setLocal(CODE_KEY, ""); codeScreen(main); } }, "Use a different group code")));
}

function pinScreen(main, code, list, p, admin) {
  const pin = pinInput();
  const status = statusLine();
  const submit = el("button", { type: "submit", class: "btn primary" }, "Open my profile");
  const form = el("form", { class: "panel pin-form" }, face(p, list.indexOf(p), true),
    el("h1", {}, p.name),
    el("label", { class: "field" }, "PIN", pin),
    el("div", { class: "row" }, submit,
      el("button", { type: "button", class: "btn quiet", onclick: () => tilesScreen(main, code, list) }, "Back to profiles")),
    status,
    admin && admin.id !== p.id ? el("p", { class: "muted small" }, `Forgot it? Ask ${admin.name} to reset it from the You page.`) : null);
  onSubmit(form, submit, status, "Opening your profile...", async () => {
    try {
      await db.rpc("cat_unlock", { p_code: code, p_id: p.id, p_pin: pin.value });
    } catch (err) {
      if (codeChanged(main, err)) return;
      pin.value = "";
      pin.focus();
      throw err;
    }
    location.reload();
  });
  // The PIN is four digits, so it goes as soon as the fourth is typed.
  pin.addEventListener("input", () => { if (/^\d{4}$/.test(pin.value)) form.requestSubmit(); });
  gate(main, form);
  pin.focus();
}

function addScreen(main, code, list) {
  const name = el("input", { type: "text", required: true, maxlength: 20, autocomplete: "nickname" });
  const slot = el("select", {}, [1, 2, 3].map((n) =>
    el("option", { value: String(n), selected: n === 2 }, `Slot ${n}${n === 1 ? " (morning)" : n === 2 ? " (afternoon)" : " (evening)"}`)));
  const pin = pinInput();
  const pin2 = pinInput();
  const status = statusLine();
  const submit = el("button", { type: "submit", class: "btn primary" }, "Make my profile");
  const form = el("form", { class: "panel" },
    el("h1", {}, "Add a profile"),
    list.length ? null : el("p", { class: "muted" }, "Yours is the first profile, so you run the group. The group code and PIN resets are on your You page."),
    el("label", { class: "field" }, "Name the others will see (2 to 20 letters)", name),
    el("label", { class: "field" }, "Your CAT 2026 slot, from the admit card", slot),
    el("label", { class: "field" }, "PIN (4 digits)", pin),
    el("label", { class: "field" }, "PIN again", pin2),
    el("div", { class: "row" }, submit,
      el("button", { type: "button", class: "btn quiet", onclick: () => tilesScreen(main, code, list) }, "Back to profiles")),
    status);
  onSubmit(form, submit, status, "Making your profile...", async () => {
    if (!/^\d{4}$/.test(pin.value)) throw new Error("Use 4 digits for the PIN.");
    if (pin.value !== pin2.value) throw new Error("The two PINs don't match. Type them again.");
    try {
      await db.rpc("cat_join", { p_code: code, p_name: name.value.trim(), p_slot: Number(slot.value), p_pin: pin.value });
    } catch (err) {
      if (codeChanged(main, err)) return;
      throw err;
    }
    location.reload();
  });
  gate(main, form);
  name.focus();
}

async function profileGate(main) {
  const code = local(CODE_KEY, "");
  if (!code) {
    codeScreen(main);
    return;
  }
  try {
    tilesScreen(main, code, await db.rpc("cat_profile_list", { p_code: code }));
  } catch (err) {
    if (!codeChanged(main, err)) gateError(main, err);
  }
}

// This device's profile, or null. A sign-in that has ended is replaced once,
// and the person picks their profile again.
async function whoAmI() {
  try {
    return (await db.rpc("cat_me")).member;
  } catch (err) {
    if (err.status !== 401) throw err;
    await db.startDevice();
    return (await db.rpc("cat_me")).member;
  }
}

// ---- boot --------------------------------------------------------------------
// Every page calls this first. It returns the member, or null after showing
// the group code, profile or PIN screen in place of the page.
export async function boot(page) {
  const main = document.getElementById("main");
  skipLink();
  offlineBar();
  applyTheme();
  applyWarm();
  renderHeader(page, null);
  if (!db.configured()) {
    main.replaceChildren(el("div", { class: "gate" }, el("div", { class: "notice" },
      "The site isn't connected to its database yet. Whoever runs the group still has to fill in js/config.js.")));
    return null;
  }
  let me;
  try {
    if (!db.signedIn()) await db.startDevice();
    me = await whoAmI();
  } catch (err) {
    gateError(main, err);
    return null;
  }
  if (!me) {
    await profileGate(main);
    return null;
  }
  if (me.settings?.textSize) applyTextSize(me.settings.textSize);
  renderHeader(page, me);
  startPulse(page);
  return me;
}

// ---- pulse: unread chat, mentions, nudges, who is studying ----------------------
let pulseTimer = null;
export function markChatSeen(id) {
  if (id > (local("cat-chat-seen", 0) || 0)) setLocal("cat-chat-seen", id);
  setNavBadge("chat.html", 0);
}
export function markPostsSeen(id) {
  if (id > (local("cat-posts-seen", 0) || 0)) setLocal("cat-posts-seen", id);
  setNavBadge("practice.html", 0);
}

let lastPulse = 0;
async function pulse(page) {
  if (document.hidden) return;
  // Switching apps back and forth on a phone shouldn't send a burst of calls.
  if (Date.now() - lastPulse < 10000) return;
  lastPulse = Date.now();
  let p;
  try {
    p = await db.rpc("cat_pulse", { p_chat_after: local("cat-chat-seen", 0) || 0, p_posts_after: local("cat-posts-seen", 0) || 0 });
  } catch {
    return;
  }
  if (local("cat-chat-seen", null) === null) setLocal("cat-chat-seen", p.chatLatest);
  if (local("cat-posts-seen", null) === null) setLocal("cat-posts-seen", p.postsLatest);
  if (page !== "chat.html") setNavBadge("chat.html", p.chatNew);
  setNavBadge("practice.html", p.postsNew);
  // Quiet hours, 22:30 to 06:00: badges still update, but no pop-ups.
  const quiet = (local("cat-settings", {})?.quiet ?? true) && (istMin() >= 1350 || istMin() < 360);
  const seenMentions = local("cat-mentions-told", 0);
  if (!quiet && page !== "chat.html" && p.mentions > 0 && p.mentions !== seenMentions) {
    setLocal("cat-mentions-told", p.mentions);
    toast({ title: "Someone mentioned you in the chat", actions: [{ label: "Open chat", primary: true, onClick: () => { location.href = "chat.html"; } }], autoHideMs: 30000 });
  }
  const nudgeKey = `cat-nudges-${istToday()}`;
  if (!quiet && p.nudges > (local(nudgeKey, 0) || 0)) {
    setLocal(nudgeKey, p.nudges);
    toast({ kind: "break", title: "You've been nudged", body: "Someone in the group wants to see you at the desk. Start a focus block.", autoHideMs: 60000,
      actions: page === "index.html" ? [] : [{ label: "Go to Today", primary: true, onClick: () => { location.href = "index.html"; } }] });
  }
  window.dispatchEvent(new CustomEvent("cat:pulse", { detail: p }));
}

function startPulse(page) {
  clearInterval(pulseTimer);
  setTimeout(() => pulse(page), 1500);
  pulseTimer = setInterval(() => pulse(page), 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pulse(page); });
}

export async function loadJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status}).`);
  return res.json();
}

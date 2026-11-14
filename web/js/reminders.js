// Break, eye, walk, lunch, caffeine, wind-down and exam-week reminders, plus
// the study timer.
// Due times live in localStorage so a reminder fires once even with two tabs
// open. Focus minutes go to the database a minute at a time for the board.
import { rpc } from "./db.js";
import { toast, local, setLocal, istToday } from "./ui.js";
import { loadPlan } from "./plan.js";

export const DEFAULTS = {
  breakAfterMin: 40, breakLengthMin: 10,
  eyeEveryMin: 20, sound: true, windDown: true, textSize: 100,
  autoBreak: true, walk: true, caffeine: true, lunch: true, examReminders: true, quiet: true,
};

const K = {
  settings: "cat-settings",
  nextEye: "cat-next-eye-at",
  focus: "cat-focus",
  testRunning: "cat-test-running",
  windDown: "cat-wind-down-day",
  once: "cat-once-",
  claim: "cat-claim-",
};
const tabId = Math.random().toString(36).slice(2);
let audio = null;
let started = false;

const STRETCHES = [
  "Roll your shoulders back ten times, then look out of a window.",
  "Stand up, reach for the ceiling for ten seconds, then touch your toes.",
  "Walk to the next room and back, slowly.",
  "Turn your head slowly left and right five times each side.",
  "Clasp your hands behind your back and open your chest for twenty seconds.",
];

export function getSettings() {
  return { ...DEFAULTS, ...(local(K.settings, {}) || {}) };
}
export function cacheSettings(settings) {
  setLocal(K.settings, { ...DEFAULTS, ...(settings || {}) });
}

function num(key) {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : null;
}
function setNum(key, t) {
  try {
    localStorage.setItem(key, String(t));
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new CustomEvent("cat:reminders"));
}

// ---- study timer -------------------------------------------------------------
// mode: "idle" | "focus" | "break". dueAt: when the next prompt is due.
// sentMin: focus minutes from this browser already added to today's total.
export function getFocus() {
  let f = local(K.focus, null);
  const today = istToday();
  f = f || { mode: "idle", since: 0, dueAt: 0, prompted: false, day: today, focusMs: 0, sentMin: 0 };
  if (f.day !== today) {
    f.day = today;
    f.focusMs = 0;
    f.sentMin = 0;
    if (f.mode === "focus") f.since = Math.max(f.since, startOfToday());
  }
  return f;
}

function startOfToday() {
  const now = Date.now();
  return now - ((now + 330 * 60000) % 86400000);
}

function saveFocus(f) {
  setLocal(K.focus, f);
  window.dispatchEvent(new CustomEvent("cat:reminders"));
}

function closeFocusSpan(f, now) {
  if (f.mode === "focus") f.focusMs += Math.max(0, now - f.since);
}

export function focusTodayMs() {
  const f = getFocus();
  return f.focusMs + (f.mode === "focus" ? Math.max(0, Date.now() - f.since) : 0);
}

export function startFocus({ prompt = true } = {}) {
  const now = Date.now();
  const f = getFocus();
  closeFocusSpan(f, now);
  const s = getSettings();
  saveFocus({ ...f, mode: "focus", since: now, dueAt: now + s.breakAfterMin * 60000, prompted: false });
  if (s.eyeEveryMin > 0) setNum(K.nextEye, now + s.eyeEveryMin * 60000);
  sendPresence();
  if (prompt) {
    toast({ title: "Phone in another room?", body: `${s.breakAfterMin} minutes on the clock. Notifications off.`, autoHideMs: 12000 });
  }
}

export function startBreak() {
  const now = Date.now();
  const f = getFocus();
  closeFocusSpan(f, now);
  saveFocus({ ...f, mode: "break", since: now, dueAt: now + getSettings().breakLengthMin * 60000, prompted: false });
  syncFocus();
  sendPresence();
  rpc("cat_break_log", { p_skipped: false }).catch(() => {});
}

// Skipping a break goes back to focus and is counted on the Today page.
function skipBreak() {
  const now = Date.now();
  const f = getFocus();
  closeFocusSpan(f, now);
  const s = getSettings();
  saveFocus({ ...f, mode: "focus", since: now, dueAt: now + s.breakAfterMin * 60000, prompted: false });
  rpc("cat_break_log", { p_skipped: true }).catch(() => {});
  sendPresence();
}

export function stopTimer() {
  const now = Date.now();
  const f = getFocus();
  closeFocusSpan(f, now);
  saveFocus({ ...f, mode: "idle", since: now, dueAt: 0, prompted: false });
  syncFocus();
  sendPresence();
}

function snoozeBreak(minutes) {
  const f = getFocus();
  saveFocus({ ...f, dueAt: Date.now() + minutes * 60000, prompted: false });
}

// Send whole minutes not yet counted. One tab sends; the others see sentMin rise.
let syncing = false;
export async function syncFocus() {
  if (syncing) return;
  const f = getFocus();
  const total = Math.floor(focusTodayMs() / 60000);
  const send = Math.min(total - (f.sentMin || 0), 60);
  if (send < 1) return;
  syncing = true;
  if (!(await claim(`sync-${f.day}-${f.sentMin}`))) {
    syncing = false;
    return;
  }
  const latest = getFocus();
  if ((latest.sentMin || 0) !== (f.sentMin || 0)) {
    syncing = false;
    return;
  }
  saveFocus({ ...latest, sentMin: (latest.sentMin || 0) + send });
  try {
    const today = await rpc("cat_add_focus", { p_minutes: send });
    window.dispatchEvent(new CustomEvent("cat:today", { detail: today }));
  } catch {
    const back = getFocus();
    saveFocus({ ...back, sentMin: Math.max(0, (back.sentMin || 0) - send) });
  } finally {
    syncing = false;
  }
}

let lastPresence = 0;
export async function sendPresence() {
  const f = getFocus();
  lastPresence = Date.now();
  const minutes = f.mode === "idle" ? 0 : Math.max(1, Math.ceil((f.dueAt - Date.now()) / 60000));
  try {
    const now = await rpc("cat_presence", { p_mode: f.mode, p_minutes: minutes });
    window.dispatchEvent(new CustomEvent("cat:now", { detail: now }));
  } catch {
    /* presence is a nicety; the timer works without it */
  }
}

// The test page calls this every few seconds while a section is running.
export function markTestRunning(on) {
  try {
    if (on) localStorage.setItem(K.testRunning, String(Date.now()));
    else localStorage.removeItem(K.testRunning);
  } catch {
    /* storage blocked */
  }
}
function testRunning() {
  const v = Number(localStorage.getItem(K.testRunning));
  return Boolean(v) && Date.now() - v < 2 * 60000;
}

// ---- firing --------------------------------------------------------------------
async function claim(name) {
  const token = `${tabId}:${Date.now()}`;
  try {
    localStorage.setItem(K.claim + name, token);
  } catch {
    return true;
  }
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 150));
  return localStorage.getItem(K.claim + name) === token;
}

function unlockAudio() {
  const unlock = () => {
    try {
      audio = audio || new AudioContext();
      if (audio.state === "suspended") audio.resume();
    } catch {
      audio = null;
    }
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

// 22:30 to 06:00 Indian time.
function quietHours() {
  const t = new Date(Date.now() + 330 * 60000);
  const m = t.getUTCHours() * 60 + t.getUTCMinutes();
  return m >= 22 * 60 + 30 || m < 6 * 60;
}

function chime(kind) {
  if (!getSettings().sound || !audio) return;
  if (getSettings().quiet && quietHours()) return;
  const notes = kind === "break" ? [523, 659, 784] : kind === "eye" ? [660] : [880, 1175];
  let t = audio.currentTime + 0.02;
  for (const freq of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(kind === "eye" ? 0.12 : 0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.65);
    t += 0.28;
  }
}

// System notification when the tab is in the background, through the service
// worker where possible.
async function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!document.hidden && document.hasFocus()) return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, {
        body, tag: `cat-${title}`, icon: "icons/icon-192.png",
      });
      return;
    }
    new Notification(title, { body, tag: `cat-${title}` });
  } catch {
    /* some browsers refuse notifications from plain pages */
  }
}

function breakReminder() {
  const s = getSettings();
  chime("break");
  notify("Time for a break", `You've focused for ${s.breakAfterMin} minutes. Take ${s.breakLengthMin}.`);
  if (s.autoBreak) {
    startBreak();
    toast({
      kind: "break",
      title: `Break started: ${s.breakLengthMin} minutes`,
      body: `${s.breakAfterMin} minutes of focus done. ${STRETCHES[Math.floor(Math.random() * STRETCHES.length)]}`,
      actions: [{ label: "Skip this break", onClick: skipBreak }],
      autoHideMs: 120000,
    });
    return;
  }
  toast({
    kind: "break",
    title: `Time for a ${s.breakLengthMin}-minute break`,
    body: `You've focused for ${s.breakAfterMin} minutes. ${STRETCHES[Math.floor(Math.random() * STRETCHES.length)]}`,
    actions: [
      { label: "Start break", primary: true, onClick: startBreak },
      { label: "5 more minutes", onClick: () => snoozeBreak(5) },
    ],
  });
}

function breakOverReminder() {
  chime("soft");
  notify("Break over", "Back to the desk for the next block.");
  toast({
    kind: "break",
    title: "Break over",
    body: "Back to the desk. The next block starts when you press the button.",
    actions: [{ label: "Start focus", primary: true, onClick: () => startFocus() }],
  });
}

function eyeReminder() {
  chime("eye");
  toast({ kind: "eye", title: "Eyes off the screen", body: "Look at something about 6 metres away for 20 seconds. Blink a few times.", autoHideMs: 25000 });
}

function windDownReminder() {
  chime("soft");
  notify("Wind down", "Screens off soon. Seven hours of sleep keeps today's work.");
  toast({
    kind: "break",
    title: "Time to wind down",
    body: "Finish what's open, set out tomorrow's first task, and aim for lights out within half an hour. Seven hours of sleep keeps today's work and earns 5 points.",
  });
}

// Reminders that fire once a day at a set time, within half an hour of it.
const DAY_REMINDERS = [
  { key: "walk", setting: "walk", at: (d) => (d?.timetable === "paper" ? 630 : d?.timetable ? 620 : null),
    show: () => toast({ kind: "break", title: "Walk", body: "Twenty minutes outside, without the phone. A walk after the morning block helps the afternoon one.", autoHideMs: 60000 }) },
  { key: "lunch", setting: "lunch", at: (d) => (d?.timetable === "paper" ? 690 : null),
    show: () => toast({ kind: "break", title: "Lunch now", body: "Eat at 11:30, the time you'll eat on exam day, so 12:30 feels normal.", autoHideMs: 60000 }) },
  { key: "caffeine", setting: "caffeine", at: (d) => (d ? 840 : null),
    show: () => toast({ title: "Last coffee or tea for today", body: "Nothing with caffeine after 14:00, so it's out of the way by lights out at 23:00.", autoHideMs: 30000 }) },
  { key: "admit", setting: "examReminders", at: (d, day) => (day === "2026-11-28" ? 1140 : null),
    show: () => toast({ kind: "break", title: "Admit card and bag", body: "Print the admit card, put the photo ID with it, and pack the bag tonight. The list is on the Exam-day page.",
      actions: [{ label: "Open the list", primary: true, onClick: () => { location.href = "exam-day.html"; } }] }) },
  { key: "route", setting: "examReminders", at: (d, day, s) => (day === "2026-11-28" && s.travelAt ? toMin(s.travelAt) : null),
    show: () => toast({ kind: "break", title: "Check the route now", body: "This is the time you'll travel tomorrow. Check how long the trip to the centre takes at this hour, and save the directions offline." }) },
];

function toMin(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

let planDays = null;
async function dayReminders(inTest) {
  if (inTest || testRunning()) return;
  const s = getSettings();
  const day = istToday();
  if (!planDays) {
    try {
      planDays = (await loadPlan()).days;
    } catch {
      planDays = {};
    }
  }
  const t = new Date(Date.now() + 330 * 60000);
  const m = t.getUTCHours() * 60 + t.getUTCMinutes();
  for (const r of DAY_REMINDERS) {
    if (!s[r.setting]) continue;
    const at = r.at(planDays[day], day, s);
    if (at === null || m < at || m >= at + 30) continue;
    const key = `${K.once}${r.key}`;
    if (local(key, "") === day || !(await claim(`once-${r.key}-${day}`))) continue;
    setLocal(key, day);
    chime("soft");
    r.show();
  }
}

async function check(inTest) {
  const now = Date.now();
  const s = getSettings();
  const f = getFocus();
  dayReminders(inTest).catch(() => {});
  if (f.mode === "focus" && !inTest && !testRunning() && s.eyeEveryMin > 0 && !(s.quiet && quietHours())) {
    const eye = num(K.nextEye);
    if (!eye) setNum(K.nextEye, now + s.eyeEveryMin * 60000);
    else if (now >= eye && (await claim("eye")) && num(K.nextEye) === eye) {
      setNum(K.nextEye, now + s.eyeEveryMin * 60000);
      if (f.dueAt - now > 60000) eyeReminder();
    }
  }
  const hour = new Date(now + 330 * 60000).getUTCHours();
  if (s.windDown && hour === 23 && !inTest && local(K.windDown, "") !== istToday() && (await claim("wind"))) {
    setLocal(K.windDown, istToday());
    windDownReminder();
  }
  if (f.mode !== "idle" && now - lastPresence > 5 * 60000 && (await claim(`presence-${Math.floor(now / 300000)}`))) {
    sendPresence();
  }
  if (f.mode === "idle" || f.prompted || !f.dueAt || now < f.dueAt) return;
  if (f.mode === "focus" && (inTest || testRunning())) return; // breaks wait until the test ends
  if (!(await claim(`focus-${f.dueAt}`))) return;
  const latest = getFocus();
  if (latest.prompted || latest.dueAt !== f.dueAt) return;
  saveFocus({ ...latest, prompted: true });
  if (latest.mode === "focus") breakReminder();
  else breakOverReminder();
}

export function startReminders({ inTest = false } = {}) {
  if (started) return;
  started = true;
  unlockAudio();
  try { localStorage.removeItem("cat-next-water-at"); } catch { /* storage blocked */ }
  setTimeout(() => check(inTest), 2000);
  setInterval(() => check(inTest), 15000);
  setInterval(syncFocus, 60000);
  window.addEventListener("pagehide", () => { syncFocus(); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register("sw.js").catch(() => {});
    // A new version took over this page: say so once, so nobody runs old code for days.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || inTest) return;
      toast({ title: "The site has been updated", body: "Reload to use the new version.",
        actions: [{ label: "Reload", primary: true, onClick: () => location.reload() }] });
    });
  }
}

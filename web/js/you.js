// You: profile, reminder settings, theme, account on this device, and the admin tools.
import * as db from "./db.js";
import { rpc } from "./db.js";
import { el, boot, busy, currentTheme, setTheme, applyTextSize, confirmBox, fmtDate, showError, fill } from "./ui.js";
import { startReminders, cacheSettings, getSettings, DEFAULTS } from "./reminders.js";

const main = document.getElementById("main");
let me = null;
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  document.getElementById("install-btn")?.removeAttribute("hidden");
});

function profilePanel() {
  const name = el("input", { type: "text", value: me.name, maxlength: 20, required: true });
  const slot = el("select", {}, [1, 2, 3].map((n) => el("option", { value: String(n), selected: n === me.slot }, `Slot ${n}`)));
  const save = el("button", { type: "button", class: "btn primary" }, "Save");
  const status = el("p", { class: "status-line", role: "status" });
  save.addEventListener("click", () => busy(save, async () => {
    me = (await rpc("cat_set_profile", { p_name: name.value.trim(), p_slot: Number(slot.value) })).member;
    status.textContent = "Saved.";
  }));
  return el("section", { class: "panel span-6" }, el("h2", {}, "Profile"),
    el("div", { class: "form-grid" }, el("label", { class: "field" }, "Name", name), el("label", { class: "field" }, "CAT slot", slot)),
    el("div", { class: "row" }, save), status,
    el("p", { class: "muted small" }, `Joined ${fmtDate(me.joinedAt)}.${me.isAdmin ? " You run the group." : ""}`));
}

function settingsPanel() {
  const s = getSettings();
  const num = (key, label, min, max, unit) => {
    const input = el("input", { type: "number", inputmode: "numeric", min, max, step: 1, value: String(s[key]), style: "width:5em", "data-key": key });
    return el("label", { class: "field" }, label, el("span", {}, input, ` ${unit}`));
  };
  const check = (key, label) => el("p", {}, el("input", { type: "checkbox", id: `set-${key}`, checked: s[key], "data-key": key }), el("label", { for: `set-${key}` }, ` ${label}`));
  const size = el("select", { "data-key": "textSize" }, [90, 100, 110, 120, 130].map((v) => el("option", { value: String(v), selected: v === s.textSize }, `${v}%`)));
  const save = el("button", { type: "button", class: "btn primary" }, "Save settings");
  const reset = el("button", { type: "button", class: "btn quiet" }, "Back to the defaults");
  const status = el("p", { class: "status-line", role: "status" });
  const panel = el("section", { class: "panel span-6" }, el("h2", {}, "Reminders and reading"),
    el("p", { class: "muted small" }, "Saved to your account, so they're the same on every device you sign in on."),
    el("div", { class: "form-grid" },
      num("breakAfterMin", "Break after", 20, 120, "min of focus"),
      num("breakLengthMin", "Break length", 3, 30, "min"),
      num("eyeEveryMin", "Eye break every (0 is off)", 0, 60, "min"),
      el("label", { class: "field" }, "Text size", size)),
    check("sound", "Chime with reminders"),
    check("windDown", "Wind-down reminder at 23:00"),
    el("div", { class: "row" }, save, reset), status);
  const read = () => {
    const out = {};
    for (const input of panel.querySelectorAll("[data-key]")) {
      out[input.dataset.key] = input.type === "checkbox" ? input.checked : Number(input.value);
    }
    return out;
  };
  const store = (values) => busy(save, async () => {
    me = (await rpc("cat_settings_set", { p_settings: values })).member;
    cacheSettings(me.settings);
    applyTextSize(me.settings.textSize || 100);
    status.textContent = "Saved.";
  });
  save.addEventListener("click", () => store(read()));
  reset.addEventListener("click", async () => {
    await store({ ...DEFAULTS });
    render();
  });
  return panel;
}

function devicePanel() {
  const themes = ["system", "light", "dark"].map((t) => {
    const r = el("input", { type: "radio", name: "theme", id: `theme-${t}`, value: t, checked: currentTheme() === t });
    r.addEventListener("change", () => setTheme(t));
    return el("label", { for: `theme-${t}`, class: "option" }, r, ` ${t === "system" ? "Follow this device" : t === "light" ? "Light" : "Dark"}`);
  });
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const notifyBtn = el("button", { type: "button", class: "btn", disabled: perm !== "default" },
    perm === "granted" ? "Notifications are on" : perm === "denied" ? "Notifications are blocked in this browser" : perm === "unsupported" ? "This browser has no notifications" : "Turn on notifications");
  notifyBtn.addEventListener("click", async () => {
    await Notification.requestPermission();
    render();
  });
  const install = el("button", { type: "button", class: "btn", id: "install-btn", hidden: !installPrompt }, "Install as an app");
  install.addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    install.hidden = true;
  });
  const apple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  const appleTip = apple && !installed
    ? el("p", { class: "notice" }, "On iPhone or iPad: open this site in Safari, tap Share, then Add to Home Screen. Open it from the home screen and turn on notifications there. Safari only sends reminders to sites added this way.")
    : null;
  return el("section", { class: "panel span-6" }, el("h2", {}, "This device"),
    el("h3", {}, "Theme"), el("div", {}, themes),
    el("p", { class: "muted small" }, "Dark is easier on the eyes at night. The theme is kept on this device only."),
    el("h3", {}, "Notifications and app"),
    el("p", { class: "muted small" }, "With notifications on, reminders still reach you while the site is in a background tab. On a phone, install the site to the home screen for the same."),
    appleTip,
    el("div", { class: "row" }, notifyBtn, install));
}

function accountPanel() {
  const pw = el("input", { type: "password", autocomplete: "new-password", minlength: 8, placeholder: "New password" });
  const change = el("button", { type: "button", class: "btn" }, "Change password");
  const status = el("p", { class: "status-line", role: "status" });
  change.addEventListener("click", () => busy(change, async () => {
    if (pw.value.length < 8) {
      status.textContent = "Use 8 characters or more.";
      return;
    }
    await db.setPassword(pw.value);
    pw.value = "";
    status.textContent = "Password changed.";
  }));
  const out = el("button", { type: "button", class: "btn" }, "Sign out of this device");
  out.addEventListener("click", async () => {
    await db.signOut();
    location.href = "index.html";
  });
  return el("section", { class: "panel span-6" }, el("h2", {}, "Account"),
    el("p", {}, `Signed in as ${db.signedInEmail() || "you"}.`),
    el("p", { class: "muted small" }, "Your sign-in stays on this device only. Signing out here leaves your other devices signed in, and nothing about the sign-in is shared between devices."),
    el("div", { class: "row" }, pw, change), status,
    el("div", { class: "row" }, out),
    el("div", { class: "kbd-hint" }, el("h3", {}, "Keyboard shortcuts on the Today page"),
      el("p", {}, el("kbd", {}, "F"), " start or stop focus, ", el("kbd", {}, "B"), " take a break.")),
    el("p", {}, el("a", { href: "exam-day.html" }, "Exam-day checklist and the last 48 hours")));
}

async function adminPanel() {
  if (!me.isAdmin) return null;
  const a = await rpc("cat_admin_members");
  const code = el("input", { type: "text", value: a.code || "", maxlength: 30, spellcheck: "false" });
  const saveCode = el("button", { type: "button", class: "btn" }, "Change the code");
  saveCode.addEventListener("click", () => busy(saveCode, async () => {
    await rpc("cat_admin_set_code", { p_code: code.value.trim() });
    saveCode.textContent = "Changed";
  }));
  const rows = a.members.map((m) => {
    const team = el("select", { "aria-label": `Team for ${m.name}` }, [["", "No team"], ["A", "Team A"], ["B", "Team B"]].map(([v, l]) => el("option", { value: v, selected: (m.team || "") === v }, l)));
    team.addEventListener("change", () => busy(team, () => rpc("cat_admin_set_team", { p_name: m.name, p_team: team.value || null })));
    const remove = m.me ? null : el("button", { type: "button", class: "btn quiet small" }, "Remove");
    remove?.addEventListener("click", async () => {
      if (!(await confirmBox(`Remove ${m.name}?`, ["They lose access to the group straight away. Their account stays, so they can rejoin with the code."], "Remove"))) return;
      busy(remove, async () => { await rpc("cat_admin_remove", { p_name: m.name }); render(); });
    });
    return el("tr", {}, el("td", {}, m.name, m.isAdmin ? " (admin)" : ""), el("td", {}, `Slot ${m.slot}`), el("td", {}, fmtDate(m.joinedAt)), el("td", {}, team), el("td", {}, remove));
  });
  return el("section", { class: "panel span-12" }, el("h2", {}, "Running the group"),
    el("p", { class: "muted" }, "Only you see this. Share the code privately, in your family or friends' chat, never on a public page."),
    el("div", { class: "row" }, el("label", {}, "Group code ", code), saveCode),
    el("div", { class: "table-wrap" }, el("table", { class: "plain" }, el("thead", {}, el("tr", {}, ["Name", "Slot", "Joined", "Team", ""].map((h) => el("th", {}, h)))), el("tbody", {}, rows))),
    el("p", { class: "muted small" }, "Teams add a team total to the board. Leave everyone without a team to switch it off."));
}

async function render() {
  const grid = el("div", { class: "grid" }, profilePanel(), settingsPanel(), devicePanel(), accountPanel());
  try {
    const admin = await adminPanel();
    if (admin) grid.append(admin);
  } catch (err) {
    showError(err);
  }
  fill(main, el("div", { class: "page-head" }, el("h1", {}, "You")), grid);
}

async function init() {
  me = await boot("you.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  render();
}

init();

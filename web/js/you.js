// You: profile, reminder settings, theme, PIN and profile switching, and the admin tools.
import { rpc } from "./db.js";
import { el, boot, busy, currentTheme, setTheme, applyTextSize, confirmBox, fmtDate, fmtDateTime, showError, fill, local, setLocal, applyWarm, loadJson } from "./ui.js";
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
    check("quiet", "No chimes or eye reminders from 22:30 to 06:00"),
    check("autoBreak", "Start the break on its own when a focus block ends (you can skip it)"),
    check("windDown", "Wind-down reminder at 23:00"),
    check("walk", "Morning walk reminder"),
    check("lunch", "Lunch reminder on paper days"),
    check("caffeine", "No-caffeine reminder at 14:00"),
    check("examReminders", "Admit card and route reminders on 28 November"),
    el("label", { class: "field" }, "Time you'll leave for the centre on 29 November",
      el("input", { type: "time", value: s.travelAt || "", "data-key": "travelAt", style: "width:8em" })),
    el("p", { class: "muted small" }, "With that time set, the site reminds you at the same time on the 28th to check the route at that hour."),
    el("div", { class: "row" }, save, reset), status);
  const read = () => {
    const out = {};
    for (const input of panel.querySelectorAll("[data-key]")) {
      out[input.dataset.key] = input.type === "checkbox" ? input.checked : input.type === "time" ? input.value || null : Number(input.value);
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
  const THEME_LABEL = { system: "Follow this device", light: "Light", dark: "Dark", sunset: "Light by day, dark from 18:00 to 06:30" };
  const themes = Object.keys(THEME_LABEL).map((t) => {
    const r = el("input", { type: "radio", name: "theme", id: `theme-${t}`, value: t, checked: currentTheme() === t });
    r.addEventListener("change", () => setTheme(t));
    return el("label", { for: `theme-${t}`, class: "option" }, r, ` ${THEME_LABEL[t]}`);
  });
  const warm = el("input", { type: "checkbox", id: "warm", checked: local("cat-warm", false) === true });
  warm.addEventListener("change", () => { setLocal("cat-warm", warm.checked); applyWarm(); });
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
    el("p", {}, warm, el("label", { for: "warm" }, " Warmer colours from 21:00, to go easier on sleep")),
    el("p", { class: "muted small" }, "Dark is easier on the eyes at night. These are kept on this device only."),
    el("h3", {}, "Notifications and app"),
    el("p", { class: "muted small" }, "With notifications on, reminders still reach you while the site is in a background tab. On a phone, install the site to the home screen for the same."),
    appleTip,
    el("div", { class: "row" }, notifyBtn, install),
    el("details", {}, el("summary", {}, "Reminders on an iPhone or iPad"),
      el("ol", {},
        el("li", {}, "Open the site in Safari, tap Share, then Add to Home Screen."),
        el("li", {}, "Open it from the new home-screen icon and sign in there. That sign-in is separate from Safari's."),
        el("li", {}, "On this page, tap Turn on notifications and allow them."),
        el("li", {}, "In Settings, Notifications, find the site's name and turn on Time Sensitive if you see it.")),
      el("p", { class: "muted small" }, "iOS only shows reminders while the site is open or was open recently. For the paper and bed time, a phone alarm is the safer backup.")),
    el("details", {}, el("summary", {}, "Silence the phone while you study"),
      el("p", {}, el("strong", {}, "iPhone: "), "Settings, Focus, Do Not Disturb. Under Allowed apps, add this site's home-screen app if you want its break reminders. Turn it on from Control Centre when you start the timer."),
      el("p", {}, el("strong", {}, "Android: "), "Settings, Notifications, Do Not Disturb. Under Apps, allow Chrome (or the installed site) so break reminders still come through."),
      el("p", { class: "muted small" }, "Better still, leave the phone in another room and use a laptop or tablet for the site.")));
}

// Buddy (you see each other's plan ticks) and target IIMs.
async function buddyPanel() {
  const [people, buddy, facts] = await Promise.all([rpc("cat_profiles"), rpc("cat_buddy").catch(() => null), loadJson("data/facts.json").catch(() => null)]);
  const others = people.filter((x) => !x.me);
  const pick = el("select", { "aria-label": "Buddy" }, el("option", { value: "" }, "No buddy"),
    others.map((x) => el("option", { value: x.name, selected: buddy?.name === x.name }, x.name)));
  const saveBuddy = el("button", { type: "button", class: "btn" }, "Save buddy");
  const status = el("p", { class: "status-line", role: "status" });
  saveBuddy.addEventListener("click", () => busy(saveBuddy, async () => {
    me = (await rpc("cat_set_buddy", { p_name: pick.value || null })).member;
    status.textContent = pick.value ? `${pick.value} is your buddy. Their plan ticks show on your Today page.` : "No buddy now.";
  }));
  const names = (facts?.iims || []).map((x) => x.name || x.short || x).filter((x) => typeof x === "string");
  const iims = el("input", { type: "text", maxlength: 200, value: me.iims || "", list: "iim-list", placeholder: "e.g. IIM Indore, IIM Kozhikode, IIM Rohtak" });
  const saveIims = el("button", { type: "button", class: "btn" }, "Save targets");
  saveIims.addEventListener("click", () => busy(saveIims, async () => {
    me = (await rpc("cat_set_iims", { p_text: iims.value })).member;
    status.textContent = "Targets saved. The exam-day page shows the group's.";
  }));
  return el("section", { class: "panel span-6", id: "buddy" }, el("h2", {}, "Buddy and targets"),
    el("p", { class: "muted small" }, "A buddy sees your plan ticks and focus time for the day, and you see theirs. Pick someone whose slot and hours are close to yours."),
    el("div", { class: "row" }, pick, saveBuddy),
    buddy?.name ? el("p", { class: "small" }, `${buddy.name} today: ${buddy.ticks?.length || 0} plan blocks ticked, ${buddy.focusMin || 0} minutes focused.`) : null,
    el("label", { class: "field" }, "IIMs you're aiming for", iims),
    names.length ? el("datalist", { id: "iim-list" }, names.map((n) => el("option", { value: n }))) : null,
    el("div", { class: "row" }, saveIims), status);
}

function accountPanel() {
  const pinField = (label, hint) => el("input", { type: "password", inputmode: "numeric", pattern: "[0-9]{4}", maxlength: 4, autocomplete: "off", "aria-label": label, placeholder: hint, style: "width:7em" });
  const oldPin = pinField("Your PIN now", "PIN now");
  const newPin = pinField("Your new PIN", "New PIN");
  const change = el("button", { type: "button", class: "btn" }, "Change PIN");
  const status = el("p", { class: "status-line", role: "status" });
  change.addEventListener("click", () => busy(change, async () => {
    if (!/^\d{4}$/.test(newPin.value)) {
      status.textContent = "Use 4 digits for the new PIN.";
      return;
    }
    await rpc("cat_change_pin", { p_old: oldPin.value, p_new: newPin.value });
    oldPin.value = "";
    newPin.value = "";
    status.textContent = "PIN changed. Use the new one next time you pick your profile.";
  }));
  const swap = el("button", { type: "button", class: "btn" }, "Switch profile");
  swap.addEventListener("click", () => busy(swap, async () => {
    await rpc("cat_lock");
    location.href = "index.html";
  }));
  return el("section", { class: "panel span-6" }, el("h2", {}, "Profile on this device"),
    el("p", {}, `This device is on ${me.name}'s profile.`),
    el("p", { class: "muted small" }, "It stays on your profile until you switch. Switching here leaves your other devices as they are."),
    el("div", { class: "row" }, swap),
    el("h3", {}, "PIN"),
    el("div", { class: "row" }, oldPin, newPin, change), status,
    el("div", { class: "kbd-hint" }, el("h3", {}, "Keyboard shortcuts on the Today page"),
      el("p", {}, el("kbd", {}, "F"), " start or stop focus, ", el("kbd", {}, "B"), " take a break.")),
    el("p", {}, el("a", { href: "exam-day.html" }, "Exam-day checklist and the last four days")));
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
      if (!(await confirmBox(`Remove ${m.name}?`, ["Their profile and everything saved on it are deleted, and any device on it goes back to the profile list. This can't be undone."], "Remove"))) return;
      busy(remove, async () => { await rpc("cat_admin_remove", { p_name: m.name }); render(); });
    });
    return el("tr", {}, el("td", {}, m.name, m.isAdmin ? " (admin)" : "", m.hasPin ? "" : " (no PIN)"), el("td", {}, `Slot ${m.slot}`), el("td", {}, fmtDate(m.joinedAt)), el("td", {}, team), el("td", {}, remove));
  });
  // A forgotten PIN.
  const resetWho = el("select", { "aria-label": "Whose PIN" }, a.members.map((m) => el("option", { value: m.name }, m.name)));
  const resetPin = el("input", { type: "text", inputmode: "numeric", pattern: "[0-9]{4}", maxlength: 4, autocomplete: "off", "aria-label": "Their new PIN", placeholder: "New PIN", style: "width:7em" });
  const resetBtn = el("button", { type: "button", class: "btn" }, "Reset the PIN");
  const resetStatus = el("p", { class: "status-line", role: "status" });
  resetBtn.addEventListener("click", () => busy(resetBtn, async () => {
    if (!/^\d{4}$/.test(resetPin.value)) {
      resetStatus.textContent = "Use 4 digits.";
      return;
    }
    await rpc("cat_admin_reset_pin", { p_name: resetWho.value, p_pin: resetPin.value });
    resetStatus.textContent = `${resetWho.value}'s PIN is now ${resetPin.value}. Tell them privately; they can change it on their You page.`;
    resetPin.value = "";
  }));
  // Notice at the top of everyone's Today page.
  const today = await rpc("cat_today");
  const notice = el("textarea", { maxlength: 600, rows: 2, placeholder: "e.g. Paper moved to 13:00 on Saturday" }, today.notice?.text || "");
  const postNotice = el("button", { type: "button", class: "btn" }, "Post the notice");
  const noticeStatus = el("p", { class: "status-line", role: "status" });
  postNotice.addEventListener("click", () => busy(postNotice, async () => {
    await rpc("cat_admin_notice", { p_text: notice.value });
    noticeStatus.textContent = notice.value.trim() ? "Posted. It shows on everyone's Today page until they dismiss it." : "Notice cleared.";
  }));
  // Group hours goal for the week.
  const goal = await rpc("cat_week_goal").catch(() => null);
  const hours = el("input", { type: "number", min: 1, max: 2000, step: 1, value: goal?.goalHours ?? "", style: "width:6em", inputmode: "numeric", "aria-label": "Group hours this week" });
  const saveGoal = el("button", { type: "button", class: "btn" }, "Set the goal");
  const clearGoal = el("button", { type: "button", class: "btn quiet" }, "Clear the goal");
  saveGoal.addEventListener("click", () => busy(saveGoal, async () => { await rpc("cat_admin_week_goal", { p_hours: Number(hours.value) }); saveGoal.textContent = "Set"; }));
  clearGoal.addEventListener("click", () => busy(clearGoal, async () => { await rpc("cat_admin_week_goal", { p_hours: null }); hours.value = ""; }));
  // Reported questions.
  const reportsHost = el("div");
  const paintReports = (list) => fill(reportsHost, list.length ? el("ul", { class: "list" }, list.map((r) => {
    const done = el("button", { type: "button", class: "btn small" }, "Mark fixed");
    done.addEventListener("click", () => busy(done, async () => paintReports(await rpc("cat_admin_report_resolve", { p_id: r.id }))));
    return el("li", {}, el("span", { class: "grow" }, el("strong", {}, `${r.testId}, ${String(r.questionId).replace(/^.*~/, "")}`),
      el("span", { class: "muted small" }, ` from ${r.name}, ${fmtDateTime(r.at)}`), el("br"), r.text), done);
  })) : el("p", { class: "muted small" }, "No open reports."));
  paintReports(await rpc("cat_admin_reports").catch(() => []));
  // Everything the group has, as one file.
  const exp = el("button", { type: "button", class: "btn" }, "Download the group's data (JSON)");
  exp.addEventListener("click", () => busy(exp, async () => {
    const data = await rpc("cat_admin_export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = el("a", { href: url, download: `cat-prep-export-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }));
  return el("section", { class: "panel span-12" }, el("h2", {}, "Running the group"),
    el("p", { class: "muted" }, "Only you see this. Share the code privately, in your family or friends' chat, never on a public page."),
    el("div", { class: "row" }, el("label", {}, "Group code ", code), saveCode),
    el("div", { class: "table-wrap" }, el("table", { class: "plain" }, el("thead", {}, el("tr", {}, ["Name", "Slot", "Joined", "Team", ""].map((h) => el("th", {}, h)))), el("tbody", {}, rows))),
    el("p", { class: "muted small" }, "Teams add a team total to the board. Leave everyone without a team to switch it off."),
    el("h3", {}, "Reset a PIN"),
    el("div", { class: "row" }, resetWho, resetPin, resetBtn), resetStatus,
    el("h3", {}, "Notice for everyone"), notice, el("div", { class: "row" }, postNotice), noticeStatus,
    el("h3", {}, "Group hours this week"),
    el("p", { class: "muted small" }, goal?.goalHours ? `${Math.round((goal.doneMin || 0) / 60)} of ${goal.goalHours} hours done so far this week.` : "No goal set for this week."),
    el("div", { class: "row" }, hours, el("span", {}, "hours"), saveGoal, clearGoal),
    el("h3", {}, "Reported questions"), reportsHost,
    el("h3", {}, "Backup"),
    el("p", { class: "muted small" }, "Members, scores, mocks, posts and settings. Keep the file private: it has everyone's names and results."),
    el("div", { class: "row" }, exp));
}

async function render() {
  const grid = el("div", { class: "grid" }, profilePanel(), settingsPanel(), devicePanel());
  try {
    grid.append(await buddyPanel());
  } catch (err) {
    showError(err);
  }
  grid.append(accountPanel());
  try {
    const admin = await adminPanel();
    if (admin) grid.append(admin);
  } catch (err) {
    showError(err);
  }
  fill(main, el("div", { class: "page-head" }, el("h1", {}, "You")), grid);
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

async function init() {
  me = await boot("you.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  render();
}

init();

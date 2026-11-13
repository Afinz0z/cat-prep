// Exam-day checklist and the last four days. Ticks are kept on this device.
import { el, boot, local, setLocal, fill } from "./ui.js";
import { startReminders, cacheSettings } from "./reminders.js";

const main = document.getElementById("main");

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

async function init() {
  const me = await boot("exam-day.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  fill(main, 
    el("div", { class: "page-head" }, el("h1", {}, "Exam day"),
      el("button", { type: "button", class: "btn no-print", onclick: () => window.print() }, "Print")),
    el("p", { class: "notice" }, "Your admit card's instructions win over anything on this page. Read them in full on Saturday."),
    el("div", { class: "grid" },
      el("section", { class: "panel span-6" }, el("h2", {}, "The last four days"),
        PLAN.map(([day, items], i) => [el("h3", {}, day), checklist(`cat-plan48-${i}`, items)])),
      el("section", { class: "panel span-6" },
        el("h2", {}, "The bag"), checklist("cat-bag", BAG),
        el("h2", {}, "In the hall"), checklist("cat-hall", IN_EXAM))));
}

init();

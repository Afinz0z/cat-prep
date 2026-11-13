// The two boards: effort points (week, last week, November) and scores.
import { rpc } from "./db.js";
import { el, boot, fmtMin, fmtDate, istToday, daysBetween, CAT_DAY, loadJson, toast, showError, fill } from "./ui.js";
import { startReminders, cacheSettings } from "./reminders.js";

const main = document.getElementById("main");
let me = null;
let testTitles = {};

const RULES = [
  ["Focus on the study timer", "1 per 10 minutes", "60 a day"],
  ["Study day (an hour or more of focus)", "5", ""],
  ["Promise of 2 hours or more, kept", "10", ""],
  ["Sleep of 7 hours or more, logged", "5", ""],
  ["Task ticked off", "3", "5 tasks a day"],
  ["Site test, first finish", "20 (Daily 5: 10)", "once per test"],
  ["Full mock logged", "30, plus 10 at your slot time", "1 a day"],
  ["Video marked watched", "5", "6 a day"],
  ["Topic reaches 'solves basic' / 'solves CAT level'", "10 / 15 more", "50 a day"],
  ["Approach posted (40 characters or more)", "3", "5 a day"],
  ["Helpful vote on your approach", "2", "5 a day"],
  ["Review question answered right", "2", "5 a day"],
  ["Speed drill round", "2", "5 a day"],
];

const BADGES = {
  "first-test": "First site test",
  "first-mock": "First full mock",
  "slot-mock": "Mock at slot time",
  "promise-kept": "Promise kept",
  "streak-3": "3-day streak",
  "streak-7": "7-day streak",
  "hours-10": "10 hours focused",
  "hours-50": "50 hours focused",
  helper: "5 approaches posted",
  helpful: "Voted helpful",
  "topics-5": "5 topics at CAT level",
  reviewer: "10 reviews cleared",
};

function breakdown(r) {
  const items = [
    ["Focus", fmtMin(r.focusMin)], ["Study days", r.studyDays], ["Promises kept", r.kept], ["Sleep 7 h+", r.slept],
    ["Tasks", r.tasks], ["Site tests", r.tests], ["Mocks", r.mocks],
    ["Videos", r.videos], ["Topic points", r.topicPoints], ["Approaches", r.posts], ["Helpful votes", r.votes],
    ["Reviews right", r.reviews], ["Drill rounds", r.drills], ["Streak now", `${r.streak} days`],
  ];
  return el("div", { class: "breakdown" }, items.map(([k, v]) => el("span", {}, `${k}: `, el("strong", {}, String(v)))));
}

function race(rows) {
  const leader = Math.max(1, ...rows.map((r) => r.points));
  return el("ol", { class: "race" }, rows.map((r, i) => el("li", { class: r.me ? "me" : "" },
    el("span", { class: "pos" }, String(i + 1)),
    el("span", { class: "name", title: r.name }, r.name, r.team ? el("span", { class: "muted small" }, ` team ${r.team}`) : null),
    el("span", { class: "track", "aria-hidden": "true" }, el("span", { style: `width:${Math.round((r.points / leader) * 100)}%` })),
    el("span", { class: "pts" }, String(r.points)),
    el("details", {}, el("summary", {}, "Where the points came from"), breakdown(r)))));
}

function teams(rows) {
  const t = {};
  for (const r of rows) {
    if (!r.team) continue;
    t[r.team] = t[r.team] || { points: 0, n: 0 };
    t[r.team].points += r.points;
    t[r.team].n += 1;
  }
  const names = Object.keys(t);
  if (names.length < 2) return null;
  return el("section", { class: "panel" }, el("h2", {}, "Teams"),
    el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, el("th", {}, "Team"), el("th", { class: "n" }, "People"), el("th", { class: "n" }, "Points"), el("th", { class: "n" }, "Per person"))),
      el("tbody", {}, names.sort((a, b) => t[b].points - t[a].points).map((n) => el("tr", {},
        el("td", {}, `Team ${n}`), el("td", { class: "n" }, String(t[n].n)), el("td", { class: "n" }, String(t[n].points)),
        el("td", { class: "n" }, String(Math.round(t[n].points / t[n].n))))))),
    el("p", { class: "muted small" }, "Per person is the fair comparison when the teams differ in size. The admin sets teams on the You page."));
}

function summaryText(b) {
  const left = daysBetween(istToday(), CAT_DAY);
  const lines = [`CAT prep board, week from ${fmtDate(b.from)} to ${fmtDate(b.to)}`];
  b.rows.forEach((r, i) => lines.push(`${i + 1}. ${r.name}: ${r.points} points, ${fmtMin(r.focusMin)} focus`));
  const lazy = b.rows.filter((r) => r.focusMin < 60).map((r) => r.name);
  if (lazy.length) lines.push(`Under an hour so far: ${lazy.join(", ")}.`);
  if (left >= 0) lines.push(`${left} days to CAT.`);
  return lines.join("\n");
}

async function copySummary(b, button) {
  const text = summaryText(b);
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied. Paste it in WhatsApp";
  } catch {
    toast({ title: "Copy this", body: text });
  }
}

function rulesPanel() {
  return el("details", { class: "panel" }, el("summary", {}, el("strong", {}, "How points work")),
    el("p", { class: "muted" }, "Days run on Indian time. Weeks start on Monday. Caps stop anyone farming one thing."),
    el("table", { class: "plain" },
      el("thead", {}, el("tr", {}, el("th", {}, "For"), el("th", {}, "Points"), el("th", {}, "Cap"))),
      el("tbody", {}, RULES.map(([a, b, c]) => el("tr", {}, el("td", {}, a), el("td", {}, b), el("td", {}, c))))));
}

// Weekly winners since the first week of November.
async function hallOfFame() {
  const mondays = [];
  const thisMonday = (() => {
    const d = new Date(`${istToday()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d;
  })();
  for (let d = new Date("2026-11-02T00:00:00Z"); d < thisMonday; d.setUTCDate(d.getUTCDate() + 7)) mondays.push(d.toISOString().slice(0, 10));
  const weeks = await Promise.all(mondays.map((m) => rpc("cat_board", { p_range: m }).catch(() => null)));
  return weeks.filter((w) => w && w.rows.length && w.rows[0].points > 0).map((w) => ({ from: w.from, winner: w.rows[0], second: w.rows[1] }));
}

async function showEffort(range, host) {
  fill(host, el("p", { class: "muted" }, "Loading..."));
  const b = await rpc("cat_board", { p_range: range });
  const mine = b.rows.find((r) => r.me);
  const pos = b.rows.findIndex((r) => r.me) + 1;
  const copy = el("button", { type: "button", class: "btn" }, "Copy a summary for WhatsApp");
  copy.addEventListener("click", () => copySummary(b, copy));
  const parts = [];
  if (range === "week") {
    const fame = await hallOfFame();
    const last = fame.at(-1);
    if (last) {
      parts.push(el("section", { class: "panel winner" },
        el("h2", {}, `Last week's winner: ${last.winner.name}`),
        el("p", {}, `${last.winner.points} points, ${fmtMin(last.winner.focusMin)} of focus.`,
          last.second ? ` ${last.second.name} came second with ${last.second.points}.` : "")));
    }
    if (fame.length > 1) {
      parts.push(el("section", { class: "panel" }, el("h2", {}, "Hall of fame"),
        el("ul", { class: "list" }, fame.map((w) => el("li", {}, el("span", { class: "grow" }, `Week from ${fmtDate(w.from)}`),
          el("strong", {}, w.winner.name), el("span", { class: "muted" }, `${w.winner.points} points`))))));
    }
    if (mine) {
      const prev = await rpc("cat_board", { p_range: "last" }).catch(() => null);
      const before = prev?.rows.find((r) => r.me);
      parts.push(el("section", { class: "panel" }, el("h2", {}, "Your week so far"),
        el("p", {}, `${pos === 1 ? "First" : `Number ${pos}`} of ${b.rows.length}, ${mine.points} points, ${fmtMin(mine.focusMin)} focused, ${mine.tests} site test${mine.tests === 1 ? "" : "s"}, ${mine.mocks} mock${mine.mocks === 1 ? "" : "s"}, ${mine.topicPoints} topic points.`),
        before ? el("p", { class: "muted" }, `All of last week: ${before.points} points and ${fmtMin(before.focusMin)} focused.`) : null));
    }
  }
  fill(host, 
    el("section", { class: "panel" },
      el("div", { class: "page-head" }, el("h2", {}, `${fmtDate(b.from)} to ${fmtDate(b.to)}`), copy),
      b.rows.length ? race(b.rows) : el("p", { class: "empty" }, "Nobody has points yet.")),
    teams(b.rows),
    ...parts,
    rulesPanel());
}

async function showScores(host) {
  fill(host, el("p", { class: "muted" }, "Loading..."));
  const s = await rpc("cat_scores");
  const tests = [...new Set(s.rows.flatMap((r) => Object.keys(r.tests || {})))].sort();
  const head = ["Name", "Slot", "Best mock", "VARC / DILR / QA", "Goal", "Gap", "Mocks", ...tests.map((t) => testTitles[t] || t)];
  fill(host, 
    el("section", { class: "panel" },
      el("h2", {}, "Scores"),
      el("p", { class: "muted" }, "Full mocks are whatever each person logged on the Mocks page. Site tests count the first attempt only, so retakes after seeing answers change nothing."),
      el("div", { class: "table-wrap" }, el("table", { class: "plain" },
        el("thead", {}, el("tr", {}, head.map((h, i) => el("th", { class: i >= 2 && i !== 3 ? "n" : null }, h)))),
        el("tbody", {}, s.rows.map((r) => {
          const best = r.bestMock;
          const gap = best && r.goalScore !== null && r.goalScore !== undefined ? best.total - r.goalScore : null;
          return el("tr", { class: r.me ? "me" : "" },
            el("td", {}, r.name), el("td", {}, String(r.slot)),
            el("td", { class: "n" }, best ? String(best.total) : ""),
            el("td", {}, best ? `${best.varc} / ${best.dilr} / ${best.qa}` : ""),
            el("td", { class: "n" }, r.goalScore !== null && r.goalScore !== undefined ? `${r.goalScore}${r.goalPct ? ` (${r.goalPct}th)` : ""}` : ""),
            el("td", { class: `n ${gap === null ? "" : gap >= 0 ? "good" : "bad"}` }, gap === null ? "" : gap >= 0 ? `+${gap}` : String(gap)),
            el("td", { class: "n" }, String(r.mocks)),
            tests.map((t) => el("td", { class: "n" }, r.tests?.[t] === undefined ? "" : String(r.tests[t]))));
        }))))));
}

function heatClass(min) {
  if (!min) return "";
  if (min < 60) return "h1";
  if (min < 180) return "h2";
  if (min < 360) return "h3";
  return "h4";
}

async function showBadges(host) {
  fill(host, el("p", { class: "muted" }, "Loading..."));
  const [badges, heat] = await Promise.all([rpc("cat_badges"), rpc("cat_heatmap")]);
  const days = [];
  for (let d = new Date("2026-11-01T00:00:00Z"); d <= new Date(`${CAT_DAY}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const today = istToday();
  fill(host, 
    el("section", { class: "panel" },
      el("h2", {}, "Study hours, 1 to 29 November"),
      el("div", { class: "table-wrap" }, el("table", { class: "heat" },
        el("thead", {}, el("tr", {}, el("th", {}, ""), days.map((d) => el("th", { scope: "col", title: fmtDate(d) }, String(Number(d.slice(8))))))),
        el("tbody", {}, heat.map((h) => el("tr", {},
          el("th", { scope: "row" }, h.name),
          days.map((d) => el("td", { class: d > today ? "future" : heatClass(h.days[d]), title: `${h.name}, ${fmtDate(d)}: ${fmtMin(h.days[d] || 0)}` }))))))),
      el("p", { class: "muted small" }, "Lightest: under an hour. Then 1 to 3 hours, 3 to 6 hours, and 6 hours or more. Dashed squares are still to come.")),
    el("section", { class: "panel" },
      el("h2", {}, "Badges"),
      el("table", { class: "plain" }, el("tbody", {}, badges.map((b) => el("tr", { class: b.me ? "me" : "" },
        el("th", { scope: "row" }, b.name),
        el("td", {}, el("div", { class: "badges" }, Object.entries(BADGES).map(([code, label]) =>
          el("span", { class: `badge${b.badges.includes(code) ? " got" : ""}` }, b.badges.includes(code) ? label : el("span", { class: "muted" }, label)))))))))));
}

async function init() {
  me = await boot("board.html");
  if (!me) return;
  cacheSettings(me.settings);
  startReminders();
  try {
    testTitles = Object.fromEntries((await loadJson("tests/index.json")).map((t) => [t.id, t.title]));
  } catch {
    testTitles = {};
  }
  const host = el("div", { class: "stack" });
  const views = [["week", "This week"], ["last", "Last week"], ["all", "All of November"], ["scores", "Scores"], ["badges", "Badges and hours"]];
  const tabs = el("div", { class: "tabs", role: "tablist" });
  const show = async (key) => {
    for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.key === key));
    try {
      if (key === "scores") await showScores(host);
      else if (key === "badges") await showBadges(host);
      else await showEffort(key, host);
    } catch (err) {
      fill(host, el("p", { class: "notice error" }, err.message));
      showError(err);
    }
    history.replaceState(null, "", `#${key}`);
  };
  for (const [key, label] of views) tabs.append(el("button", { type: "button", role: "tab", "data-key": key, onclick: () => show(key) }, label));
  fill(main, el("div", { class: "page-head" }, el("h1", {}, "Board")), tabs, host);
  const start = location.hash.slice(1);
  show(views.some(([k]) => k === start) ? start : "week");
}

init();

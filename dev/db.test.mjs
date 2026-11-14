// Tests for supabase/schema.sql, run against a local Postgres: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDb, createUser, rpc, KEYS_DIR, ROOT } from "./db.mjs";

const db = await createDb({ joinCode: "TEST-CODE" });
const asA = (fn, args) => rpc(db, A, fn, args);
const asB = (fn, args) => rpc(db, B, fn, args);
const asC = (fn, args) => rpc(db, C, fn, args);
const A = await createUser(db, "a@example.com");
const B = await createUser(db, "b@example.com");
const C = await createUser(db, "c@example.com"); // signed up, never joins

const basics = JSON.parse(readFileSync(path.join(ROOT, "web", "tests", "qa-basics-check.json"), "utf8"));
const key = JSON.parse(readFileSync(path.join(KEYS_DIR, "qa-basics-check.json"), "utf8"));
const qids = basics.sections[0].questions.map((q) => q.id);

function payload(answers, clientAttemptId) {
  return {
    testId: "qa-basics-check",
    clientAttemptId,
    startedAt: new Date().toISOString(),
    sections: [{ timeUsedSec: 1200, endedBy: "submit" }],
    questions: qids.map((id) => ({ id, answer: answers[id] ?? null, status: answers[id] ? "answered" : "notAnswered", timeSpentSec: 30, visits: 1 })),
  };
}

// Nudges are refused from 22:30 to 06:00 Indian time.
const istMinutes = (() => { const d = new Date(Date.now() + 330 * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
const quiet = istMinutes > 22 * 60 + 30 || istMinutes < 6 * 60;

const rejects = async (promise, pattern) => assert.rejects(promise, (err) => {
  assert.match(err.message, pattern);
  return true;
});

test("access rules", async () => {
  await rejects(rpc(db, null, "cat_me", {}), /permission denied/);
  assert.deepEqual(await asC("cat_me", {}), { member: null });
  await rejects(asC("cat_today", {}), /Pick your profile first/);
  await rejects(asA("cat_join", { p_code: "nope", p_name: "Asha", p_slot: 2, p_pin: "1234" }), /group code is wrong/);
  const me = await asA("cat_join", { p_code: " test-code ", p_name: "Asha", p_slot: 2, p_pin: "1234" });
  assert.equal(me.member.name, "Asha");
  assert.equal(me.member.isAdmin, true, "first member runs the group");
  await rejects(asB("cat_join", { p_code: "TEST-CODE", p_name: "asha", p_slot: 1, p_pin: "1234" }), /already uses that name/);
  const b = await asB("cat_join", { p_code: "TEST-CODE", p_name: "Bilal", p_slot: 1, p_pin: "1234" });
  assert.equal(b.member.isAdmin, false);
  await rejects(rpc(db, A, "cat_unknown", {}), /Could not find/);
  await rejects(rpc(db, A, "cat_today", { extra: 1 }), /Could not find/);
  await assert.rejects(db.transaction(async (tx) => {
    await tx.query("set local role authenticated");
    await tx.query("select * from private.tests");
  }), /permission denied/);
  await assert.rejects(db.transaction(async (tx) => {
    await tx.query("set local role authenticated");
    await tx.query("select private.grade('tita', '{}'::jsonb, '1')");
  }), /permission denied/);
});

test("grading matches the Python grader", async () => {
  const samples = {};
  qids.forEach((id, i) => {
    const k = key[id];
    const variants = [String(k.answer), `${k.answer}%`, ` ${k.answer} `, "999", "", "abc", `₹${k.answer}`, "1,0", String(k.min ?? k.answer)];
    samples[id] = variants[i % variants.length];
  });
  const rec = await asA("cat_submit", { p_attempt: payload(samples, "client-1") });
  const python = execFileSync("python", ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.resolve(ROOT, "..", "site"))})
import grading
key = json.load(open(${JSON.stringify(path.join(KEYS_DIR, "qa-basics-check.json"))}, encoding="utf-8"))
answers = json.loads(sys.stdin.read())
print(json.dumps({q: grading.grade_question({"type": "tita"}, key[q], a) for q, a in answers.items()}))
`], { input: JSON.stringify(samples), encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  const expected = JSON.parse(python);
  for (const q of rec.questions) assert.equal(q.result, expected[q.id], `${q.id}: answer ${JSON.stringify(samples[q.id])}`);
  const right = rec.questions.filter((q) => q.result === "correct").length;
  assert.equal(rec.totals.correct, right);
  assert.equal(rec.totals.marks, right * 3, "wrong type-in answers cost nothing");
  assert.equal(rec.reveal, null);
  assert.ok(!JSON.stringify(rec).includes(key.q1.solution), "no solutions before reveal");
});

test("submit is idempotent and private", async () => {
  const first = await asA("cat_submit", { p_attempt: payload({ q1: "37.5" }, "client-1") });
  const list = await asA("cat_attempts", {});
  assert.equal(list.length, 1, "same client id gives the same attempt");
  assert.equal(first.attemptId, list[0].attemptId);
  await rejects(asB("cat_attempt", { p_attempt_id: first.attemptId }), /No attempt of yours/);
  await rejects(asA("cat_submit", { p_attempt: { testId: "nope" } }), /not on the site/);
});

test("retry, reveal and the review queue", async () => {
  const [{ attemptId }] = await asA("cat_attempts", {});
  const rec = await asA("cat_attempt", { p_attempt_id: attemptId });
  const wrong = rec.questions.filter((q) => q.result !== "correct");
  const correctOne = rec.questions.find((q) => q.result === "correct");
  const target = wrong[0];
  const after = await asA("cat_retry", { p_attempt_id: attemptId, p_answers: { [target.id]: String(key[target.id].answer), [correctOne.id]: "0" } });
  const last = after.retries.at(-1).results;
  assert.equal(last[target.id], "correct");
  assert.equal(last[correctOne.id], undefined, "already-correct questions are not retried");
  await rejects(asA("cat_retry", { p_attempt_id: attemptId, p_answers: {} }), /at least one answer/);

  const reviews = await asA("cat_reviews", {});
  assert.equal(reviews.due.length, 0, "first review is due tomorrow");
  assert.equal(reviews.upcoming, wrong.length);
  await db.query("update private.reviews set due_on = due_on - 1");
  const due = await asA("cat_reviews", {});
  assert.equal(due.due.length, wrong.length);
  const r1 = await asA("cat_review_answer", { p_test_id: "qa-basics-check", p_question_id: target.id, p_answer: "123456" });
  assert.equal(r1.result, "wrong");
  assert.equal(r1.answer, null, "no answer shown before reveal");
  await rejects(asA("cat_review_answer", { p_test_id: "qa-basics-check", p_question_id: target.id, p_answer: "1" }), /Not due yet/);
  await db.query("update private.reviews set due_on = due_on - 1");
  const r2 = await asA("cat_review_answer", { p_test_id: "qa-basics-check", p_question_id: target.id, p_answer: String(key[target.id].answer) });
  assert.deepEqual([r2.result, r2.stage], ["correct", 1]);

  const shown = await asA("cat_reveal", { p_attempt_id: attemptId });
  assert.ok(shown.revealedAt);
  assert.equal(shown.reveal.q1.solution, key.q1.solution);
  assert.equal(String(shown.reveal.q2.answer), key.q2.display);
  await rejects(asA("cat_retry", { p_attempt_id: attemptId, p_answers: { [target.id]: "1" } }), /retries are closed/);
});

test("today: focus, tasks, promise, sleep", async () => {
  let t = await asA("cat_add_focus", { p_minutes: 500 });
  assert.equal(t.focusMin, 60, "60 minutes at most per call");
  for (let i = 0; i < 16; i += 1) t = await asA("cat_add_focus", { p_minutes: 60 });
  assert.equal(t.focusMin, 840, "14 hours a day at most");
  for (let i = 0; i < 8; i += 1) t = await asA("cat_task_add", { p_text: `task ${i}` });
  await rejects(asA("cat_task_add", { p_text: "ninth" }), /Eight tasks/);
  await rejects(asA("cat_task_add", { p_text: "   " }), /empty/);
  for (const task of t.tasks.slice(0, 6)) t = await asA("cat_task_done", { p_task_id: task.id, p_done: true });
  assert.equal(t.tasks.filter((x) => x.done).length, 6);
  t = await asB("cat_task_done", { p_task_id: t.tasks[7].id, p_done: true });
  assert.equal(t.tasks.length, 0, "B can't touch A's tasks");
  t = await asA("cat_set_target", { p_minutes: 300 });
  assert.equal(t.targetMin, 300);
  await rejects(asA("cat_set_target", { p_minutes: 10 }), /between 30 minutes/);
  t = await asA("cat_sleep", { p_hours: 7.5, p_bed: "23:05", p_wake: "06:35" });
  assert.deepEqual([t.bedTime, t.wakeTime], ["23:05", "06:35"]);
  assert.equal(t.sleepMin, 450);
  assert.equal(t.streak, 1);
  const promises = await asB("cat_promises", {});
  assert.equal(promises.find((p) => p.name === "Asha").targetMin, 300);
});

test("topics, videos, mocks, scores", async () => {
  await asA("cat_topic_set", { p_topic: "qa-percentages", p_status: "basic" });
  await asA("cat_topic_set", { p_topic: "qa-percentages", p_status: "learning" });
  const p = await asA("cat_topic_set", { p_topic: "qa-percentages", p_status: "cat-level" });
  assert.equal(p.topics["qa-percentages"], "cat-level");
  assert.deepEqual(p.group["qa-percentages"], { basic: 1, catLevel: 1 });
  await rejects(asA("cat_topic_set", { p_topic: "Bad Topic", p_status: "basic" }), /Unknown topic/);
  const v = await asA("cat_video_set", { p_video: "hq_wPlMckKQ", p_watched: true });
  assert.deepEqual(v.videos, ["hq_wPlMckKQ"]);
  const today = (await asA("cat_today", {})).day;
  const analysis = { attempted: { varc: 12, dilr: 6, qa: 9 }, wrong: { varc: 4, dilr: 2, qa: 3 }, causes: { c1: 6, c3: 9, c9: 4 }, note: "rushed DILR", junk: 1 };
  const mocks = await asA("cat_mock_add", { p_taken_on: today, p_source: "CAT 2024 Slot 1", p_paper_id: "cat-2024-s1", p_varc: 20, p_dilr: 8, p_qa: 12, p_at_slot_time: true, p_analysis: analysis });
  assert.equal(mocks[0].total, 40);
  assert.deepEqual(mocks[0].analysis, { attempted: { varc: 12, dilr: 6, qa: 9 }, wrong: { varc: 4, dilr: 2, qa: 3 }, causes: { c1: 6, c3: 9 }, note: "rushed DILR" });
  await rejects(asA("cat_mock_add", { p_taken_on: today, p_source: "x", p_paper_id: null, p_varc: 80, p_dilr: 0, p_qa: 0, p_at_slot_time: false, p_analysis: {} }), /outside what CAT allows/);
  await rejects(asA("cat_mock_add", { p_taken_on: "2030-01-01", p_source: "x", p_paper_id: null, p_varc: 1, p_dilr: 0, p_qa: 0, p_at_slot_time: false, p_analysis: {} }), /not in the future/);
  await asB("cat_mock_add", { p_taken_on: today, p_source: "CAT 2024 Slot 1", p_paper_id: "cat-2024-s1", p_varc: 25, p_dilr: 10, p_qa: 15, p_at_slot_time: false, p_analysis: {} });
  const paper = await asA("cat_paper", { p_paper_id: "cat-2024-s1" });
  assert.deepEqual(paper.map((r) => [r.name, r.total]), [["Bilal", 50], ["Asha", 40]]);
  const goal = await asA("cat_set_goal", { p_score: 45, p_pct: 85, p_sec: { varc: 20, dilr: 9.4, qa: 99, x: 1 } });
  assert.deepEqual(goal.member.goalSec, { varc: 20, dilr: 9, qa: 72 });
  const scores = await asA("cat_scores", {});
  assert.deepEqual(scores.rows.map((r) => r.name), ["Bilal", "Asha"]);
  assert.equal(scores.rows[1].goalScore, 45);
  assert.equal(typeof scores.rows[1].tests["qa-basics-check"], "number");
});

test("effort board adds up", async () => {
  const board = await asB("cat_board", { p_range: "week" });
  const a = board.rows.find((r) => r.name === "Asha");
  // focus 60 (cap) + study day 5 + promise kept 10 + sleep 5 + tasks 5*3
  // + basics test 20 + mock 30 + slot bonus 10 + video 5 + topic 10+15 + review 1*2
  // + analysis saved with the mock 10
  assert.equal(a.points, 60 + 5 + 10 + 5 + 15 + 20 + 30 + 10 + 5 + 25 + 2 + 10);
  assert.equal(a.analyses, 1);
  assert.equal(board.rows[0].name, "Asha");
  const last = await asB("cat_board", { p_range: "last" });
  assert.ok(last.rows.every((r) => r.points === 0));
  const byDate = await asB("cat_board", { p_range: board.from });
  assert.equal(byDate.rows[0].points, a.points);
});

test("chat, threads, votes, bookmarks", async () => {
  await asA("cat_chat_send", { p_text: "Morning all. @bilal you up?", p_paper_id: null });
  await asB("cat_chat_send", { p_text: "Yes", p_paper_id: null });
  const chat = await asA("cat_chat", { p_after: 0 });
  assert.deepEqual(chat.map((m) => m.name), ["Asha", "Bilal"]);
  const pulse = await asB("cat_pulse", { p_chat_after: 0, p_posts_after: 0 });
  assert.equal(pulse.chatNew, 1);
  assert.equal(pulse.mentions, 1);
  await asA("cat_chat_like", { p_message_id: chat[1].id, p_on: true });
  assert.equal((await asB("cat_chat", { p_after: 0 }))[1].likes, 1);
  await asB("cat_chat_delete", { p_message_id: chat[0].id });
  assert.equal((await asA("cat_chat", { p_after: 0 })).length, 2, "can't delete someone else's message");
  for (let i = 0; i < 14; i += 1) await asB("cat_chat_send", { p_text: `m${i}`, p_paper_id: null });
  await rejects(asB("cat_chat_send", { p_text: "too many", p_paper_id: null }), /Slow down/);

  assert.deepEqual(await asB("cat_thread_summary", { p_test_id: "qa-basics-check" }), { open: false });
  await rejects(asB("cat_thread", { p_test_id: "qa-basics-check", p_question_id: "q1" }), /Submit this test first/);
  const t1 = await asA("cat_thread_post", { p_test_id: "qa-basics-check", p_question_id: "q1", p_text: "3/8 is half of 3/4, and 3/4 is 75%, so 37.5." });
  assert.equal(t1.posts.length, 1);
  await rejects(asA("cat_thread_post", { p_test_id: "qa-basics-check", p_question_id: "q99", p_text: "x" }), /not in this test/);
  await asB("cat_submit", { p_attempt: payload({ q1: "37.5" }, "client-b") });
  const t2 = await asB("cat_thread", { p_test_id: "qa-basics-check", p_question_id: "q1" });
  assert.equal(t2.posts[0].name, "Asha");
  assert.equal(t2.mine, "correct");
  assert.equal(t2.done, 2);
  const voted = await asB("cat_post_vote", { p_post_id: t2.posts[0].id, p_on: true });
  assert.equal(voted.posts[0].votes, 1);
  await rejects(asA("cat_post_vote", { p_post_id: t2.posts[0].id, p_on: true }), /own approach/);
  const summary = await asB("cat_thread_summary", { p_test_id: "qa-basics-check" });
  assert.equal(summary.questions.q1.posts, 1);
  assert.equal(summary.questions.q1.done, 2);
  const bm = await asB("cat_bookmark_set", { p_test_id: "qa-basics-check", p_question_id: "q5", p_on: true, p_note: "redo" });
  assert.equal(bm[0].note, "redo");
});

test("presence, nudges, rooms, drills, badges, admin", async () => {
  await asA("cat_presence", { p_mode: "focus", p_minutes: 50 });
  const now = await asB("cat_now", {});
  assert.deepEqual(now.map((n) => [n.name, n.mode]), [["Asha", "focus"]]);
  await rejects(asB("cat_nudge", { p_name: "Asha" }), quiet ? /Quiet hours/ : /already studied today/);
  if (quiet) {
    await rejects(asA("cat_nudge", { p_name: "bilal" }), /Quiet hours/);
  } else {
    await asA("cat_nudge", { p_name: "bilal" });
    await asA("cat_nudge", { p_name: "bilal" });
    assert.equal((await asB("cat_today", {})).nudges.length, 1, "one nudge per person per day");
  }
  const start = new Date(Date.now() + 3600e3).toISOString();
  const rooms = await asA("cat_room_create", { p_title: "QA hour", p_starts_at: start, p_minutes: 60 });
  await asB("cat_room_join", { p_room_id: rooms[0].id, p_on: true });
  assert.deepEqual((await asA("cat_rooms", {}))[0].people, ["Asha", "Bilal"]);
  await rejects(asA("cat_room_create", { p_title: "x", p_starts_at: start, p_minutes: 5 }), /25 minutes/);
  await asA("cat_speed_save", { p_kind: "squares", p_score: 18 });
  const sb = await asB("cat_speed_save", { p_kind: "squares", p_score: 12 });
  assert.deepEqual(sb.map((r) => [r.name, r.best]), [["Asha", 18], ["Bilal", 12]]);
  await rejects(asA("cat_speed_save", { p_kind: "squares", p_score: 999 }), /out of range/);
  const badges = await asA("cat_badges", {});
  const mine = badges.find((b) => b.me).badges;
  for (const code of ["first-test", "first-mock", "slot-mock", "promise-kept", "hours-10"]) assert.ok(mine.includes(code), code);
  const heat = await asB("cat_heatmap", {});
  assert.equal(Object.values(heat.find((h) => h.name === "Asha").days)[0], 840);
  const admin = await asA("cat_admin_members", {});
  assert.equal(admin.code, "TEST-CODE");
  await rejects(asB("cat_admin_members", {}), /Only the group admin/);
  await asA("cat_admin_set_team", { p_name: "Bilal", p_team: "B" });
  await asA("cat_admin_set_code", { p_code: "NEW-CODE" });
  await rejects(asC("cat_join", { p_code: "TEST-CODE", p_name: "Chitra", p_slot: 3, p_pin: "1234" }), /code is wrong/);
  await asC("cat_join", { p_code: "new-code", p_name: "Chitra", p_slot: 3, p_pin: "1234" });
  const settings = await asC("cat_settings_set", { p_settings: { breakAfterMin: 5, sound: false, evil: "x", textSize: 200, waterEveryMin: 30 } });
  assert.deepEqual(settings.member.settings, { breakAfterMin: 20, sound: false, textSize: 130 });
  await asA("cat_admin_remove", { p_name: "Chitra" });
  assert.deepEqual(await asC("cat_me", {}), { member: null });
  await rejects(asA("cat_admin_remove", { p_name: "Asha" }), /Nobody else/);
});

// ---- added 14 Nov 2026 ----------------------------------------------------------------

const keyFile = (id) => JSON.parse(readFileSync(path.join(KEYS_DIR, `${id}.json`), "utf8"));

test("plan ticks, focus log, check-in, breaks, buddy, profile", async () => {
  let t = await asA("cat_plan_tick", { p_block: "qa-learn", p_done: true, p_total: 2 });
  assert.deepEqual(t.planTicks, ["qa-learn"]);
  await rejects(asA("cat_plan_tick", { p_block: "Bad Block!", p_done: true, p_total: 2 }), /Unknown block/);
  await asA("cat_plan_tick", { p_block: "walk", p_done: true, p_total: 2 });
  assert.ok((await asA("cat_badges", {})).find((b) => b.me).badges.includes("plan-day"), "every block ticked");
  t = await asA("cat_plan_tick", { p_block: "walk", p_done: false, p_total: 2 });
  assert.deepEqual(t.planTicks, ["qa-learn"]);
  t = await asA("cat_set_plan_text", { p_text: "  Ratio, then a DILR set  " });
  assert.equal(t.planText, "Ratio, then a DILR set");
  assert.equal((await asB("cat_promises", {})).find((p) => p.name === "Asha").ticks, 1);
  const log = await asA("cat_focus_log", {});
  assert.ok(log.length >= 1 && log.every((r) => r.minutes > 0));
  t = await asA("cat_checkin", { p_hours: 7.25, p_best: "Ratio 9/10", p_worst: "TSD", p_fix: "redo the TSD set" });
  assert.equal(t.checkin.fix, "redo the TSD set");
  assert.equal((await asA("cat_checkins", {}))[0].best, "Ratio 9/10");
  await rejects(asA("cat_checkin", { p_hours: 30, p_best: "", p_worst: "", p_fix: "" }), /0 to 16/);
  await asA("cat_break_log", { p_skipped: true });
  await asA("cat_break_log", { p_skipped: false });
  assert.deepEqual((await asA("cat_today", {})).breaks, { taken: 1, skipped: 1 });
  const me = await asB("cat_set_buddy", { p_name: "asha" });
  assert.equal(me.member.buddy, "Asha");
  assert.deepEqual((await asB("cat_buddy", {})).ticks, ["qa-learn"]);
  await rejects(asB("cat_set_buddy", { p_name: "Bilal" }), /someone else/);
  assert.equal((await asA("cat_set_rules", { p_text: "QA: two rounds." })).member.rules, "QA: two rounds.");
  await asA("cat_set_iims", { p_text: "IIM Indore, IIM Kozhikode" });
  assert.equal((await asB("cat_profiles", {})).find((p) => p.name === "Asha").iims, "IIM Indore, IIM Kozhikode");
});

test("admin notice and weekly goal", async () => {
  await rejects(asB("cat_admin_notice", { p_text: "x" }), /Only the group admin/);
  await asA("cat_admin_notice", { p_text: "Plan changed: ratio moves to Tuesday." });
  assert.equal((await asB("cat_today", {})).notice.text, "Plan changed: ratio moves to Tuesday.");
  await asA("cat_admin_notice", { p_text: "" });
  assert.equal((await asB("cat_today", {})).notice, null);
  const g = await asA("cat_admin_week_goal", { p_hours: 100 });
  assert.equal(g.goalHours, 100);
  assert.ok(g.doneMin >= 840);
});

test("mixed sets, readiness, error log, causes, hints, explanations", async () => {
  await rejects(asB("cat_compose", { p_kind: "mixed" }), /3 days after/);
  await asB("cat_topic_set", { p_topic: "qa-percentages", p_status: "learning" });
  await asB("cat_topic_set", { p_topic: "qa-ratio", p_status: "learning" });
  assert.ok((await asB("cat_progress", {})).starts["qa-ratio"]);
  await rejects(asB("cat_compose", { p_kind: "mixed" }), /3 days after/);
  await db.query("update private.topic_starts set at = now() - interval '4 days'");
  const set = await asB("cat_compose", { p_kind: "mixed" });
  assert.ok(set.questions.length >= 4 && set.questions.length <= 10, `${set.questions.length} questions`);
  assert.ok(set.questions.every((q) => /^practice2?-qa-(percentages|ratio)$/.test(q.src)), JSON.stringify(set.questions.map((q) => q.src)));
  assert.equal(new Set(set.questions.map((q) => q.topic)).size, 2, "both topics mixed in");
  assert.equal((await asB("cat_compose", { p_kind: "mixed" })).id, set.id, "one mixed set a day");
  await rejects(asA("cat_composed", { p_test_id: set.id }), /not made for you/);
  await rejects(asA("cat_submit", { p_attempt: { testId: set.id, questions: [] } }), /someone else/);

  const before = (await asB("cat_reviews", {})).upcoming;
  const answers = set.questions.map((q, i) => ({
    id: q.id, answer: i === 0 ? String(keyFile(q.src)[q.qid].answer) : null, status: i === 0 ? "answered" : "notAnswered",
    timeSpentSec: 40, visits: 1, conf: i === 0 ? "sure" : "maybe", atSec: 40,
  }));
  const rec = await asB("cat_submit", { p_attempt: { testId: set.id, clientAttemptId: "mix-b-1", startedAt: new Date().toISOString(), sections: [{ timeUsedSec: 300, endedBy: "submit" }], questions: answers } });
  assert.equal(rec.totals.correct, 1);
  assert.deepEqual([rec.questions[0].conf, rec.questions[1].conf, rec.questions[0].atSec], ["sure", null, 40]);
  assert.equal((await asB("cat_reviews", {})).upcoming, before + set.questions.length - 1, "misses join the queue under their source test");
  assert.equal((await asB("cat_board", { p_range: "week" })).rows.find((r) => r.me).tests, 2);
  assert.ok(!(await asB("cat_scores", {})).rows.find((r) => r.me).tests[set.id], "mixed sets stay off the scores table");
  if (new Date(Date.now() + 330 * 60000).getUTCDay() !== 0) await rejects(asB("cat_compose", { p_kind: "retest" }), /Sundays/);

  const ready = await asB("cat_readiness", {});
  const counted = (ready["qa-percentages"]?.total || 0) + (ready["qa-ratio"]?.total || 0);
  assert.ok(counted >= set.questions.length, "mixed-set questions count for their topics");
  const board = await asA("cat_topic_board", {});
  assert.ok(Object.keys(board.find((r) => r.name === "Bilal").topics).length >= 2);

  const errors = await asB("cat_errors", {});
  assert.ok(errors.some((e) => e.testId === set.id && e.inQueue));
  await asB("cat_cause_set", { p_test_id: set.id, p_question_id: set.questions[1].id, p_cause: "c3" });
  assert.equal((await asB("cat_errors", {})).find((e) => e.questionId === set.questions[1].id).cause, "c3");
  await rejects(asB("cat_cause_set", { p_test_id: set.id, p_question_id: set.questions[1].id, p_cause: "c9" }), /Unknown cause/);
  assert.deepEqual((await asB("cat_confidence", {})).sure, { right: 1, answered: 1 });
  assert.ok("hint" in (await asB("cat_hint", { p_test_id: set.id, p_question_id: set.questions[0].id })));
  await rejects(asA("cat_hint", { p_test_id: "practice-qa-ratio", p_question_id: "q1" }), /Submit this test first/);
  const ex = await asB("cat_explain", { p_test_id: set.id, p_question_id: set.questions[0].id, p_text: "Because one part is 80." });
  assert.equal(ex[set.questions[0].id], "Because one part is 80.");
  assert.ok((await asB("cat_search", { p_q: "one part" })).some((f) => f.kind === "explanation"));
  assert.ok(Array.isArray(await asB("cat_missed_easy", {})));
  assert.equal(typeof (await asB("cat_qtype_counts", {})), "object");
  const summary = await asB("cat_thread_summary", { p_test_id: "qa-basics-check" });
  assert.equal(typeof summary.questions.q1.medianSec, "number");
});

test("formula cards from memory", async () => {
  let r = await asA("cat_recall_mark", { p_card: "qa-ratio#0", p_ok: false });
  assert.deepEqual([r["qa-ratio#0"].stage, r["qa-ratio#0"].misses], [0, 1]);
  for (let i = 0; i < 3; i += 1) r = await asA("cat_recall_mark", { p_card: "qa-ratio#0", p_ok: true });
  assert.equal(r["qa-ratio#0"].cleared, true);
  await rejects(asA("cat_recall_mark", { p_card: "bad", p_ok: true }), /Unknown card/);
});

test("calendar, paper room, debriefs, spoilers, mock analysis", async () => {
  const today = (await asA("cat_today", {})).day;
  const add = (who, extra) => who("cat_calendar_add", { p_day: "2026-11-22", p_time: "09:00", p_title: "TIME AIMCAT", p_paper_id: null, p_kind: "paid", p_link: null, p_group: false, ...extra });
  await rejects(add(asB, { p_group: true }), /Only the group admin/);
  let cal = await asA("cat_admin_calendar_import", { p_items: [
    { day: "2026-11-15", time: "12:30", title: "CAT 2024 Slot 1", paper: "cat-2024-s1" },
    { day: "2026-11-18", time: "12:30", title: "CAT 2024 Slot 2", paper: "cat-2024-s2" }] });
  assert.equal(cal.length, 2);
  assert.equal((await asA("cat_admin_calendar_import", { p_items: [] })).length, 2, "the import runs once");
  cal = await add(asB, { p_link: "https://www.time4education.com/aimcats" });
  const mine = cal.find((c) => c.mine === true);
  assert.equal(mine.owner, "Bilal");
  await rejects(asA("cat_calendar_delete", { p_id: mine.id }), /Only its owner/);
  await rejects(add(asB, { p_link: "javascript:alert(1)" }), /https/);
  cal = await asA("cat_calendar_move", { p_id: cal[0].id, p_day: "2026-11-16", p_time: "12:30" });
  assert.equal(cal.find((c) => c.paper === "cat-2024-s1").day, "2026-11-16");
  await rejects(asB("cat_calendar_move", { p_id: cal[0].id, p_day: "2026-11-16", p_time: "12:30" }), /Only the group admin/);

  const room = await asA("cat_paper_progress", { p_paper_id: "cat-2024-s2", p_state: "dilr" });
  assert.deepEqual(room.map((r) => [r.name, r.state]), [["Asha", "dilr"]]);
  await rejects(asA("cat_paper_progress", { p_paper_id: "cat-2024-s2", p_state: "eating" }), /Unknown state/);

  const log = (who) => who("cat_mock_add", { p_taken_on: today, p_source: "CAT 2024 Slot 2", p_paper_id: "cat-2024-s2", p_varc: 18, p_dilr: 6, p_qa: 9, p_at_slot_time: false, p_analysis: {} });
  await log(asA);
  await asA("cat_chat_send", { p_text: "DILR set 2 was a trap", p_paper_id: "cat-2024-s2" });
  const hidden = (await asB("cat_chat", { p_after: 0 })).at(-1);
  assert.deepEqual([hidden.hidden, hidden.text], [true, ""]);
  assert.equal((await asA("cat_chat", { p_after: 0 })).at(-1).text, "DILR set 2 was a trap");
  assert.equal((await asB("cat_paper_posts", { p_paper_id: "cat-2024-s2" })).open, false);
  await rejects(asB("cat_paper_post", { p_paper_id: "cat-2024-s2", p_text: "hi" }), /Log this paper/);
  assert.equal((await asA("cat_paper_post", { p_paper_id: "cat-2024-s2", p_text: "Started with RC." })).posts.length, 1);
  await log(asB);
  assert.equal((await asB("cat_chat", { p_after: 0 })).at(-1).hidden, false);
  assert.equal((await asB("cat_paper_posts", { p_paper_id: "cat-2024-s2" })).posts.length, 1);

  const s2 = (await asA("cat_mocks", {})).find((m) => m.paperId === "cat-2024-s2");
  assert.equal(s2.analysedAt, null);
  const updated = (await asA("cat_mock_analysis", { p_mock_id: s2.id, p_analysis: {
    causes: { c4: 8 }, skip: ["Q5 DILR set 3", "", "x".repeat(200)], try: ["QA Q12"], resolve: 52, varcOrder: "rc", evil: 1 } }))
    .find((m) => m.id === s2.id);
  assert.ok(updated.analysedAt);
  assert.deepEqual(updated.analysis, { causes: { c4: 8 }, skip: ["Q5 DILR set 3", "x".repeat(120)], try: ["QA Q12"], resolve: 52, varcOrder: "rc" });
  await rejects(asB("cat_mock_analysis", { p_mock_id: s2.id, p_analysis: {} }), /No mock of yours/);
});

test("reports, RC log, budget, voice, whiteboard, co-solve", async () => {
  await asB("cat_report", { p_test_id: "qa-basics-check", p_question_id: "q3", p_text: "Two answers seem possible." });
  await rejects(asB("cat_report", { p_test_id: "qa-basics-check", p_question_id: "q99", p_text: "x" }), /not in this test/);
  const reps = await asA("cat_admin_reports", {});
  assert.equal(reps.length, 1);
  assert.deepEqual(await asA("cat_admin_report_resolve", { p_id: reps[0].id }), []);
  await rejects(asB("cat_admin_reports", {}), /Only the group admin/);

  const rc = await asA("cat_rc_log_add", { p_words: 520, p_seconds: 600, p_right: 3, p_total: 4, p_source: "CAT 2024 S1 RC 2" });
  assert.equal(rc[0].words, 520);
  await rejects(asA("cat_rc_log_add", { p_words: 520, p_seconds: 600, p_right: 5, p_total: 4, p_source: "" }), /Right answers/);
  assert.deepEqual(await asA("cat_rc_log_delete", { p_id: rc[0].id }), []);

  const spend = await asA("cat_spend_add", { p_item: "TIME AIMCAT pack", p_amount: 1499, p_day: null });
  assert.equal(spend[0].amount, 1499);
  assert.deepEqual(await asB("cat_spend", {}), [], "spending is private");
  assert.deepEqual(await asA("cat_spend_delete", { p_id: spend[0].id }), []);

  const audio = Buffer.alloc(3000, 7).toString("base64");
  const voice = (who, extra) => who("cat_voice_post", { p_test_id: "qa-basics-check", p_question_id: "q1", p_mime: "audio/webm;codecs=opus", p_data: audio, p_seconds: 10, ...extra });
  await rejects(voice(asA, { p_test_id: "practice-qa-ratio" }), /Submit this test first/);
  await rejects(voice(asA, { p_mime: "text/html" }), /not supported/);
  const voices = await voice(asA, {});
  assert.equal(voices.length, 1);
  assert.equal((await asB("cat_voice_get", { p_id: voices[0].id })).data, audio);

  const s1 = await asA("cat_stroke_add", { p_board: "set-dilr-tables-1", p_data: { color: "ink", width: 3, points: [[0.1, 0.2], [0.3, 0.4]] } });
  assert.equal((await asB("cat_strokes", { p_board: "set-dilr-tables-1", p_after: 0 })).length, 1);
  await asB("cat_stroke_add", { p_board: "set-dilr-tables-1", p_data: { clear: true } });
  assert.deepEqual((await asA("cat_strokes", { p_board: "set-dilr-tables-1", p_after: s1.id })).map((s) => s.data), [{ clear: true }]);
  await rejects(asA("cat_stroke_add", { p_board: "nope", p_data: {} }), /Unknown board/);

  const cs = await asA("cat_cosolve_create", { p_test_id: "practice-qa-ratio", p_partner: "Bilal", p_in_min: 2 });
  assert.equal(cs[0].partner, "Bilal");
  assert.equal((await asB("cat_cosolve", { p_id: cs[0].id })).testId, "practice-qa-ratio");
  await rejects(asA("cat_cosolve_create", { p_test_id: "practice-qa-ratio", p_partner: "Asha", p_in_min: 2 }), /someone else/);
});

test("streak saver, points history, export, nudge limit", async () => {
  await db.query(`insert into private.days (user_id, day, focus_min, sleep_min) values
    ($1, private.today() - 2, 90, null), ($1, private.today() - 1, 20, 400), ($1, private.today(), 130, null)
    on conflict (user_id, day) do update set focus_min = excluded.focus_min, sleep_min = excluded.sleep_min`, [B]);
  assert.equal((await asB("cat_today", {})).streak, 2, "a short day with sleep logged, then 2 hours, keeps the streak");
  await db.query("update private.days set sleep_min = null where user_id = $1 and day = private.today() - 1", [B]);
  assert.equal((await asB("cat_today", {})).streak, 1);

  const hist = await asA("cat_points_history", {});
  const week = (await asA("cat_board", { p_range: "week" })).rows.find((r) => r.me);
  assert.equal(hist.reduce((s, d) => s + d.points, 0), week.points, "the history adds up to the week");

  const dump = await asA("cat_admin_export", {});
  assert.ok(dump.members.length >= 2 && dump.attempts.length >= 1 && dump.planTicks.length >= 1);
  const text = JSON.stringify(dump);
  assert.ok(!text.includes("NEW-CODE") && !text.includes(key.q1.solution), "no group code or answer keys");
  await rejects(asB("cat_admin_export", {}), /Only the group admin/);

  if (!quiet) {
    const extra = [];
    for (const n of ["Dev", "Esha", "Farah"]) {
      const id = await createUser(db, `${n.toLowerCase()}@example.com`);
      await rpc(db, id, "cat_join", { p_code: "NEW-CODE", p_name: n, p_slot: 2, p_pin: "1234" });
      extra.push(n);
    }
    const sent = (await db.query("select count(*)::int n from private.nudges where from_user = $1 and day = private.today()", [A])).rows[0].n;
    for (const n of extra.slice(0, 3 - sent)) await asA("cat_nudge", { p_name: n });
    await rejects(asA("cat_nudge", { p_name: extra[2] }), /Three nudges a day|already/);
  }
});

test("profiles and PINs", async () => {
  const code = (await db.query("select value from private.config where key = 'join_code'")).rows[0].value;
  const D1 = await createUser(db); // a phone: a device account with no email
  const D2 = await createUser(db); // an iPad
  const on1 = (fn, args) => rpc(db, D1, fn, args);
  const on2 = (fn, args) => rpc(db, D2, fn, args);
  const focus = async (id) => (await db.query("select coalesce(sum(focus_min), 0)::int n from private.days where user_id = $1", [id])).rows[0].n;

  await rejects(on1("cat_join", { p_code: code, p_name: "Gita", p_slot: 2, p_pin: "12a4" }), /4 digits/);
  await rejects(on1("cat_join", { p_code: code, p_name: "Gita", p_slot: 2, p_pin: "12345" }), /4 digits/);
  await rejects(on1("cat_join", { p_code: "wrong", p_name: "Gita", p_slot: 2, p_pin: "4321" }), /group code is wrong/);
  await rejects(on1("cat_join", { p_code: code, p_name: "ASHA", p_slot: 2, p_pin: "4321" }), /already uses that name/);
  assert.equal((await on1("cat_join", { p_code: code, p_name: "Gita", p_slot: 2, p_pin: "4321" })).member.name, "Gita");
  const again = await on1("cat_join", { p_code: code, p_name: "Gita2", p_slot: 2, p_pin: "4321" });
  assert.equal(again.member.name, "Gita", "a repeat join from a linked device makes no second profile");

  await rejects(on2("cat_profile_list", { p_code: "wrong" }), /group code is wrong/);
  const list = await on2("cat_profile_list", { p_code: code });
  const g = list.find((p) => p.name === "Gita");
  assert.ok(g?.id, "the new profile is listed");
  assert.equal(list.find((p) => p.name === "Asha").isAdmin, true);
  assert.ok(!/pin/i.test(JSON.stringify(list)), "no PIN data in the list");
  assert.deepEqual(await on2("cat_me", {}), { member: null });
  await rejects(on2("cat_today", {}), /Pick your profile first/);
  await rejects(on2("cat_unlock", { p_code: code, p_id: g.id, p_pin: "0000" }), /PIN is wrong/);
  await rejects(on2("cat_unlock", { p_code: "wrong", p_id: g.id, p_pin: "4321" }), /group code is wrong/);
  assert.equal((await on2("cat_unlock", { p_code: code, p_id: g.id, p_pin: "4321" })).member.name, "Gita");

  await on2("cat_add_focus", { p_minutes: 25 });
  await on1("cat_add_focus", { p_minutes: 5 });
  assert.equal(await focus(g.id), 30, "both devices save to the same profile");

  assert.deepEqual(await on1("cat_lock", {}), { member: null });
  assert.deepEqual(await on1("cat_me", {}), { member: null });
  await rejects(on1("cat_today", {}), /Pick your profile first/);
  assert.equal((await on2("cat_me", {})).member.name, "Gita", "switching on one device leaves the other on the profile");

  // The same phone adds a second profile, then goes back to the first.
  assert.equal((await on1("cat_join", { p_code: code, p_name: "Hari", p_slot: 1, p_pin: "8642" })).member.name, "Hari");
  const hari = (await on1("cat_profile_list", { p_code: code })).find((p) => p.name === "Hari");
  assert.notEqual(hari.id, g.id);
  await on1("cat_lock", {});
  assert.equal((await on1("cat_unlock", { p_code: code, p_id: g.id, p_pin: "4321" })).member.name, "Gita");

  // A PIN change needs the old PIN. Only the admin resets someone else's.
  await rejects(on1("cat_change_pin", { p_old: "0000", p_new: "5555" }), /PIN is wrong/);
  await rejects(on1("cat_change_pin", { p_old: "4321", p_new: "55" }), /4 digits/);
  await on1("cat_change_pin", { p_old: "4321", p_new: "5555" });
  await on2("cat_lock", {});
  await rejects(on2("cat_unlock", { p_code: code, p_id: g.id, p_pin: "4321" }), /PIN is wrong/);
  await rejects(asB("cat_admin_reset_pin", { p_name: "Gita", p_pin: "9999" }), /Only the group admin/);
  await rejects(asA("cat_admin_reset_pin", { p_name: "Gita", p_pin: "99" }), /4 digits/);
  await asA("cat_admin_reset_pin", { p_name: "gita", p_pin: "9999" });
  assert.equal((await on2("cat_unlock", { p_code: code, p_id: g.id, p_pin: "9999" })).member.name, "Gita");
  assert.equal((await asA("cat_admin_members", {})).members.find((m) => m.name === "Gita").hasPin, true);
  assert.ok(!JSON.stringify(await asA("cat_admin_export", {})).includes("pin_hash"), "the backup has no PIN data");

  // Removing a profile takes every device off it.
  await asA("cat_admin_remove", { p_name: "Gita" });
  assert.deepEqual(await on1("cat_me", {}), { member: null });
  assert.deepEqual(await on2("cat_me", {}), { member: null });
});

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

const rejects = async (promise, pattern) => assert.rejects(promise, (err) => {
  assert.match(err.message, pattern);
  return true;
});

test("access rules", async () => {
  await rejects(rpc(db, null, "cat_me", {}), /permission denied/);
  assert.deepEqual(await asC("cat_me", {}), { member: null });
  await rejects(asC("cat_today", {}), /Join the group first/);
  await rejects(asA("cat_join", { p_code: "nope", p_name: "Asha", p_slot: 2 }), /group code is wrong/);
  const me = await asA("cat_join", { p_code: " test-code ", p_name: "Asha", p_slot: 2 });
  assert.equal(me.member.name, "Asha");
  assert.equal(me.member.isAdmin, true, "first member runs the group");
  await rejects(asB("cat_join", { p_code: "TEST-CODE", p_name: "asha", p_slot: 1 }), /already uses that name/);
  const b = await asB("cat_join", { p_code: "TEST-CODE", p_name: "Bilal", p_slot: 1 });
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
  t = await asA("cat_sleep", { p_hours: 7.5 });
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
  await asA("cat_set_goal", { p_score: 45, p_pct: 85 });
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
  assert.equal(a.points, 60 + 5 + 10 + 5 + 15 + 20 + 30 + 10 + 5 + 25 + 2);
  assert.equal(board.rows[0].name, "Asha");
  const last = await asB("cat_board", { p_range: "last" });
  assert.ok(last.rows.every((r) => r.points === 0));
  const byDate = await asB("cat_board", { p_range: board.from });
  assert.equal(byDate.rows[0].points, a.points);
});

test("chat, threads, votes, bookmarks", async () => {
  await asA("cat_chat_send", { p_text: "Morning all. @bilal you up?" });
  await asB("cat_chat_send", { p_text: "Yes" });
  const chat = await asA("cat_chat", { p_after: 0 });
  assert.deepEqual(chat.map((m) => m.name), ["Asha", "Bilal"]);
  const pulse = await asB("cat_pulse", { p_chat_after: 0, p_posts_after: 0 });
  assert.equal(pulse.chatNew, 1);
  assert.equal(pulse.mentions, 1);
  await asA("cat_chat_like", { p_message_id: chat[1].id, p_on: true });
  assert.equal((await asB("cat_chat", { p_after: 0 }))[1].likes, 1);
  await asB("cat_chat_delete", { p_message_id: chat[0].id });
  assert.equal((await asA("cat_chat", { p_after: 0 })).length, 2, "can't delete someone else's message");
  for (let i = 0; i < 14; i += 1) await asB("cat_chat_send", { p_text: `m${i}` });
  await rejects(asB("cat_chat_send", { p_text: "too many" }), /Slow down/);

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
  await rejects(asB("cat_nudge", { p_name: "Asha" }), /already studied today/);
  await asA("cat_nudge", { p_name: "bilal" });
  await asA("cat_nudge", { p_name: "bilal" });
  assert.equal((await asB("cat_today", {})).nudges.length, 1, "one nudge per person per day");
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
  await rejects(asC("cat_join", { p_code: "TEST-CODE", p_name: "Chitra", p_slot: 3 }), /code is wrong/);
  await asC("cat_join", { p_code: "new-code", p_name: "Chitra", p_slot: 3 });
  const settings = await asC("cat_settings_set", { p_settings: { breakAfterMin: 5, sound: false, evil: "x", textSize: 200, waterEveryMin: 30 } });
  assert.deepEqual(settings.member.settings, { breakAfterMin: 20, sound: false, textSize: 130 });
  await asA("cat_admin_remove", { p_name: "Chitra" });
  assert.deepEqual(await asC("cat_me", {}), { member: null });
  await rejects(asA("cat_admin_remove", { p_name: "Asha" }), /Nobody else/);
});

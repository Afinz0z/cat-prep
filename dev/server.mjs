// Local dev server: serves web/ and stands in for Supabase (sign-in and the
// database functions) on a throwaway in-memory Postgres. Nothing here is saved.
//   npm run dev                http://127.0.0.1:8790
//   npm run dev -- --demo      adds three made-up profiles with some activity
//   npm run dev -- --no-anon   acts as if anonymous sign-ins were off in Supabase
import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { createDb, createUser, rpc, RpcError, ROOT } from "./db.mjs";

const PORT = Number(process.env.PORT || 8790);
const WEB = path.join(ROOT, "web");
const JOIN_CODE = process.env.CAT_JOIN_CODE || "DEV-CODE";
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml",
};

const db = await createDb({ joinCode: JOIN_CODE });
const tokens = new Map(); // access token -> { userId, exp }
const refreshTokens = new Map(); // refresh token -> userId
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

function session(userId) {
  const access = randomBytes(16).toString("hex");
  const refresh = randomBytes(16).toString("hex");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  tokens.set(access, { userId, exp });
  refreshTokens.set(refresh, userId);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: { id: userId, is_anonymous: true } };
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body === undefined ? "" : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function caller(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  const t = tokens.get(m[1]);
  if (!t || t.exp * 1000 < Date.now()) return undefined;
  return t.userId;
}

// Only what the site uses: an anonymous sign-up (one per device) and token refresh.
const NO_ANON = process.argv.includes("--no-anon");

async function auth(req, res, url) {
  const body = req.method === "GET" ? {} : await readBody(req);
  const route = url.pathname.slice("/auth/v1/".length);
  if (route === "signup") {
    if (body.email || body.phone || body.password) return send(res, 422, { msg: "This dev server only makes anonymous device accounts." });
    if (NO_ANON) return send(res, 422, { code: 422, error_code: "anonymous_provider_disabled", msg: "Anonymous sign-ins are disabled" });
    return send(res, 200, session(await createUser(db)));
  }
  if (route === "token" && url.searchParams.get("grant_type") === "refresh_token") {
    const userId = refreshTokens.get(body.refresh_token);
    if (!userId) return send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token: Refresh Token Not Found" });
    refreshTokens.delete(body.refresh_token);
    return send(res, 200, session(userId));
  }
  return send(res, 404, { msg: "Not found" });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/auth/v1/")) return await auth(req, res, url);
    if (url.pathname.startsWith("/rest/v1/rpc/") && req.method === "POST") {
      const userId = caller(req);
      if (userId === undefined) return send(res, 401, { code: "PGRST301", message: "JWT expired" });
      const args = await readBody(req);
      const fn = url.pathname.slice("/rest/v1/rpc/".length);
      try {
        const out = await serial(() => rpc(db, userId, fn, args));
        return send(res, 200, out);
      } catch (err) {
        if (err instanceof RpcError) return send(res, err.status, { code: err.code, message: err.message });
        throw err;
      }
    }
    if (DEMO && url.pathname === "/tests/dev-sample.json") return send(res, 200, JSON.stringify(SAMPLE), TYPES[".json"]);
    if (DEMO && url.pathname === "/tests/index.json") {
      const index = JSON.parse(await readFile(path.join(WEB, "tests", "index.json"), "utf8"));
      const s = SAMPLE.sections[0];
      index.unshift({ id: SAMPLE.id, title: SAMPLE.title, kind: SAMPLE.kind, source: SAMPLE.source, sections: [{ name: s.name, minutes: s.minutes, count: s.questions.length }] });
      return send(res, 200, JSON.stringify(index), TYPES[".json"]);
    }
    if (url.pathname === "/js/config.js") {
      return send(res, 200, `export const SUPABASE_URL = "http://${req.headers.host}";\nexport const SUPABASE_KEY = "dev-publishable-key";\n`, TYPES[".js"]);
    }
    let file = path.normalize(path.join(WEB, decodeURIComponent(url.pathname)));
    if (!file.startsWith(WEB)) return send(res, 403, "Forbidden", "text/plain");
    if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
    const data = await readFile(file).catch(() => null);
    if (!data) return send(res, 404, "Not found", "text/plain");
    return send(res, 200, data, TYPES[path.extname(file)] || "application/octet-stream");
  } catch (err) {
    console.error(err);
    return send(res, 500, { message: String(err.message || err) });
  }
}

async function demo() {
  const people = [["Asha", 2, "1111"], ["Bilal", 1, "2222"], ["Chitra", 3, "3333"]];
  for (const [name, slot, pin] of people) {
    const id = await createUser(db);
    await rpc(db, id, "cat_join", { p_code: JOIN_CODE, p_name: name, p_slot: slot, p_pin: pin });
    await rpc(db, id, "cat_set_target", { p_minutes: 240 + slot * 60 });
    for (let i = 0; i < slot; i += 1) await rpc(db, id, "cat_add_focus", { p_minutes: 50 });
    await rpc(db, id, "cat_sleep", { p_hours: 6 + slot / 2, p_bed: "23:00", p_wake: slot === 2 ? "06:30" : "07:00" });
    await rpc(db, id, "cat_chat_send", { p_text: `${name} here, starting with percentages.`, p_paper_id: null });
    if (slot === 2) await rpc(db, id, "cat_presence", { p_mode: "focus", p_minutes: 40 });
  }
  console.log("Demo profiles: Asha (PIN 1111), Bilal (2222) and Chitra (3333). Asha runs the group.");
}

// A throwaway test for clicking through the exam and results screens without
// opening a real Daily 5 or practice set. Served only with --demo.
const DEMO = process.argv.includes("--demo");
const SAMPLE = JSON.parse(await readFile(path.join(ROOT, "dev", "sample-test.json"), "utf8"));
const SAMPLE_KEY = {
  q1: { answer: "B", solution: "15% of 80 = 0.15 × 80 = 12." },
  q2: { answer: "B", solution: "3 + 5 = 8 parts, so one part is 160 ÷ 8 = 20. The smaller share is 3 × 20 = 60." },
  q3: { answer: 56, solution: "7 × 8 = 56." },
  q4: { answer: 8, solution: "(4 + 8 + 12) ÷ 3 = 24 ÷ 3 = 8." },
};

if (DEMO) {
  const sections = SAMPLE.sections.map((s) => ({ name: s.name, minutes: s.minutes, questions: s.questions.map((q) => ({ id: q.id, type: q.type })) }));
  await db.query(
    "insert into private.tests (test_id, title, sections, key) values ($1, $2, $3::jsonb, $4::jsonb) on conflict (test_id) do nothing",
    [SAMPLE.id, SAMPLE.title, JSON.stringify(sections), JSON.stringify(SAMPLE_KEY)]);
  await demo();
}
http.createServer(handle).listen(PORT, "127.0.0.1", () => {
  console.log(`CAT prep dev server on http://127.0.0.1:${PORT} (group code ${JOIN_CODE})`);
});

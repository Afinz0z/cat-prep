// Talks to Supabase: this device's sign-in and the cat_* database functions.
// Each device signs itself in with an anonymous Supabase account (no email or
// password), then a profile's PIN puts the device on that profile.
// Only the publishable key lives in the browser. Every table is private, and
// each function checks who is calling, so the key alone can read nothing.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const SESSION_KEY = "cat-session";
let session = readSession();
let refreshing = null;

export class DbError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(s) {
  session = s && s.access_token ? {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
  } : null;
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private window: the session lasts for this tab only */
  }
}

export const configured = () => Boolean(SUPABASE_URL && SUPABASE_KEY);
export const signedIn = () => Boolean(session?.access_token);

const FRIENDLY = [
  [/anonymous sign-?ins are disabled|anonymous_provider_disabled/i,
    "The database doesn't let devices sign in yet. Whoever runs the group has to turn on \"Allow anonymous sign-ins\" in Supabase, under Authentication, Sign In / Providers."],
  [/rate limit|too many/i, "Too many tries in a short time. Wait a minute and try again."],
  [/permission denied for function|jwt|not authenticated/i, "Sign in first."],
  [/Could not find the function/i, "The site and the database are out of step. Tell whoever runs the group."],
];

function friendly(message) {
  for (const [pattern, text] of FRIENDLY) if (pattern.test(message)) return text;
  return message;
}

async function request(path, { method = "POST", body, auth = false } = {}) {
  if (!configured()) throw new DbError("The site isn't connected to its database yet.", 0, "config");
  const headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (auth && session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  let res;
  try {
    res = await fetch(SUPABASE_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new DbError("No connection to the site's database. Check your internet and try again.", 0, "offline");
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const raw = data?.message || data?.msg || data?.error_description || data?.error || `The database answered ${res.status}.`;
    throw new DbError(friendly(String(raw)), res.status, data?.code || data?.error_code || "");
  }
  return data;
}

// ---- this device's sign-in -------------------------------------------------------
// Sign-ins stay on the device that made them: the session lives only in this
// browser's storage and is never shared with another device. A sign-up with
// no email or password is Supabase's anonymous sign-in.
export async function startDevice() {
  saveSession(null);
  saveSession(await request("/auth/v1/signup", { body: {} }));
}

async function refresh() {
  // Another tab may have refreshed already; its token is the one that still works.
  const latest = readSession();
  if (latest?.access_token && latest.access_token !== session?.access_token && latest.expires_at * 1000 - Date.now() > 60000) {
    session = latest;
    return;
  }
  const token = latest?.refresh_token || session?.refresh_token;
  if (!token) {
    saveSession(null);
    throw new DbError("This device was signed out. Reload the page and pick your profile again.", 401);
  }
  try {
    saveSession(await request("/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: token } }));
  } catch (err) {
    if (err.status === 400 || err.status === 401) saveSession(null);
    throw err.status === 400 ? new DbError("This device was signed out. Reload the page and pick your profile again.", 401) : err;
  }
}

async function ensureFresh() {
  if (!session) return;
  if (session.expires_at * 1000 - Date.now() > 60000) return;
  refreshing = refreshing || refresh().finally(() => { refreshing = null; });
  await refreshing;
}

// ---- database functions ------------------------------------------------------
export async function rpc(fn, args = {}) {
  await ensureFresh();
  try {
    return await request(`/rest/v1/rpc/${fn}`, { body: args, auth: true });
  } catch (err) {
    if (err.status === 401 && session) {
      await refresh();
      return request(`/rest/v1/rpc/${fn}`, { body: args, auth: true });
    }
    throw err;
  }
}

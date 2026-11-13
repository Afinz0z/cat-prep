// Talks to Supabase: email sign-in and the cat_* database functions.
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
    email: s.user?.email || s.email || session?.email || "",
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
export const signedInEmail = () => session?.email || "";

const FRIENDLY = [
  [/invalid login credentials/i, "That email and password don't match. Check both, or reset the password."],
  [/user already registered|already been registered/i, "That email already has an account. Sign in instead."],
  [/password should be at least/i, "Use a password of at least 8 characters."],
  [/email not confirmed/i, "Confirm your email first: open the link Supabase sent you, then sign in."],
  [/unable to validate email|invalid email/i, "That doesn't look like an email address."],
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

// ---- auth ------------------------------------------------------------------
export async function signUp(email, password) {
  const data = await request("/auth/v1/signup", { body: { email, password } });
  if (data?.access_token) {
    saveSession(data);
    return { signedIn: true };
  }
  // Email confirmation is switched on in Supabase: no session until the link is opened.
  return { signedIn: false };
}

export async function signIn(email, password) {
  saveSession(await request("/auth/v1/token?grant_type=password", { body: { email, password } }));
}

// Sign-ins stay on the device that made them: the session lives only in this
// browser's storage, and signing out ends this device's session alone
// (scope=local), never the ones on your other devices.
export async function signOut() {
  try {
    if (session) await request("/auth/v1/logout?scope=local", { auth: true });
  } catch {
    /* signed out locally either way */
  }
  saveSession(null);
}

export async function sendReset(email) {
  const back = encodeURIComponent(location.origin + location.pathname.replace(/[^/]*$/, ""));
  await request(`/auth/v1/recover?redirect_to=${back}`, { body: { email } });
}

export async function setPassword(password) {
  await ensureFresh();
  await request("/auth/v1/user", { method: "PUT", body: { password }, auth: true });
}

// A password-reset link lands with the session in the address bar's #fragment.
export function takeRecoveryFromUrl() {
  if (!location.hash.includes("access_token=")) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  saveSession({
    access_token: p.get("access_token"),
    refresh_token: p.get("refresh_token"),
    expires_in: Number(p.get("expires_in")) || 3600,
  });
  history.replaceState(null, "", location.pathname + location.search);
  return p.get("type") === "recovery";
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
    throw new DbError("Sign in again.", 401);
  }
  try {
    saveSession(await request("/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: token } }));
  } catch (err) {
    if (err.status === 400 || err.status === 401) saveSession(null);
    throw err.status === 400 ? new DbError("Your sign-in expired. Sign in again.", 401) : err;
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

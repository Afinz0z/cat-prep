// A local stand-in for the Supabase database, for tests and the dev server.
// It runs real Postgres (PGlite) with the same schema, plus the small parts of
// Supabase the schema relies on: the anon and authenticated roles and auth.uid().
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
export const KEYS_DIR = process.env.CAT_KEYS_DIR || path.resolve(ROOT, "..", "private", "keys");

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password text not null,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public to anon, authenticated;
`;

function privateSql(joinCode) {
  if (!existsSync(KEYS_DIR)) throw new Error(`Answer keys not found in ${KEYS_DIR}`);
  const python = process.platform === "win32" ? "python" : "python3";
  return execFileSync(python, [path.join(ROOT, "tools", "build_private_sql.py"), "--code", joinCode, "--keys", KEYS_DIR], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
}

export async function createDb({ joinCode = "DEV-CODE" } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(readFileSync(path.join(ROOT, "supabase", "schema.sql"), "utf8"));
  await db.exec(privateSql(joinCode));
  return db;
}

export async function createUser(db, email, password = "secret-pass") {
  const r = await db.query("insert into auth.users (email, password) values ($1, $2) returning id", [email.toLowerCase(), password]);
  return r.rows[0].id;
}

const signatures = new Map();

async function signature(db, fn) {
  if (signatures.has(fn)) return signatures.get(fn);
  const r = await db.query(
    `select p.proargnames as names,
            array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = $1`,
    [fn],
  );
  const sig = r.rows[0] ? { names: r.rows[0].names || [], types: r.rows[0].types || [] } : null;
  signatures.set(fn, sig);
  return sig;
}

export class RpcError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Call a public function the way PostgREST does: named arguments, which must
// match the function's parameters exactly, as the given user (or anon).
export async function rpc(db, userId, fn, args = {}) {
  const sig = /^cat_[a-z_]+$/.test(fn) ? await signature(db, fn) : null;
  const given = Object.keys(args).sort();
  if (!sig || given.join(",") !== [...sig.names].sort().join(",")) {
    throw new RpcError(404, `Could not find the function public.${fn}(${given.join(", ")})`, "PGRST202");
  }
  const params = [];
  const parts = sig.names.map((name, i) => {
    const type = sig.types[i];
    const value = args[name];
    params.push(value === null || value === undefined ? null : type === "jsonb" || type === "json" ? JSON.stringify(value) : String(value));
    return `${name} => $${params.length}::${type}`;
  });
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`set local role ${userId ? "authenticated" : "anon"}`);
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId || ""]);
      const r = await tx.query(`select public.${fn}(${parts.join(", ")}) as r`, params);
      return r.rows[0].r;
    });
  } catch (err) {
    if (err instanceof RpcError) throw err;
    const code = err.code || "";
    const status = code === "42501" ? (userId ? 403 : 401) : 400;
    throw new RpcError(status, err.message, code);
  }
}

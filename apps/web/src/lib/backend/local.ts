/**
 * Local backend: the real database (all migrations + demo seed) running in the browser with PGlite.
 * - The database comes pre-built from /demo-db/<version>.tar.gz (scripts/build-demo-db.mjs) and is kept in IndexedDB.
 * - RPCs run exactly as in Supabase: role anon/authenticated/service_role + request.jwt.claims, so RLS and every
 *   authorisation check are the real ones.
 * - Auth is emulated against auth.users (bcrypt via pgcrypto); magic links are shown in the UI instead of e-mailed.
 * - Edge Functions are emulated in `localFunctions` with the same mock adapters the server uses in DEMO_MODE.
 */
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { ApiError, fromPgError } from "./errors";
import { localFunctions } from "./localFunctions";
import { idbDelete, idbGet, idbPut } from "./idb";
import { totpVerify, randomBase32 } from "./totp";
import type { Backend, Session } from "./types";

declare const __DEMO_DB_VERSION__: string;

const SESSION_KEY = "maskinid.local.session";
const MFA_KEY = "maskinid.local.mfa";

type Role = "anon" | "authenticated" | "service_role";
interface FnSig {
  names: string[];
  types: string[];
}

export interface LocalContext {
  session(): Session | null;
  rpcAs<T>(role: Role, fn: string, args: Record<string, unknown>): Promise<T>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function pgArrayLiteral(items: unknown[]): string {
  return `{${items.map((x) => (x === null ? "NULL" : `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",")}}`;
}

function toParam(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  if (type === "jsonb" || type === "json") return JSON.stringify(v);
  if (type.endsWith("[]")) return Array.isArray(v) ? pgArrayLiteral(v) : v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

const READY_KEY = `maskinid.local.ready.${__DEMO_DB_VERSION__}`;
const IDB_NAME = `/pglite/maskinid-${__DEMO_DB_VERSION__}`;

function deleteIdb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

function readyMarker(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Opens the browser database. The first time, the prebuilt demo data directory is loaded and flushed completely to
 * IndexedDB; a marker in localStorage records that the copy is complete. Without the marker any partial copy is
 * discarded, so an interrupted first load never leaves an empty or half-written database behind.
 */
async function openDatabase(): Promise<PGlite> {
  const [{ PGlite }, { pgcrypto }, { pg_trgm }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/pgcrypto"),
    import("@electric-sql/pglite/contrib/pg_trgm"),
  ]);
  const extensions = { pgcrypto, pg_trgm };
  const dataDir = `idb://maskinid-${__DEMO_DB_VERSION__}`;
  if (readyMarker()) {
    try {
      const existing = new PGlite(dataDir, { extensions });
      await existing.waitReady;
      const r = await existing.query<{ ok: boolean }>("select to_regclass('public.machines') is not null as ok");
      if (r.rows[0]?.ok) return existing;
      await existing.close();
    } catch {
      /* fall through to a fresh load */
    }
  }
  const res = await fetch(`${import.meta.env.BASE_URL}demo-db/maskinid-${__DEMO_DB_VERSION__}.tar.gz`);
  if (!res.ok) throw new ApiError("DEMO_DB_MISSING", { status: res.status }, 500);
  const blob = await res.blob();
  try {
    await deleteIdb(IDB_NAME);
    const db = new PGlite(dataDir, { extensions, loadDataDir: blob });
    await db.waitReady;
    await db.syncToFs();
    try {
      localStorage.setItem(READY_KEY, "1");
    } catch {
      /* private mode: the database still works for this tab */
    }
    return db;
  } catch {
    // IndexedDB unavailable (private mode): keep the database in memory for this tab.
    const db = new PGlite({ extensions, loadDataDir: blob });
    await db.waitReady;
    return db;
  }
}

export function createLocalBackend(): Backend {
  let dbPromise: Promise<PGlite> | null = null;
  const db = () => (dbPromise ??= openDatabase());
  const listeners = new Set<(s: Session | null) => void>();
  const sigs = new Map<string, FnSig>();
  let session = readSession();

  function setSession(s: Session | null) {
    session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    for (const l of listeners) l(s);
  }

  async function signature(fn: string): Promise<FnSig> {
    const cached = sigs.get(fn);
    if (cached) return cached;
    const r = await (await db()).query<{ names: string[] | null; types: string[] }>(
      `select p.proargnames as names, array(select format_type(t, null) from unnest(p.proargtypes) t) as types
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1`,
      [fn],
    );
    const row = r.rows[0];
    if (!row) throw new ApiError("UNKNOWN_FUNCTION", { fn }, 404);
    const sig = { names: row.names ?? [], types: row.types };
    sigs.set(fn, sig);
    return sig;
  }

  async function withRole<T>(role: Role, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const d = await db();
    const result = await d.transaction(async (tx) => {
      const claims = role === "authenticated" && session
        ? { sub: session.userId, role: "authenticated", email: session.email, aal: session.aal ?? "aal1" }
        : { role };
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      await tx.query("select set_config('request.headers', '{}', true)");
      await tx.exec(`set local role ${role}`);
      return fn(tx);
    });
    // Flush to IndexedDB before resolving so a write survives an immediate page reload.
    await d.syncToFs();
    return result;
  }

  async function rpcAs<T>(role: Role, fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const sig = await signature(fn);
    const keys = Object.keys(args).filter((k) => args[k] !== undefined);
    const params: unknown[] = [];
    const list = keys.map((k, i) => {
      const idx = sig.names.indexOf(k);
      if (idx < 0) throw new ApiError("UNKNOWN_ARGUMENT", { fn, arg: k }, 400);
      const type = sig.types[idx]!;
      params.push(toParam(args[k], type));
      return `${k} => $${i + 1}::${type}`;
    });
    try {
      return await withRole(role, async (tx) => {
        const r = await tx.query<{ r: T }>(`select public.${fn}(${list.join(", ")}) as r`, params);
        return r.rows[0]!.r;
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw fromPgError(e as { message: string; code?: string; detail?: string });
    }
  }

  const ctx: LocalContext = {
    session: () => session,
    rpcAs,
    async query<T>(sql: string, params: unknown[] = []) {
      return (await (await db()).query<T>(sql, params)).rows;
    },
  };
  // e2e hook (step 27): lets Playwright read the in-browser database to assert results (e-mail queued, events …).
  // Only in the Vite dev server – production builds (import.meta.env.DEV = false) drop this branch entirely.
  if (import.meta.env.DEV && typeof window !== "undefined") {
    (window as unknown as { __maskinidTest?: unknown }).__maskinidTest = { query: ctx.query, rpcAs };
  }

  async function createSession(userId: string, email: string): Promise<Session> {
    // Like Supabase: a password/link sign-in is aal1; verifying a TOTP code (mfa.verify) raises the session to aal2.
    const s: Session = { userId, email, aal: "aal1" };
    await ctx.query("update auth.users set last_sign_in_at = now() where id = $1", [userId]);
    setSession(s);
    return s;
  }

  function readMfa(): Record<string, { factorId: string; secret: string; verified: boolean }> {
    try {
      return JSON.parse(localStorage.getItem(MFA_KEY) ?? "{}");
    } catch {
      return {};
    }
  }
  function writeMfa(v: Record<string, { factorId: string; secret: string; verified: boolean }>) {
    localStorage.setItem(MFA_KEY, JSON.stringify(v));
  }

  return {
    kind: "local",
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      return rpcAs<T>(session ? "authenticated" : "anon", fn, args);
    },
    async invoke<T>(fn: string, body?: unknown, opts = {}) {
      const handler = localFunctions[fn];
      if (!handler) throw new ApiError("UNKNOWN_FUNCTION", { fn }, 404);
      return (await handler(ctx, body, opts)) as T;
    },
    auth: {
      async getSession() {
        // Without a stored session there is nothing to validate: public pages do not wait for the database to boot.
        if (!session) return null;
        await db();
        return session;
      },
      async signInWithPassword(email, password) {
        const rows = await ctx.query<{ id: string; email: string }>(
          "select id, email from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)",
          [email.trim(), password],
        );
        if (!rows[0]) throw new ApiError("INVALID_CREDENTIALS", undefined, 401);
        return createSession(rows[0].id, rows[0].email);
      },
      async signUp(email, password, meta) {
        const e = email.trim().toLowerCase();
        const exists = await ctx.query("select 1 from auth.users where lower(email) = $1", [e]);
        if (exists.length) throw new ApiError("EMAIL_IN_USE", undefined, 400);
        if (password.length < 8) throw new ApiError("WEAK_PASSWORD", undefined, 400);
        const rows = await ctx.query<{ id: string }>(
          `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
           values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1,
                   extensions.crypt($2, extensions.gen_salt('bf', 6)), now(), $3) returning id`,
          [e, password, JSON.stringify(meta)],
        );
        return { session: await createSession(rows[0]!.id, e) };
      },
      async signInWithOtp(email, redirectTo) {
        const e = email.trim().toLowerCase();
        let rows = await ctx.query<{ id: string }>("select id from auth.users where lower(email) = $1", [e]);
        if (!rows[0]) {
          rows = await ctx.query<{ id: string }>(
            `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at) values
             ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, now()) returning id`,
            [e],
          );
        }
        const token = crypto.randomUUID();
        sessionStorage.setItem(`maskinid.link.${token}`, JSON.stringify({ id: rows[0]!.id, email: e, exp: Date.now() + 3600_000 }));
        const url = new URL(redirectTo);
        url.searchParams.set("demo_link", token);
        return { demoLink: url.toString() };
      },
      async completeLink(params) {
        const token = params.get("demo_link");
        if (!token) return session;
        const raw = sessionStorage.getItem(`maskinid.link.${token}`);
        if (!raw) throw new ApiError("LINK_INVALID", undefined, 401);
        sessionStorage.removeItem(`maskinid.link.${token}`);
        const v = JSON.parse(raw) as { id: string; email: string; exp: number };
        if (v.exp < Date.now()) throw new ApiError("LINK_EXPIRED", undefined, 401);
        return createSession(v.id, v.email);
      },
      async signOut() {
        setSession(null);
      },
      onChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      mfa: {
        async enroll() {
          if (!session) throw new ApiError("NOT_AUTHENTICATED", undefined, 401);
          const secret = randomBase32(20);
          const all = readMfa();
          const factorId = crypto.randomUUID();
          all[session.userId] = { factorId, secret, verified: false };
          writeMfa(all);
          const uri = `otpauth://totp/MaskinID:${encodeURIComponent(session.email)}?secret=${secret}&issuer=MaskinID`;
          return { factorId, qr: uri, secret };
        },
        async verify(factorId, code) {
          if (!session) throw new ApiError("NOT_AUTHENTICATED", undefined, 401);
          const all = readMfa();
          const f = all[session.userId];
          if (!f || f.factorId !== factorId || !(await totpVerify(f.secret, code))) throw new ApiError("MFA_INVALID_CODE", undefined, 400);
          all[session.userId] = { ...f, verified: true };
          writeMfa(all);
          setSession({ ...session, aal: "aal2" });
        },
        async list() {
          const f = session ? readMfa()[session.userId] : undefined;
          return f ? [{ id: f.factorId, status: f.verified ? "verified" : "unverified" }] : [];
        },
        async unenroll() {
          if (!session) return;
          const all = readMfa();
          delete all[session.userId];
          writeMfa(all);
          setSession({ ...session, aal: "aal1" });
        },
      },
    },
    storage: {
      async upload(bucket, path, file, contentType) {
        await idbPut(`${bucket}/${path}`, { blob: file, contentType });
      },
      publicUrl(bucket, path) {
        return `local-storage://${bucket}/${path}`;
      },
      async localObjectUrl(bucket, path) {
        const v = await idbGet<{ blob: Blob }>(`${bucket}/${path}`);
        return v ? URL.createObjectURL(v.blob) : null;
      },
    },
    async reset() {
      const d = await db();
      await d.close();
      dbPromise = null;
      sigs.clear();
      setSession(null);
      try {
        localStorage.removeItem(READY_KEY);
      } catch {
        /* ignore */
      }
      await deleteIdb(IDB_NAME);
      await idbDelete("*");
    },
  };
}

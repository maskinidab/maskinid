import pg from "pg";
import { afterAll, inject } from "vitest";
import { USERS, type UserKey } from "./fixtures.ts";

export { USERS, ORGS, type UserKey, type OrgKey } from "./fixtures.ts";

const pool = new pg.Pool({ connectionString: inject("dbUrl"), max: 4 });
afterAll(async () => {
  await pool.end();
});

export interface AppError {
  code: string; // application code (e.g. FORBIDDEN) or the Postgres message
  sqlstate: string;
  detail: unknown;
}

export class Tx {
  constructor(readonly client: pg.PoolClient) {}

  /** Act as a fixture user (authenticated), anon, service_role, or the database owner (null). */
  async as(who: UserKey | "anon" | "service" | null, opts: { apiKeyId?: string } = {}) {
    await this.client.query("reset role");
    await this.client.query("select set_config('request.jwt.claims', '', true), set_config('request.headers', '', true)");
    if (who === null) return this;
    if (who === "anon") {
      await this.client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "anon" })]);
      await this.client.query("set local role anon");
    } else if (who === "service") {
      await this.client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
      if (opts.apiKeyId) {
        await this.client.query("select set_config('request.headers', $1, true)", [
          JSON.stringify({ "x-maskinid-api-key-id": opts.apiKeyId }),
        ]);
      }
      await this.client.query("set local role service_role");
    } else {
      const sub = USERS[who];
      await this.client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub, role: "authenticated", aal: "aal2" }),
      ]);
      await this.client.query("set local role authenticated");
    }
    return this;
  }

  async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.client.query(sql, params)).rows as T[];
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.q<T>(sql, params);
    return rows[0] as T;
  }

  async val<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
    const r = (await this.client.query({ text: sql, values: params, rowMode: "array" })).rows[0];
    return (r ? r[0] : undefined) as T;
  }

  /** Calls public.<fn>(name => value, ...) and returns the scalar result. */
  async rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const keys = Object.keys(args);
    const params = keys.map((k) => normalizeParam(args[k]));
    const list = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
    return this.val<T>(`select public.${fn}(${list})`, params);
  }

  /** Runs fn inside a savepoint and returns the error it raised (or throws if it did not raise). */
  async error(fn: () => Promise<unknown>): Promise<AppError> {
    await this.client.query("savepoint expect_error");
    try {
      await fn();
    } catch (e) {
      await this.client.query("rollback to savepoint expect_error");
      const err = e as { message: string; code: string; detail?: string };
      let detail: unknown = err.detail;
      try {
        detail = err.detail ? JSON.parse(err.detail) : undefined;
      } catch {
        /* keep string */
      }
      return { code: err.message, sqlstate: err.code, detail };
    }
    await this.client.query("release savepoint expect_error");
    throw new Error("expected an error but the call succeeded");
  }

  async rpcError(fn: string, args: Record<string, unknown> = {}): Promise<AppError> {
    return this.error(() => this.rpc(fn, args));
  }
}

function normalizeParam(v: unknown): unknown {
  if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v);
  return v;
}

/** Runs fn in a transaction that is always rolled back, so tests never leak state. */
export async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  await client.query("begin");
  try {
    return await fn(new Tx(client));
  } finally {
    await client.query("rollback");
    client.release();
  }
}

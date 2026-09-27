/** Minimal PostgREST RPC client for the service role (no supabase-js dependency in the worker). */
export type Rpc = <T = unknown>(fn: string, args: Record<string, unknown>) => Promise<T>;

export class RpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function serviceRpc(url: string, serviceKey: string, f: typeof fetch = fetch): Rpc {
  return async <T>(fn: string, args: Record<string, unknown>) => {
    const res = await f(`${url.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      // app.raise puts the machine code in the message (ADR 0007).
      const code = typeof body?.message === "string" ? body.message.split(":")[0] : `HTTP_${res.status}`;
      throw new RpcError(code, body?.message ?? text);
    }
    return body as T;
  };
}

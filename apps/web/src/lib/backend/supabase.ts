import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError, fromPgError } from "./errors";
import type { Backend, InvokeOptions, Session } from "./types";

function toSession(s: { user: { id: string; email?: string }; access_token: string } | null): Session | null {
  if (!s) return null;
  let aal: "aal1" | "aal2" | undefined;
  try {
    aal = JSON.parse(atob(s.access_token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))).aal;
  } catch {
    aal = undefined;
  }
  return { userId: s.user.id, email: s.user.email ?? "", aal };
}

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return {
    kind: "supabase",
    async rpc(fn, args = {}) {
      const { data, error } = await sb.rpc(fn, args);
      if (error) throw fromPgError(error);
      return data;
    },
    async invoke<T>(fn: string, body?: unknown, opts: InvokeOptions = {}) {
      const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
      const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
      const session = (await sb.auth.getSession()).data.session;
      headers.Authorization = `Bearer ${!opts.anonymous && session ? session.access_token : key}`;
      const res = await fetch(`${url}/functions/v1/${fn}${qs}`, {
        method: opts.method ?? (body === undefined ? "GET" : "POST"),
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(payload.code ?? "UNKNOWN", payload.detail ?? payload, res.status);
      return payload as T;
    },
    auth: {
      async getSession() {
        return toSession((await sb.auth.getSession()).data.session);
      },
      async signInWithPassword(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error || !data.session) throw new ApiError("INVALID_CREDENTIALS", error?.message, 401);
        return toSession(data.session)!;
      },
      async signUp(email, password, meta) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: meta, emailRedirectTo: `${location.origin}/auth/callback` } });
        if (error) throw new ApiError(error.message.includes("registered") ? "EMAIL_IN_USE" : "SIGNUP_FAILED", error.message, 400);
        return { session: toSession(data.session) };
      },
      async signInWithOtp(email, redirectTo) {
        const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
        if (error) throw new ApiError("OTP_FAILED", error.message, 400);
        return {};
      },
      async completeLink() {
        return toSession((await sb.auth.getSession()).data.session);
      },
      async signOut() {
        await sb.auth.signOut();
      },
      onChange(cb) {
        const { data } = sb.auth.onAuthStateChange((_e, s) => cb(toSession(s)));
        return () => data.subscription.unsubscribe();
      },
      mfa: {
        async enroll() {
          const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp" });
          if (error) throw new ApiError("MFA_FAILED", error.message);
          return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
        },
        async verify(factorId, code) {
          const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId });
          if (e1) throw new ApiError("MFA_FAILED", e1.message);
          const { error } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code });
          if (error) throw new ApiError("MFA_INVALID_CODE", error.message);
        },
        async list() {
          const { data } = await sb.auth.mfa.listFactors();
          return (data?.totp ?? []).map((f) => ({ id: f.id, status: f.status }));
        },
        async unenroll(factorId) {
          await sb.auth.mfa.unenroll({ factorId });
        },
      },
    },
    storage: {
      async upload(bucket, path, file, contentType) {
        const { error } = await sb.storage.from(bucket).upload(path, file, { contentType, upsert: false });
        if (error) throw new ApiError("UPLOAD_FAILED", error.message);
      },
      publicUrl(bucket, path) {
        return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      },
    },
  };
}

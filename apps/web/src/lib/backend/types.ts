/**
 * The frontend's only way to talk to the backend. Everything register-related goes through `rpc` (Postgres functions
 * with authorisation inside) – the client never writes tables (CLAUDE.md rule 2).
 *
 * Two implementations:
 *  - supabase: supabase-js against a Supabase project (staging/prod).
 *  - local:    the same migrations running in the browser (PGlite) with demo data – no backend needed. Auth and the
 *              Edge Functions are emulated with the same adapters (mocks) the server uses in DEMO_MODE.
 */
export interface Session {
  userId: string;
  email: string;
  aal?: "aal1" | "aal2";
}

export interface SignUpResult {
  session: Session | null; // null when e-mail confirmation is required
}

export interface InvokeOptions {
  method?: "GET" | "POST";
  query?: Record<string, string>;
  /** Call as anon even when signed in (public functions). */
  anonymous?: boolean;
}

export interface Backend {
  readonly kind: "local" | "supabase";
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  invoke<T = unknown>(fn: string, body?: unknown, opts?: InvokeOptions): Promise<T>;
  auth: {
    getSession(): Promise<Session | null>;
    signInWithPassword(email: string, password: string): Promise<Session>;
    signUp(email: string, password: string, meta: { full_name?: string; locale?: string }): Promise<SignUpResult>;
    /** Magic link. In local mode the "e-mail" is returned as demoLink. */
    signInWithOtp(email: string, redirectTo: string): Promise<{ demoLink?: string }>;
    /** Completes a local-mode magic link (no-op for Supabase, which handles the redirect itself). */
    completeLink(params: URLSearchParams): Promise<Session | null>;
    signOut(): Promise<void>;
    onChange(cb: (s: Session | null) => void): () => void;
    mfa: {
      enroll(): Promise<{ factorId: string; qr: string; secret: string }>;
      verify(factorId: string, code: string): Promise<void>;
      list(): Promise<{ id: string; status: string }[]>;
      unenroll(factorId: string): Promise<void>;
    };
  };
  storage: {
    upload(bucket: string, path: string, file: Blob, contentType: string): Promise<void>;
    publicUrl(bucket: string, path: string): string;
    /** Local mode: an object URL for a stored file (Supabase uses the document-url function). */
    localObjectUrl?(bucket: string, path: string): Promise<string | null>;
  };
  /** Local mode only: wipe the demo database and start over. */
  reset?(): Promise<void>;
}

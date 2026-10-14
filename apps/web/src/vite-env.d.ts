/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** "local" (default: database in the browser, demo data) or "supabase". */
  readonly VITE_DATA_SOURCE?: "local" | "supabase";
  readonly VITE_SUPABASE_URL?: string;
  /** Publishable (anon) key – never the service role key in the frontend. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** "hash" in the self-contained demo build. */
  readonly VITE_ROUTER?: "hash";
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** Where the public site and the app live when they are separate deployments (ADR 0035). Unset: same origin. */
  readonly VITE_SITE_URL?: string;
  readonly VITE_APP_URL?: string;
  /** "site" in the public site's build (apps/site). */
  readonly VITE_SURFACE?: "site" | "app";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __DEMO_DB_VERSION__: string;

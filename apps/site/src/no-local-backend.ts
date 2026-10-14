import type { Backend } from "@web/lib/backend/types";

/** Stands in for the in-browser database, which the public site never uses (ADR 0035). */
export function createLocalBackend(): Backend {
  throw new Error("The public site needs VITE_DATA_SOURCE=supabase and VITE_SUPABASE_URL.");
}

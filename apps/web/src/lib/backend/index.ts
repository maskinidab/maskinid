import { createLocalBackend } from "./local";
import { createSupabaseBackend } from "./supabase";
import type { Backend } from "./types";

export * from "./types";
export * from "./errors";

export type DataSource = "local" | "supabase";

/** VITE_DATA_SOURCE=supabase uses the Supabase project; anything else runs the local in-browser database. */
export const dataSource: DataSource =
  import.meta.env.VITE_DATA_SOURCE === "supabase" && import.meta.env.VITE_SUPABASE_URL ? "supabase" : "local";

export const backend: Backend =
  dataSource === "supabase"
    ? createSupabaseBackend(import.meta.env.VITE_SUPABASE_URL as string, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string)
    : createLocalBackend();

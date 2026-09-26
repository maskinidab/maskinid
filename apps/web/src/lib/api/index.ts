import { mockApi } from "./mockApi";
import { supabaseApi } from "./supabaseApi";
import type { MaskinIdApi } from "./types";

export type DataSource = "mock" | "supabase";

/** Mock är standard tills Supabase är uppsatt. Sätt VITE_DATA_SOURCE=supabase i .env för att byta. */
export const dataSource: DataSource = import.meta.env.VITE_DATA_SOURCE === "supabase" ? "supabase" : "mock";

export const api: MaskinIdApi = dataSource === "supabase" ? supabaseApi : mockApi;

export * from "./types";

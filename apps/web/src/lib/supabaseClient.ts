import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase-klienten skapas först när den behövs, så att appen går att köra
 * i mock-läge utan miljövariabler. Se .env.example och docs/BACKEND.md.
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "VITE_SUPABASE_URL och VITE_SUPABASE_PUBLISHABLE_KEY saknas. Kopiera .env.example till .env och fyll i värdena.",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

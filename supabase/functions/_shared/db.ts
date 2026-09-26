import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function serviceClient(headers: Record<string, string> = {}): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
}

/** A client acting as the calling user (RLS and RPC authorisation apply). */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
}

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
}

export function envRecord(): Record<string, string | undefined> {
  return Deno.env.toObject();
}

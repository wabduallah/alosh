import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client for rooms, players and realtime state.
 *
 * Only the anon key is used here. It is public by design, and the database
 * policies in supabase/schema_al3sh_core.sql decide what it can read or write.
 * When the variables are missing the client is null, so pages can show a
 * clear message instead of crashing.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;

/**
 * Returns a signed-in session for this browser. Guests get an anonymous
 * Supabase user, which requires "Anonymous Sign-Ins" to be enabled in the project.
 */
export async function ensureSession() {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data: current } = await supabase.auth.getSession();
  if (current.session) return current.session;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session) throw new Error(error?.message ?? "ANON_SIGNIN_FAILED");
  return data.session;
}

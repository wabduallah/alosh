import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

function liveClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    client = null;
    return null;
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Push from Supabase when the room revision changes. No-op without public env. */
export function watchRoom(code: string, onChange: () => void): () => void {
  const supabase = liveClient();
  const safe = code.toUpperCase();
  if (!supabase || !/^[A-Z0-9]{4,12}$/.test(safe)) return () => {};
  const channel = supabase
    .channel(`room-${safe}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "room_signals", filter: `code=eq.${safe}` },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

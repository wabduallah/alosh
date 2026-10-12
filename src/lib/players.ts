import { supabase } from "@/lib/supabase";
import { getAvatar } from "@/lib/prefs";

type NewPlayer = { room_id: string; user_id: string; player_name: string; is_host?: boolean };

/**
 * Adds a player to a room with the avatar chosen in the settings page.
 * Before supabase/guests_v1.sql adds the avatar column, it simply joins without one.
 */
export async function insertPlayer(row: NewPlayer, select = "id, player_name, is_host") {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const avatar = getAvatar();
  if (avatar) {
    const first = await supabase.from("room_players").insert({ ...row, avatar }).select(select).single();
    const missing = first.error && (first.error.code === "PGRST204" || first.error.code === "42703" || /avatar/i.test(first.error.message ?? ""));
    if (!missing) return first;
  }
  return supabase.from("room_players").insert(row).select(select).single();
}

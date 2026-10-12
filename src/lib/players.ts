import { supabase } from "@/lib/supabase";
import { getAvatar } from "@/lib/prefs";

type NewPlayer = { room_id: string; user_id: string; player_name: string; is_host?: boolean };

/**
 * Adds a player to a room with the avatar chosen in the settings page.
 * Older databases still join: before supabase/guests_v1.sql (no avatar column) the
 * player joins without one, and before guests_v2.sql (emoji-only check) with the
 * chosen colour alone.
 */
export async function insertPlayer(row: NewPlayer, select = "id, player_name, is_host") {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const avatar = getAvatar();
  if (avatar) {
    const first = await supabase.from("room_players").insert({ ...row, avatar }).select(select).single();
    if (!first.error) return first;
    const code = first.error.code;
    const missing = code === "PGRST204" || code === "42703";
    const rejected = code === "23514" && /avatar/i.test(first.error.message ?? "");
    if (!missing && !rejected) return first;
    if (rejected && avatar.c) {
      const colourOnly = await supabase.from("room_players").insert({ ...row, avatar: { c: avatar.c } }).select(select).single();
      if (!colourOnly.error || colourOnly.error.code !== "23514") return colourOnly;
    }
  }
  return supabase.from("room_players").insert(row).select(select).single();
}

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { adaptivePoll } from "@/lib/live";

/**
 * Watches a room for a new round started by the host (supabase/rooms_v1.sql):
 * when its game or its session number changes, the page reloads so every screen
 * (player, TV, a second host device) opens the new game cleanly.
 * Also reports the room's live status. Works before rooms_v1.sql too (game changes only).
 */
export function useRoomSession(roomId: string | null | undefined) {
  const [status, setStatus] = useState<string | null>(null);
  const first = useRef<{ game: string; session: number | null } | null>(null);

  useEffect(() => {
    if (!supabase || !roomId) return;
    const client = supabase;
    let alive = true;
    let withSession = true;

    function check(row: { status?: string; game_id?: string; session?: number | null } | null) {
      if (!alive || !row?.game_id) return;
      if (row.status) setStatus(row.status);
      const now = { game: row.game_id, session: row.session ?? null };
      const seen = first.current;
      if (!seen) {
        first.current = now;
        return;
      }
      if (seen.game !== now.game || (seen.session !== null && now.session !== null && seen.session !== now.session)) {
        alive = false;
        window.location.reload();
      }
    }

    async function poll() {
      const res = await client
        .from("game_rooms")
        .select(withSession ? "status, game_id, session" : "status, game_id")
        .eq("id", roomId)
        .maybeSingle();
      if (res.error && withSession) {
        withSession = false;
        return poll();
      }
      check(res.data as { status?: string; game_id?: string; session?: number } | null);
    }

    void poll();
    const channel = client
      .channel(`room-session-${roomId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` }, (payload) => {
        check(payload.new as { status?: string; game_id?: string; session?: number });
      })
      .subscribe((status) => poller.onStatus(status));
    // Realtime can drop on phones and sleeping tabs: check every few seconds too (slower while it is connected).
    const poller = adaptivePoll(poll, 3000);
    return () => {
      alive = false;
      poller.stop();
      client.removeChannel(channel);
    };
  }, [roomId]);

  return status;
}

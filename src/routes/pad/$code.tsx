import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Mark } from "@/components/brand";
import { supabase } from "@/lib/supabase";

/**
 * Player pad link (/pad/CODE). A player who already joined this room on this
 * device goes straight to the game pad (/room/CODE); everyone else goes to the
 * join page with the code filled in (/join/CODE).
 */
export const Route = createFileRoute("/pad/$code")({
  head: () => ({ meta: [{ title: "لوحة اللاعب — العش" }, { name: "robots", content: "noindex" }] }),
  component: PadRedirect,
});

function PadRedirect() {
  const { code } = Route.useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const roomCode = code.toUpperCase();
    let cancelled = false;
    const toJoin = () => navigate({ to: "/join/$code", params: { code: roomCode }, replace: true });

    (async () => {
      if (!supabase) return toJoin();
      try {
        // Only look at an existing session: a new visitor gets one on the join page.
        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user.id;
        if (!userId) return toJoin();
        const { data: room } = await supabase.from("game_rooms").select("id").eq("room_code", roomCode).maybeSingle();
        if (!room) return toJoin();
        const { data: me } = await supabase
          .from("room_players")
          .select("id")
          .eq("room_id", (room as { id: string }).id)
          .eq("user_id", userId)
          .maybeSingle();
        if (cancelled) return;
        if (me) navigate({ to: "/room/$code", params: { code: roomCode }, replace: true });
        else toJoin();
      } catch {
        if (!cancelled) toJoin();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  return (
    <main className="nest grid min-h-dvh place-content-center justify-items-center gap-4 text-center">
      <Mark height={120} className="bob" />
      <p className="text-[17px] text-mist">جارٍ فتح الغرفة…</p>
    </main>
  );
}

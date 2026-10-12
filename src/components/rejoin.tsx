import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Glyph } from "@/components/brand";
import { buttonBase, buttonTone, cx } from "@/components/ui";
import { forgetRoom, getLastRoom, type LastRoom } from "@/lib/prefs";
import { supabase } from "@/lib/supabase";

/**
 * «ارجع لغرفتك»: if this phone was in a room that is still open (the page was
 * closed, the phone locked, the network dropped), one tap takes it back.
 */
export function RejoinCard() {
  const [room, setRoom] = useState<(LastRoom & { status: string }) | null>(null);

  useEffect(() => {
    const last = getLastRoom();
    if (!last || !supabase) return;
    let alive = true;
    void supabase
      .from("game_rooms")
      .select("status")
      .eq("room_code", last.code)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive || error) return;
        const status = (data as { status?: string } | null)?.status;
        if (!status || status === "finished") {
          forgetRoom();
          return;
        }
        setRoom({ ...last, status });
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!room) return null;
  const to = room.host ? "/host/$code" : "/room/$code";
  return (
    <div role="status" className="rise mb-4 flex flex-wrap items-center gap-3 rounded-[20px] border border-gold/50 bg-gold/10 px-4 py-3">
      <Glyph name="refresh" className="size-6 shrink-0 text-gold" />
      <p className="min-w-0 flex-1 text-[15px] leading-6 text-ivory">
        {room.host ? "غرفتك مفتوحة" : "لعبتك مستمرة"}
        <span className="block text-[13px] text-mist">
          <span className="room-code text-[15px] text-gold">{room.code}</span> <span className="whitespace-nowrap">· {room.status === "lobby" ? "بانتظار البدء" : "اللعب جارٍ"}</span>
        </span>
      </p>
      <div className="flex gap-2">
        <Link to={to} params={{ code: room.code }} className={cx(buttonBase, buttonTone("primary"), "min-h-11 px-5")}>
          ارجع لها
        </Link>
        <button
          type="button"
          onClick={() => {
            forgetRoom();
            setRoom(null);
          }}
          aria-label="تجاهل"
          className="grid size-11 place-items-center rounded-full border border-line-strong/70 text-mist hover:text-ivory"
        >
          <Glyph name="x" className="size-4" />
        </button>
      </div>
    </div>
  );
}

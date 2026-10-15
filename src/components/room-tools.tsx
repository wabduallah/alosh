import { useCallback, useState } from "react";
import { Button, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useLivePoll } from "@/lib/live";

/**
 * The host's room tools, on every game's host screen: the players in the room with «طرد» for
 * each (before and during the game), and «إنهاء الغرفة للجميع». Uses supabase/rooms_v2.sql,
 * and falls back to the plain table rules when that file has not run yet.
 */

type Row = { id: string; player_name: string; is_host: boolean; score: number };

const missing = (code?: string) => code === "PGRST202" || code === "42883";

export function HostRoomTools({ roomId, status, onEnded }: { roomId: string; status: string; onEnded?: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [ended, setEnded] = useState(false);
  const finished = status === "finished" || ended;

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from("room_players").select("id, player_name, is_host, score").eq("room_id", roomId).order("joined_at");
    if (data) setRows(data as Row[]);
  }, [roomId]);
  useLivePoll(`room-tools-${roomId}`, [{ table: "room_players", filter: `room_id=eq.${roomId}` }], load);

  const guests = rows.filter((r) => !r.is_host);

  async function kick(r: Row) {
    if (!supabase) return;
    if (!window.confirm(`طرد ${r.player_name} من الغرفة؟ يخرج فورًا، ولا يستطيع الرجوع لهذه الغرفة من نفس الجهاز.`)) return;
    setBusy(r.id);
    setNote(null);
    const { data, error } = await supabase.rpc("room_kick", { p_room_id: roomId, p_player_id: r.id });
    let ok = !error && (data as { ok?: boolean } | null)?.ok !== false;
    if (error && missing(error.code)) {
      // Before rooms_v2.sql: the host may still remove the row, but the player can join again.
      const res = await supabase.from("room_players").delete().eq("id", r.id);
      ok = !res.error;
    }
    setBusy(null);
    setNote(ok ? { ok: true, text: `خرج ${r.player_name} من الغرفة.` } : { ok: false, text: "تعذّر الطرد، حاول مرة أخرى." });
    await load();
  }

  async function endRoom() {
    if (!supabase) return;
    if (!window.confirm("إنهاء الغرفة للجميع؟ تتوقف اللعبة على كل الشاشات، ولا يستطيع أحد الانضمام بعدها.")) return;
    setBusy("end");
    setNote(null);
    const { data, error } = await supabase.rpc("room_end", { p_room_id: roomId });
    let ok = !error && (data as { ok?: boolean } | null)?.ok !== false;
    if (error && missing(error.code)) {
      const res = await supabase.from("game_rooms").update({ status: "finished" }).eq("id", roomId);
      ok = !res.error;
    }
    setBusy(null);
    if (ok) {
      setEnded(true);
      onEnded?.();
    } else setNote({ ok: false, text: "تعذّر إنهاء الغرفة، حاول مرة أخرى." });
  }

  return (
    <details className="surface mx-auto mb-4 max-w-3xl rounded-[20px] p-4">
      <summary className="cursor-pointer text-[15px] font-semibold text-ivory">
        👥 اللاعبون ({guests.length}) · إدارة الغرفة{finished ? <span className="ms-2 text-[13px] font-normal text-mist">انتهت الغرفة</span> : null}
      </summary>
      <div className="mt-3 grid gap-3">
        {guests.length ? (
          <ul className="grid gap-1.5">
            {guests.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-[14px] border border-line bg-deep-2/50 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ivory">{r.player_name}</span>
                {!finished ? (
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => kick(r)}
                    className="min-h-10 rounded-full border border-wrong/50 px-4 text-[13px] font-semibold text-wrong hover:bg-wrong-fill/20 disabled:opacity-50"
                  >
                    {busy === r.id ? "…" : "طرد"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-mist">لم ينضم أحد بعد.</p>
        )}
        {!finished ? <p className="text-[12px] leading-5 text-faint">أثناء اللعب يخرج اللاعب فورًا وتكمل اللعبة بالباقين. في المحكمة: إذا كان له دور مهم، استبدله أولًا من «استبدال لاعب».</p> : null}
        {note ? <p className={cx("text-[14px] font-semibold", note.ok ? "text-correct" : "text-wrong")}>{note.text}</p> : null}
        {!finished ? (
          <Button tone="danger" className="min-h-12" disabled={!!busy} onClick={endRoom}>
            {busy === "end" ? "…" : "⏹️ إنهاء الغرفة للجميع"}
          </Button>
        ) : (
          <p className="text-center text-[14px] text-mist">انتهت الغرفة لكل اللاعبين.</p>
        )}
      </div>
    </details>
  );
}

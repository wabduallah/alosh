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

/* ---------------- الضيوف التجريبيون (supabase/site_v1.sql) ---------------- */

type GuestStatus = { allowed: boolean; seat?: string | null; guests?: Array<{ id: string; name: string }> };

const GUEST_ERRORS: Record<string, string> = {
  ROOM_FULL: "الغرفة ممتلئة.",
  ROOM_FINISHED: "الغرفة انتهت.",
  NOT_ALLOWED: "الضيوف التجريبيون غير مفعّلين لهذه اللعبة.",
  NOT_A_GUEST: "هذا ليس ضيفًا تجريبيًا.",
};

/**
 * For the admin only, in games where «الضيوف التجريبيون» is on (admin → الموقع): add fake players
 * to the room and play as any of them from this device. Every game finds the current player with
 * my_player_id(), which follows the chosen guest, so this works in every game, new ones included.
 * Shows nothing for everyone else.
 */
export function TestGuestsBar({ roomId, roomCode, onHost = false }: { roomId: string; roomCode?: string; onHost?: boolean }) {
  const [s, setS] = useState<GuestStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc("test_guests_status", { p_room_id: roomId });
    if (!error && data) setS(data as GuestStatus);
  }, [roomId]);
  useLivePoll(`test-guests-${roomId}`, [{ table: "room_players", filter: `room_id=eq.${roomId}` }], load);

  const guests = s?.guests ?? [];
  const seat = s?.seat ?? null;
  const seatName = guests.find((g) => g.id === seat)?.name;

  async function run(fn: string, args: Record<string, unknown>, reload: boolean) {
    if (!supabase) return;
    setBusy(true);
    setNote(null);
    const { data, error } = await supabase.rpc(fn, { p_room_id: roomId, ...args });
    setBusy(false);
    const res = data as { ok?: boolean; reason?: string } | null;
    if (error || res?.ok === false) {
      setNote(GUEST_ERRORS[res?.reason ?? ""] ?? "تعذّر التنفيذ، حاول مرة أخرى.");
      return;
    }
    // The game screens read the current player once: reload so they follow the new seat.
    if (reload && !onHost) window.location.reload();
    else await load();
  }

  if (!s?.allowed) {
    // The game was switched off while playing as a guest: only the way back is left.
    if (!seat) return null;
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-dashed border-violet-text/60 p-3">
        <p className="text-[13px] text-mist">🧪 ما زلت تلعب بدور ضيف تجريبي.</p>
        <Button tone="outline" className="min-h-10 px-3 text-[13px]" disabled={busy} onClick={() => void run("test_guest_act", { p_player_id: null }, true)}>
          ارجع لنفسي
        </Button>
      </div>
    );
  }

  return (
    <section aria-label="الضيوف التجريبيون" className="mb-4 grid gap-2.5 rounded-[18px] border border-dashed border-violet-text/60 bg-violet-fill/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[14px] font-bold text-ivory">🧪 ضيوف تجريبيون <span className="font-normal text-muted">(تراه أنت فقط)</span></p>
        <p className="text-[13px] text-mist">{seatName ? `تلعب الآن بدور: ${seatName}` : "تلعب بنفسك"}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button tone="quiet" className="min-h-10 px-3 text-[13px]" disabled={busy} onClick={() => void run("test_guest_add", { p_count: 1 }, false)}>
          + ضيف
        </Button>
        <Button tone="quiet" className="min-h-10 px-3 text-[13px]" disabled={busy} onClick={() => void run("test_guest_add", { p_count: 3 }, false)}>
          + 3 ضيوف
        </Button>
        {seat ? (
          <Button tone="outline" className="min-h-10 px-3 text-[13px]" disabled={busy} onClick={() => void run("test_guest_act", { p_player_id: null }, true)}>
            ارجع لنفسي
          </Button>
        ) : null}
        {guests.length ? (
          <Button
            tone="danger"
            className="min-h-10 px-3 text-[13px]"
            disabled={busy}
            onClick={() => window.confirm("حذف كل الضيوف التجريبيين من الغرفة؟") && void run("test_guest_remove", {}, !!seat)}
          >
            احذف الضيوف
          </Button>
        ) : null}
      </div>
      {guests.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {guests.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                disabled={busy || g.id === seat}
                onClick={() => void run("test_guest_act", { p_player_id: g.id }, true)}
                className={cx(
                  "min-h-10 rounded-full border px-3 text-[13px] font-semibold transition",
                  g.id === seat ? "border-gold bg-gold/15 text-gold" : "border-line-strong/70 text-mist hover:text-ivory",
                )}
              >
                {g.id === seat ? `● ${g.name}` : `العب بدور ${g.name}`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {onHost && roomCode ? (
        <p className="text-[12px] leading-5 text-muted">
          اختر ضيفًا ثم افتح{" "}
          <a href={`/room/${roomCode}`} target="_blank" rel="noopener" className="font-bold text-gold underline-offset-4 hover:underline">
            شاشة اللاعب
          </a>{" "}
          في تبويب آخر لتلعب بدوره.
        </p>
      ) : null}
      {note ? (
        <p role="alert" className="text-[13px] font-semibold text-wrong">
          {note}
        </p>
      ) : null}
    </section>
  );
}

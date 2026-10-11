import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { ensureSession, supabase } from "@/lib/supabase";

/** Room codes use this alphabet only (no I, O, 0, 1), matching the database. */
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;

type RoomRow = { id: string; room_code: string; status: string };
type PlayerRow = { id: string; player_name: string; is_host: boolean };

/**
 * Join a room from a phone. Works with a typed code or a code prefilled from
 * the QR link (/join/CODE). Once joined, the player sees the lobby live.
 */
export function JoinRoom({ initialCode = "" }: { initialCode?: string }) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [me, setMe] = useState<PlayerRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);

  // Live player list once joined (same pattern as the host lobby).
  useEffect(() => {
    if (!supabase || !room) return;
    const client = supabase;
    const roomId = room.id;
    let cancelled = false;

    async function loadPlayers() {
      const { data } = await client
        .from("room_players")
        .select("id, player_name, is_host")
        .eq("room_id", roomId)
        .order("joined_at");
      if (!cancelled) setPlayers((data ?? []) as PlayerRow[]);
    }

    loadPlayers();
    const channel = client
      .channel(`join-players-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${roomId}` },
        () => {
          loadPlayers();
        },
      )
      .subscribe();

    // Fallback: re-read the list every few seconds in case realtime drops.
    const timer = window.setInterval(loadPlayers, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      client.removeChannel(channel);
    };
  }, [room]);

  // Follow the room status, so players see when the host starts the game.
  useEffect(() => {
    if (!supabase || !room) return;
    const client = supabase;
    const roomId = room.id;
    const channel = client
      .channel(`join-status-${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          const next = (payload.new as { status?: string }).status;
          if (next) setRoom((current) => (current ? { ...current, status: next } : current));
        },
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [room?.id]);

  async function join(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const cleanCode = code.trim().toUpperCase();
    const cleanName = name.trim().replace(/\s+/g, " ");

    if (!CODE_PATTERN.test(cleanCode)) return setError("الرمز يتكون من 5 أحرف أو أرقام.");
    if (cleanName.length < 2 || cleanName.length > 24) return setError("الاسم بين حرفين و24 حرفًا.");
    if (!supabase) return setError("الاتصال بقاعدة البيانات غير مضبوط بعد.");

    setBusy(true);
    try {
      const session = await ensureSession();
      const userId = session.user.id;

      // 1) Find the room by its code. Reading is public per RLS.
      const { data: found, error: findError } = await supabase
        .from("game_rooms")
        .select("id, room_code, status")
        .eq("room_code", cleanCode)
        .maybeSingle();
      if (findError) throw findError;
      if (!found) return setError("لم نجد غرفة بهذا الرمز.");
      const target = found as RoomRow;
      if (target.status === "finished") return setError("انتهت هذه الغرفة.");

      // 2) Already in this room on this device? Just show the lobby.
      const { data: existing } = await supabase
        .from("room_players")
        .select("id, player_name, is_host")
        .eq("room_id", target.id)
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        setMe(existing as PlayerRow);
        setRoom(target);
        return;
      }

      // 3) Join. The database checks capacity, room status and duplicate names.
      const { data: joined, error: joinError } = await supabase
        .from("room_players")
        .insert({ room_id: target.id, user_id: userId, player_name: cleanName })
        .select("id, player_name, is_host")
        .single();
      if (joinError) throw joinError;

      setMe(joined as PlayerRow);
      setRoom(target);
    } catch (err) {
      setError(friendlyJoinError(err));
    } finally {
      setBusy(false);
    }
  }

  if (room && me) {
    return (
      <section className="glass-card mx-auto mt-6 max-w-md rounded-3xl p-6 text-center">
        <p className="text-sm text-muted">أنت في الغرفة</p>
        <p className="mt-2 font-mono text-3xl font-extrabold tracking-[0.3em] text-neon">{room.room_code}</p>
        <p className="mt-3 text-base font-bold text-ivory">مرحبًا {me.player_name}</p>
        {room.status === "playing" ? (
          <div className="mt-3 space-y-3">
            <p className="rounded-2xl border border-emerald/40 bg-emerald/10 p-3 text-sm font-bold text-ivory">
              بدأت اللعبة! تابع الشاشة الكبيرة.
            </p>
            <Link
              to="/room/$code"
              params={{ code: room.room_code }}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-neon px-5 text-sm font-bold text-night"
            >
              افتح لوحة اللعب
            </Link>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">بانتظار المضيف ليبدأ اللعبة.</p>
        )}

        <h2 className="mt-6 text-right text-base font-extrabold text-ivory">اللاعبون ({players.length})</h2>
        <ul className="mt-2 space-y-2 text-right">
          {players.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-2 text-sm">
              <span className="text-ivory">{p.player_name}</span>
              {p.is_host ? <span className="text-xs font-bold text-violet">المضيف</span> : null}
            </li>
          ))}
        </ul>

        <Link to="/" className="mt-6 inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 text-sm font-bold text-ivory">
          الرئيسية
        </Link>
      </section>
    );
  }

  return (
    <section className="glass-card mx-auto mt-6 max-w-md rounded-3xl p-6">
      <h1 className="text-2xl font-extrabold text-ivory">انضمام إلى غرفة</h1>
      <p className="mt-2 text-sm text-muted">اكتب رمز الغرفة من شاشة المضيف، أو امسح الـ QR.</p>

      <form onSubmit={join} className="mt-6 space-y-4">
        <Field label="رمز الغرفة">
          <input
            className={`${inputClass} text-center font-mono text-xl tracking-[0.3em] uppercase`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
            maxLength={5}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABCDE"
          />
        </Field>

        <Field label="اسمك">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            placeholder="اكتب اسمك"
            autoComplete="nickname"
          />
        </Field>

        {error ? <p className="text-sm text-crimson">{error}</p> : null}

        <Button type="submit" tone="primary" disabled={busy} className="w-full">
          {busy ? "جارٍ الانضمام…" : "انضم"}
        </Button>
      </form>
    </section>
  );
}

function friendlyJoinError(err: unknown): string {
  const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
  if (message.includes("SUPABASE_NOT_CONFIGURED")) return "الاتصال بقاعدة البيانات غير مضبوط بعد.";
  if (message.includes("ANON_SIGNIN_FAILED") || message.toLowerCase().includes("anonymous"))
    return "تعذّر تسجيل الدخول المؤقت. تأكد من تفعيل Anonymous Sign-Ins في Supabase.";
  if (message.includes("ROOM_FULL")) return "الغرفة ممتلئة.";
  if (message.includes("ROOM_FINISHED")) return "انتهت هذه الغرفة.";
  if (message.includes("room_players_room_name_key") || message.toLowerCase().includes("duplicate"))
    return "هذا الاسم مستخدم في الغرفة. اختر اسمًا آخر.";
  return "تعذّر الانضمام، حاول مرة أخرى.";
}

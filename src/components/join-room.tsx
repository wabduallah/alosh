import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, buttonBase, buttonTone, cx, inputClass } from "@/components/ui";
import { CodeCells, Cradle, Egg, Glyph, Mark } from "@/components/brand";
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
    const myIndex = Math.max(1, players.findIndex((p) => p.id === me.id) + 1);
    return (
      <section className="surface mx-auto mt-2 grid max-w-md justify-items-center gap-4 rounded-[28px] p-6 text-center sm:p-8">
        <div className="grid justify-items-center gap-1">
          <p className="text-[13px] font-semibold text-mist">أنت في الغرفة</p>
          <p className="room-code text-[34px] leading-[44px] text-gold">{room.room_code}</p>
        </div>
        <Cradle hold style={{ padding: "0 26px" }}>
          <Egg name={me.player_name} index={myIndex} size="xl" me />
        </Cradle>
        <p className="font-display text-[26px] font-extrabold leading-9 text-ivory">مرحبًا {me.player_name}</p>
        {room.status === "playing" ? (
          <div className="grid w-full gap-3">
            <p className="flex items-center justify-center gap-2 rounded-[14px] border border-correct/50 bg-correct-fill/15 p-3 text-[15px] font-semibold text-ivory">
              <Glyph name="check" className="size-5 text-correct" />
              بدأت اللعبة! تابع الشاشة الكبيرة.
            </p>
            <Link to="/room/$code" params={{ code: room.room_code }} className={cx(buttonBase, buttonTone("primary"), "min-h-16 w-full text-[19px]")}>
              افتح لوحة اللعب
            </Link>
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-[14px] border border-line bg-glass px-4 py-3 text-[15px] text-mist">
            <Glyph name="hourglass" className="size-5 text-gold" />
            بانتظار المضيف ليبدأ اللعبة.
          </p>
        )}

        <div className="mt-2 w-full text-start">
          <h2 className="mb-3 text-[19px]">اللاعبون ({players.length})</h2>
          <ul className="grid gap-2">
            {players.map((p, i) => (
              <li
                key={p.id}
                className={cx(
                  "flex min-h-14 items-center gap-3 rounded-[14px] border px-3 py-2",
                  p.id === me.id ? "border-gold/50 bg-gold/10" : "border-line bg-deep-2/50",
                )}
              >
                <Egg name={p.player_name} index={i + 1} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ivory">{p.player_name}</span>
                {p.is_host ? <span className="rounded-full bg-violet/25 px-2.5 py-0.5 text-[13px] font-semibold text-violet-text">المضيف</span> : null}
              </li>
            ))}
          </ul>
        </div>

        <Link to="/" className={cx(buttonBase, buttonTone("quiet"), "mt-2")}>
          <Glyph name="home" className="size-[18px]" />
          الرئيسية
        </Link>
      </section>
    );
  }

  return (
    <section className="surface mx-auto mt-2 max-w-md rounded-[28px] p-6 sm:p-8">
      <div className="grid justify-items-center text-center">
        <Mark height={88} className="bob" />
        <h1 className="mt-2 text-[30px] leading-10">انضمام إلى غرفة</h1>
        <p className="mt-1 text-[15px] leading-[26px] text-mist">اكتب رمز الغرفة من شاشة المضيف، أو امسح الـ QR.</p>
      </div>

      <form onSubmit={join} className="mt-6 grid gap-5">
        <Field label="رمز الغرفة">
          <span className="flex justify-center">
            <CodeCells value={code} onChange={(next) => setCode(next.replace(/[^A-Z0-9]/g, "").slice(0, 5))} placeholder="ABCDE" />
          </span>
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

        {error ? (
          <p className="flex items-center gap-1.5 text-[14px] font-semibold text-wrong">
            <Glyph name="alert" className="size-4" />
            {error}
          </p>
        ) : null}

        <Button type="submit" tone="primary" disabled={busy} className="min-h-14 w-full text-[18px]">
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

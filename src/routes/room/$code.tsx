import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/shell";
import { cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";

/**
 * Player screen for a room (phones). Shows the game board and the active
 * question, live, through Realtime. It never shows the correct answer: the
 * board reads from questions_public, and the answer only comes from the host
 * screen via room_correct_answer().
 */
export const Route = createFileRoute("/room/$code")({
  head: () => ({ meta: [{ title: "اللعب — العش" }] }),
  component: PlayerBoard,
});

type Room = { id: string; room_code: string; game_id: string; status: string };
type Question = {
  id: string;
  category_ar: string;
  question_text: string;
  options: string[];
  points: number;
};
type StateData = { answered?: string[]; phase?: string } & Record<string, unknown>;

function PlayerBoard() {
  const { code } = Route.useParams();
  const [room, setRoom] = useState<Room | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stateData, setStateData] = useState<StateData>({});
  const [error, setError] = useState<string | null>(null);

  // Load the room, its public questions and its current state.
  useEffect(() => {
    if (!supabase) {
      setError("الاتصال بقاعدة البيانات غير مضبوط بعد.");
      return;
    }
    const client = supabase;
    let cancelled = false;

    async function load() {
      const { data: found, error: roomError } = await client
        .from("game_rooms")
        .select("id, room_code, game_id, status")
        .eq("room_code", code.toUpperCase())
        .maybeSingle();
      if (roomError) return setError("تعذّر تحميل الغرفة، حاول مرة أخرى.");
      if (!found) return setError("لم نجد هذه الغرفة.");
      const r = found as Room;

      const { data: game } = await client.from("games").select("slug").eq("id", r.game_id).single();
      const { data: qs } = await client
        .from("questions_public")
        .select("id, category_ar, question_text, options, points")
        .eq("game_slug", game?.slug ?? "")
        .order("points");

      const { data: state } = await client
        .from("room_game_state")
        .select("active_question_id, state_data")
        .eq("room_id", r.id)
        .maybeSingle();

      if (cancelled) return;
      setRoom(r);
      setQuestions((qs ?? []) as Question[]);
      setActiveId((state?.active_question_id as string | null) ?? null);
      setStateData(((state?.state_data as StateData) ?? {}) as StateData);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Follow room state changes (question opened, closed, answered) and game status.
  useEffect(() => {
    if (!supabase || !room) return;
    const client = supabase;
    const roomId = room.id;

    const channel = client
      .channel(`player-board-${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "room_game_state", filter: `room_id=eq.${roomId}` },
        (payload) => {
          const next = payload.new as { active_question_id: string | null; state_data: StateData };
          setActiveId(next.active_question_id ?? null);
          setStateData(next.state_data ?? {});
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          const next = payload.new as { status?: string };
          if (next.status) setRoom((current) => (current ? { ...current, status: next.status! } : current));
        },
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [room?.id]);

  const { categories, pointRows } = useMemo(() => {
    const cats: string[] = [];
    const pts = new Set<number>();
    for (const q of questions) {
      if (!cats.includes(q.category_ar)) cats.push(q.category_ar);
      pts.add(q.points);
    }
    return { categories: cats, pointRows: [...pts].sort((a, b) => a - b) };
  }, [questions]);

  const answered = new Set(stateData.answered ?? []);
  const active = questions.find((q) => q.id === activeId) ?? null;

  if (error) {
    return (
      <Shell>
        <section className="glass-card mx-auto mt-8 max-w-xl rounded-3xl p-6 text-center">
          <p className="text-sm text-crimson">{error}</p>
          <Link to="/" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 text-sm font-bold text-ivory">
            الرئيسية
          </Link>
        </section>
      </Shell>
    );
  }

  if (!room) {
    return (
      <Shell>
        <p className="mt-8 text-center text-sm text-muted">جارٍ التحميل…</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="mx-auto mt-4 max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-ivory">
            الغرفة <span className="font-mono text-neon">{room.room_code}</span>
          </h1>
          <span className="text-sm text-muted">
            أُجيب {answered.size} من {questions.length}
          </span>
        </div>

        {room.status !== "playing" ? (
          <p className="glass-card mb-4 rounded-2xl p-4 text-center text-sm text-muted">بانتظار المضيف ليبدأ اللعبة.</p>
        ) : null}

        {active ? (
          <div className="glass-card mb-5 rounded-3xl p-5 text-center">
            <p className="text-xs font-bold text-violet">
              {active.category_ar} · {active.points} نقطة
            </p>
            <p className="mt-3 text-xl font-extrabold leading-relaxed text-ivory">{active.question_text}</p>
            {active.options.length > 0 ? (
              <ul className="mt-4 grid gap-2">
                {active.options.map((opt) => (
                  <li key={opt} className="rounded-xl bg-white/[0.05] px-4 py-3 text-right text-ivory">
                    {opt}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : room.status === "playing" ? (
          <p className="glass-card mb-5 rounded-2xl p-4 text-center text-sm text-muted">اختر المضيف سؤالاً من اللوحة.</p>
        ) : null}

        {categories.length > 0 ? (
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[360px] gap-1.5"
              style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}
            >
              {categories.map((cat) => (
                <div key={cat} className="rounded-xl bg-violet/20 p-2 text-center text-xs font-extrabold text-ivory">
                  {cat}
                </div>
              ))}
              {pointRows.map((points) =>
                categories.map((cat) => {
                  const q = questions.find((item) => item.category_ar === cat && item.points === points) ?? null;
                  const done = q ? answered.has(q.id) : true;
                  const isActive = q?.id === activeId;
                  return (
                    <div
                      key={`${cat}-${points}`}
                      className={cx(
                        "flex min-h-12 items-center justify-center rounded-xl border text-base font-extrabold",
                        isActive
                          ? "border-neon bg-neon/20 text-ivory"
                          : q && !done
                            ? "border-neon/40 bg-white/[0.04] text-neon"
                            : "border-white/5 bg-white/[0.02] text-muted/30",
                      )}
                    >
                      {q && !done ? points : ""}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        ) : null}

        <p className="mt-6 text-center text-xs text-muted">
          <Link to="/join/$code" params={{ code: room.room_code }} className="underline-offset-4 hover:underline">
            الانضمام كلاعب
          </Link>
        </p>
      </section>
    </Shell>
  );
}

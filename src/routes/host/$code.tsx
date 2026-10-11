import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/shell";
import { Button, cx } from "@/components/ui";
import { ensureSession, supabase } from "@/lib/supabase";

/**
 * Host screen for a room: the question board for the game (categories × points).
 * Only the room's host can use it. The correct answer comes from the
 * room_correct_answer() database function, never from the questions list.
 */
export const Route = createFileRoute("/host/$code")({
  head: () => ({ meta: [{ title: "شاشة المضيف — العش" }] }),
  component: HostBoard,
});

type Room = { id: string; room_code: string; host_id: string; status: string; game_id: string };
type Question = {
  id: string;
  category_ar: string;
  question_text: string;
  options: string[];
  points: number;
  difficulty: string;
};
type RoomState = {
  active_question_id: string | null;
  state_data: { answered?: string[]; phase?: string } & Record<string, unknown>;
};

function HostBoard() {
  const { code } = Route.useParams();
  const [room, setRoom] = useState<Room | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [isHost, setIsHost] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the room, its questions and its live state.
  useEffect(() => {
    if (!supabase) {
      setError("الاتصال بقاعدة البيانات غير مضبوط بعد.");
      return;
    }
    const client = supabase;
    let cancelled = false;

    async function load() {
      try {
        const session = await ensureSession();
        const { data: found, error: roomError } = await client
          .from("game_rooms")
          .select("id, room_code, host_id, status, game_id")
          .eq("room_code", code.toUpperCase())
          .maybeSingle();
        if (roomError) throw roomError;
        if (!found) throw new Error("ROOM_NOT_FOUND");
        const r = found as Room;
        if (cancelled) return;
        setRoom(r);
        setIsHost(r.host_id === session.user.id);

        const { data: game } = await client.from("games").select("slug").eq("id", r.game_id).single();
        const { data: qs } = await client
          .from("questions_public")
          .select("id, category_ar, question_text, options, points, difficulty")
          .eq("game_slug", game?.slug ?? "")
          .order("points");
        if (!cancelled) setQuestions((qs ?? []) as Question[]);

        const { data: state } = await client
          .from("room_game_state")
          .select("active_question_id, state_data")
          .eq("room_id", r.id)
          .maybeSingle();
        if (!cancelled) setRoomState((state ?? null) as RoomState | null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error && err.message === "ROOM_NOT_FOUND" ? "لم نجد هذه الغرفة." : "تعذّر تحميل الشاشة، حاول مرة أخرى.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Categories as columns, point values as rows.
  const { categories, pointRows } = useMemo(() => {
    const cats: string[] = [];
    const pts = new Set<number>();
    for (const q of questions) {
      if (!cats.includes(q.category_ar)) cats.push(q.category_ar);
      pts.add(q.points);
    }
    return { categories: cats, pointRows: [...pts].sort((a, b) => a - b) };
  }, [questions]);

  const answered = new Set(roomState?.state_data?.answered ?? []);
  const active = questions.find((q) => q.id === roomState?.active_question_id) ?? null;

  function questionAt(category: string, points: number) {
    return questions.find((q) => q.category_ar === category && q.points === points) ?? null;
  }

  async function openQuestion(q: Question) {
    if (!supabase || !room || !roomState) return;
    setBusy(true);
    setRevealed(null);
    setError(null);
    try {
      const nextData = { ...roomState.state_data, phase: "question", buzzer_open: true, buzzer: null, voting_open: false };
      const { error: updateError } = await supabase
        .from("room_game_state")
        .update({ active_question_id: q.id, state_data: nextData })
        .eq("room_id", room.id);
      if (updateError) throw updateError;
      setRoomState({ active_question_id: q.id, state_data: nextData });
    } catch {
      setError("تعذّر فتح السؤال.");
    } finally {
      setBusy(false);
    }
  }

  async function reveal() {
    if (!supabase || !room) return;
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("room_correct_answer", { p_room_id: room.id });
    if (rpcError) return setError("تعذّر كشف الإجابة.");
    setRevealed(typeof data === "string" ? data : null);
  }

  async function closeQuestion(markAnswered: boolean) {
    if (!supabase || !room || !roomState) return;
    setBusy(true);
    try {
      const done = new Set(roomState.state_data.answered ?? []);
      if (markAnswered && active) done.add(active.id);
      const nextData = { ...roomState.state_data, phase: "board", buzzer_open: false, answered: [...done] };
      const { error: updateError } = await supabase
        .from("room_game_state")
        .update({ active_question_id: null, state_data: nextData })
        .eq("room_id", room.id);
      if (updateError) throw updateError;
      setRoomState({ active_question_id: null, state_data: nextData });
      setRevealed(null);
    } catch {
      setError("تعذّر إغلاق السؤال.");
    } finally {
      setBusy(false);
    }
  }

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

  if (!room || isHost === null) {
    return (
      <Shell>
        <p className="mt-8 text-center text-sm text-muted">جارٍ التحميل…</p>
      </Shell>
    );
  }

  if (!isHost) {
    return (
      <Shell>
        <section className="glass-card mx-auto mt-8 max-w-xl rounded-3xl p-6 text-center">
          <p className="text-base font-bold text-ivory">هذه الشاشة للمضيف فقط.</p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell>
      <section className="mx-auto mt-4 max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-extrabold text-ivory">
            رمز الغرفة <span className="font-mono text-neon">{room.room_code}</span>
          </h1>
          <span className="text-sm text-muted">
            أُجيب {answered.size} من {questions.length}
          </span>
        </div>

        {active ? (
          <div className="glass-card mb-6 rounded-3xl p-6 text-center">
            <p className="text-sm font-bold text-violet">
              {active.category_ar} · {active.points} نقطة
            </p>
            <p className="mt-3 text-2xl font-extrabold leading-relaxed text-ivory">{active.question_text}</p>
            {active.options.length > 0 ? (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {active.options.map((opt) => (
                  <li key={opt} className="rounded-xl bg-white/[0.05] px-4 py-2 text-ivory">
                    {opt}
                  </li>
                ))}
              </ul>
            ) : null}
            {revealed ? (
              <p className="mt-4 rounded-xl border border-emerald/40 bg-emerald/10 p-3 font-bold text-ivory">
                الإجابة: {revealed}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button type="button" tone="glass" onClick={reveal} disabled={busy}>
                كشف الإجابة
              </Button>
              <Button type="button" tone="primary" onClick={() => closeQuestion(true)} disabled={busy}>
                انتهى السؤال
              </Button>
              <Button type="button" tone="danger" onClick={() => closeQuestion(false)} disabled={busy}>
                تخطّي
              </Button>
            </div>
          </div>
        ) : null}

        {questions.length === 0 ? (
          <p className="text-center text-sm text-muted">لا توجد أسئلة لهذه اللعبة بعد.</p>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[480px] gap-2"
              style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}
            >
              {categories.map((cat) => (
                <div key={cat} className="rounded-2xl bg-violet/20 p-3 text-center text-sm font-extrabold text-ivory">
                  {cat}
                </div>
              ))}
              {pointRows.map((points) =>
                categories.map((cat) => {
                  const q = questionAt(cat, points);
                  const done = q ? answered.has(q.id) : true;
                  return (
                    <button
                      key={`${cat}-${points}`}
                      type="button"
                      disabled={!q || done || busy || !!active}
                      onClick={() => q && openQuestion(q)}
                      className={cx(
                        "min-h-16 rounded-2xl border p-3 text-lg font-extrabold transition",
                        q && !done && !active
                          ? "border-neon/50 bg-white/[0.04] text-neon hover:bg-neon/10"
                          : "border-white/5 bg-white/[0.02] text-muted/40",
                      )}
                    >
                      {q && !done ? points : ""}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
        )}
      </section>
    </Shell>
  );
}

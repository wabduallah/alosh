import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/shell";
import { Button, cx } from "@/components/ui";
import { ensureSession, supabase } from "@/lib/supabase";

/**
 * Host screen for a room: the question board, the buzzer, and the scoreboard.
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
type Buzzer = { player_id: string; player_name: string } | null;
type StateData = {
  answered?: string[];
  phase?: string;
  buzzer_open?: boolean;
  buzzer?: Buzzer;
} & Record<string, unknown>;
type RoomState = { active_question_id: string | null; state_data: StateData };
type PlayerRow = { id: string; player_name: string; score: number; is_host: boolean };
/** Bluff game (سيد الخداع): counts from bluff_status() and the revealed options. */
type BluffStatus = { phase: string; submitted: number; voted: number; players: number };
type RevealOption = { key: string; text: string; is_correct: boolean; owner: string | null; votes: number };

function HostBoard() {
  const { code } = Route.useParams();
  const [room, setRoom] = useState<Room | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [isHost, setIsHost] = useState<boolean | null>(null);
  const [gameSlug, setGameSlug] = useState<string | null>(null);
  const [bluffStatus, setBluffStatus] = useState<BluffStatus | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isBluff = gameSlug === "bluff-master";
  const isOutsider = gameSlug === "outsider";

  // Load the room, its questions, its live state, and its players.
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
        if (!cancelled) setGameSlug(game?.slug ?? null);
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

        const { data: ps } = await client
          .from("room_players")
          .select("id, player_name, score, is_host")
          .eq("room_id", r.id);
        if (!cancelled) setPlayers((ps ?? []) as PlayerRow[]);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error && err.message === "ROOM_NOT_FOUND" ? "لم نجد هذه الغرفة." : "تعذّر تحميل الشاشة، حاول مرة أخرى.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Follow the buzzer, answers, and the scoreboard live.
  useEffect(() => {
    if (!supabase || !room) return;
    const client = supabase;
    const roomId = room.id;

    // Re-read the live state from the database. Used by realtime and by a short
    // polling fallback, because realtime events can be missed on some connections.
    async function refresh() {
      const [{ data: state }, { data: ps }] = await Promise.all([
        client.from("room_game_state").select("active_question_id, state_data").eq("room_id", roomId).maybeSingle(),
        client.from("room_players").select("id, player_name, score, is_host").eq("room_id", roomId),
      ]);
      if (state) setRoomState({ active_question_id: state.active_question_id ?? null, state_data: state.state_data ?? {} } as RoomState);
      if (ps) setPlayers(ps as PlayerRow[]);
    }

    const channel = client
      .channel(`host-board-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_game_state", filter: `room_id=eq.${roomId}` },
        () => {
          refresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${roomId}` },
        () => {
          refresh();
        },
      )
      .subscribe();

    const timer = window.setInterval(refresh, 2000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
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

  const answered = new Set(roomState?.state_data?.answered ?? []);
  const active = questions.find((q) => q.id === roomState?.active_question_id) ?? null;
  const buzzer = roomState?.state_data?.buzzer ?? null;
  const ranking = [...players].filter((p) => !p.is_host).sort((a, b) => b.score - a.score);
  const allDone = questions.length > 0 && answered.size >= questions.length;
  const gameOver = allDone || room?.status === "finished";
  const topScore = ranking.length ? ranking[0].score : 0;
  const winners = ranking.filter((p) => p.score === topScore);

  /** Ends the game for everyone: the room becomes "finished" and can't take new players. */
  async function endGame() {
    if (!supabase || !room) return;
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.from("game_rooms").update({ status: "finished" }).eq("id", room.id);
      if (updateError) throw updateError;
      setRoom({ ...room, status: "finished" });
    } catch {
      setError("تعذّر إنهاء الغرفة.");
    } finally {
      setBusy(false);
    }
  }

  function questionAt(category: string, points: number) {
    return questions.find((q) => q.category_ar === category && q.points === points) ?? null;
  }

  async function openQuestion(q: Question) {
    if (!supabase || !room || !roomState) return;
    setBusy(true);
    setRevealed(null);
    setError(null);
    try {
      const nextData: StateData = {
        ...roomState.state_data,
        phase: "question",
        // The bluff game has no buzzer: players write answers instead.
        buzzer_open: !isBluff,
        buzzer: null,
        voting_open: false,
        reveal: null,
      };
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

  /** Runs one step of the bluff round on the server (start, open vote, reveal, finish). */
  async function bluffStep(fn: "bluff_start_fakes" | "bluff_open_vote" | "bluff_reveal" | "bluff_finish_round") {
    if (!supabase || !room) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc(fn, { p_room_id: room.id });
      if (rpcError) throw rpcError;
      const result = data as { ok: boolean; reason?: string };
      if (!result.ok) {
        const messages: Record<string, string> = {
          NO_ACTIVE_QUESTION: "اختر سؤالًا من اللوحة أولًا.",
          WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
        };
        setError(messages[result.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.");
        return;
      }
      if (fn === "bluff_finish_round") {
        // Same bookkeeping as closing a question: mark it answered and return to the board.
        const done = new Set(roomState?.state_data?.answered ?? []);
        if (active) done.add(active.id);
        setRoomState({ active_question_id: null, state_data: { ...(roomState?.state_data ?? {}), phase: "board", answered: [...done], reveal: null } });
        setBluffStatus(null);
        setRevealed(null);
      }
      const { data: fresh } = await supabase
        .from("room_game_state")
        .select("active_question_id, state_data")
        .eq("room_id", room.id)
        .maybeSingle();
      if (fresh) setRoomState(fresh as RoomState);
      const { data: ps } = await supabase.from("room_players").select("id, player_name, score, is_host").eq("room_id", room.id);
      if (ps) setPlayers(ps as PlayerRow[]);
    } catch {
      setError("تعذّر تنفيذ الخطوة.");
    } finally {
      setBusy(false);
    }
  }

  // While a bluff question is active, keep the answer and vote counts fresh.
  useEffect(() => {
    if (!supabase || !room || !isBluff || !roomState?.active_question_id) return;
    const client = supabase;
    const roomId = room.id;
    let cancelled = false;
    async function loadStatus() {
      const { data } = await client.rpc("bluff_status", { p_room_id: roomId });
      if (!cancelled && data) setBluffStatus(data as BluffStatus);
    }
    loadStatus();
    const timer = window.setInterval(loadStatus, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [room?.id, isBluff, roomState?.active_question_id, roomState?.state_data?.phase]);

  async function reveal() {
    if (!supabase || !room) return;
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("room_correct_answer", { p_room_id: room.id });
    if (rpcError) return setError("تعذّر كشف الإجابة.");
    setRevealed(typeof data === "string" ? data : null);
  }

  /**
   * Host judged the buzzer's answer. The judge_answer() function on the server
   * awards points (or reopens the buzzer) in one locked transaction, so two
   * judgments can't overwrite each other.
   */
  async function judge(correct: boolean, penalty: "none" | "half" | "full" = "none") {
    if (!supabase || !room || !roomState || !active || !buzzer) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("judge_answer", {
        p_room_id: room.id,
        p_correct: correct,
        p_penalty: penalty,
      });
      if (rpcError) throw rpcError;
      const result = data as { ok: boolean; reason?: string };
      if (!result.ok) {
        setError(result.reason === "NO_BUZZER" ? "لا يوجد لاعب ضغط الجرس الآن." : "تعذّر حفظ الحكم.");
        return;
      }
      // Realtime also refreshes this, but reflect the change right away.
      const { data: fresh } = await supabase
        .from("room_game_state")
        .select("active_question_id, state_data")
        .eq("room_id", room.id)
        .maybeSingle();
      if (fresh) setRoomState(fresh as RoomState);
      const { data: ps } = await supabase
        .from("room_players")
        .select("id, player_name, score, is_host")
        .eq("room_id", room.id);
      if (ps) setPlayers(ps as PlayerRow[]);
    } catch {
      setError("تعذّر حفظ الحكم.");
    } finally {
      setBusy(false);
    }
  }

  async function closeQuestion(markAnswered: boolean) {
    if (!supabase || !room || !roomState) return;
    setBusy(true);
    try {
      const done = new Set(roomState.state_data.answered ?? []);
      if (markAnswered && active) done.add(active.id);
      const nextData: StateData = { ...roomState.state_data, phase: "board", buzzer_open: false, buzzer: null, answered: [...done] };
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

  if (error && !room) {
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

  if (isOutsider) {
    return (
      <Shell>
        <OutsiderHostPanel roomId={room.id} roomCode={room.room_code} roomStatus={room.status} />
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

        {error ? <p className="mb-4 text-sm text-crimson">{error}</p> : null}

        {gameOver ? (
          <div className="glass-card mb-6 rounded-3xl p-6 text-center">
            <p className="text-sm font-bold text-violet">انتهت اللعبة</p>
            {winners.length > 0 ? (
              <p className="mt-2 text-3xl font-extrabold text-ivory">
                {winners.length > 1 ? "التعادل بين: " : "الفائز: "}
                {winners.map((w) => w.player_name).join("، ")}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-muted">بنقاط {topScore}</p>
            {room.status !== "finished" ? (
              <Button type="button" tone="violet" className="mt-5" onClick={endGame} disabled={busy}>
                إنهاء الغرفة للجميع
              </Button>
            ) : null}
          </div>
        ) : null}

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

            {isBluff ? (
              <BluffHostPanel
                phase={String(roomState?.state_data?.phase ?? "")}
                status={bluffStatus}
                reveal={(roomState?.state_data?.reveal as RevealOption[] | undefined) ?? []}
                busy={busy}
                onStart={() => bluffStep("bluff_start_fakes")}
                onOpenVote={() => bluffStep("bluff_open_vote")}
                onReveal={() => bluffStep("bluff_reveal")}
                onFinish={() => bluffStep("bluff_finish_round")}
              />
            ) : null}

            {!isBluff ? (
            <div className="mt-5">
              {buzzer ? (
                <div className="rounded-2xl border border-violet/40 bg-violet/10 p-4">
                  <p className="text-sm text-muted">ضغط الجرس</p>
                  <p className="mt-1 text-xl font-extrabold text-ivory">{buzzer.player_name}</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-3">
                    <Button type="button" tone="primary" onClick={() => judge(true)} disabled={busy}>
                      إجابة صحيحة (+{active.points})
                    </Button>
                  </div>
                  <p className="mt-4 text-sm text-muted">إجابة خاطئة:</p>
                  <div className="mt-2 flex flex-wrap justify-center gap-3">
                    <Button type="button" tone="ghost" onClick={() => judge(false, "none")} disabled={busy}>
                      بدون خصم
                    </Button>
                    <Button type="button" tone="danger" onClick={() => judge(false, "half")} disabled={busy}>
                      خصم نصف النقاط (-{Math.floor(active.points / 2)})
                    </Button>
                    <Button type="button" tone="danger" onClick={() => judge(false, "full")} disabled={busy}>
                      خصم كامل النقاط (-{active.points})
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">{roomState?.state_data?.buzzer_open ? "بانتظار الجرس…" : "الجرس مغلق."}</p>
              )}
            </div>
            ) : null}

            {!isBluff && revealed ? (
              <p className="mt-4 rounded-xl border border-emerald/40 bg-emerald/10 p-3 font-bold text-ivory">
                الإجابة: {revealed}
              </p>
            ) : null}

            {!isBluff ? (
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button type="button" tone="glass" onClick={reveal} disabled={busy}>
                كشف الإجابة
              </Button>
              <Button type="button" tone="ghost" onClick={() => closeQuestion(true)} disabled={busy}>
                انتهى السؤال
              </Button>
              <Button type="button" tone="ghost" onClick={() => closeQuestion(false)} disabled={busy}>
                تخطّي
              </Button>
            </div>
            ) : (
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button type="button" tone="ghost" onClick={() => closeQuestion(false)} disabled={busy}>
                تخطّي
              </Button>
            </div>
            )}
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

        {ranking.length > 0 ? (
          <div className="glass-card mt-6 rounded-2xl p-4">
            <h2 className="mb-2 text-sm font-extrabold text-ivory">النتائج</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {ranking.map((p, i) => (
                <li key={p.id} className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3 py-2 text-sm text-ivory/80">
                  <span>
                    {i + 1}. {p.player_name}
                  </span>
                  <span className="font-extrabold text-neon">{p.score}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </Shell>
  );
}

type BluffPanelProps = {
  phase: string;
  status: BluffStatus | null;
  reveal: RevealOption[];
  busy: boolean;
  onStart: () => void;
  onOpenVote: () => void;
  onReveal: () => void;
  onFinish: () => void;
};

/** Host controls for one bluff round, step by step. */
function BluffHostPanel({ phase, status, reveal, busy, onStart, onOpenVote, onReveal, onFinish }: BluffPanelProps) {
  const total = status?.players ?? 0;
  return (
    <div className="mt-5 rounded-2xl border border-violet/40 bg-violet/10 p-4 text-center">
      {phase === "question" || phase === "" ? (
        <>
          <p className="text-sm text-muted">اكتب الجميع إجابة مزيفة مقنعة للسؤال.</p>
          <Button type="button" tone="primary" className="mt-3" onClick={onStart} disabled={busy}>
            ابدأ كتابة الإجابات
          </Button>
        </>
      ) : null}

      {phase === "fakes" ? (
        <>
          <p className="text-sm text-muted">
            أرسل الإجابة {status?.submitted ?? 0} من {total}
          </p>
          <Button type="button" tone="primary" className="mt-3" onClick={onOpenVote} disabled={busy || (status?.submitted ?? 0) === 0}>
            افتح التصويت
          </Button>
        </>
      ) : null}

      {phase === "vote" ? (
        <>
          <p className="text-sm text-muted">
            صوّت {status?.voted ?? 0} من {total}
          </p>
          <Button type="button" tone="primary" className="mt-3" onClick={onReveal} disabled={busy}>
            اكشف النتائج وأضف النقاط
          </Button>
        </>
      ) : null}

      {phase === "reveal" ? (
        <>
          <ul className="mt-2 grid gap-2 text-right">
            {reveal.map((o) => (
              <li
                key={o.key}
                className={cx(
                  "flex items-center justify-between rounded-xl px-4 py-2 text-sm",
                  o.is_correct ? "border border-emerald/40 bg-emerald/10 text-ivory" : "bg-white/[0.04] text-ivory/80",
                )}
              >
                <span>
                  {o.text}
                  {o.owner ? <span className="mr-2 text-xs text-violet">({o.owner})</span> : null}
                </span>
                <span className="font-extrabold">{o.is_correct ? "✓ " : ""}{o.votes} صوت</span>
              </li>
            ))}
          </ul>
          <Button type="button" tone="primary" className="mt-4" onClick={onFinish} disabled={busy}>
            التالي
          </Button>
        </>
      ) : null}
    </div>
  );
}


type OutsiderStatus = { phase: string; round: number; voted: number; players: number };
type OutsiderVoteCount = { name: string; votes: number };
type OutsiderReveal = {
  outsider?: string;
  caught?: boolean;
  topic?: string;
  word?: string;
  guess?: string;
  guess_ok?: boolean;
  votes?: OutsiderVoteCount[];
};

const OUTSIDER_HOST_ERRORS: Record<string, string> = {
  NOT_ENOUGH_PLAYERS: "تحتاج الجولة إلى 3 لاعبين على الأقل.",
  ROOM_NOT_PLAYING: "ابدأ الغرفة أولًا.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
};

/** Host controls for برة السالفة: start, vote, reveal, and the next round. */
function OutsiderHostPanel({ roomId, roomCode, roomStatus }: { roomId: string; roomCode: string; roomStatus: string }) {
  const [status, setStatus] = useState<OutsiderStatus | null>(null);
  const [reveal, setReveal] = useState<OutsiderReveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(roomStatus === "finished");

  async function refresh() {
    if (!supabase) return;
    const [{ data: st }, { data: gs }] = await Promise.all([
      supabase.rpc("outsider_status", { p_room_id: roomId }),
      supabase.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
    ]);
    if (st) setStatus(st as OutsiderStatus);
    setReveal(((gs?.state_data as { reveal?: OutsiderReveal } | undefined)?.reveal ?? null) as OutsiderReveal | null);
  }

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (!cancelled) refresh();
    };
    tick();
    const timer = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // refresh only depends on roomId, which the effect already tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  /** Calls one step on the server; returns true when it succeeded. */
  async function call(fn: "outsider_start_round" | "outsider_open_vote" | "outsider_reveal" | "outsider_finish_round") {
    if (!supabase) return false;
    const { data, error: rpcError } = await supabase.rpc(fn, { p_room_id: roomId });
    if (rpcError) throw rpcError;
    const result = data as { ok: boolean; reason?: string };
    if (!result.ok) {
      setError(OUTSIDER_HOST_ERRORS[result.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.");
      return false;
    }
    return true;
  }

  async function step(fn: Parameters<typeof call>[0]) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await call(fn);
      await refresh();
    } catch {
      setError("تعذّر تنفيذ الخطوة.");
    } finally {
      setBusy(false);
    }
  }

  /** Finish the current round and start the next one in one go. */
  async function nextRound() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await call("outsider_finish_round")) await call("outsider_start_round");
      await refresh();
    } catch {
      setError("تعذّر بدء الجولة التالية.");
    } finally {
      setBusy(false);
    }
  }

  async function endGame() {
    if (!supabase) return;
    setBusy(true);
    try {
      const { error: updateError } = await supabase.from("game_rooms").update({ status: "finished" }).eq("id", roomId);
      if (updateError) throw updateError;
      setEnded(true);
    } catch {
      setError("تعذّر إنهاء الغرفة.");
    } finally {
      setBusy(false);
    }
  }

  const phase = status?.phase ?? "";
  const round = status?.round ?? 0;

  return (
    <section className="mx-auto mt-4 max-w-2xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-ivory">
          رمز الغرفة <span className="font-mono text-neon">{roomCode}</span>
        </h1>
        <span className="text-sm text-muted">الجولة {round}</span>
      </div>

      {error ? <p className="mb-4 text-sm text-crimson">{error}</p> : null}

      <div className="glass-card rounded-3xl p-6 text-center">
        {phase === "" || phase === "idle" || phase === "board" ? (
          <>
            <p className="text-sm text-muted">تُختار الكلمة والبرة عشوائيًا.</p>
            <Button type="button" tone="primary" className="mt-4" onClick={() => step("outsider_start_round")} disabled={busy}>
              ابدأ الجولة
            </Button>
          </>
        ) : null}

        {phase === "discuss" ? (
          <>
            <p className="text-lg font-bold text-ivory">الجولة جارية: ناقشوا الكلمة بالصوت.</p>
            <p className="mt-2 text-sm text-muted">لا تذكروا الكلمة بوضوح، والبرة يحاول أن يتعرّف عليها.</p>
            <Button type="button" tone="primary" className="mt-4" onClick={() => step("outsider_open_vote")} disabled={busy}>
              افتح التصويت
            </Button>
          </>
        ) : null}

        {phase === "vote" ? (
          <>
            <p className="text-lg font-bold text-ivory">
              صوّت {status?.voted ?? 0} من {status?.players ?? 0}
            </p>
            <Button type="button" tone="primary" className="mt-4" onClick={() => step("outsider_reveal")} disabled={busy}>
              اكشف النتائج
            </Button>
          </>
        ) : null}

        {phase === "guess" ? (
          <>
            <p className="text-lg font-bold text-ivory">{reveal?.outsider ?? "البرة"} برة السالفة!</p>
            <p className="mt-2 text-sm text-muted">بانتظار تخمينه للكلمة…</p>
          </>
        ) : null}

        {phase === "done" && reveal ? (
          <>
            <p className="text-sm text-muted">{reveal.caught ? "تم كشف البرة" : "لم يُكشف البرة"}</p>
            <p className="mt-1 text-xl font-extrabold text-ivory">البرة: {reveal.outsider}</p>
            <p className="mt-2 text-sm text-muted">
              الموضوع: {reveal.topic} · الكلمة: <span className="font-bold text-ivory">{reveal.word}</span>
            </p>
            {reveal.guess !== undefined ? (
              <p className="mt-2 text-sm text-ivory">
                تخمينه: {reveal.guess} {reveal.guess_ok ? "✓" : "✗"}
              </p>
            ) : null}
            <Button type="button" tone="primary" className="mt-5" onClick={nextRound} disabled={busy}>
              جولة جديدة
            </Button>
          </>
        ) : null}

        {reveal?.votes && reveal.votes.length > 0 && (phase === "guess" || phase === "done") ? (
          <ul className="mt-5 grid gap-2 text-right">
            {reveal.votes.map((v) => (
              <li key={v.name} className="flex items-center justify-between rounded-xl bg-white/[0.04] px-4 py-2 text-sm text-ivory">
                <span>{v.name}</span>
                <span className="font-bold">{v.votes} صوت</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {!ended ? (
        <div className="mt-6 text-center">
          <Button type="button" tone="violet" onClick={endGame} disabled={busy}>
            إنهاء الغرفة للجميع
          </Button>
        </div>
      ) : (
        <p className="mt-6 text-center text-sm text-muted">انتهت الغرفة.</p>
      )}
    </section>
  );
}

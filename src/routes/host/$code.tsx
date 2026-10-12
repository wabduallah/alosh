import { createFileRoute, Link } from "@tanstack/react-router";
import { rememberRoom } from "@/lib/prefs";
import { useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { NextGame } from "@/components/next-game";
import { GridHostPanel } from "@/components/grid";
import { useRoomSession } from "@/lib/room-session";
import { Button, buttonBase, buttonTone, cx } from "@/components/ui";
import { Glyph } from "@/components/brand";
import { ShareRoom } from "@/components/share";
import { HalbaHostPanel } from "@/components/halba";
import { MafiaShare, MafiaSummary, ROLE_ICONS, ROLE_NAMES, VotesView, WINNERS, mmss, narratorLine, useCountdown, type MafiaPlayerRow, type MafiaPublicState } from "@/components/mafia";
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
  const isHeads = gameSlug === "heads-up";
  const isMafia = gameSlug === "social-mafia";
  const isHalba = gameSlug === "alhalba";
  const isGrid = gameSlug === "tactical-grid";

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
        if (r.host_id === session.user.id && r.status !== "finished") rememberRoom(r.room_code, true);

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
  const liveStatus = useRoomSession(room?.id);
  const gameOver = allDone || room?.status === "finished" || liveStatus === "finished";
  // Any game is over: offer a new round in the same room (same players, same code).
  const roundOver = gameOver || roomState?.state_data?.phase === "over";
  const nextGame = room && roundOver ? <NextGame roomId={room.id} roomCode={room.room_code} currentSlug={gameSlug} className="mx-auto mt-5 max-w-3xl" /> : null;
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
      <Shell play>
        <section className="glass-card mx-auto mt-8 max-w-xl rounded-[28px] p-6 text-center">
          <p className="text-sm text-wrong">{error}</p>
          <Link to="/" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-line-strong/70 px-5 text-sm font-bold text-ivory">
            الرئيسية
          </Link>
        </section>
      </Shell>
    );
  }

  if (!room || isHost === null) {
    return (
      <Shell play>
        <p className="mt-8 text-center text-sm text-muted">جارٍ التحميل…</p>
      </Shell>
    );
  }

  if (!isHost) {
    return (
      <Shell play>
        <section className="glass-card mx-auto mt-8 max-w-xl rounded-[28px] p-6 text-center">
          <p className="text-base font-bold text-ivory">هذه الشاشة للمضيف فقط.</p>
        </section>
      </Shell>
    );
  }

  if (isOutsider) {
    return (
      <Shell play>
        <ShareRoom code={room.room_code} />
        <TvLink code={room.room_code} />
        <OutsiderHostPanel roomId={room.id} roomCode={room.room_code} roomStatus={room.status} />
        {nextGame}
      </Shell>
    );
  }

  if (isMafia) {
    return (
      <Shell play>
        <ShareRoom code={room.room_code} />
        <TvLink code={room.room_code} />
        <MafiaHostPanel roomId={room.id} roomCode={room.room_code} roomStatus={room.status} />
        {nextGame}
      </Shell>
    );
  }

  if (isGrid) {
    return (
      <Shell play>
        <ShareRoom code={room.room_code} />
        <TvLink code={room.room_code} />
        <GridHostPanel roomId={room.id} />
        {nextGame}
      </Shell>
    );
  }

  if (isHalba) {
    return (
      <Shell play>
        <ShareRoom code={room.room_code} />
        <TvLink code={room.room_code} />
        <HalbaHostPanel roomId={room.id} roomCode={room.room_code} roomStatus={room.status} />
        {nextGame}
      </Shell>
    );
  }

  if (isHeads) {
    return (
      <Shell play>
        <ShareRoom code={room.room_code} />
        <TvLink code={room.room_code} />
        <HeadsHostPanel roomId={room.id} roomCode={room.room_code} roomStatus={room.status} />
        {nextGame}
      </Shell>
    );
  }

  return (
    <Shell play>
      <section className="mx-auto mt-2 max-w-5xl tv:max-w-[1440px]">
        <div className="surface mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[22px] px-4 py-3 lg:px-6 lg:py-4">
          <h1 className="flex flex-wrap items-center gap-3 text-xl font-extrabold text-ivory lg:text-2xl tv:text-4xl">
            رمز الغرفة <span className="room-code rounded-[12px] border border-gold/40 bg-night/60 px-3 py-0.5 text-gold shadow-glow-gold">{room.room_code}</span>
          </h1>
          <span className="text-sm text-muted lg:text-base tv:text-2xl">
            أُجيب {answered.size} من {questions.length}
          </span>
        </div>

        <ShareRoom code={room.room_code} />
        <TvLink code={room.room_code} />

        {error ? <p className="mb-4 text-sm text-wrong">{error}</p> : null}

        {gameOver ? (
          <div className="glass-card mb-6 rounded-[28px] p-6 text-center lg:p-8 tv:p-12">
            <Glyph name="trophy" className="mx-auto mb-2 size-12 text-gold tv:size-20" />
            <p className="text-sm font-bold text-violet-text lg:text-lg tv:text-2xl">انتهت اللعبة</p>
            {winners.length > 0 ? (
              <p className="mt-2 font-display text-3xl font-extrabold text-ivory lg:text-5xl tv:text-7xl">
                {winners.length > 1 ? "التعادل بين: " : "الفائز: "}
                {winners.map((w) => w.player_name).join("، ")}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-muted lg:text-lg tv:text-2xl">بنقاط {topScore}</p>
            {room.status !== "finished" ? (
              <Button type="button" tone="violet" className="mt-5" onClick={endGame} disabled={busy}>
                إنهاء الغرفة للجميع
              </Button>
            ) : null}
          </div>
        ) : null}
        {gameOver ? <NextGame roomId={room.id} roomCode={room.room_code} currentSlug={gameSlug} className="mb-6" /> : null}

        {active ? (
          <div className="glass-card mb-6 rounded-[28px] p-6 text-center lg:p-8 tv:p-12">
            <p className="inline-flex rounded-full bg-violet/20 px-3 py-1 text-sm font-bold text-violet-text lg:text-lg tv:px-5 tv:text-2xl">
              {active.category_ar} · {active.points} نقطة
            </p>
            <p className="mt-3 font-display text-2xl font-extrabold leading-relaxed text-ivory lg:text-4xl lg:leading-[1.5] tv:text-6xl">{active.question_text}</p>
            {active.options.length > 0 ? (
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {active.options.map((opt) => (
                  <li key={opt} className="rounded-[16px] border border-line-strong/60 bg-deep-2/70 px-4 py-3 text-lg font-semibold text-ivory lg:text-2xl tv:py-5 tv:text-4xl">
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
                <div className="rounded-[22px] border border-violet/50 bg-violet/15 p-4 shadow-glow-violet lg:p-6">
                  <p className="inline-flex items-center gap-1.5 text-sm text-muted lg:text-lg tv:text-2xl">
                    <Glyph name="bell" className="size-5 text-gold tv:size-8" />
                    ضغط الجرس
                  </p>
                  <p className="mt-1 font-display text-2xl font-extrabold text-ivory lg:text-4xl tv:text-6xl">{buzzer.player_name}</p>
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
                <p className="inline-flex items-center gap-2 text-sm text-muted lg:text-lg tv:text-2xl"><Glyph name="bell" className="size-5" />{roomState?.state_data?.buzzer_open ? "بانتظار الجرس…" : "الجرس مغلق."}</p>
              )}
            </div>
            ) : null}

            {!isBluff && revealed ? (
              <p className="mt-4 rounded-[16px] border border-correct/50 bg-correct-fill/15 p-3 font-bold text-ivory lg:text-2xl tv:p-5 tv:text-4xl">
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
              className="grid min-w-[480px] gap-2 lg:gap-3"
              style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}
            >
              {categories.map((cat) => (
                <div key={cat} className="grid min-h-14 place-items-center rounded-[14px] border border-violet/40 bg-violet/20 p-2 text-center text-[15px] font-semibold text-ivory lg:min-h-16 lg:text-lg tv:min-h-24 tv:text-3xl">
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
                        "grid min-h-16 place-items-center rounded-[14px] border p-3 text-[22px] font-bold tabular-nums transition lg:min-h-20 lg:text-3xl tv:min-h-28 tv:text-5xl",
                        q && !done && !active
                          ? "border-glow/40 bg-deep text-gold shadow-[0_0_18px_-8px_#6b7bff] hover:border-gold hover:shadow-glow-gold"
                          : done && q
                            ? "border-dashed border-line bg-transparent text-faint"
                            : "border-line bg-deep/60 text-faint",
                      )}
                      aria-label={q ? `${cat} ${points}${done ? " — أُجيب" : ""}` : undefined}
                    >
                      {q && !done ? points : q ? <Glyph name="check" className="size-4" /> : ""}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
        )}

        {ranking.length > 0 ? (
          <div className="glass-card mt-6 rounded-[24px] p-5 tv:p-8">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-ivory tv:text-3xl">
              <Glyph name="trophy" className="size-5 text-gold tv:size-8" />
              النتائج
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {ranking.map((p, i) => (
                <li key={p.id} className="flex items-center justify-between rounded-[14px] border border-line bg-deep-2/50 px-4 py-2.5 text-base text-ivory/90 tv:py-4 tv:text-2xl">
                  <span>
                    {i + 1}. {p.player_name}
                  </span>
                  <span className="font-extrabold text-gold">{p.score}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </Shell>
  );
}

/** Opens the display-only TV screen for this room in a new tab (cast it or open it on the TV). */
function TvLink({ code }: { code: string }) {
  return (
    <div className="-mt-1 mb-4 flex justify-center">
      <Link to="/tv/$code" params={{ code }} target="_blank" className={cx(buttonBase, buttonTone("outline"))}>
        <Glyph name="tv" />
        افتح شاشة التلفزيون
      </Link>
    </div>
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
                  o.is_correct ? "border border-correct/50 bg-correct-fill/15 text-ivory" : "bg-deep-2/60 text-ivory/80",
                )}
              >
                <span>
                  {o.text}
                  {o.owner ? <span className="mr-2 text-xs text-violet-text">({o.owner})</span> : null}
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
    <section className="mx-auto mt-2 max-w-2xl lg:max-w-3xl tv:max-w-5xl">
      <div className="surface mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[22px] px-4 py-3 lg:px-6 lg:py-4">
        <h1 className="flex flex-wrap items-center gap-3 text-xl font-extrabold text-ivory lg:text-2xl tv:text-4xl">
          رمز الغرفة <span className="room-code rounded-[12px] border border-gold/40 bg-night/60 px-3 py-0.5 text-gold shadow-glow-gold">{roomCode}</span>
        </h1>
        <span className="text-sm text-muted">الجولة {round}</span>
      </div>

      {error ? <p className="mb-4 text-sm text-wrong">{error}</p> : null}

      <div className="glass-card rounded-[28px] p-6 text-center">
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
              <li key={v.name} className="flex items-center justify-between rounded-xl bg-deep-2/60 px-4 py-2 text-sm text-ivory">
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


type HeadsPlayer = { id: string; player_name: string; team_color: string | null; is_host: boolean };
type HeadsState = {
  phase?: string;
  guesser_id?: string;
  turn_ends_at?: string | null;
  team_scores?: Record<string, number>;
  queue?: string[];
};

const TEAM_NAMES: Record<string, string> = { red: "الفريق الأحمر", blue: "الفريق الأزرق" };

const HEADS_HOST_ERRORS: Record<string, string> = {
  GAME_OVER: "انتهت كل الكلمات.",
  ROOM_NOT_PLAYING: "ابدأ الغرفة أولًا.",
  NOT_ENOUGH_PLAYERS: "تحتاج اللعبة إلى لاعبين على الأقل.",
  NO_TEAM: "المخمِّن ليس في فريق.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  NO_ACTIVE_WORD: "لا توجد كلمة الآن.",
  NO_WORDS: "لا توجد كلمات في التصنيفات المختارة.",
};

/** Parses a timestamp from JSON, trimming microseconds that JS can't read. */
function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(t) ? null : t;
}

/** Host controls for هل تعرف: teams, timer, correct / pass / end turn. */
function HeadsHostPanel({ roomId, roomCode, roomStatus }: { roomId: string; roomCode: string; roomStatus: string }) {
  const [state, setState] = useState<HeadsState>({});
  const [players, setPlayers] = useState<HeadsPlayer[]>([]);
  const [word, setWord] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [ended, setEnded] = useState(roomStatus === "finished");

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;
    async function load() {
      const [{ data: gs }, { data: ps }, { data: w }] = await Promise.all([
        client.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
        client.from("room_players").select("id, player_name, team_color, is_host").eq("room_id", roomId).order("joined_at"),
        client.rpc("heads_my_word", { p_room_id: roomId }),
      ]);
      if (cancelled) return;
      if (gs) setState((gs.state_data ?? {}) as HeadsState);
      if (ps) setPlayers(ps as HeadsPlayer[]);
      setWord(typeof w === "string" && w ? w : null);
    }
    load();
    client.rpc("heads_categories").then(({ data }) => {
      if (cancelled || !Array.isArray(data)) return;
      const names = data.filter((c): c is string => typeof c === "string");
      setCategories(names);
      setPicked((current) => current ?? names);
    });
    const poll = window.setInterval(load, 2000);
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [roomId]);

  const phase = state.phase ?? "";
  const scores = { red: state.team_scores?.red ?? 0, blue: state.team_scores?.blue ?? 0 };
  const guesser = players.find((p) => p.id === state.guesser_id) ?? null;
  const endsAt = parseTime(state.turn_ends_at);
  const secondsLeft = phase === "turn" && endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;
  const timeUp = secondsLeft === 0;

  /** Runs one server step; returns true when it succeeded. */
  async function run(
    fn: "heads_start_turn" | "heads_correct" | "heads_pass" | "heads_end_turn",
    extra: Record<string, unknown> = {},
  ) {
    if (!supabase || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc(fn, { p_room_id: roomId, ...extra });
      if (rpcError) throw rpcError;
      const result = data as { ok: boolean; reason?: string };
      if (!result.ok) {
        setError(HEADS_HOST_ERRORS[result.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.");
        return false;
      }
      return true;
    } catch {
      setError("تعذّر تنفيذ الخطوة.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Keyboard shortcuts for the host: → correct, ← pass.
  useEffect(() => {
    if (phase !== "turn") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") run("heads_correct");
      if (e.key === "ArrowLeft") run("heads_pass");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // run reads busy/roomId; re-binding on phase change is enough here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, busy]);

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

  const winner =
    scores.red === scores.blue ? "تعادل" : scores.red > scores.blue ? "الفريق الأحمر" : "الفريق الأزرق";

  return (
    <section className="mx-auto mt-2 max-w-2xl lg:max-w-3xl tv:max-w-5xl">
      <div className="surface mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[22px] px-4 py-3 lg:px-6 lg:py-4">
        <h1 className="flex flex-wrap items-center gap-3 text-xl font-extrabold text-ivory lg:text-2xl tv:text-4xl">
          رمز الغرفة <span className="room-code rounded-[12px] border border-gold/40 bg-night/60 px-3 py-0.5 text-gold shadow-glow-gold">{roomCode}</span>
        </h1>
        <span className="text-sm text-muted">هل تعرف</span>
      </div>

      {error ? <p className="mb-4 text-sm text-wrong">{error}</p> : null}

      <div className="glass-card rounded-[28px] p-6 text-center">
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl bg-deep-2/60 p-4">
            <p className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-team-red">
              <Glyph name="triangle" className="size-3.5" />
              الفريق الأحمر
            </p>
            <p className="text-4xl font-bold tabular-nums text-ivory tv:text-7xl">{scores.red}</p>
          </div>
          <div className="rounded-2xl bg-deep-2/60 p-4">
            <p className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-team-blue">
              <Glyph name="circle" className="size-3.5" />
              الفريق الأزرق
            </p>
            <p className="text-4xl font-bold tabular-nums text-ivory tv:text-7xl">{scores.blue}</p>
          </div>
        </div>

        {phase === "turn" ? (
          <>
            <p className="mt-6 text-sm text-muted">
              المخمِّن: <span className="font-bold text-ivory">{guesser?.player_name ?? "—"}</span>
              {guesser?.team_color ? ` (${TEAM_NAMES[guesser.team_color ?? ""] ?? ""})` : ""}
            </p>
            {word ? (
              <p className="mt-3 rounded-2xl border border-gold/40 bg-deep-2/60 px-4 py-3 text-lg font-extrabold text-gold">
                الكلمة (للوصف فقط): {word}
              </p>
            ) : null}
            <p dir="ltr" className={cx("mt-2 text-5xl font-bold tabular-nums tv:text-8xl", timeUp ? "text-wrong" : "text-gold")}>
              {timeUp ? "انتهى الوقت" : `${secondsLeft ?? 0}s`}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button type="button" tone="primary" onClick={() => run("heads_correct")} disabled={busy}>
                إجابة صحيحة (+1)
              </Button>
              <Button type="button" tone="ghost" onClick={() => run("heads_pass")} disabled={busy}>
                تخطّي
              </Button>
              <Button type="button" tone="danger" onClick={() => run("heads_end_turn")} disabled={busy}>
                إنهاء الدور
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted">اختصارات لوحة المفاتيح: → صحيح، ← تخطّي</p>
          </>
        ) : null}

        {phase === "" || phase === "between" || phase === "idle" ? (
          <>
            <p className="mt-6 text-sm text-muted">ابدأ دورًا جديدًا. يتناوب اللاعبون على التخمين.</p>
            {!state.queue && categories.length > 0 ? (
              <div className="mx-auto mt-5 max-w-md">
                <p className="text-sm font-bold text-ivory">اختاروا التصنيفات</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {categories.map((c) => {
                    const on = (picked ?? []).includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() =>
                          setPicked((current) => {
                            const list = current ?? [];
                            return on ? list.filter((x) => x !== c) : [...list, c];
                          })
                        }
                        className={cx(
                          "min-h-11 rounded-full border px-4 text-sm font-bold transition",
                          on ? "border-gold bg-gold/10 text-gold" : "border-line text-muted",
                        )}
                        aria-pressed={on}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <Button
              type="button"
              tone="primary"
              className="mt-4"
              onClick={() => run("heads_start_turn", { p_categories: picked && picked.length > 0 ? picked : null })}
              disabled={busy || (!state.queue && (picked ?? []).length === 0 && categories.length > 0)}
            >
              ابدأ الدور
            </Button>
          </>
        ) : null}

        {phase === "turn_over" || phase === "over" ? (
          <>
            <p className="mt-6 text-xl font-extrabold text-ivory">انتهت كل الكلمات</p>
            <p className="mt-2 text-sm text-muted">
              {scores.red === scores.blue ? "تعادل" : `الفائز: ${winner} بـ ${Math.max(scores.red, scores.blue)} نقطة`}
            </p>
          </>
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

type MafiaState = MafiaPublicState;

const MAFIA_HOST_ERRORS: Record<string, string> = {
  ROOM_NOT_PLAYING: "ابدأ الغرفة أولًا.",
  ALREADY_STARTED: "اللعبة بدأت بالفعل.",
  NOT_ENOUGH_PLAYERS: "تحتاج المافيا إلى 5 لاعبين على الأقل غير المضيف.",
  TOO_MANY_PLAYERS: "الحد الأقصى 14 لاعبًا.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  NO_STATE: "تعذّر تحميل اللعبة.",
  BAD_MAFIA_COUNT: "عدد المافيا لازم يكون أقل من نصف اللاعبين.",
  TOO_MANY_ROLES: "الأدوار أكثر من اللاعبين. قلّل الأدوار الإضافية أو عدد المافيا.",
  NOT_OVER: "المباراة لم تنتهِ بعد.",
};

/** mafia_progress(): votes for everyone, night actions for the host only (mafia_v2.sql). */
type MafiaProgress = { phase?: string; done?: number; total?: number; mafia_split?: boolean };

function MafiaHostPanel({ roomId, roomCode, roomStatus }: { roomId: string; roomCode: string; roomStatus: string }) {
  const [state, setState] = useState<MafiaState>({});
  const [rows, setRows] = useState<MafiaPlayerRow[]>([]);
  const [guests, setGuests] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(roomStatus === "finished");
  const [progress, setProgress] = useState<MafiaProgress | null>(null);
  const [auto, setAuto] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  // Setup
  const [mafiaCount, setMafiaCount] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [daySeconds, setDaySeconds] = useState(120);
  const [jester, setJester] = useState(false);
  const [mayor, setMayor] = useState(false);
  const [bodyguard, setBodyguard] = useState(false);
  const [sniper, setSniper] = useState(false);
  const [seer, setSeer] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;
    async function load() {
      const [{ data: gs }, { data: list }, { data: prog }, { count }] = await Promise.all([
        client.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
        client.rpc("mafia_players", { p_room_id: roomId }),
        client.rpc("mafia_progress", { p_room_id: roomId }),
        client.from("room_players").select("id", { count: "exact", head: true }).eq("room_id", roomId).eq("is_host", false),
      ]);
      if (cancelled) return;
      if (gs) setState((gs.state_data ?? {}) as MafiaState);
      if (list) setRows(list as MafiaPlayerRow[]);
      setProgress((prog ?? null) as MafiaProgress | null);
      if (typeof count === "number") setGuests(count);
    }
    load();
    const poll = window.setInterval(load, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [roomId]);

  async function step(fn: "mafia_start" | "mafia_resolve_night" | "mafia_open_vote" | "mafia_close_vote" | "mafia_reset", args: Record<string, unknown> = {}) {
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc(fn, { p_room_id: roomId, ...args });
      if (rpcError) throw rpcError;
      const result = data as { ok: boolean; reason?: string };
      if (!result.ok) setError(MAFIA_HOST_ERRORS[result.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.");
    } catch {
      setError("تعذّر تنفيذ الخطوة.");
    } finally {
      setBusy(false);
    }
  }

  async function endGame() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
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

  const phase = state.phase ?? "";
  const round = state.round ?? 1;
  const over = phase === "over";
  const alive = rows.filter((p) => p.alive).length;
  const runoff = Array.isArray(state.runoff) ? state.runoff : null;

  // After «مباراة جديدة», the setup starts from the last match's choices.
  const prefilled = useRef(false);
  useEffect(() => {
    const last = state.last_settings;
    if (phase !== "" || !last || prefilled.current) return;
    prefilled.current = true;
    setMafiaCount(last.auto_mafia === false ? (last.mafia ?? 0) : 0);
    setReveal(!!last.reveal_roles);
    setDaySeconds(last.day_seconds ?? 120);
    setJester(!!last.jester);
    setMayor(!!last.mayor);
    setBodyguard(!!last.bodyguard);
    setSniper(!!last.sniper);
    setSeer(!!last.seer);
  }, [phase, state.last_settings]);
  useEffect(() => {
    if (phase !== "") prefilled.current = false;
  }, [phase]);

  const dayLeft = useCountdown(phase === "day" ? state.day_ends_at : null);
  const complete = !!progress && progress.phase === phase && (phase === "night" || phase === "vote") && (progress.total ?? 0) > 0 && (progress.done ?? 0) >= (progress.total ?? 0);
  const stepKey = `${phase}:${round}:${runoff ? "r" : ""}`;

  // Everyone has chosen: move on by itself after 5 seconds, unless the host turns it off.
  useEffect(() => {
    if (!auto || !complete) {
      setCountdown(null);
      return;
    }
    setCountdown(5);
    const t = window.setInterval(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [auto, complete, stepKey]);
  useEffect(() => {
    if (countdown !== 0) return;
    setCountdown(null);
    if (phase === "night") void step("mafia_resolve_night");
    else if (phase === "vote") void step("mafia_close_vote");
    // step is stable for this one-shot call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  // The day timer ran out: open the vote (when automatic moves are on).
  const dayDone = useRef("");
  useEffect(() => {
    if (phase !== "day" || dayLeft !== 0 || !auto || dayDone.current === stepKey) return;
    dayDone.current = stepKey;
    void step("mafia_open_vote");
    // step is stable for this one-shot call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, dayLeft, auto, stepKey]);

  const headline =
    phase === "" ? "جاهزون للبدء؟"
    : phase === "night" ? `🌙 ليل الجولة ${round}`
    : phase === "day" ? `☀️ نهار الجولة ${round}`
    : phase === "vote" ? (runoff ? "إعادة التصويت" : "التصويت")
    : "انتهت اللعبة";

  const maxMafia = Math.max(1, Math.floor((guests - 1) / 2));
  const autoMafia = guests >= 10 ? 3 : guests >= 7 ? 2 : 1;
  const plannedMafia = mafiaCount || autoMafia;
  const special = 2 + Number(jester) + Number(mayor) + Number(bodyguard) + Number(sniper) + Number(seer);
  const fits = guests >= 5 && plannedMafia * 2 < guests && plannedMafia + special < guests;

  return (
    <section className="mx-auto mt-2 max-w-2xl lg:max-w-3xl tv:max-w-5xl">
      <div className="glass-card rounded-[28px] p-6 text-center">
        <p className="text-xs font-bold text-violet-text">رمز الغرفة</p>
        <p className="room-code mt-1 text-3xl text-gold">{roomCode}</p>
        <p className="mt-4 text-xl font-extrabold text-ivory">{headline}</p>
        {state.last_result ? <p className="mt-3 text-sm font-bold text-ivory">{state.last_result}</p> : null}

        {narratorLine(state, rows) ? (
          <div className="mt-4 rounded-2xl border border-violet-text/40 bg-violet-fill/10 p-3 text-start">
            <p className="text-xs font-bold text-violet-text">🎙️ اقرأ بصوت عالٍ</p>
            <p className="mt-1 text-[15px] leading-7 text-ivory">{narratorLine(state, rows)}</p>
          </div>
        ) : null}

        {phase === "" ? (
          <div className="mt-5 grid gap-4 text-start">
            <p className="text-center text-sm text-muted">
              في الغرفة {guests} {guests > 2 && guests < 11 ? "لاعبين" : "لاعبًا"} غير المضيف. المضيف هو الراوي ولا يلعب.
            </p>
            <MafiaChoice
              label="عدد المافيا"
              value={mafiaCount}
              onChange={setMafiaCount}
              options={[{ value: 0, label: `تلقائي (${autoMafia})` }, ...[1, 2, 3, 4].filter((n) => n <= maxMafia).map((n) => ({ value: n, label: String(n) }))]}
            />
            <MafiaChoice
              label="مؤقت النهار (للنقاش)"
              value={daySeconds}
              onChange={setDaySeconds}
              options={[
                { value: 0, label: "بدون" },
                { value: 60, label: "دقيقة" },
                { value: 120, label: "دقيقتان" },
                { value: 180, label: "3 دقائق" },
                { value: 300, label: "5 دقائق" },
              ]}
            />
            <label className="flex items-start gap-3 rounded-2xl border border-line bg-deep-2/50 p-3">
              <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} className="mt-1 size-5 accent-[var(--color-gold)]" />
              <span>
                <b className="text-ivory">كشف دور من يخرج</b>
                <span className="block text-xs text-muted">عند القتل أو الإقصاء يُعلن دوره. بدونها تبقى الأدوار سرًّا حتى النهاية.</span>
              </span>
            </label>
            <div className="grid gap-2">
              <p className="text-sm font-bold text-ivory">أدوار إضافية</p>
              {[
                { on: jester, set: setJester, role: "jester", text: "يفوز وحده إذا أقصوه بالتصويت." },
                { on: mayor, set: setMayor, role: "mayor", text: "معروف للجميع، وصوته بصوتين." },
                { on: bodyguard, set: setBodyguard, role: "bodyguard", text: "يحرس لاعبًا كل ليلة، ويموت بدلًا منه إذا هوجم." },
                { on: sniper, set: setSniper, role: "sniper", text: "رصاصة واحدة في المباراة، يطلقها في النهار." },
                { on: seer, set: setSeer, role: "seer", text: "مرة واحدة تعرف دور لاعب خرج من اللعبة." },
              ].map((r) => (
                <label key={r.role} className="flex items-start gap-3 rounded-2xl border border-line bg-deep-2/50 p-3">
                  <input type="checkbox" checked={r.on} onChange={(e) => r.set(e.target.checked)} className="mt-1 size-5 accent-[var(--color-gold)]" />
                  <span>
                    <b className="text-ivory">
                      {ROLE_ICONS[r.role]} {ROLE_NAMES[r.role]}
                    </b>
                    <span className="block text-xs text-muted">{r.text}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className={cx("text-center text-xs", fits ? "text-muted" : "text-gold")}>
              {guests < 5
                ? "تحتاجون 5 لاعبين على الأقل غير المضيف."
                : fits
                  ? `الأدوار: ${plannedMafia} مافيا، طبيب، محقق${bodyguard ? "، حارس" : ""}${mayor ? "، عمدة" : ""}${jester ? "، مهرّج" : ""}${sniper ? "، قنّاص" : ""}${seer ? "، عرّافة" : ""}، والباقي مواطنون (${guests - plannedMafia - special}).`
                  : "الأدوار أكثر من اللاعبين. قلّل الأدوار الإضافية أو عدد المافيا."}
            </p>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-2 text-right sm:grid-cols-3">
          {rows.map((p) => (
            <div
              key={p.player_id}
              className={cx(
                "rounded-xl px-3 py-2 text-sm font-bold",
                p.alive ? "bg-deep-2/70 text-ivory" : "bg-deep/50 text-muted line-through",
                runoff?.includes(p.player_id) && "ring-2 ring-gold",
              )}
            >
              {p.is_mayor ? "👑 " : ""}
              {p.player_name}
              {p.player_role && (over || !p.alive) ? (
                <span className="block text-xs font-normal text-muted no-underline">{ROLE_NAMES[p.player_role] ?? ""}</span>
              ) : null}
            </div>
          ))}
        </div>
        {phase !== "" ? <p className="mt-3 text-xs text-muted">الأحياء: {alive}</p> : null}

        {phase === "day" && dayLeft !== null ? (
          <p className={cx("mt-4 font-display text-4xl font-extrabold tabular-nums", dayLeft <= 10 ? "text-wrong" : "text-gold")} dir="ltr">
            {mmss(dayLeft)}
          </p>
        ) : null}

        {progress && progress.phase === phase && (phase === "night" || phase === "vote") ? (
          <div className="mt-4 grid justify-items-center gap-2">
            <p className="text-lg font-extrabold text-ivory">
              {phase === "night" ? "اختار" : "صوّت"} <span className="tabular-nums text-gold">{progress.done ?? 0}</span> من{" "}
              <span className="tabular-nums">{progress.total ?? 0}</span>
            </p>
            {phase === "night" && progress.mafia_split ? <p className="text-xs text-muted">المافيا لم تتفق بعد على ضحية واحدة.</p> : null}
            {countdown !== null ? (
              <p className="text-sm font-bold text-gold">
                الكل اختار. {phase === "night" ? "يطلع الفجر" : "يُغلق التصويت"} بعد {countdown}…
              </p>
            ) : null}
          </div>
        ) : null}
        {phase !== "" && !over ? (
          <label className="mt-3 inline-flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="size-4 accent-[var(--color-gold)]" />
            انتقل تلقائيًا (عندما يختار الجميع، أو ينتهي وقت النهار)
          </label>
        ) : null}

        {(phase === "night" || (phase === "vote" && runoff)) && state.last_votes && state.last_votes.length > 0 ? (
          <div className="mx-auto mt-4 max-w-md">
            <VotesView votes={state.last_votes} />
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {phase === "" ? (
            <Button
              type="button"
              tone="primary"
              onClick={() =>
                step("mafia_start", {
                  p_settings: { mafia: mafiaCount || null, reveal_roles: reveal, day_seconds: daySeconds, jester, mayor, bodyguard, sniper, seer },
                })
              }
              disabled={busy || !fits}
            >
              وزّع الأدوار وابدأ
            </Button>
          ) : null}
          {phase === "night" ? (
            <Button type="button" tone="primary" onClick={() => step("mafia_resolve_night")} disabled={busy}>
              الفجر: احسم الليل
            </Button>
          ) : null}
          {phase === "day" ? (
            <Button type="button" tone="primary" onClick={() => step("mafia_open_vote")} disabled={busy}>
              افتح التصويت
            </Button>
          ) : null}
          {phase === "vote" ? (
            <Button type="button" tone="primary" onClick={() => step("mafia_close_vote")} disabled={busy}>
              أغلق التصويت
            </Button>
          ) : null}
        </div>

        {over ? (
          <div className="mt-5 grid gap-4">
            <p className="text-2xl font-extrabold text-ivory">{WINNERS[state.winner ?? ""] ?? "انتهت اللعبة"}</p>
            <MafiaSummary state={state} rows={rows} />
            <MafiaShare state={state} rows={rows} />
            <Button type="button" tone="primary" className="mx-auto" onClick={() => step("mafia_reset")} disabled={busy}>
              مباراة جديدة بنفس اللاعبين
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-wrong">
            {error}
          </p>
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

function MafiaChoice({ label, value, options, onChange }: { label: string; value: number; options: Array<{ value: number; label: string }>; onChange: (v: number) => void }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-bold text-ivory">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx("min-h-10 rounded-full border px-4 text-sm font-semibold transition", value === o.value ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/60 text-mist hover:text-ivory")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

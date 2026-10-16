import { createFileRoute, Link } from "@tanstack/react-router";
import { rememberRoom } from "@/lib/prefs";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/shell";
import { useRoomSession } from "@/lib/room-session";
import { Button, cx } from "@/components/ui";
import { Cradle, Glyph } from "@/components/brand";
import { HalbaPlayerPanel } from "@/components/halba";
import { GridPlayerPanel } from "@/components/grid";
import { CourtPlayerPanel } from "@/components/court-wired";
import { ResultShare, rankingShare } from "@/components/result-share";
import { MafiaPlayerPanel } from "@/components/mafia-play";
import { adaptivePoll } from "@/lib/live";
import { supabase } from "@/lib/supabase";
import { TestGuestsBar } from "@/components/room-tools";

/**
 * Player screen for a room (phones). Shows the game board, the active question,
 * the buzzer, and the scoreboard, live through Realtime. It never shows the
 * correct answer: the board reads from questions_public, and the answer only
 * comes from the host screen via room_correct_answer().
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
type Buzzer = { player_id: string; player_name: string } | null;
type StateData = {
  answered?: string[];
  phase?: string;
  buzzer_open?: boolean;
  buzzer?: Buzzer;
} & Record<string, unknown>;
type PlayerRow = { id: string; user_id: string | null; player_name: string; score: number; is_host: boolean };
/** Bluff game (سيد الخداع): one option as revealed after the vote. */
type RevealOption = { key: string; text: string; is_correct: boolean; owner: string | null; votes: number };

function PlayerBoard() {
  const { code } = Route.useParams();
  const [room, setRoom] = useState<Room | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stateData, setStateData] = useState<StateData>({});
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  // The current player as the server sees it: follows the admin's test-guest seat (supabase/site_v1.sql).
  const [myPid, setMyPid] = useState<string | null>(null);
  const [buzzMessage, setBuzzMessage] = useState<string | null>(null);
  const [buzzing, setBuzzing] = useState(false);
  const [gameSlug, setGameSlug] = useState<string | null>(null);
  const isBluff = gameSlug === "bluff-master";
  const isOutsider = gameSlug === "outsider";
  const isHeads = gameSlug === "heads-up";
  const isMafia = gameSlug === "social-mafia";
  const isHalba = gameSlug === "alhalba";
  const isGrid = gameSlug === "tactical-grid";
  const isCourt = gameSlug === "court";
  const [error, setError] = useState<string | null>(null);

  // Load the room, its public questions, its state, and its players.
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
      // Heads-up words are never loaded on phones: describers get the current word from the server.
      const { data: qs } = game?.slug === "heads-up" || game?.slug === "social-mafia" || game?.slug === "alhalba" || game?.slug === "tactical-grid" || game?.slug === "court"
        ? { data: [] }
        : await client
            .from("questions_public")
            .select("id, category_ar, question_text, options, points")
            .eq("game_slug", game?.slug ?? "")
            .order("points");
      const { data: state } = await client
        .from("room_game_state")
        .select("active_question_id, state_data")
        .eq("room_id", r.id)
        .maybeSingle();
      const { data: ps } = await client
        .from("room_players")
        .select("id, user_id, player_name, score, is_host")
        .eq("room_id", r.id);
      const { data: sessionData } = await client.auth.getSession();
      const { data: pid } = await client.rpc("my_player_id", { p_room_id: r.id });

      if (cancelled) return;
      setRoom(r);
      setQuestions((qs ?? []) as Question[]);
      setActiveId((state?.active_question_id as string | null) ?? null);
      setStateData(((state?.state_data as StateData) ?? {}) as StateData);
      setPlayers((ps ?? []) as PlayerRow[]);
      setMyUserId(sessionData.session?.user.id ?? null);
      setMyPid(typeof pid === "string" ? pid : null);
      setGameSlug(game?.slug ?? null);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Follow room state, room status, and the scoreboard live.
  useEffect(() => {
    if (!supabase || !room) return;
    const client = supabase;
    const roomId = room.id;

    // Re-read the live state. Used by realtime and by a short polling fallback,
    // because realtime events can be missed on some connections.
    async function refreshState() {
      const { data: state } = await client
        .from("room_game_state")
        .select("active_question_id, state_data")
        .eq("room_id", roomId)
        .maybeSingle();
      if (!state) return;
      setActiveId((state.active_question_id as string | null) ?? null);
      const data = (state.state_data as StateData) ?? {};
      setStateData(data);
      if (!data.buzzer) setBuzzMessage(null);
    }

    const channel = client
      .channel(`player-board-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_game_state", filter: `room_id=eq.${roomId}` },
        () => {
          refreshState();
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${roomId}` },
        async () => {
          const { data } = await client
            .from("room_players")
            .select("id, user_id, player_name, score, is_host")
            .eq("room_id", roomId);
          setPlayers((data ?? []) as PlayerRow[]);
        },
      )
      .subscribe((status) => poller.onStatus(status));

    async function refreshPlayers() {
      const { data } = await client
        .from("room_players")
        .select("id, user_id, player_name, score, is_host")
        .eq("room_id", roomId);
      if (data) setPlayers(data as PlayerRow[]);
    }

    const poller = adaptivePoll(() => {
      refreshState();
      refreshPlayers();
    }, 2000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refreshState();
        refreshPlayers();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      poller.stop();
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

  const answered = new Set(stateData.answered ?? []);
  const active = questions.find((q) => q.id === activeId) ?? null;
  const me = (myPid ? players.find((p) => p.id === myPid) : undefined) ?? players.find((p) => p.user_id && p.user_id === myUserId) ?? null;
  // Was in the room, and the host removed them (supabase/rooms_v2.sql, room_kick).
  const [wasIn, setWasIn] = useState(false);
  useEffect(() => {
    if (me && !me.is_host) setWasIn(true);
  }, [me]);
  const kicked = wasIn && !me && players.length > 0;
  const rememberKey = me && room && room.status !== "finished" ? `${room.room_code}:${me.is_host}` : null;
  useEffect(() => {
    if (!rememberKey) return;
    const [code, host] = rememberKey.split(":");
    rememberRoom(code, host === "true");
  }, [rememberKey]);
  const buzzer = stateData.buzzer ?? null;
  const canBuzz = !!active && !!stateData.buzzer_open && !buzzer && !!me && !me.is_host && !buzzing;
  const ranking = [...players].filter((p) => !p.is_host).sort((a, b) => b.score - a.score);
  const allDone = questions.length > 0 && answered.size >= questions.length;
  // A new round from the host (same room, new game or replay) reloads this screen; the poll also keeps the status fresh.
  const liveStatus = useRoomSession(room?.id);
  useEffect(() => {
    if (liveStatus) setRoom((current) => (current && current.status !== liveStatus ? { ...current, status: liveStatus } : current));
  }, [liveStatus]);
  const gameOver = allDone || room?.status === "finished";
  const topScore = ranking.length ? ranking[0].score : 0;
  const winners = ranking.filter((p) => p.score === topScore);

  async function buzz() {
    if (!supabase || !room) return;
    setBuzzing(true);
    setBuzzMessage(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("press_buzzer", { p_room_id: room.id });
      if (rpcError) throw rpcError;
      const result = data as { ok: boolean; reason?: string };
      if (result.ok) setBuzzMessage("ضغطت الجرس! انتظر المضيف.");
      else if (result.reason === "LOCKED") setBuzzMessage("سبقك لاعب آخر.");
      else setBuzzMessage("لا يمكن الضغط الآن.");
    } catch {
      setBuzzMessage("تعذّر الضغط على الجرس، حاول مرة أخرى.");
    } finally {
      setBuzzing(false);
    }
  }

  if (error) {
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

  if (!room) {
    return (
      <Shell play>
        <p className="mt-8 text-center text-sm text-muted">جارٍ التحميل…</p>
      </Shell>
    );
  }

  if (kicked) {
    return (
      <Shell play>
        <section className="glass-card mx-auto mt-8 max-w-xl rounded-[28px] p-6 text-center">
          <p className="text-[40px] leading-none" aria-hidden="true">
            🚪
          </p>
          <p className="mt-3 text-lg font-extrabold text-ivory">أخرجك المضيف من الغرفة</p>
          <p className="mt-1 text-sm text-muted">لا تستطيع الرجوع لهذه الغرفة. تقدر تنضم لغرفة أخرى أو تبدأ لعبة جديدة.</p>
          <Link to="/" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-line-strong/70 px-5 text-sm font-bold text-ivory">
            الرئيسية
          </Link>
        </section>
      </Shell>
    );
  }

  return (
    <Shell play>
      <section className="mx-auto mt-4 max-w-md">
        <TestGuestsBar roomId={room.id} />
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-extrabold text-ivory">
            الغرفة <span className="room-code text-gold">{room.room_code}</span>
          </h1>
          {isHalba || isMafia || isGrid || isCourt ? (
            <span className="text-sm text-muted">{isHalba ? "الحلبة" : isGrid ? "تحديات العش" : isCourt ? "المحكمة" : "المافيا"}</span>
          ) : (
            <span className="text-sm text-muted">
              أُجيب {answered.size} من {questions.length}
            </span>
          )}
        </div>

        {room.status === "finished" && (isGrid || isCourt) ? (
          <div className="glass-card mb-5 rounded-[22px] p-4 text-center">
            <p className="text-sm font-bold text-violet-text">⏹️ انتهت الغرفة</p>
            <p className="mt-1 text-sm text-muted">أنهى المضيف الغرفة. شكرًا للعب!</p>
          </div>
        ) : null}

        {gameOver && !isGrid && !isCourt ? (
          <div className="glass-card mb-5 rounded-[28px] p-6 text-center">
            <p className="text-sm font-bold text-violet-text">انتهت اللعبة</p>
            {winners.length > 0 ? (
              <p className="mt-2 text-2xl font-extrabold text-ivory">
                {winners.length > 1 ? "تعادل بين: " : "الفائز: "}
                {winners.map((w) => w.player_name).join("، ")}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-muted">بنقاط {topScore}</p>
            {ranking.length > 0 && !isHalba && !isMafia ? <ResultShare className="mt-4" result={rankingShare(gameSlug, ranking)} /> : null}
          </div>
        ) : null}

        {room.status !== "playing" && !gameOver ? (
          <p className="glass-card mb-4 rounded-2xl p-4 text-center text-sm text-muted">بانتظار المضيف ليبدأ اللعبة.</p>
        ) : null}

        {isOutsider ? (
          <OutsiderPlayerPanel
            roomId={room.id}
            players={players}
            meId={me?.id ?? null}
            isPlayer={!!me && !me.is_host}
            phase={String(stateData.phase ?? "")}
            round={Number(stateData.round ?? 0)}
            reveal={(stateData.reveal as OutsiderRevealView | undefined) ?? null}
          />
        ) : null}

        {isHalba ? (
          <HalbaPlayerPanel roomId={room.id} meId={me?.id ?? null} />
        ) : null}

        {isGrid && room.status !== "lobby" ? <GridPlayerPanel roomId={room.id} meId={me?.id ?? null} /> : null}

        {isCourt && room.status !== "lobby" ? <CourtPlayerPanel roomId={room.id} meId={me?.id ?? null} /> : null}

        {isMafia ? (
          <MafiaPlayerPanel roomId={room.id} meId={me?.id ?? null} state={stateData} roomCode={room.room_code} roomStatus={room.status} />
        ) : null}

        {isHeads ? (
          <HeadsPlayerPanel roomId={room.id} meId={me?.id ?? null} state={stateData} />
        ) : null}

        {active && !isHeads && !isMafia && !isCourt ? (
          <div className="glass-card mb-5 rounded-[28px] p-5 text-center">
            <p className="text-xs font-bold text-violet-text">
              {active.category_ar} · {active.points} نقطة
            </p>
            <p className="mt-3 text-xl font-extrabold leading-relaxed text-ivory">{active.question_text}</p>

            {isBluff ? (
              <BluffPlayerPanel
                roomId={room.id}
                activeId={active.id}
                phase={String(stateData.phase ?? "")}
                reveal={(stateData.reveal as RevealOption[] | undefined) ?? []}
                isPlayer={!!me && !me.is_host}
              />
            ) : null}

            {!isBluff && active.options.length > 0 ? (
              <ul className="mt-4 grid gap-2">
                {active.options.map((opt) => (
                  <li key={opt} className="rounded-xl bg-deep-2/70 px-4 py-3 text-right text-ivory">
                    {opt}
                  </li>
                ))}
              </ul>
            ) : null}

            {!isBluff ? (
            <div className="mt-5">
              {buzzer ? (
                <p className="rounded-[20px] border border-violet/50 bg-violet/16 p-4 font-display text-xl font-bold text-ivory">
                  الجرس عند {buzzer.player_name}
                </p>
              ) : stateData.buzzer_open && me && !me.is_host ? (
                <div className="grid justify-items-center gap-3 pt-2">
                  <Cradle hold style={{ padding: "0 18px" }}>
                    <button
                      type="button"
                      onClick={buzz}
                      disabled={!canBuzz}
                      className="buzz-ring relative grid aspect-square w-[min(66vw,280px)] place-content-center justify-items-center gap-1 rounded-full bg-[radial-gradient(circle_at_40%_30%,#ffd36b,#ffa53a_55%,#f7832a)] px-6 pb-6 font-display text-[22px] font-bold leading-8 text-on-gold shadow-[0_0_36px_#ffa53a66,inset_0_-10px_0_#e8741a,inset_0_2px_0_#fff8] transition active:scale-[0.96] disabled:opacity-60"
                    >
                      <Glyph name="bell" className="size-12" />
                      {buzzing ? "…" : "اضغط الجرس"}
                    </button>
                  </Cradle>
                </div>
              ) : (
                <p className="inline-flex items-center gap-2 text-[15px] text-mist">
                  <Glyph name="hourglass" className="size-5" />
                  بانتظار فتح الجرس.
                </p>
              )}
              {buzzMessage ? <p className="mt-2 text-sm text-ivory">{buzzMessage}</p> : null}
            </div>
            ) : null}
          </div>
        ) : room.status === "playing" && !isOutsider && !isHeads && !isMafia && !isHalba && !isGrid && !isCourt ? (
          <p className="glass-card mb-5 rounded-2xl p-4 text-center text-sm text-muted">اختر المضيف سؤالاً من اللوحة.</p>
        ) : null}

        {categories.length > 0 && !isHeads && !isMafia && !isHalba && !isGrid && !isCourt ? (
          <div className="overflow-x-auto">
            <div
              className="grid min-w-[360px] gap-1.5"
              style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}
            >
              {categories.map((cat) => (
                <div key={cat} className="grid min-h-11 place-items-center rounded-[10px] bg-violet/16 p-1.5 text-center text-[13px] font-semibold leading-[18px] text-ivory">
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
                        "flex min-h-11 items-center justify-center rounded-[10px] border text-[17px] font-bold tabular-nums",
                        isActive
                          ? "border-gold bg-gold text-on-gold shadow-glow-gold"
                          : q && !done
                            ? "border-line bg-deep text-gold"
                            : "border-dashed border-line bg-transparent text-faint",
                      )}
                    >
                      {q && !done ? points : q ? <Glyph name="check" className="size-4" /> : ""}
                    </div>
                  );
                }),
              )}
            </div>
          </div>
        ) : null}

        {ranking.length > 0 && !isHalba && !isMafia && !isGrid && !isCourt ? (
          <div className="glass-card mt-6 rounded-2xl p-4">
            <h2 className="mb-2 text-sm font-extrabold text-ivory">النتائج</h2>
            <ul className="space-y-2">
              {ranking.map((p, i) => (
                <li
                  key={p.id}
                  className={cx(
                    "flex items-center justify-between rounded-xl px-3 py-2 text-sm",
                    me?.id === p.id ? "bg-gold/10 text-ivory" : "bg-deep-2/50 text-ivory/80",
                  )}
                >
                  <span>
                    {i + 1}. {p.player_name}
                  </span>
                  <span className="font-extrabold text-gold">{p.score}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* For a visitor who opened the room link without joining (a spectator): players and the host never need it. */}
        {!me && room.status !== "finished" ? (
          <div className="mt-6 text-center">
            <Link to="/join/$code" params={{ code: room.room_code }} className="inline-flex min-h-11 items-center rounded-full border border-gold/60 px-5 text-sm font-bold text-gold">
              أنت تشاهد فقط · انضم كلاعب
            </Link>
          </div>
        ) : null}
      </section>
    </Shell>
  );
}

type BluffPlayerPanelProps = {
  roomId: string;
  activeId: string;
  phase: string;
  reveal: RevealOption[];
  isPlayer: boolean;
};
type BluffOption = { opt_key: string; opt_text: string; is_mine: boolean };

const BLUFF_ERRORS: Record<string, string> = {
  EMPTY: "اكتب إجابة أولًا.",
  SAME_AS_CORRECT: "هذه هي الإجابة الصحيحة، اكتب إجابة مزيفة مختلفة.",
  WRONG_PHASE: "انتهت مرحلة الكتابة.",
  ALREADY_VOTED: "لقد صوّتّ بالفعل.",
  OWN_ANSWER: "لا يمكنك التصويت لإجابتك.",
  HOST_CANNOT_PLAY: "المضيف لا يشارك في الإجابات.",
  NOT_IN_ROOM: "انضم إلى الغرفة أولًا.",
};

/** Player side of one bluff round: write a fake answer, then vote, then see the reveal. */
function BluffPlayerPanel({ roomId, activeId, phase, reveal, isPlayer }: BluffPlayerPanelProps) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [options, setOptions] = useState<BluffOption[]>([]);
  const [votedKey, setVotedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A new question or a new phase starts with a clean slate for this player.
  useEffect(() => {
    setText("");
    setSent(false);
    setVotedKey(null);
    setMessage(null);
    setOptions([]);
  }, [activeId, phase === "fakes" ? "fakes" : phase === "question" || phase === "" ? "start" : "other"]);

  // Load the voting options once voting opens (the server hides owners and the correct flag).
  useEffect(() => {
    if (!supabase || phase !== "vote") return;
    const client = supabase;
    let cancelled = false;
    client.rpc("bluff_options", { p_room_id: roomId }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) return setMessage("تعذّر تحميل الخيارات.");
      setOptions((data ?? []) as BluffOption[]);
    });
    return () => {
      cancelled = true;
    };
  }, [roomId, phase, activeId]);

  async function submitFake() {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc("bluff_submit_fake", { p_room_id: roomId, p_text: text });
      if (error) throw error;
      const result = data as { ok: boolean; reason?: string };
      if (result.ok) {
        setSent(true);
      } else {
        setMessage(BLUFF_ERRORS[result.reason ?? ""] ?? "تعذّر إرسال الإجابة.");
      }
    } catch {
      setMessage("تعذّر إرسال الإجابة، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  async function vote(key: string) {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc("bluff_vote", { p_room_id: roomId, p_key: key });
      if (error) throw error;
      const result = data as { ok: boolean; reason?: string };
      if (result.ok) setVotedKey(key);
      else if (result.reason === "ALREADY_VOTED") setVotedKey(key);
      else setMessage(BLUFF_ERRORS[result.reason ?? ""] ?? "تعذّر حفظ التصويت.");
    } catch {
      setMessage("تعذّر حفظ التصويت، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-violet/40 bg-violet/10 p-4 text-center">
      {phase === "fakes" ? (
        !isPlayer ? (
          <p className="text-sm text-muted">بانتظار الإجابات المزيفة…</p>
        ) : sent ? (
          <p className="font-bold text-ivory">أرسلت إجابتك. بانتظار الباقين.</p>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm text-muted">اكتب إجابة مزيفة تبدو صحيحة.</p>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={60}
              placeholder="إجابتك"
              className="min-h-12 w-full rounded-2xl border border-line bg-night px-4 text-center text-ivory outline-none focus:border-gold"
            />
            <Button type="button" tone="primary" className="w-full" onClick={submitFake} disabled={busy || text.trim() === ""}>
              أرسل الإجابة
            </Button>
          </div>
        )
      ) : null}

      {phase === "vote" ? (
        !isPlayer ? (
          <p className="text-sm text-muted">اللاعبون يصوّتون الآن…</p>
        ) : votedKey ? (
          <p className="font-bold text-ivory">صوّتّ. بانتظار الباقين.</p>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm text-muted">أي إجابة تظنها صحيحة؟</p>
            {options.map((o) => (
              <Button
                key={o.opt_key}
                type="button"
                tone="glass"
                className="w-full"
                onClick={() => vote(o.opt_key)}
                disabled={busy || o.is_mine}
              >
                {o.is_mine ? `${o.opt_text} (إجابتك)` : o.opt_text}
              </Button>
            ))}
          </div>
        )
      ) : null}

      {phase === "reveal" ? (
        <ul className="grid gap-2 text-right">
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
              <span className="font-extrabold">
                {o.is_correct ? "✓ " : ""}
                {o.votes} صوت
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {phase !== "fakes" && phase !== "vote" && phase !== "reveal" ? (
        <p className="text-sm text-muted">بانتظار المضيف ليبدأ الجولة.</p>
      ) : null}

      {message ? <p className="mt-3 text-sm text-wrong">{message}</p> : null}
    </div>
  );
}


type OutsiderRevealView = {
  outsider?: string;
  caught?: boolean;
  topic?: string;
  word?: string;
  guess?: string;
  guess_ok?: boolean;
  votes?: { name: string; votes: number }[];
};
type OutsiderCard = { is_outsider: boolean; topic?: string; word?: string } | null;

const OUTSIDER_PLAYER_ERRORS: Record<string, string> = {
  SELF_VOTE: "لا يمكنك التصويت لنفسك.",
  BAD_TARGET: "هذا اللاعب غير متاح للتصويت.",
  WRONG_PHASE: "هذه المرحلة انتهت.",
  EMPTY: "اكتب تخمينك أولًا.",
  NOT_OUTSIDER: "هذه المرحلة للبرة فقط.",
  HOST_CANNOT_PLAY: "المضيف لا يشارك في التصويت.",
  NOT_IN_ROOM: "انضم إلى الغرفة أولًا.",
};

/** Player side of برة السالفة: their card, voting, the guess, and the reveal. */
function OutsiderPlayerPanel({
  roomId,
  players,
  meId,
  isPlayer,
  phase,
  round,
  reveal,
}: {
  roomId: string;
  players: PlayerRow[];
  meId: string | null;
  isPlayer: boolean;
  phase: string;
  round: number;
  reveal: OutsiderRevealView | null;
}) {
  const [card, setCard] = useState<OutsiderCard>(null);
  const [votedFor, setVotedFor] = useState<string | null>(null);
  const [guess, setGuess] = useState("");
  const [guessSent, setGuessSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A new round starts with no vote, no guess, and a fresh card.
  useEffect(() => {
    setVotedFor(null);
    setGuess("");
    setGuessSent(false);
    setMessage(null);
    setCard(null);
    if (!supabase || !isPlayer) return;
    let cancelled = false;
    supabase.rpc("outsider_my_card", { p_room_id: roomId }).then(({ data }) => {
      if (!cancelled && data) setCard(data as OutsiderCard);
    });
    return () => {
      cancelled = true;
    };
  }, [roomId, round, isPlayer]);

  const voters = players.filter((p) => !p.is_host && p.id !== meId);
  const isOutsider = !!card?.is_outsider;

  async function vote(target: string) {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc("outsider_vote", { p_room_id: roomId, p_target: target });
      if (error) throw error;
      const result = data as { ok: boolean; reason?: string };
      if (result.ok) setVotedFor(target);
      else setMessage(OUTSIDER_PLAYER_ERRORS[result.reason ?? ""] ?? "تعذّر حفظ التصويت.");
    } catch {
      setMessage("تعذّر حفظ التصويت، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  async function sendGuess() {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc("outsider_guess", { p_room_id: roomId, p_text: guess });
      if (error) throw error;
      const result = data as { ok: boolean; reason?: string };
      if (result.ok) setGuessSent(true);
      else setMessage(OUTSIDER_PLAYER_ERRORS[result.reason ?? ""] ?? "تعذّر إرسال التخمين.");
    } catch {
      setMessage("تعذّر إرسال التخمين، حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass-card mb-5 rounded-[28px] p-5 text-center">
      <p className="text-xs font-bold text-violet-text">برة السالفة · الجولة {round}</p>

      {phase === "discuss" && isPlayer && card ? (
        <div className="mt-3">
          {isOutsider ? (
            <p className="text-xl font-extrabold text-ivory">أنت برة السالفة! اكتشف الموضوع من نقاشهم.</p>
          ) : (
            <>
              <p className="text-sm text-muted">الموضوع: {card.topic}</p>
              <p className="mt-2 text-2xl font-extrabold text-gold">{card.word}</p>
              <p className="mt-2 text-xs text-muted">ناقشوا الكلمة دون أن تكشفوها بوضوح.</p>
            </>
          )}
        </div>
      ) : null}

      {phase === "discuss" && !isPlayer ? <p className="mt-3 text-sm text-muted">ناقشوا الآن بالصوت.</p> : null}

      {phase === "vote" ? (
        !isPlayer ? (
          <p className="mt-3 text-sm text-muted">اللاعبون يصوّتون الآن…</p>
        ) : votedFor ? (
          <p className="mt-3 font-bold text-ivory">صوّتّ. بانتظار الباقين.</p>
        ) : (
          <div className="mt-3 grid gap-2">
            <p className="text-sm text-muted">من تظنه برة السالفة؟</p>
            {voters.map((p) => (
              <Button key={p.id} type="button" tone="glass" className="w-full" onClick={() => vote(p.id)} disabled={busy}>
                {p.player_name}
              </Button>
            ))}
          </div>
        )
      ) : null}

      {phase === "guess" ? (
        isOutsider && !guessSent ? (
          <div className="mt-3 grid gap-3">
            <p className="text-sm text-muted">لقد كُشفت! خمّن الكلمة لتفوز وحدك.</p>
            <input
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              maxLength={40}
              placeholder="تخمينك"
              className="min-h-12 w-full rounded-2xl border border-line bg-night px-4 text-center text-ivory outline-none focus:border-gold"
            />
            <Button type="button" tone="primary" className="w-full" onClick={sendGuess} disabled={busy || guess.trim() === ""}>
              أرسل التخمين
            </Button>
          </div>
        ) : isOutsider ? (
          <p className="mt-3 font-bold text-ivory">أرسلت تخمينك. بانتظار النتيجة.</p>
        ) : (
          <p className="mt-3 text-sm text-muted">{reveal?.outsider ?? "البرة"} يخمّن الكلمة الآن…</p>
        )
      ) : null}

      {(phase === "guess" || phase === "done") && reveal?.votes && reveal.votes.length > 0 ? (
        <ul className="mt-4 grid gap-2 text-right">
          {reveal.votes.map((v) => (
            <li key={v.name} className="flex items-center justify-between rounded-xl bg-deep-2/60 px-4 py-2 text-sm text-ivory">
              <span>{v.name}</span>
              <span className="font-bold">{v.votes} صوت</span>
            </li>
          ))}
        </ul>
      ) : null}

      {phase === "done" && reveal ? (
        <div className="mt-4 rounded-2xl border border-correct/50 bg-correct-fill/15 p-4 text-ivory">
          <p className="font-bold">البرة: {reveal.outsider}</p>
          <p className="mt-1 text-sm">الموضوع: {reveal.topic} · الكلمة: {reveal.word}</p>
          {reveal.guess !== undefined ? (
            <p className="mt-1 text-sm">
              تخمينه: {reveal.guess} {reveal.guess_ok ? "✓" : "✗"}
            </p>
          ) : null}
        </div>
      ) : null}

      {phase !== "discuss" && phase !== "vote" && phase !== "guess" && phase !== "done" ? (
        <p className="mt-3 text-sm text-muted">بانتظار المضيف ليبدأ الجولة.</p>
      ) : null}

      {message ? <p className="mt-3 text-sm text-wrong">{message}</p> : null}
    </section>
  );
}


const HEADS_PLAYER_ERRORS: Record<string, string> = {
  NOT_IN_ROOM: "انضم إلى الغرفة أولًا.",
};

/** Parses a timestamp from JSON, trimming microseconds that JS can't read. */
function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(t) ? null : t;
}

/** Player side of هل تعرف: the timer, the teams, and the word for describers only. */
const TEAM_NAMES: Record<string, string> = { red: "الفريق الأحمر", blue: "الفريق الأزرق" };

function HeadsPlayerPanel({ roomId, meId, state }: { roomId: string; meId: string | null; state: StateData }) {
  const [players, setPlayers] = useState<{ id: string; player_name: string; team_color: string | null; is_host: boolean }[]>([]);
  const [word, setWord] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);

  const phase = String(state.phase ?? "");
  const guesserId = typeof state.guesser_id === "string" ? state.guesser_id : null;
  const iAmGuesser = !!meId && meId === guesserId;
  const me = players.find((p) => p.id === meId) ?? null;
  const scores = state.team_scores ?? {};
  const scoreRed = Number(scores.red ?? 0);
  const scoreBlue = Number(scores.blue ?? 0);
  const guesser = players.find((p) => p.id === guesserId) ?? null;

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;
    async function loadPlayers() {
      const { data } = await client
        .from("room_players")
        .select("id, player_name, team_color, is_host")
        .eq("room_id", roomId)
        .order("joined_at");
      if (!cancelled && data) setPlayers(data as typeof players);
    }
    loadPlayers();
    const poll = window.setInterval(loadPlayers, 2000);
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
    // players is set by loadPlayers; the effect only depends on the room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Describers (not the guesser) see the current word. The server never sends it to the guesser.
  useEffect(() => {
    if (!supabase || phase !== "turn" || !meId || iAmGuesser) {
      setWord(null);
      return;
    }
    const client = supabase;
    let cancelled = false;
    async function loadWord() {
      const { data, error } = await client.rpc("heads_my_word", { p_room_id: roomId });
      if (cancelled) return;
      if (error) return setMessage(HEADS_PLAYER_ERRORS.NOT_IN_ROOM);
      setWord((data as string | null) ?? null);
    }
    loadWord();
    const poll = window.setInterval(loadWord, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [roomId, phase, meId, iAmGuesser, state.guesser_id, state.turn_ends_at]);

  const endsAt = parseTime(typeof state.turn_ends_at === "string" ? state.turn_ends_at : null);
  const secondsLeft = phase === "turn" && endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;

  const winnerText =
    scoreRed === scoreBlue ? "تعادل" : `الفائز: ${scoreRed > scoreBlue ? "الفريق الأحمر" : "الفريق الأزرق"}`;

  return (
    <section className="glass-card mb-5 rounded-[28px] p-5 text-center">
      <p className="text-xs font-bold text-violet-text">هل تعرف</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-deep-2/60 p-3">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-team-red">
            <Glyph name="triangle" className="size-3" />
            الفريق الأحمر
          </p>
          <p className="text-2xl font-bold tabular-nums text-ivory">{scoreRed}</p>
        </div>
        <div className="rounded-2xl bg-deep-2/60 p-3">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-team-blue">
            <Glyph name="circle" className="size-3" />
            الفريق الأزرق
          </p>
          <p className="text-2xl font-bold tabular-nums text-ivory">{scoreBlue}</p>
        </div>
      </div>
      {me?.team_color ? <p className="mt-2 text-sm text-muted">أنت في {TEAM_NAMES[me.team_color] ?? ""}</p> : null}

      {phase === "turn" ? (
        <div className="mt-4">
          <p className="text-sm text-muted">
            المخمِّن: <span className="font-bold text-ivory">{guesser?.player_name ?? "—"}</span>
          </p>
          <p dir="ltr" className="mt-1 text-3xl font-bold tabular-nums text-gold">{secondsLeft !== null ? `${secondsLeft}s` : ""}</p>
          {iAmGuesser ? (
            <p className="mt-4 rounded-2xl border border-violet/40 bg-violet/10 p-4 font-bold text-ivory">
              أنت المخمِّن! خمّن الكلمة من تلميحات زملائك.
            </p>
          ) : word ? (
            <div className="mt-4 rounded-2xl border border-gold/40 bg-gold/10 p-5">
              <p className="text-sm text-muted">صِفها دون أن تقولها</p>
              <p className="mt-2 text-3xl font-extrabold text-ivory">{word}</p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">بانتظار الكلمة…</p>
          )}
        </div>
      ) : null}

      {phase === "between" || phase === "" || phase === "idle" ? (
        <p className="mt-4 text-sm text-muted">بانتظار المضيف ليبدأ الدور.</p>
      ) : null}

      {phase === "turn_over" || phase === "over" ? (
        <p className="mt-4 text-xl font-extrabold text-ivory">انتهت كل الكلمات. {winnerText}</p>
      ) : null}

      {message ? <p className="mt-3 text-sm text-wrong">{message}</p> : null}
    </section>
  );
}


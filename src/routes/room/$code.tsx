import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/shell";
import { Button, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";

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
  const [buzzMessage, setBuzzMessage] = useState<string | null>(null);
  const [buzzing, setBuzzing] = useState(false);
  const [gameSlug, setGameSlug] = useState<string | null>(null);
  const isBluff = gameSlug === "bluff-master";
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
      const { data: ps } = await client
        .from("room_players")
        .select("id, user_id, player_name, score, is_host")
        .eq("room_id", r.id);
      const { data: sessionData } = await client.auth.getSession();

      if (cancelled) return;
      setRoom(r);
      setQuestions((qs ?? []) as Question[]);
      setActiveId((state?.active_question_id as string | null) ?? null);
      setStateData(((state?.state_data as StateData) ?? {}) as StateData);
      setPlayers((ps ?? []) as PlayerRow[]);
      setMyUserId(sessionData.session?.user.id ?? null);
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
      .subscribe();

    async function refreshPlayers() {
      const { data } = await client
        .from("room_players")
        .select("id, user_id, player_name, score, is_host")
        .eq("room_id", roomId);
      if (data) setPlayers(data as PlayerRow[]);
    }

    const timer = window.setInterval(() => {
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

  const answered = new Set(stateData.answered ?? []);
  const active = questions.find((q) => q.id === activeId) ?? null;
  const me = players.find((p) => p.user_id && p.user_id === myUserId) ?? null;
  const buzzer = stateData.buzzer ?? null;
  const canBuzz = !!active && !!stateData.buzzer_open && !buzzer && !!me && !me.is_host && !buzzing;
  const ranking = [...players].filter((p) => !p.is_host).sort((a, b) => b.score - a.score);
  const allDone = questions.length > 0 && answered.size >= questions.length;
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

        {gameOver ? (
          <div className="glass-card mb-5 rounded-3xl p-6 text-center">
            <p className="text-sm font-bold text-violet">انتهت اللعبة</p>
            {winners.length > 0 ? (
              <p className="mt-2 text-2xl font-extrabold text-ivory">
                {winners.length > 1 ? "تعادل بين: " : "الفائز: "}
                {winners.map((w) => w.player_name).join("، ")}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-muted">بنقاط {topScore}</p>
          </div>
        ) : null}

        {room.status !== "playing" && !gameOver ? (
          <p className="glass-card mb-4 rounded-2xl p-4 text-center text-sm text-muted">بانتظار المضيف ليبدأ اللعبة.</p>
        ) : null}

        {active ? (
          <div className="glass-card mb-5 rounded-3xl p-5 text-center">
            <p className="text-xs font-bold text-violet">
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
                  <li key={opt} className="rounded-xl bg-white/[0.05] px-4 py-3 text-right text-ivory">
                    {opt}
                  </li>
                ))}
              </ul>
            ) : null}

            {!isBluff ? (
            <div className="mt-5">
              {buzzer ? (
                <p className="rounded-2xl border border-violet/40 bg-violet/10 p-3 font-bold text-ivory">
                  الجرس عند {buzzer.player_name}
                </p>
              ) : stateData.buzzer_open && me && !me.is_host ? (
                <Button type="button" tone="primary" className="w-full min-h-16 text-lg" onClick={buzz} disabled={!canBuzz}>
                  {buzzing ? "…" : "اضغط الجرس"}
                </Button>
              ) : (
                <p className="text-sm text-muted">بانتظار فتح الجرس.</p>
              )}
              {buzzMessage ? <p className="mt-2 text-sm text-ivory">{buzzMessage}</p> : null}
            </div>
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

        {ranking.length > 0 ? (
          <div className="glass-card mt-6 rounded-2xl p-4">
            <h2 className="mb-2 text-sm font-extrabold text-ivory">النتائج</h2>
            <ul className="space-y-2">
              {ranking.map((p, i) => (
                <li
                  key={p.id}
                  className={cx(
                    "flex items-center justify-between rounded-xl px-3 py-2 text-sm",
                    me?.id === p.id ? "bg-neon/10 text-ivory" : "bg-white/[0.03] text-ivory/80",
                  )}
                >
                  <span>
                    {i + 1}. {p.player_name}
                  </span>
                  <span className="font-extrabold text-neon">{p.score}</span>
                </li>
              ))}
            </ul>
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
              className="min-h-12 w-full rounded-2xl border border-white/10 bg-night px-4 text-center text-ivory outline-none focus:border-neon"
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
                o.is_correct ? "border border-emerald/40 bg-emerald/10 text-ivory" : "bg-white/[0.04] text-ivory/80",
              )}
            >
              <span>
                {o.text}
                {o.owner ? <span className="mr-2 text-xs text-violet">({o.owner})</span> : null}
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

      {message ? <p className="mt-3 text-sm text-crimson">{message}</p> : null}
    </div>
  );
}

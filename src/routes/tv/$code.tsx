import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Egg, GameIcon, Glyph, Lockup, Mark } from "@/components/brand";
import { QrCode } from "@/components/qr-code";
import { buttonBase, buttonTone, cx, joinLink } from "@/components/ui";
import { ensureSession, supabase } from "@/lib/supabase";
import { useRoomSession } from "@/lib/room-session";
import {
  AnswersList,
  Hearts,
  MatchSummary,
  RoundBadges,
  TEAMS,
  TeamsRing,
  canFight,
  goalOf,
  halbaWinner,
  isAnswering,
  nameOf,
  participants,
  performerLabel,
  phaseAnswers,
  predictionTally,
  sideName,
  useHalbaCues,
  useSecondsLeft,
  useTicks,
  type HalbaState,
} from "@/components/halba";
import { MafiaSummary, ROLE_NAMES, VotesView, WINNERS, mmss, narratorLine, setVoicePreference, speak, useCountdown, useMafiaCues, voicePreference, type MafiaPlayerRow, type MafiaPublicState } from "@/components/mafia";

/**
 * TV screen for a room (/tv/CODE): display only, for the big screen in the room.
 * The host runs the game from /host/CODE on any device; this page follows the
 * same public state. It never shows correct answers before the host reveals
 * them, the heads-up word, the outsider's secret, or mafia roles before the end.
 */
export const Route = createFileRoute("/tv/$code")({
  head: () => ({ meta: [{ title: "شاشة التلفزيون — العش" }, { name: "robots", content: "noindex" }] }),
  component: TvScreen,
});

type Room = { id: string; room_code: string; game_id: string; status: string };
type Game = { slug: string; title_ar: string };
type Question = { id: string; category_ar: string; question_text: string; options: string[]; points: number };
type Player = { id: string; player_name: string; score: number; is_host: boolean; team_color: string | null; avatar?: { c?: number; e?: string | null } | null };
type Buzzer = { player_id: string; player_name: string } | null;
type RevealOption = { key: string; text: string; is_correct: boolean; owner: string | null; votes: number };
type OutsiderReveal = {
  outsider?: string;
  caught?: boolean;
  topic?: string;
  word?: string;
  guess?: string;
  guess_ok?: boolean;
  votes?: { name: string; votes: number }[];
};
type StateData = {
  answered?: string[];
  phase?: string;
  round?: number;
  buzzer_open?: boolean;
  buzzer?: Buzzer;
  reveal?: unknown;
  guesser_id?: string;
  turn_ends_at?: string | null;
  team_scores?: Record<string, number>;
  winner?: string | null;
  last_result?: string | null;
} & Record<string, unknown>;
type Counts = { phase?: string; round?: number; submitted?: number; voted?: number; players?: number };
type MafiaRow = { player_id: string; player_name: string; alive: boolean; player_role: string | null; is_mayor?: boolean };

const TEAM_NAMES: Record<string, string> = { red: "الفريق الأحمر", blue: "الفريق الأزرق" };

/** Parses a timestamp from JSON, trimming microseconds that JS can't read. */
function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(t) ? null : t;
}

function TvScreen() {
  const { code } = Route.useParams();
  const [room, setRoom] = useState<Room | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<StateData>({});
  const [players, setPlayers] = useState<Player[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [mafia, setMafia] = useState<MafiaRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const slug = game?.slug ?? "";
  const isBluff = slug === "bluff-master";
  const isOutsider = slug === "outsider";
  const isHeads = slug === "heads-up";
  const isMafia = slug === "social-mafia";
  const isHalba = slug === "alhalba";
  const isBoard = !isOutsider && !isHeads && !isMafia && !isHalba;

  // Load the room once, then its game and its public questions (no answers).
  useEffect(() => {
    if (!supabase) {
      setError("الاتصال بقاعدة البيانات غير مضبوط بعد.");
      return;
    }
    const client = supabase;
    let cancelled = false;
    (async () => {
      try {
        await ensureSession();
        const { data: found, error: roomError } = await client
          .from("game_rooms")
          .select("id, room_code, game_id, status")
          .eq("room_code", code.toUpperCase())
          .maybeSingle();
        if (roomError) throw roomError;
        if (!found) {
          if (!cancelled) setError("لم نجد هذه الغرفة.");
          return;
        }
        const r = found as Room;
        const { data: g } = await client.from("games").select("slug, title_ar").eq("id", r.game_id).maybeSingle();
        const gameRow = (g ?? null) as Game | null;
        const noQuestions = gameRow?.slug === "heads-up" || gameRow?.slug === "social-mafia" || gameRow?.slug === "outsider" || gameRow?.slug === "alhalba";
        const { data: qs } = noQuestions
          ? { data: [] }
          : await client
              .from("questions_public")
              .select("id, category_ar, question_text, options, points")
              .eq("game_slug", gameRow?.slug ?? "")
              .order("points");
        if (cancelled) return;
        setRoom(r);
        setGame(gameRow);
        setQuestions((qs ?? []) as Question[]);
      } catch {
        if (!cancelled) setError("تعذّر تحميل الغرفة، حاول مرة أخرى.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Follow the room live: realtime when it works, and a short poll as a fallback.
  useEffect(() => {
    if (!supabase || !room) return;
    const client = supabase;
    const roomId = room.id;
    let cancelled = false;

    async function refresh() {
      const [{ data: st }, { data: ps }, { data: rm }] = await Promise.all([
        client.from("room_game_state").select("active_question_id, state_data").eq("room_id", roomId).maybeSingle(),
        client.from("room_players").select("*").eq("room_id", roomId).order("joined_at"),
        client.from("game_rooms").select("status").eq("id", roomId).maybeSingle(),
      ]);
      if (cancelled) return;
      if (st) {
        setActiveId((st.active_question_id as string | null) ?? null);
        setState(((st.state_data as StateData) ?? {}) as StateData);
      }
      if (ps) setPlayers(ps as Player[]);
      if (rm?.status) setRoom((current) => (current ? { ...current, status: rm.status as string } : current));
      if (isBluff || isOutsider) {
        const { data } = await client.rpc(isBluff ? "bluff_status" : "outsider_status", { p_room_id: roomId });
        if (!cancelled && data) setCounts(data as Counts);
      }
      if (isMafia) {
        const { data } = await client.rpc("mafia_players", { p_room_id: roomId });
        if (!cancelled && data) setMafia(data as MafiaRow[]);
      }
    }

    refresh();
    const channel = client
      .channel(`tv-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_game_state", filter: `room_id=eq.${roomId}` }, () => refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${roomId}` }, () => refresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "game_rooms", filter: `id=eq.${roomId}` }, () => refresh())
      .subscribe();
    const poll = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      client.removeChannel(channel);
    };
  }, [room?.id, isBluff, isOutsider, isMafia]);

  // A clock for the heads-up timer.
  useEffect(() => {
    if (!isHeads) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, [isHeads]);

  // Keep the TV from dimming while the room is open, where the browser allows it.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock
      ?.request("screen")
      .then((l) => {
        lock = l;
      })
      .catch(() => undefined);
    return () => {
      void lock?.release().catch(() => undefined);
    };
  }, []);

  const { categories, pointRows } = useMemo(() => {
    const cats: string[] = [];
    const pts = new Set<number>();
    for (const q of questions) {
      if (!cats.includes(q.category_ar)) cats.push(q.category_ar);
      pts.add(q.points);
    }
    return { categories: cats, pointRows: [...pts].sort((a, b) => a - b) };
  }, [questions]);

  const guests = players.filter((p) => !p.is_host);
  const ranking = [...(isHalba ? participants(state as unknown as HalbaState, players) : guests)].sort((a, b) => b.score - a.score);
  const answered = new Set(state.answered ?? []);
  const active = questions.find((q) => q.id === activeId) ?? null;
  const allDone = isBoard && questions.length > 0 && answered.size >= questions.length;
  // A new round from the host (same room, new game or replay) reloads this screen; the poll also keeps the status fresh.
  const liveStatus = useRoomSession(room?.id);
  useEffect(() => {
    if (liveStatus) setRoom((current) => (current && current.status !== liveStatus ? { ...current, status: liveStatus } : current));
  }, [liveStatus]);
  const finished = room?.status === "finished" || allDone;

  if (error) {
    return (
      <TvFrame>
        <Center>
          <Mark height={160} />
          <p className="font-display text-[clamp(28px,3.4vw,56px)] font-extrabold">{error}</p>
          <Link to="/" className={cx(buttonBase, buttonTone("quiet"), "mt-2")}>
            <Glyph name="home" className="size-[18px]" />
            الرئيسية
          </Link>
        </Center>
      </TvFrame>
    );
  }

  if (!room) {
    return (
      <TvFrame>
        <Center>
          <Mark height={160} className="bob" />
          <p className="text-[clamp(18px,1.6vw,28px)] text-mist">جارٍ التحميل…</p>
        </Center>
      </TvFrame>
    );
  }

  const link = joinLink(room.room_code);

  return (
    <TvFrame
      game={game}
      corner={
        room.status !== "lobby" && !finished ? (
          <div className="flex items-center gap-3 rounded-[18px] border border-glow/30 bg-night/60 p-2 pe-4">
            <QrCode text={link} className="size-[clamp(56px,5.5vw,96px)]" />
            <div>
              <p className="text-[clamp(12px,1vw,18px)] text-mist">رمز الغرفة</p>
              <p className="room-code text-[clamp(20px,2.2vw,40px)] leading-tight text-gold">{room.room_code}</p>
            </div>
          </div>
        ) : null
      }
    >
      {room.status === "lobby" ? (
        <Lobby code={room.room_code} link={link} game={game} players={guests} />
      ) : finished ? (
        <Results slug={slug} ranking={ranking} state={state} mafia={mafia} />
      ) : isHeads ? (
        <Heads state={state} players={players} now={now} />
      ) : isOutsider ? (
        <Outsider state={state} counts={counts} />
      ) : isMafia ? (
        <Mafia state={state} rows={mafia} players={players} />
      ) : isHalba ? (
        <Halba state={state as unknown as HalbaState} players={players} />
      ) : (
        <Board
          active={active}
          state={state}
          isBluff={isBluff}
          counts={counts}
          categories={categories}
          pointRows={pointRows}
          questions={questions}
          answered={answered}
          ranking={ranking}
        />
      )}
    </TvFrame>
  );
}

/* ---------------- Frame ---------------- */

function TvFrame({ children, corner, game }: { children: ReactNode; corner?: ReactNode; game?: Game | null }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  return (
    <main className="nest relative flex min-h-dvh flex-col overflow-hidden px-[3vw] pt-[max(2vh,env(safe-area-inset-top))] pb-[3vh]">
      <span aria-hidden="true" className="pointer-events-none absolute -top-[20vh] start-[-10vw] size-[60vw] rounded-full bg-violet/15 blur-[120px]" />
      <span aria-hidden="true" className="pointer-events-none absolute end-[-10vw] -bottom-[30vh] size-[50vw] rounded-full bg-gold/10 blur-[120px]" />
      <header className="relative flex items-center gap-[2vw]">
        <Link to="/" aria-label="العش — الرئيسية" className="inline-flex shrink-0">
          <Lockup height={56} className="h-[clamp(40px,4.6vw,84px)]! w-auto!" />
        </Link>
        {game ? (
          <div className="flex min-w-0 items-center gap-3">
            <GameIcon id={game.slug} size="sm" className="size-[clamp(36px,3.6vw,64px)]!" />
            <span className="truncate font-display text-[clamp(20px,2.2vw,40px)] font-extrabold">{game.title_ar}</span>
          </div>
        ) : null}
        <div className="ms-auto flex items-center gap-3">
          {corner}
          {!full ? (
            <button
              type="button"
              onClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
              className="hidden min-h-11 items-center gap-2 rounded-full border border-line-strong/70 bg-deep-2/60 px-4 text-[15px] font-semibold text-mist transition hover:text-ivory md:inline-flex"
            >
              <Glyph name="tv" className="size-[18px]" />
              ملء الشاشة
            </button>
          ) : null}
        </div>
      </header>
      <div className="relative flex flex-1 flex-col pt-[3vh]">{children}</div>
    </main>
  );
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center gap-[2vh] text-center">{children}</div>;
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("surface rounded-[clamp(20px,2vw,36px)] p-[clamp(16px,2vw,40px)]", className)}>{children}</section>;
}

/* ---------------- Lobby ---------------- */

function Lobby({ code, link, game, players }: { code: string; link: string; game: Game | null; players: Player[] }) {
  return (
    <div className="grid flex-1 items-center gap-[3vw] lg:grid-cols-[1.15fr_1fr]">
      <div className="grid justify-items-center gap-[2.4vh] text-center lg:justify-items-start lg:text-start">
        <p className="text-[clamp(18px,1.8vw,34px)] text-mist">امسحوا الرمز من الجوال، أو افتحوا الرابط واكتبوا أسماءكم</p>
        <div className="grid justify-items-center gap-2 lg:justify-items-start">
          <span className="text-[clamp(16px,1.4vw,26px)] font-semibold text-mist">رمز الغرفة</span>
          <span className="room-code rounded-[clamp(16px,1.6vw,32px)] border border-gold/40 bg-night/60 px-[2vw] py-[1vh] text-[clamp(56px,9vw,180px)] leading-none text-gold shadow-glow-gold">
            {code}
          </span>
        </div>
        <p dir="ltr" className="text-[clamp(14px,1.3vw,24px)] font-semibold text-gold">
          {link}
        </p>

        <div className="mt-[1vh] w-full">
          <h2 className="mb-[1.5vh] flex items-center justify-center gap-2 text-[clamp(20px,2vw,38px)] lg:justify-start">
            <Glyph name="users" className="size-[1.2em] text-gold" />
            اللاعبون ({players.length})
          </h2>
          {players.length === 0 ? (
            <p className="text-[clamp(16px,1.4vw,26px)] text-mist">بانتظار أول لاعب…</p>
          ) : (
            <ul className="flex flex-wrap justify-center gap-[1.2vw] lg:justify-start">
              {players.map((p, i) => (
                <li key={p.id} className="rise grid justify-items-center gap-1.5" style={{ animationDelay: `${i * 40}ms` }}>
                  <Egg name={p.player_name} index={i + 1} avatar={p.avatar} size="lg" className="w-[clamp(52px,4.6vw,88px)]! text-[clamp(20px,2vw,38px)]!" />
                  <span className="max-w-[10vw] truncate text-[clamp(14px,1.3vw,24px)] font-semibold">{p.player_name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="inline-flex items-center gap-2 text-[clamp(16px,1.5vw,28px)] text-mist">
          <Glyph name="hourglass" className="size-[1.2em] text-gold" />
          بانتظار المضيف ليبدأ اللعبة.
        </p>
      </div>
      <div className="grid justify-items-center gap-[2vh]">
        <QrCode text={link} className="size-[min(36vw,52vh)]" />
        {game ? <p className="text-[clamp(16px,1.5vw,28px)] text-mist">{game.title_ar}</p> : null}
      </div>
    </div>
  );
}

/* ---------------- Board games (تحديات العش، سيد الخداع، ...) ---------------- */

function Board({
  active,
  state,
  isBluff,
  counts,
  categories,
  pointRows,
  questions,
  answered,
  ranking,
}: {
  active: Question | null;
  state: StateData;
  isBluff: boolean;
  counts: Counts | null;
  categories: string[];
  pointRows: number[];
  questions: Question[];
  answered: Set<string>;
  ranking: Player[];
}) {
  const buzzer = state.buzzer ?? null;
  const phase = String(state.phase ?? "");
  const reveal = Array.isArray(state.reveal) ? (state.reveal as RevealOption[]) : [];
  return (
    <div className="grid flex-1 gap-[2vw] lg:grid-cols-[1fr_minmax(260px,24vw)]">
      {active ? (
        <Panel className="flex flex-col justify-center text-center">
          <p className="mx-auto inline-flex rounded-full bg-violet/20 px-[1.4vw] py-[0.6vh] text-[clamp(16px,1.5vw,30px)] font-bold text-violet-text">
            {active.category_ar} · {active.points} نقطة
          </p>
          <p className="mt-[2.5vh] font-display text-[clamp(30px,3.6vw,76px)] leading-[1.45] font-extrabold">{active.question_text}</p>
          {!isBluff && active.options.length > 0 ? (
            <ul className="mt-[3vh] grid gap-[1.2vw] sm:grid-cols-2">
              {active.options.map((opt) => (
                <li
                  key={opt}
                  className="rounded-[clamp(14px,1.4vw,26px)] border border-line-strong/60 bg-deep-2/70 px-[1.5vw] py-[1.8vh] text-[clamp(20px,2.2vw,44px)] font-semibold"
                >
                  {opt}
                </li>
              ))}
            </ul>
          ) : null}

          {isBluff ? (
            <div className="mt-[3vh]">
              {phase === "fakes" ? (
                <Status icon="edit">
                  اكتبوا إجابة مزيفة مقنعة على جوالاتكم · أرسل {counts?.submitted ?? 0} من {counts?.players ?? 0}
                </Status>
              ) : phase === "vote" ? (
                <Status icon="check">
                  صوّتوا على الإجابة الصحيحة من جوالاتكم · صوّت {counts?.voted ?? 0} من {counts?.players ?? 0}
                </Status>
              ) : phase === "reveal" ? (
                <ul className="grid gap-[1vh] text-start">
                  {reveal.map((o) => (
                    <li
                      key={o.key}
                      className={cx(
                        "flex items-center justify-between gap-4 rounded-[clamp(12px,1.2vw,22px)] px-[1.4vw] py-[1.2vh] text-[clamp(18px,1.8vw,34px)]",
                        o.is_correct ? "border border-correct/60 bg-correct-fill/20" : "bg-deep-2/70",
                      )}
                    >
                      <span className="font-semibold">
                        {o.is_correct ? <Glyph name="check" className="me-2 inline size-[1em] text-correct" /> : null}
                        {o.text}
                        {o.owner ? <span className="ms-3 text-[0.75em] text-violet-text">({o.owner})</span> : null}
                      </span>
                      <span className="shrink-0 font-bold text-gold">{o.votes} صوت</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Status icon="hourglass">استعدوا للسؤال</Status>
              )}
            </div>
          ) : (
            <div className="mt-[3.5vh]">
              {buzzer ? (
                <div className="mx-auto inline-grid justify-items-center gap-1 rounded-[clamp(18px,1.8vw,32px)] border border-violet/60 bg-violet/20 px-[3vw] py-[2vh] shadow-glow-violet">
                  <span className="inline-flex items-center gap-2 text-[clamp(16px,1.5vw,28px)] text-mist">
                    <Glyph name="bell" className="size-[1.2em] text-gold" />
                    الجرس عند
                  </span>
                  <span className="font-display text-[clamp(36px,4.4vw,88px)] leading-tight font-extrabold">{buzzer.player_name}</span>
                </div>
              ) : state.buzzer_open ? (
                <Status icon="bell" tone="gold">
                  الجرس مفتوح! أول من يضغط من جواله يجاوب
                </Status>
              ) : (
                <Status icon="hourglass">الجرس مغلق</Status>
              )}
            </div>
          )}
        </Panel>
      ) : (
        <Panel className="flex flex-col">
          {questions.length === 0 ? (
            <Center>
              <p className="text-[clamp(18px,1.8vw,32px)] text-mist">لا توجد أسئلة لهذه اللعبة بعد.</p>
            </Center>
          ) : (
            <>
              <p className="mb-[2vh] text-center text-[clamp(18px,1.7vw,32px)] text-mist">
                يختار المضيف سؤالًا من اللوحة · أُجيب {answered.size} من {questions.length}
              </p>
              <div className="grid flex-1 gap-[0.8vw]" style={{ gridTemplateColumns: `repeat(${categories.length}, minmax(0, 1fr))` }}>
                {categories.map((cat) => (
                  <div
                    key={cat}
                    className="grid min-h-[8vh] place-items-center rounded-[clamp(10px,1vw,20px)] border border-violet/40 bg-violet/20 p-2 text-center text-[clamp(14px,1.5vw,30px)] font-semibold"
                  >
                    {cat}
                  </div>
                ))}
                {pointRows.map((points) =>
                  categories.map((cat) => {
                    const q = questions.find((item) => item.category_ar === cat && item.points === points) ?? null;
                    const done = q ? answered.has(q.id) : true;
                    return (
                      <div
                        key={`${cat}-${points}`}
                        className={cx(
                          "grid min-h-[9vh] place-items-center rounded-[clamp(10px,1vw,20px)] border text-[clamp(22px,2.8vw,56px)] font-bold tabular-nums",
                          q && !done ? "border-glow/40 bg-deep text-gold shadow-[0_0_18px_-8px_#6b7bff]" : "border-dashed border-line text-faint",
                        )}
                      >
                        {q && !done ? points : q ? <Glyph name="check" className="size-[0.7em]" /> : ""}
                      </div>
                    );
                  }),
                )}
              </div>
            </>
          )}
        </Panel>
      )}
      <Scoreboard ranking={ranking} />
    </div>
  );
}

function Status({ icon, children, tone }: { icon: string; children: ReactNode; tone?: "gold" }) {
  return (
    <p
      className={cx(
        "mx-auto inline-flex items-center gap-3 rounded-full border px-[2vw] py-[1.4vh] text-[clamp(18px,1.9vw,36px)] font-semibold",
        tone === "gold" ? "border-gold/60 bg-gold/15 text-gold shadow-glow-gold" : "border-line-strong/60 bg-deep-2/60 text-mist",
      )}
    >
      <Glyph name={icon} className="size-[1.2em]" />
      {children}
    </p>
  );
}

function Scoreboard({ ranking }: { ranking: Player[] }) {
  return (
    <Panel className="flex flex-col">
      <h2 className="mb-[1.5vh] flex items-center gap-2 text-[clamp(20px,1.9vw,36px)]">
        <Glyph name="trophy" className="size-[1.1em] text-gold" />
        النتائج
      </h2>
      {ranking.length === 0 ? (
        <p className="text-[clamp(16px,1.3vw,24px)] text-mist">لا يوجد لاعبون بعد.</p>
      ) : (
        <ol className="grid gap-[1vh]">
          {ranking.map((p, i) => (
            <li
              key={p.id}
              className={cx(
                "flex items-center gap-3 rounded-[clamp(12px,1vw,20px)] border px-[1vw] py-[1vh] text-[clamp(16px,1.5vw,30px)]",
                i === 0 && p.score > 0 ? "border-gold/50 bg-gold/10" : "border-line bg-deep-2/50",
              )}
            >
              <span className="w-[1.6em] text-center font-bold tabular-nums text-mist">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{p.player_name}</span>
              <span className="font-bold tabular-nums text-gold">{p.score}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/* ---------------- على راسك ---------------- */

function Heads({ state, players, now }: { state: StateData; players: Player[]; now: number }) {
  const phase = String(state.phase ?? "");
  const red = state.team_scores?.red ?? 0;
  const blue = state.team_scores?.blue ?? 0;
  const guesser = players.find((p) => p.id === state.guesser_id) ?? null;
  const endsAt = parseTime(state.turn_ends_at);
  const secondsLeft = phase === "turn" && endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;
  return (
    <div className="grid flex-1 content-center gap-[3vh]">
      <div className="grid grid-cols-2 gap-[2vw]">
        <TeamScore team="red" score={red} active={guesser?.team_color === "red" && phase === "turn"} />
        <TeamScore team="blue" score={blue} active={guesser?.team_color === "blue" && phase === "turn"} />
      </div>
      <Panel className="text-center">
        {phase === "turn" ? (
          <>
            <p className="text-[clamp(18px,1.8vw,34px)] text-mist">
              المخمِّن: <span className="font-display font-extrabold text-ivory">{guesser?.player_name ?? "—"}</span>
              {guesser?.team_color ? ` (${TEAM_NAMES[guesser.team_color] ?? ""})` : ""}
            </p>
            <p
              dir="ltr"
              className={cx(
                "mt-[1vh] font-display text-[clamp(64px,10vw,200px)] leading-none font-extrabold tabular-nums",
                secondsLeft === 0 ? "text-wrong" : "text-gold",
              )}
            >
              {secondsLeft === 0 ? "انتهى الوقت" : `${secondsLeft ?? 0}s`}
            </p>
            <p className="mt-[1.5vh] text-[clamp(16px,1.5vw,28px)] text-mist">الكلمة على جوالات فريقه فقط. صِفوها دون أن تقولوها.</p>
          </>
        ) : phase === "turn_over" || phase === "over" ? (
          <p className="font-display text-[clamp(32px,4vw,80px)] font-extrabold">
            {red === blue ? "تعادل" : `الفائز: ${red > blue ? "الفريق الأحمر" : "الفريق الأزرق"}`}
          </p>
        ) : (
          <p className="text-[clamp(20px,2.2vw,42px)] text-mist">بانتظار الدور التالي…</p>
        )}
      </Panel>
    </div>
  );
}

function TeamScore({ team, score, active }: { team: "red" | "blue"; score: number; active: boolean }) {
  return (
    <Panel className={cx("text-center transition", active && "outline-4 outline-offset-4 outline-solid", active && (team === "red" ? "outline-team-red/70" : "outline-team-blue/70"))}>
      <p className={cx("inline-flex items-center gap-2 text-[clamp(18px,2vw,38px)] font-bold", team === "red" ? "text-team-red" : "text-team-blue")}>
        <Glyph name={team === "red" ? "triangle" : "circle"} className="size-[0.8em]" />
        {TEAM_NAMES[team]}
      </p>
      <p className="font-display text-[clamp(64px,9vw,180px)] leading-none font-extrabold tabular-nums">{score}</p>
    </Panel>
  );
}

/* ---------------- برة السالفة ---------------- */

function Outsider({ state, counts }: { state: StateData; counts: Counts | null }) {
  const phase = String(counts?.phase ?? state.phase ?? "");
  const round = Number(counts?.round ?? state.round ?? 0);
  const reveal = (state.reveal ?? null) as OutsiderReveal | null;
  return (
    <div className="grid flex-1 content-center gap-[3vh]">
      <Panel className="text-center">
        <p className="text-[clamp(16px,1.5vw,28px)] font-bold text-violet-text">الجولة {round || 1}</p>
        {phase === "discuss" ? (
          <>
            <p className="mt-[2vh] font-display text-[clamp(32px,4vw,80px)] font-extrabold">ناقشوا الكلمة بالصوت</p>
            <p className="mt-[1.5vh] text-[clamp(18px,1.8vw,34px)] text-mist">لا تذكروا الكلمة بوضوح، والبرة يحاول أن يتعرّف عليها.</p>
          </>
        ) : phase === "vote" ? (
          <>
            <p className="mt-[2vh] font-display text-[clamp(32px,4vw,80px)] font-extrabold">صوّتوا: من برة السالفة؟</p>
            <p className="mt-[1.5vh] text-[clamp(18px,1.8vw,34px)] text-mist">
              صوّت {counts?.voted ?? 0} من {counts?.players ?? 0}
            </p>
          </>
        ) : phase === "guess" ? (
          <>
            <p className="mt-[2vh] font-display text-[clamp(32px,4vw,80px)] font-extrabold">{reveal?.outsider ?? "البرة"} برة السالفة!</p>
            <p className="mt-[1.5vh] text-[clamp(18px,1.8vw,34px)] text-mist">بانتظار تخمينه للكلمة…</p>
          </>
        ) : phase === "done" && reveal ? (
          <>
            <p className="mt-[1vh] text-[clamp(18px,1.8vw,34px)] text-mist">{reveal.caught ? "تم كشف البرة" : "لم يُكشف البرة"}</p>
            <p className="mt-[1vh] font-display text-[clamp(32px,4vw,80px)] font-extrabold">البرة: {reveal.outsider}</p>
            <p className="mt-[1.5vh] text-[clamp(18px,1.8vw,34px)] text-mist">
              الموضوع: {reveal.topic} · الكلمة: <span className="font-bold text-gold">{reveal.word}</span>
            </p>
            {reveal.guess !== undefined ? (
              <p className="mt-[1vh] text-[clamp(18px,1.8vw,34px)]">
                تخمينه: {reveal.guess} {reveal.guess_ok ? "✓" : "✗"}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-[2vh] text-[clamp(20px,2.2vw,42px)] text-mist">بانتظار بدء الجولة…</p>
        )}
      </Panel>
      {reveal?.votes && reveal.votes.length > 0 && (phase === "guess" || phase === "done") ? (
        <Panel>
          <ul className="grid gap-[1vh] sm:grid-cols-2">
            {reveal.votes.map((v) => (
              <li key={v.name} className="flex items-center justify-between rounded-[clamp(12px,1vw,20px)] bg-deep-2/60 px-[1.2vw] py-[1vh] text-[clamp(16px,1.6vw,30px)]">
                <span>{v.name}</span>
                <span className="font-bold text-gold">{v.votes} صوت</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

/* ---------------- المافيا ---------------- */

function Mafia({ state, rows, players }: { state: StateData; rows: MafiaRow[]; players: Player[] }) {
  const ms = state as unknown as MafiaPublicState;
  const list = rows as MafiaPlayerRow[];
  const phase = String(ms.phase ?? "");
  const round = Number(ms.round ?? 1);
  const runoff = phase === "vote" && Array.isArray(ms.runoff) ? ms.runoff : null;
  const [voice, setVoice] = useState(false);
  useEffect(() => setVoice(voicePreference()), []);
  useMafiaCues(ms, list, voice);
  const dayLeft = useCountdown(phase === "day" ? ms.day_ends_at : null);
  const night = phase === "night";
  const headline =
    phase === "" ? "جاهزون للبدء؟"
    : night ? `ليل الجولة ${round}`
    : phase === "day" ? `نهار الجولة ${round}`
    : phase === "vote" ? (runoff ? "إعادة التصويت" : "التصويت")
    : WINNERS[ms.winner ?? ""] ?? "انتهت اللعبة";
  const votes = (night || runoff || phase === "over") && Array.isArray(ms.last_votes) ? ms.last_votes : [];

  return (
    <div className="relative grid flex-1 content-center gap-[3vh]">
      {/* Night darkens the whole screen; day warms it a little. */}
      <div
        aria-hidden="true"
        className={cx(
          "pointer-events-none fixed inset-0 transition-opacity duration-1000",
          night ? "bg-[radial-gradient(ellipse_at_top,#1a2050_0%,#03040c_75%)] opacity-90" : phase === "day" ? "bg-[radial-gradient(ellipse_at_top,#ffb54722_0%,transparent_60%)] opacity-100" : "opacity-0",
        )}
      />
      <Panel className="relative text-center">
        <button
          type="button"
          onClick={() => {
            const next = !voice;
            setVoice(next);
            setVoicePreference(next);
            if (next) speak(narratorLine(ms, list));
          }}
          aria-pressed={voice}
          className="absolute end-[1.5vw] top-[1.5vh] inline-flex min-h-10 items-center gap-2 rounded-full border border-line-strong/70 bg-deep-2/60 px-4 text-[clamp(13px,1vw,20px)] text-mist hover:text-ivory"
        >
          {voice ? "🔊 الراوي يتكلم" : "🔈 شغّل صوت الراوي"}
        </button>
        <p aria-hidden="true" className="text-[clamp(40px,4vw,80px)] leading-none">
          {night ? "🌙" : phase === "day" ? "☀️" : phase === "vote" ? "🗳️" : phase === "over" ? "🏁" : "🕵️"}
        </p>
        <p className="mt-[1vh] font-display text-[clamp(36px,4.6vw,92px)] font-extrabold">{headline}</p>
        <p className="mx-auto mt-[1.5vh] max-w-[70vw] text-[clamp(18px,1.8vw,34px)] leading-relaxed text-mist">{narratorLine(ms, list)}</p>
        {ms.last_result && (phase !== "day" || ms.last_shot?.text === ms.last_result) ? (
          <p className={cx("mt-[2vh] text-[clamp(20px,2vw,38px)] font-bold", phase === "day" && "rise rounded-[clamp(14px,1.2vw,24px)] border border-wrong/50 bg-wrong-fill/20 px-[2vw] py-[1vh]")}>
            {phase === "day" ? "🎯 " : ""}
            {ms.last_result}
          </p>
        ) : null}
        {phase === "day" && dayLeft !== null ? (
          <p dir="ltr" key={dayLeft <= 10 ? dayLeft : "calm"} className={cx("mt-[2vh] font-display text-[clamp(56px,7vw,140px)] leading-none font-extrabold tabular-nums", dayLeft <= 10 ? "beat text-wrong" : "text-gold")}>
            {mmss(dayLeft)}
          </p>
        ) : null}
      </Panel>

      {phase === "over" ? (
        <Panel className="relative">
          <MafiaSummary state={ms} rows={list} big />
        </Panel>
      ) : (
        <div className={cx("relative grid gap-[2vw]", votes.length > 0 && "lg:grid-cols-[1.4fr_1fr]")}>
          <Panel>
            <ul className="grid grid-cols-2 gap-[1vw] sm:grid-cols-3 lg:grid-cols-4">
              {list.map((p, i) => (
                <li
                  key={p.player_id}
                  className={cx(
                    "flex items-center gap-2 rounded-[clamp(12px,1vw,20px)] px-[1vw] py-[1vh] text-[clamp(16px,1.6vw,30px)] font-semibold",
                    !p.alive ? "bg-deep/50 text-faint line-through" : runoff?.includes(p.player_id) ? "bg-gold/15 ring-2 ring-gold" : runoff ? "bg-deep-2/40 text-mist" : "bg-deep-2/70",
                  )}
                >
                  <Egg
                    name={p.player_name}
                    index={players.findIndex((x) => x.id === p.player_id) + 1 || i + 1}
                    avatar={players.find((x) => x.id === p.player_id)?.avatar}
                    size="sm"
                    className={cx("w-[clamp(28px,2.4vw,46px)]!", !p.alive && "opacity-40")}
                  />
                  <span className="min-w-0 truncate">
                    {p.is_mayor ? "👑 " : ""}
                    {p.player_name}
                    {!p.alive && p.player_role ? <span className="block text-[0.7em] font-normal no-underline">{ROLE_NAMES[p.player_role] ?? ""}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-[1.5vh] text-center text-[clamp(14px,1.3vw,24px)] text-mist">الأحياء: {list.filter((p) => p.alive).length}</p>
          </Panel>
          {votes.length > 0 ? (
            <Panel>
              <VotesView votes={votes} big />
            </Panel>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---------------- Results ---------------- */

function Results({ slug, ranking, state, mafia }: { slug: string; ranking: Player[]; state: StateData; mafia: MafiaRow[] }) {
  if (slug === "alhalba") {
    const hs = state as unknown as HalbaState;
    const w = halbaWinner(hs, ranking);
    return (
      <div className="grid flex-1 content-center gap-[3vh] lg:grid-cols-[1.2fr_1fr] lg:items-center">
        <div className="grid gap-[2vh]">
          <Winner text={w ? `الفائز: ${w.name}` : "انتهت الغرفة"} sub={w?.why} />
          <MatchSummary state={hs} players={ranking} big />
        </div>
        {hs.mode === "teams" ? <TeamsRing state={hs} players={ranking} big /> : ranking.length > 0 ? <Scoreboard ranking={ranking} /> : null}
      </div>
    );
  }
  if (slug === "heads-up") {
    const red = state.team_scores?.red ?? 0;
    const blue = state.team_scores?.blue ?? 0;
    return (
      <div className="grid flex-1 content-center gap-[3vh]">
        <Winner text={red === blue ? "تعادل" : `الفائز: ${red > blue ? "الفريق الأحمر" : "الفريق الأزرق"}`} />
        <div className="grid grid-cols-2 gap-[2vw]">
          <TeamScore team="red" score={red} active={red > blue} />
          <TeamScore team="blue" score={blue} active={blue > red} />
        </div>
      </div>
    );
  }
  if (slug === "social-mafia") {
    const ms = state as unknown as MafiaPublicState;
    return (
      <div className="grid flex-1 content-center gap-[3vh]">
        <Winner text={WINNERS[ms.winner ?? ""] ?? "انتهت الغرفة"} />
        {mafia.length > 0 ? (
          <Panel>
            <MafiaSummary state={ms} rows={mafia as MafiaPlayerRow[]} big />
          </Panel>
        ) : null}
      </div>
    );
  }
  const top = ranking[0]?.score ?? 0;
  const winners = ranking.filter((p) => p.score === top && top > 0);
  return (
    <div className="grid flex-1 content-center gap-[3vh] lg:grid-cols-[1.2fr_1fr] lg:items-center">
      <Winner
        text={
          winners.length > 1
            ? `التعادل بين: ${winners.map((w) => w.player_name).join("، ")}`
            : winners.length === 1
              ? `الفائز: ${winners[0].player_name}`
              : "انتهت الغرفة"
        }
        sub={winners.length > 0 ? `بنقاط ${top}` : undefined}
      />
      {ranking.length > 0 ? <Scoreboard ranking={ranking} /> : null}
    </div>
  );
}

function Winner({ text, sub }: { text: string; sub?: string }) {
  return (
    <Panel className="relative overflow-hidden text-center">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-1/2 mx-auto size-[40vw] rounded-full bg-gold/15 blur-3xl" />
      <Glyph name="trophy" className="relative mx-auto size-[clamp(56px,6vw,120px)] text-gold" />
      <p className="relative mt-[1vh] text-[clamp(18px,1.8vw,34px)] font-bold text-violet-text">انتهت اللعبة</p>
      <p className="relative mt-[1vh] font-display text-[clamp(36px,4.8vw,96px)] leading-tight font-extrabold">{text}</p>
      {sub ? <p className="relative mt-[1vh] text-[clamp(18px,1.8vw,34px)] text-mist">{sub}</p> : null}
    </Panel>
  );
}

/* ---------------- الحلبة ---------------- */

function Halba({ state, players }: { state: HalbaState; players: Player[] }) {
  const phase = state.phase ?? "";
  const bidLeft = useSecondsLeft(phase === "bid" ? state.bid_ends_at : null);
  const proveLeft = useSecondsLeft(isAnswering(state) ? state.prove_ends_at : null);
  const offerLeft = useSecondsLeft(phase === "steal_offer" ? state.offer_ends_at : null);
  const guests = participants(state, players);
  const knocked = state.knocked ?? [];
  const maxLives = state.max_lives ?? 1;
  const winner = phase === "over" ? halbaWinner(state, players) : null;
  useHalbaCues(state, { sound: true });
  const duel = Array.isArray(state.duel) && state.duel.length === 2 ? state.duel : null;
  const result = state.result;
  const teams = state.mode === "teams";
  const tally = predictionTally(state);
  const who = result ? (teams ? sideName(state, players, result.side) : result.bidder_name) : "";

  return (
    <div className="grid flex-1 gap-[2vw] lg:grid-cols-[1fr_minmax(260px,24vw)]">
      <Panel className="relative flex flex-col justify-center overflow-hidden text-center">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-1/3 mx-auto size-[36vw] rounded-full bg-[#ff5a7a26] blur-3xl" />
        {phase === "" || phase === "idle" ? (
          <p className="relative font-display text-[clamp(32px,4vw,80px)] font-extrabold">استعدوا للحلبة 🥊</p>
        ) : phase === "over" ? (
          <div className="relative grid gap-[2vh]">
            <Glyph name="trophy" className="mx-auto size-[clamp(56px,6vw,120px)] text-gold" />
            <p className="font-display text-[clamp(36px,4.8vw,96px)] leading-tight font-extrabold">{winner ? `الفائز: ${winner.name}` : "انتهت المباراة"}</p>
            {winner ? <p className="text-[clamp(18px,1.8vw,34px)] text-mist">{winner.why}</p> : null}
            <MatchSummary state={state} players={players} big />
          </div>
        ) : (
          <div className="relative grid gap-[2.5vh]">
            {state.topic ? (
              <>
                <p className="mx-auto inline-flex rounded-full bg-[#83184366] px-[1.4vw] py-[0.6vh] text-[clamp(16px,1.5vw,30px)] font-bold text-[#ffb3c4]">
                  الجولة {state.round}
                  {state.max_rounds ? ` من ${state.max_rounds}` : ""}
                  {state.topic.category ? ` · ${state.topic.category}` : ""}
                </p>
                <p className="font-display text-[clamp(34px,4.4vw,92px)] leading-[1.35] font-extrabold">{state.topic.text}</p>
              </>
            ) : null}
            <RoundBadges state={state} className="text-[clamp(16px,1.5vw,30px)]" />
            {duel ? (
              <p className="font-display text-[clamp(24px,2.8vw,56px)] font-extrabold">
                {nameOf(players, duel[0])} <span className="text-[#ff5a7a]">ضد</span> {nameOf(players, duel[1])}
              </p>
            ) : null}

            {phase === "bid" ? (
              <div className="grid justify-items-center gap-[1.5vh]">
                <p className="text-[clamp(18px,1.9vw,36px)] text-mist">{state.bidder_name ? "أعلى مزايدة" : `زايدوا من جوالاتكم · تبدأ من ${state.topic?.min ?? 1}`}</p>
                {state.bidder_name ? (
                  <p className="font-display text-[clamp(40px,5vw,100px)] leading-none font-extrabold">
                    <span className="text-gold tabular-nums">{state.bid}</span>{" "}
                    <span className="text-[0.6em]">
                      عند {state.bidder_name}
                      {teams ? <span style={{ color: TEAMS[state.bidder_side ?? ""]?.color }}> ({sideName(state, players, state.bidder_side)})</span> : null}
                    </span>
                  </p>
                ) : null}
                <Clock seconds={bidLeft} label="وقت المزايدة" />
              </div>
            ) : null}

            {isAnswering(state) ? (
              <div className="grid justify-items-center gap-[1.5vh]">
                <p className="text-[clamp(20px,2.2vw,42px)]">
                  {phase === "steal" ? "🦹 " : ""}
                  <b>{performerLabel(state, players)}</b> {phase === "steal" ? "يسرق ويذكر" : "يذكر"} {goalOf(state)} إجابات
                  {phase === "prove" && state.challenger_name ? <span className="text-mist"> · تحدّاه {state.challenger_name}</span> : null}
                </p>
                <p key={state.count ?? 0} className="rise font-display text-[clamp(80px,12vw,240px)] leading-none font-extrabold tabular-nums">
                  {state.count ?? 0}
                  <span className="text-[0.4em] text-mist">/{goalOf(state)}</span>
                </p>
                <AnswersList answers={phaseAnswers(state)} big />
                <Clock seconds={proveLeft} label={proveLeft === 0 ? "انتهى الوقت" : "الوقت"} />
              </div>
            ) : null}

            {(phase === "bid" || phase === "prove") && tally.yes + tally.no > 0 ? (
              <p className="text-[clamp(16px,1.5vw,30px)] text-mist">
                توقعات الجمهور: <span className="text-correct">ينجح {tally.yes}</span> · <span className="text-wrong">يفشل {tally.no}</span>
              </p>
            ) : null}

            {(phase === "result" || phase === "steal_offer") && result ? (
              <div className={cx("mx-auto rounded-[clamp(18px,1.8vw,32px)] border px-[3vw] py-[2vh]", result.success ? "border-correct/60 bg-correct-fill/20" : "border-wrong/60 bg-wrong-fill/20")}>
                <p className="font-display text-[clamp(32px,4vw,80px)] font-extrabold">
                  {result.success ? `${who} نجح!` : result.knocked_out ? `${who} خرج من الحلبة` : `${who} خسر محاولة`}
                </p>
                <p className="mt-[1vh] text-[clamp(18px,1.8vw,34px)] text-mist">
                  ذكر {result.count} من {result.bid} ·{" "}
                  <span dir="ltr" className="inline-block">
                    {result.success ? "+" : "−"}
                    {result.points}
                  </span>{" "}
                  نقطة{result.doubled ? " (مضاعفة)" : ""}
                </p>
                {phase === "result" && state.steal_result ? (
                  <p className={cx("mt-[1.5vh] text-[clamp(20px,2vw,40px)] font-bold", state.steal_result.success ? "text-correct" : "text-ivory")}>
                    🦹 {state.steal_result.success ? (
                      <>
                        {state.steal_result.name} سرق الجولة! <span dir="ltr" className="inline-block">+{state.steal_result.points}</span>
                      </>
                    ) : (
                      `فشلت سرقة ${state.steal_result.name}`
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}

            {phase === "steal_offer" ? (
              <div className="grid justify-items-center gap-[1vh]">
                <p className="font-display text-[clamp(26px,3vw,60px)] font-extrabold text-gold">🦹 {state.challenger_name} يقدر يسرق الجولة!</p>
                <Clock seconds={offerLeft} label="القرار خلال" />
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel className="flex flex-col">
        <h2 className="mb-[1.5vh] flex items-center gap-2 text-[clamp(20px,1.9vw,36px)]">🥊 الحلبة</h2>
        {teams ? (
          <TeamsRing state={state} players={players} big />
        ) : (
          <ol className="grid gap-[1vh]">
            {[...guests]
              .sort((a, b) => Number(knocked.includes(a.id)) - Number(knocked.includes(b.id)) || b.score - a.score)
              .map((p) => {
                const out = knocked.includes(p.id);
                const now = canFight(state, p.id) && (phase === "bid" || phase === "prove");
                return (
                  <li
                    key={p.id}
                    className={cx(
                      "flex items-center gap-3 rounded-[clamp(12px,1vw,20px)] border px-[1vw] py-[1vh] text-[clamp(16px,1.5vw,30px)]",
                      out ? "border-line/50 text-faint line-through" : now && duel ? "border-[#ff5a7a88] bg-[#83184340]" : "border-line bg-deep-2/50",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold">{p.player_name}</span>
                    {!out ? <Hearts left={state.lives?.[p.id] ?? maxLives} max={maxLives} className="text-[0.8em]" /> : null}
                    <span className="font-bold tabular-nums text-gold">{p.score}</span>
                  </li>
                );
              })}
          </ol>
        )}
      </Panel>
    </div>
  );
}

function Clock({ seconds, label }: { seconds: number | null; label: string }) {
  useTicks(seconds, true);
  if (seconds === null) return null;
  const hot = seconds > 0 && seconds <= 5;
  return (
    <p className="inline-flex items-center gap-3 text-[clamp(18px,1.9vw,36px)] text-mist">
      <Glyph name="clock" className="size-[1.1em] text-gold" />
      {label}
      <span dir="ltr" key={hot ? seconds : "calm"} className={cx("font-display text-[1.6em] font-extrabold tabular-nums", seconds <= 5 ? "text-wrong" : "text-gold", hot && "beat")}>
        {seconds}s
      </span>
    </p>
  );
}

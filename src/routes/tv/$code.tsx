import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Egg, GameIcon, Glyph, Lockup, Mark } from "@/components/brand";
import { QrCode } from "@/components/qr-code";
import { buttonBase, buttonTone, cx, joinLink } from "@/components/ui";
import { ensureSession, supabase } from "@/lib/supabase";
import { AnswersList, Hearts, canFight, halbaWinner, nameOf, participants, useHalbaCues, useSecondsLeft, type HalbaState } from "@/components/halba";

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
type Player = { id: string; player_name: string; score: number; is_host: boolean; team_color: string | null };
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
type MafiaRow = { player_id: string; player_name: string; alive: boolean; player_role: string | null };

const MAFIA_ROLE_LABELS: Record<string, string> = { mafia: "مافيا", citizen: "مواطن", doctor: "طبيب", detective: "محقق" };
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
        client.from("room_players").select("id, player_name, score, is_host, team_color").eq("room_id", roomId).order("joined_at"),
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
        <Mafia state={state} rows={mafia} />
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
                  <Egg name={p.player_name} index={i + 1} size="lg" className="w-[clamp(52px,4.6vw,88px)]! text-[clamp(20px,2vw,38px)]!" />
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

function Mafia({ state, rows }: { state: StateData; rows: MafiaRow[] }) {
  const phase = String(state.phase ?? "");
  const round = Number(state.round ?? 1);
  const headline =
    phase === "" ? "جاهزون للبدء؟"
    : phase === "night" ? `ليل الجولة ${round}`
    : phase === "day" ? `نهار الجولة ${round}`
    : phase === "vote" ? "التصويت"
    : "انتهت اللعبة";
  const hint =
    phase === "night" ? "اغمضوا أعينكم. الليل للمافيا والطبيب والمحقق."
    : phase === "day" ? "النهار: ناقشوا من تظنون أنه مافيا."
    : phase === "vote" ? "صوّتوا من جوالاتكم لإقصاء لاعب."
    : "";
  return (
    <div className="grid flex-1 content-center gap-[3vh]">
      <Panel className="text-center">
        <Glyph name={phase === "night" ? "shield" : "users"} className="mx-auto size-[clamp(40px,4vw,80px)] text-gold" />
        <p className="mt-[1vh] font-display text-[clamp(36px,4.6vw,92px)] font-extrabold">{headline}</p>
        {hint ? <p className="mt-[1vh] text-[clamp(18px,1.8vw,34px)] text-mist">{hint}</p> : null}
        {state.last_result ? <p className="mt-[2vh] text-[clamp(20px,2vw,38px)] font-bold">{state.last_result}</p> : null}
      </Panel>
      <Panel>
        <ul className="grid grid-cols-2 gap-[1vw] sm:grid-cols-3 lg:grid-cols-5">
          {rows.map((p, i) => (
            <li
              key={p.player_id}
              className={cx(
                "flex items-center gap-2 rounded-[clamp(12px,1vw,20px)] px-[1vw] py-[1vh] text-[clamp(16px,1.6vw,30px)] font-semibold",
                p.alive ? "bg-deep-2/70" : "bg-deep/50 text-faint line-through",
              )}
            >
              <Egg name={p.player_name} index={i + 1} size="sm" className={cx("w-[clamp(28px,2.4vw,46px)]!", !p.alive && "opacity-40")} />
              <span className="min-w-0 truncate">{p.player_name}</span>
            </li>
          ))}
        </ul>
        <p className="mt-[1.5vh] text-center text-[clamp(14px,1.3vw,24px)] text-mist">الأحياء: {rows.filter((p) => p.alive).length}</p>
      </Panel>
    </div>
  );
}

/* ---------------- Results ---------------- */

function Results({ slug, ranking, state, mafia }: { slug: string; ranking: Player[]; state: StateData; mafia: MafiaRow[] }) {
  if (slug === "alhalba") {
    const w = halbaWinner(state as unknown as HalbaState, ranking);
    return (
      <div className="grid flex-1 content-center gap-[3vh] lg:grid-cols-[1.2fr_1fr] lg:items-center">
        <Winner text={w ? `الفائز: ${w.name}` : "انتهت الغرفة"} sub={w?.why} />
        {ranking.length > 0 ? <Scoreboard ranking={ranking} /> : null}
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
    return (
      <div className="grid flex-1 content-center gap-[3vh]">
        <Winner text={state.winner === "mafia" ? "فازت المافيا" : state.winner ? "فاز المواطنون" : "انتهت الغرفة"} />
        {mafia.length > 0 ? (
          <Panel>
            <ul className="grid grid-cols-2 gap-[1vw] sm:grid-cols-3 lg:grid-cols-5">
              {mafia.map((p) => (
                <li key={p.player_id} className="rounded-[clamp(12px,1vw,20px)] bg-deep-2/70 px-[1vw] py-[1vh] text-[clamp(16px,1.6vw,30px)] font-semibold">
                  {p.player_name}
                  {p.player_role ? <span className="block text-[0.75em] font-normal text-mist">{MAFIA_ROLE_LABELS[p.player_role] ?? ""}</span> : null}
                </li>
              ))}
            </ul>
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
  const proveLeft = useSecondsLeft(phase === "prove" ? state.prove_ends_at : null);
  const guests = participants(state, players);
  const knocked = state.knocked ?? [];
  const maxLives = state.max_lives ?? 1;
  const winner = phase === "over" ? halbaWinner(state, players) : null;
  useHalbaCues(state, { sound: true });
  const duel = Array.isArray(state.duel) && state.duel.length === 2 ? state.duel : null;
  const result = state.result;

  return (
    <div className="grid flex-1 gap-[2vw] lg:grid-cols-[1fr_minmax(260px,24vw)]">
      <Panel className="relative flex flex-col justify-center overflow-hidden text-center">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-1/3 mx-auto size-[36vw] rounded-full bg-[#ff5a7a26] blur-3xl" />
        {phase === "" || phase === "idle" ? (
          <p className="relative font-display text-[clamp(32px,4vw,80px)] font-extrabold">استعدوا للحلبة 🥊</p>
        ) : phase === "over" ? (
          <div className="relative">
            <Glyph name="trophy" className="mx-auto size-[clamp(56px,6vw,120px)] text-gold" />
            <p className="mt-[1vh] font-display text-[clamp(36px,4.8vw,96px)] leading-tight font-extrabold">{winner ? `الفائز: ${winner.name}` : "انتهت المباراة"}</p>
            {winner ? <p className="mt-[1vh] text-[clamp(18px,1.8vw,34px)] text-mist">{winner.why}</p> : null}
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
                    <span className="text-gold tabular-nums">{state.bid}</span> <span className="text-[0.6em]">عند {state.bidder_name}</span>
                  </p>
                ) : null}
                <Clock seconds={bidLeft} label="وقت المزايدة" />
              </div>
            ) : null}

            {phase === "prove" ? (
              <div className="grid justify-items-center gap-[1.5vh]">
                <p className="text-[clamp(20px,2.2vw,42px)]">
                  <b>{state.bidder_name}</b> يذكر {state.bid} إجابات
                  {state.challenger_name ? <span className="text-mist"> · تحدّاه {state.challenger_name}</span> : null}
                </p>
                <p className="font-display text-[clamp(80px,12vw,240px)] leading-none font-extrabold tabular-nums">
                  {state.count ?? 0}
                  <span className="text-[0.4em] text-mist">/{state.bid}</span>
                </p>
                <AnswersList answers={state.answers ?? []} big />
                <Clock seconds={proveLeft} label={proveLeft === 0 ? "انتهى الوقت" : "الوقت"} />
              </div>
            ) : null}

            {phase === "result" && result ? (
              <div className={cx("mx-auto rounded-[clamp(18px,1.8vw,32px)] border px-[3vw] py-[2vh]", result.success ? "border-correct/60 bg-correct-fill/20" : "border-wrong/60 bg-wrong-fill/20")}>
                <p className="font-display text-[clamp(32px,4vw,80px)] font-extrabold">
                  {result.success ? `${result.bidder_name} نجح!` : result.knocked_out ? `${result.bidder_name} خرج من الحلبة` : `${result.bidder_name} خسر محاولة`}
                </p>
                <p className="mt-[1vh] text-[clamp(18px,1.8vw,34px)] text-mist">
                  ذكر {result.count} من {result.bid} · {result.success ? "+" : "−"}
                  {result.points} نقطة
                </p>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel className="flex flex-col">
        <h2 className="mb-[1.5vh] flex items-center gap-2 text-[clamp(20px,1.9vw,36px)]">🥊 الحلبة</h2>
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
      </Panel>
    </div>
  );
}

function Clock({ seconds, label }: { seconds: number | null; label: string }) {
  if (seconds === null) return null;
  return (
    <p className="inline-flex items-center gap-3 text-[clamp(18px,1.9vw,36px)] text-mist">
      <Glyph name="clock" className="size-[1.1em] text-gold" />
      {label}
      <span dir="ltr" className={cx("font-display text-[1.6em] font-extrabold tabular-nums", seconds <= 5 ? "text-wrong" : "text-gold")}>
        {seconds}s
      </span>
    </p>
  );
}

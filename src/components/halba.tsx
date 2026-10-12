import { useEffect, useRef, useState } from "react";
import { Egg, Glyph } from "@/components/brand";
import { Button, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";

/**
 * «الحلبة»: shared state shape, helpers, and the host and player panels.
 * The rules live in the database (supabase/schema_alhalba.sql); these panels only
 * show the room's public state and call halba_* functions.
 */

export type HalbaTopic = { id: string; text: string; min: number; seconds: number; category: string | null };
export type HalbaResult = {
  success: boolean;
  bidder_name: string | null;
  challenger_name: string | null;
  bid: number;
  count: number;
  points: number;
  knocked_out: boolean;
};
export type HalbaState = {
  phase?: string;
  mode?: "ffa" | "duel";
  round?: number;
  max_rounds?: number;
  fighters?: string[];
  knocked?: string[];
  duel?: string[] | null;
  topic?: HalbaTopic | null;
  bid?: number;
  bidder?: string | null;
  bidder_name?: string | null;
  challenger?: string | null;
  challenger_name?: string | null;
  bid_ends_at?: string | null;
  prove_ends_at?: string | null;
  count?: number;
  result?: HalbaResult | null;
};
export type HalbaPlayer = { id: string; player_name: string; score: number; is_host: boolean };

export const HALBA_ERRORS: Record<string, string> = {
  NOT_ENOUGH_PLAYERS: "تحتاج الحلبة لاعبين اثنين على الأقل.",
  ROOM_NOT_PLAYING: "ابدأ الغرفة أولًا.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  GAME_OVER: "انتهت المباراة.",
  NO_TOPICS: "لا توجد مواضيع للحلبة بعد. أضفها من لوحة الإدارة.",
  TIME_UP: "انتهى وقت المزايدة.",
  NOT_FIGHTING: "لست في الحلبة هذه الجولة.",
  BID_TOO_LOW: "المزايدة لازم تكون أعلى من الحالية.",
  OWN_BID: "لا تقدر تتحدى مزايدتك.",
  NO_BID: "ما فيه مزايدة تتحداها بعد.",
  NOT_YET: "المزايدة ما خلصت بعد.",
  NOT_IN_ROOM: "انضم للغرفة أولًا.",
};

/** Parses a timestamp from JSON, trimming microseconds that JS can't read. */
export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(t) ? null : t;
}

/** Seconds left until a timestamp, ticking 4 times a second. */
export function useSecondsLeft(until: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [until]);
  const end = parseTime(until);
  return end === null ? null : Math.max(0, Math.ceil((end - now) / 1000));
}

/** Who may bid this round: the duel pair, or everyone still in the ring. */
export function canFight(state: HalbaState, playerId: string | null | undefined) {
  if (!playerId) return false;
  if (Array.isArray(state.duel) && state.duel.length > 0) return state.duel.includes(playerId);
  return (state.fighters ?? []).includes(playerId);
}

export function nameOf(players: HalbaPlayer[], id: string | null | undefined) {
  return players.find((p) => p.id === id)?.player_name ?? "";
}

/** Winner text once the match is over: last one standing, else the top score. */
export function halbaWinner(state: HalbaState, players: HalbaPlayer[]) {
  const fighters = state.fighters ?? [];
  if (fighters.length === 1) return { name: nameOf(players, fighters[0]), why: "آخر من بقي في الحلبة" };
  const ranked = players.filter((p) => !p.is_host).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return null;
  const tied = ranked.filter((p) => p.score === top.score);
  return tied.length > 1
    ? { name: tied.map((p) => p.player_name).join("، "), why: `تعادل بـ ${top.score} نقطة` }
    : { name: top.player_name, why: `بـ ${top.score} نقطة` };
}

async function call(fn: string, args: Record<string, unknown>): Promise<string | null> {
  if (!supabase) return "الاتصال بقاعدة البيانات غير مضبوط بعد.";
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return "تعذّر تنفيذ الخطوة، حاول مرة أخرى.";
  const result = data as { ok: boolean; reason?: string };
  return result?.ok ? null : (HALBA_ERRORS[result?.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.");
}

/* ---------------- Shared pieces ---------------- */

export function TopicCard({ topic, round, maxRounds }: { topic: HalbaTopic; round?: number; maxRounds?: number }) {
  return (
    <div className="rounded-[22px] border border-[#ff5a7a55] bg-[linear-gradient(160deg,#831843cc,#1e1b4bcc)] p-5 text-center shadow-[0_0_40px_-12px_#ff5a7a]">
      <p className="text-[13px] font-semibold text-[#ffb3c4]">
        {[round ? `الجولة ${round}${maxRounds ? ` من ${maxRounds}` : ""}` : "", topic.category ?? ""].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-2 font-display text-[26px] leading-10 font-extrabold text-ivory">{topic.text}</p>
    </div>
  );
}

export function Timer({ seconds, label }: { seconds: number | null; label: string }) {
  if (seconds === null) return null;
  return (
    <p className="inline-flex items-center gap-2 text-[15px] text-mist">
      <Glyph name="clock" className="size-5 text-gold" />
      {label}
      <span dir="ltr" className={cx("font-display text-[24px] font-extrabold tabular-nums", seconds <= 5 ? "text-wrong" : "text-gold")}>
        {seconds}s
      </span>
    </p>
  );
}

export function Ring({ state, players }: { state: HalbaState; players: HalbaPlayer[] }) {
  const fighters = state.fighters ?? [];
  const knocked = state.knocked ?? [];
  const guests = players.filter((p) => !p.is_host);
  const order = [...guests].sort((a, b) => Number(knocked.includes(a.id)) - Number(knocked.includes(b.id)) || b.score - a.score);
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {order.map((p, i) => {
        const out = knocked.includes(p.id) || (fighters.length > 0 && !fighters.includes(p.id));
        const inDuel = Array.isArray(state.duel) && state.duel.includes(p.id);
        return (
          <li
            key={p.id}
            className={cx(
              "flex min-h-12 items-center gap-3 rounded-[14px] border px-3 py-2",
              out ? "border-line/60 bg-deep/40 text-faint" : inDuel ? "border-[#ff5a7a88] bg-[#83184333]" : "border-line bg-deep-2/50",
            )}
          >
            <Egg name={p.player_name} index={i + 1} size="sm" className={cx(out && "opacity-40")} />
            <span className={cx("min-w-0 flex-1 truncate text-[15px] font-semibold", out && "line-through")}>{p.player_name}</span>
            {out ? <span className="text-[12px]">خارج الحلبة</span> : inDuel ? <span className="text-[12px] text-[#ffb3c4]">في النزال</span> : null}
            <span className="font-bold tabular-nums text-gold">{p.score}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ResultCard({ result }: { result: HalbaResult }) {
  return (
    <div
      className={cx(
        "rounded-[20px] border p-4 text-center",
        result.success ? "border-correct/50 bg-correct-fill/15" : "border-wrong/50 bg-wrong-fill/15",
      )}
    >
      <p className="font-display text-[22px] font-extrabold text-ivory">
        {result.success ? `${result.bidder_name} نجح!` : `${result.bidder_name} فشل وخرج من الحلبة`}
      </p>
      <p className="mt-1 text-[15px] text-mist">
        ذكر {result.count} من {result.bid} · {result.success ? "+" : "−"}
        {result.points} نقطة
        {result.challenger_name ? ` · ${result.success ? "خسرها" : "كسبها"} ${result.challenger_name}` : ""}
      </p>
    </div>
  );
}

/* ---------------- Host panel ---------------- */

/** Host controls for الحلبة: settings, rounds, closing bids, counting answers, and finishing a round. */
export function HalbaHostPanel({ roomId, roomCode, roomStatus }: { roomId: string; roomCode: string; roomStatus: string }) {
  const [state, setState] = useState<HalbaState>({});
  const [players, setPlayers] = useState<HalbaPlayer[]>([]);
  const [mode, setMode] = useState<"ffa" | "duel">("ffa");
  const [rounds, setRounds] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(roomStatus === "finished");
  const closing = useRef(false);

  async function load() {
    if (!supabase) return;
    const [{ data: gs }, { data: ps }] = await Promise.all([
      supabase.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
      supabase.from("room_players").select("id, player_name, score, is_host").eq("room_id", roomId).order("joined_at"),
    ]);
    if (gs) setState((gs.state_data ?? {}) as HalbaState);
    if (ps) setPlayers(ps as HalbaPlayer[]);
  }

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 1500);
    return () => window.clearInterval(poll);
    // load only depends on the room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function step(fn: string, args: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await call(fn, { p_room_id: roomId, ...args });
    if (message) setError(message);
    await load();
    setBusy(false);
  }

  const phase = state.phase ?? "";
  const bidLeft = useSecondsLeft(phase === "bid" ? state.bid_ends_at : null);
  const proveLeft = useSecondsLeft(phase === "prove" ? state.prove_ends_at : null);

  // When bidding time runs out, move on by itself (once).
  useEffect(() => {
    if (phase !== "bid") {
      closing.current = false;
      return;
    }
    if (bidLeft === 0 && !closing.current) {
      closing.current = true;
      void step("halba_close_bids");
    }
    // step is stable enough for this one-shot call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, bidLeft]);

  async function endGame() {
    if (!supabase) return;
    setBusy(true);
    const { error: updateError } = await supabase.from("game_rooms").update({ status: "finished" }).eq("id", roomId);
    setBusy(false);
    if (updateError) return setError("تعذّر إنهاء الغرفة.");
    setEnded(true);
  }

  const started = Array.isArray(state.fighters);
  const winner = phase === "over" ? halbaWinner(state, players) : null;

  return (
    <section className="mx-auto mt-2 grid max-w-3xl gap-4 tv:max-w-5xl">
      <div className="surface flex flex-wrap items-center justify-between gap-3 rounded-[22px] px-4 py-3 lg:px-6 lg:py-4">
        <h1 className="flex flex-wrap items-center gap-3 text-xl font-extrabold text-ivory lg:text-2xl tv:text-4xl">
          رمز الغرفة{" "}
          <span className="room-code rounded-[12px] border border-gold/40 bg-night/60 px-3 py-0.5 text-gold shadow-glow-gold">{roomCode}</span>
        </h1>
        <span className="text-sm text-muted">
          الحلبة{state.mode ? ` · ${state.mode === "duel" ? "نزال ثنائي" : "الكل ضد الكل"}` : ""}
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-wrong">
          {error}
        </p>
      ) : null}

      <div className="glass-card grid gap-4 rounded-[28px] p-5 text-center sm:p-6">
        {!started ? (
          <>
            <p className="text-[15px] text-mist">اختاروا طريقة اللعب وعدد الجولات، ثم ابدأوا أول جولة.</p>
            <div className="mx-auto grid w-full max-w-md gap-3">
              <Choice
                label="طريقة اللعب"
                value={mode}
                onChange={(v) => setMode(v as "ffa" | "duel")}
                options={[
                  { value: "ffa", label: "الكل ضد الكل" },
                  { value: "duel", label: "نزال ثنائي" },
                ]}
              />
              <Choice
                label="عدد الجولات"
                value={String(rounds)}
                onChange={(v) => setRounds(Number(v))}
                options={[3, 5, 7, 10].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
            <Button tone="primary" className="mx-auto min-h-14 px-10 text-[17px]" onClick={() => step("halba_start_round", { p_mode: mode, p_rounds: rounds })} disabled={busy}>
              ابدأ الجولة الأولى
            </Button>
          </>
        ) : null}

        {state.topic && (phase === "bid" || phase === "prove" || phase === "result") ? (
          <TopicCard topic={state.topic} round={state.round} maxRounds={state.max_rounds} />
        ) : null}

        {phase === "bid" ? (
          <>
            {Array.isArray(state.duel) && state.duel.length === 2 ? (
              <p className="font-display text-[20px] font-bold text-ivory">
                {nameOf(players, state.duel[0])} <span className="text-[#ff5a7a]">ضد</span> {nameOf(players, state.duel[1])}
              </p>
            ) : null}
            <p className="text-[17px] text-ivory">
              {state.bidder_name ? (
                <>
                  أعلى مزايدة: <b className="font-display text-[28px] text-gold">{state.bid}</b> عند <b>{state.bidder_name}</b>
                </>
              ) : (
                <>المزايدة تبدأ من {state.topic?.min ?? 1}</>
              )}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Timer seconds={bidLeft} label="وقت المزايدة" />
              <Button tone="quiet" onClick={() => step("halba_close_bids")} disabled={busy}>
                أغلق المزايدة الآن
              </Button>
            </div>
          </>
        ) : null}

        {phase === "prove" ? (
          <>
            <p className="text-[17px] text-ivory">
              <b>{state.bidder_name}</b> يذكر <b className="text-gold">{state.bid}</b> إجابات بصوت عالٍ
              {state.challenger_name ? <span className="text-mist"> · تحدّاه {state.challenger_name}</span> : null}
            </p>
            <Timer seconds={proveLeft} label={proveLeft === 0 ? "انتهى الوقت" : "الوقت المتبقي"} />
            <div className="flex items-center justify-center gap-4">
              <Button tone="quiet" className="size-16 rounded-full p-0 text-[26px]" onClick={() => step("halba_count", { p_delta: -1 })} disabled={busy} aria-label="إنقاص إجابة">
                −
              </Button>
              <p className="min-w-28 font-display text-[64px] leading-none font-extrabold tabular-nums text-ivory">
                {state.count ?? 0}
                <span className="text-[28px] text-mist">/{state.bid}</span>
              </p>
              <Button tone="primary" className="size-20 rounded-full p-0 text-[32px]" onClick={() => step("halba_count", { p_delta: 1 })} disabled={busy} aria-label="إجابة صحيحة">
                <span dir="ltr">+1</span>
              </Button>
            </div>
            <p className="text-[13px] text-mist">اضغط +1 لكل إجابة صحيحة تسمعها.</p>
            <Button tone="primary" className="mx-auto min-h-14 px-10 text-[17px]" onClick={() => step("halba_finish")} disabled={busy}>
              أنهِ الجولة واحسب النتيجة
            </Button>
          </>
        ) : null}

        {phase === "result" && state.result ? (
          <>
            <ResultCard result={state.result} />
            <Button tone="primary" className="mx-auto min-h-14 px-10 text-[17px]" onClick={() => step("halba_start_round")} disabled={busy}>
              الجولة التالية
            </Button>
          </>
        ) : null}

        {phase === "over" ? (
          <>
            {state.result ? <ResultCard result={state.result} /> : null}
            <Glyph name="trophy" className="mx-auto size-12 text-gold" />
            <p className="font-display text-[30px] font-extrabold text-ivory">{winner ? `الفائز: ${winner.name}` : "انتهت المباراة"}</p>
            {winner ? <p className="text-[15px] text-mist">{winner.why}</p> : null}
          </>
        ) : null}
      </div>

      {started ? (
        <div className="glass-card rounded-[24px] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-ivory">
            <Glyph name="users" className="size-5 text-gold" />
            الحلبة
          </h2>
          <Ring state={state} players={players} />
        </div>
      ) : null}

      {!ended ? (
        <div className="text-center">
          <Button type="button" tone="violet" onClick={endGame} disabled={busy}>
            إنهاء الغرفة للجميع
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted">انتهت الغرفة.</p>
      )}
    </section>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5 text-start">
      <span className="text-[14px] font-semibold text-ivory">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-full border border-line-strong/70 bg-deep-2/60 p-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx("min-h-11 flex-1 rounded-full px-3 text-[15px] font-semibold transition", value === o.value ? "btn-gold" : "text-mist hover:text-ivory")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Player panel ---------------- */

/** A player's phone in الحلبة: bid, challenge, and follow the proof. */
export function HalbaPlayerPanel({ roomId, meId, state, players }: { roomId: string; meId: string | null; state: HalbaState; players: HalbaPlayer[] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [local, setLocal] = useState<HalbaState | null>(null);
  const closing = useRef(false);
  // Show our own bid at once; the room's next refresh replaces it.
  const view = local && local.phase === state.phase && (local.bid ?? 0) > (state.bid ?? 0) ? local : state;
  const phase = view.phase ?? "";
  const bidLeft = useSecondsLeft(phase === "bid" ? view.bid_ends_at : null);
  const proveLeft = useSecondsLeft(phase === "prove" ? view.prove_ends_at : null);
  const fighting = canFight(view, meId);
  const knocked = !!meId && (view.knocked ?? []).includes(meId);
  const iAmBidder = !!meId && view.bidder === meId;

  useEffect(() => {
    setMessage(null);
    setLocal(null);
  }, [state.phase, state.round]);

  useEffect(() => {
    if (phase !== "bid") {
      closing.current = false;
      return;
    }
    if (bidLeft === 0 && !closing.current && fighting) {
      closing.current = true;
      void call("halba_close_bids", { p_room_id: roomId });
    }
  }, [phase, bidLeft, fighting, roomId]);

  async function bid(amount: number) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const error = await call("halba_bid", { p_room_id: roomId, p_amount: amount });
    if (error) setMessage(error);
    else setLocal({ ...view, bid: amount, bidder: meId, bidder_name: nameOf(players, meId) });
    setBusy(false);
  }

  async function challenge() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const error = await call("halba_challenge", { p_room_id: roomId });
    if (error) setMessage(error);
    setBusy(false);
  }

  const current = view.bid ?? 0;
  const winner = phase === "over" ? halbaWinner(view, players) : null;

  return (
    <section className="glass-card mb-5 grid gap-4 rounded-[28px] p-5 text-center">
      <p className="text-xs font-bold text-violet-text">الحلبة{view.round ? ` · الجولة ${view.round}` : ""}</p>

      {phase === "" || phase === "idle" ? <p className="text-[15px] text-mist">انتظروا المضيف ليبدأ أول جولة.</p> : null}

      {view.topic && (phase === "bid" || phase === "prove" || phase === "result") ? <TopicCard topic={view.topic} /> : null}

      {knocked && phase !== "over" ? (
        <p className="rounded-[14px] border border-wrong/40 bg-wrong-fill/10 p-3 text-[15px] text-ivory">خرجت من الحلبة. تابع النزالات وشجّع!</p>
      ) : null}

      {phase === "bid" ? (
        <>
          <Timer seconds={bidLeft} label="وقت المزايدة" />
          <p className="text-[17px] text-ivory">
            {view.bidder_name ? (
              <>
                أعلى مزايدة <b className="font-display text-[30px] text-gold">{current}</b> عند <b>{iAmBidder ? "أنت" : view.bidder_name}</b>
              </>
            ) : (
              <>كم إجابة تقدر تذكر؟ المزايدة تبدأ من {view.topic?.min ?? 1}</>
            )}
          </p>
          {fighting ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((n) => (
                  <Button key={n} tone={n === 1 ? "primary" : "quiet"} className="min-h-16 flex-col gap-0 px-2 text-[22px] font-extrabold" onClick={() => bid(current + n)} disabled={busy || bidLeft === 0}>
                    {current + n}
                    <span className="text-[12px] font-semibold opacity-80">أزايد</span>
                  </Button>
                ))}
              </div>
              {view.bidder && !iAmBidder ? (
                <button
                  type="button"
                  onClick={challenge}
                  disabled={busy}
                  className="min-h-16 rounded-full bg-[linear-gradient(90deg,#ff5a7a,#c21d4f)] px-6 font-display text-[24px] font-extrabold text-ivory shadow-[0_10px_30px_-8px_#ff5a7a] transition active:scale-[0.97] disabled:opacity-50"
                >
                  تحدي! 🥊
                </button>
              ) : null}
              {iAmBidder ? <p className="text-[14px] text-mist">مزايدتك الأعلى. انتظر: أحد يزايد عليك أو يتحداك.</p> : null}
            </>
          ) : !knocked ? (
            <p className="text-[14px] text-mist">هذه الجولة نزال بين لاعبين آخرين. تابع!</p>
          ) : null}
        </>
      ) : null}

      {phase === "prove" ? (
        <>
          {iAmBidder ? (
            <p className="rounded-[18px] border border-gold/50 bg-gold/10 p-4 font-display text-[22px] font-extrabold text-ivory">
              دورك! اذكر {view.bid} إجابات بصوت عالٍ
            </p>
          ) : (
            <p className="text-[17px] text-ivory">
              <b>{view.bidder_name}</b> يذكر {view.bid} إجابات
              {view.challenger_name ? <span className="text-mist"> · تحدّاه {view.challenger_name}</span> : null}
            </p>
          )}
          <Timer seconds={proveLeft} label={proveLeft === 0 ? "انتهى الوقت" : "الوقت"} />
          <p className="font-display text-[56px] leading-none font-extrabold tabular-nums text-ivory">
            {view.count ?? 0}
            <span className="text-[24px] text-mist">/{view.bid}</span>
          </p>
        </>
      ) : null}

      {phase === "result" && view.result ? <ResultCard result={view.result} /> : null}

      {phase === "over" ? (
        <>
          <Glyph name="trophy" className="mx-auto size-10 text-gold" />
          <p className="font-display text-[26px] font-extrabold text-ivory">{winner ? `الفائز: ${winner.name}` : "انتهت المباراة"}</p>
          {winner ? <p className="text-[14px] text-mist">{winner.why}</p> : null}
        </>
      ) : null}

      {message ? <p className="text-[14px] font-semibold text-wrong">{message}</p> : null}
    </section>
  );
}

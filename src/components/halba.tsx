import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Egg, Glyph } from "@/components/brand";
import { Button, cx, inputClass } from "@/components/ui";
import { playCue } from "@/lib/sfx";
import { supabase } from "@/lib/supabase";

/**
 * «الحلبة»: shared state shape, helpers, and the host and player panels.
 * The rules live in the database (supabase/schema_alhalba.sql + alhalba_v2.sql);
 * these panels only show the room's public state and call halba_* functions.
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
  lives_left?: number;
};
export type HalbaState = {
  phase?: string;
  mode?: "ffa" | "duel";
  round?: number;
  max_rounds?: number;
  fighters?: string[];
  knocked?: string[];
  lives?: Record<string, number>;
  max_lives?: number;
  host_plays?: boolean;
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
  answers?: HalbaAnswer[];
  result?: HalbaResult | null;
};
export type HalbaAnswer = { n: number; text: string; status: "pending" | "ok" | "no" };
export type HalbaPlayer = { id: string; player_name: string; score: number; is_host: boolean };

export const HALBA_ERRORS: Record<string, string> = {
  NOT_ENOUGH_PLAYERS: "تحتاج الحلبة لاعبين اثنين على الأقل.",
  NOT_ENOUGH_GUESTS: "تحتاج لاعبين اثنين غيرك. شغّل «أشارك في اللعب» أو ادعُ لاعبًا آخر.",
  ROOM_NOT_PLAYING: "ابدأ الغرفة أولًا.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  GAME_OVER: "انتهت المباراة.",
  NO_TOPICS: "لا توجد مواضيع للحلبة بعد. أضفها من لوحة الإدارة.",
  TIME_UP: "انتهى الوقت.",
  NOT_FIGHTING: "لست في الحلبة هذه الجولة.",
  BID_TOO_LOW: "سبقك أحد بمزايدة أعلى. زايد من جديد.",
  OWN_BID: "لا تقدر تتحدى مزايدتك.",
  NO_BID: "ما فيه مزايدة تتحداها بعد.",
  NOT_YET: "المزايدة ما خلصت بعد.",
  NOT_IN_ROOM: "انضم للغرفة أولًا.",
  NOT_JUDGE: "الحَكَم هو من يحسب الإجابات.",
  NOT_BIDDER: "صاحب المزايدة فقط يكتب الإجابات.",
  BAD_ANSWER: "اكتب إجابة قصيرة.",
  TOO_MANY: "وصلت لأقصى عدد من الإجابات.",
  DUPLICATE: "كتبتها من قبل.",
  NO_ANSWER: "هذه الإجابة غير موجودة.",
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

/** Same rule as halba_may_judge(): who counts answers right now. */
export function canJudge(state: HalbaState, players: HalbaPlayer[], meId: string | null | undefined, iAmHost: boolean) {
  if (state.phase !== "prove") return false;
  if (meId && state.bidder === meId) return false;
  if (iAmHost) return true;
  if (meId && state.challenger === meId) return true;
  const hostId = players.find((p) => p.is_host)?.id;
  return !!meId && state.bidder === hostId && (state.fighters ?? []).includes(meId);
}

export function nameOf(players: HalbaPlayer[], id: string | null | undefined) {
  return players.find((p) => p.id === id)?.player_name ?? "";
}

/** Everyone who takes part: guests, plus the host when they play. */
export function participants(state: HalbaState, players: HalbaPlayer[]) {
  return players.filter((p) => !p.is_host || state.host_plays);
}

/** Winner text once the match is over: last one standing, else the top score. */
export function halbaWinner(state: HalbaState, players: HalbaPlayer[]) {
  const fighters = state.fighters ?? [];
  if (fighters.length === 1) return { name: nameOf(players, fighters[0]), why: "آخر من بقي في الحلبة" };
  const ranked = participants(state, players).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return null;
  const tied = ranked.filter((p) => p.score === top.score);
  return tied.length > 1
    ? { name: tied.map((p) => p.player_name).join("، "), why: `تعادل بـ ${top.score} نقطة` }
    : { name: top.player_name, why: `بـ ${top.score} نقطة` };
}

async function call(fn: string, args: Record<string, unknown>): Promise<{ error: string | null; reason?: string }> {
  if (!supabase) return { error: "الاتصال بقاعدة البيانات غير مضبوط بعد." };
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: "تعذّر تنفيذ الخطوة، حاول مرة أخرى." };
  const result = data as { ok: boolean; reason?: string };
  if (result?.ok) return { error: null };
  return { error: HALBA_ERRORS[result?.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.", reason: result?.reason };
}

/** The room's الحلبة state and players, kept fresh: realtime plus a 1-second poll. */
export function useHalbaLive(roomId: string) {
  const [state, setState] = useState<HalbaState>({});
  const [players, setPlayers] = useState<HalbaPlayer[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: gs }, { data: ps }] = await Promise.all([
      supabase.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
      supabase.from("room_players").select("id, player_name, score, is_host").eq("room_id", roomId).order("joined_at"),
    ]);
    if (gs) setState((gs.state_data ?? {}) as HalbaState);
    if (ps) setPlayers(ps as HalbaPlayer[]);
  }, [roomId]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    void load();
    const channel = client
      .channel(`halba-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_game_state", filter: `room_id=eq.${roomId}` }, () => void load())
      .subscribe();
    const poll = window.setInterval(load, 1000);
    return () => {
      window.clearInterval(poll);
      client.removeChannel(channel);
    };
  }, [roomId, load]);

  return { state, players, reload: load };
}

/**
 * Sounds on the big screen and host device, vibration on the phone whose turn it is.
 * Fires once per change of phase or round.
 */
export function useHalbaCues(state: HalbaState, opts: { sound?: boolean; meId?: string | null }) {
  const last = useRef<string>("");
  useEffect(() => {
    const key = `${state.round ?? 0}:${state.phase ?? ""}`;
    if (!last.current) {
      last.current = key;
      return;
    }
    if (key === last.current) return;
    last.current = key;
    const phase = state.phase ?? "";
    if (opts.sound) {
      if (phase === "bid") playCue("round");
      else if (phase === "prove") playCue("countdown");
      else if (phase === "result") playCue(state.result?.success ? "correct" : "wrong");
      else if (phase === "over") playCue("victory");
    }
    if (opts.meId && phase === "prove" && state.bidder === opts.meId) {
      try {
        navigator.vibrate?.([200, 80, 200]);
      } catch {
        // No vibration on this device.
      }
    }
  }, [state.round, state.phase, state.result?.success, state.bidder, opts.sound, opts.meId]);
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

/** Lives left, as small hearts. */
export function Hearts({ left, max, className }: { left: number; max: number; className?: string }) {
  if (max <= 1) return null;
  return (
    <span aria-label={`${left} من ${max} محاولات`} className={cx("inline-flex gap-0.5", className)}>
      {Array.from({ length: max }, (_, i) => (
        <Glyph key={i} name="heart" className={cx("size-[1em]", i < left ? "text-[#ff5a7a]" : "text-line-strong/50")} />
      ))}
    </span>
  );
}

export function Ring({ state, players }: { state: HalbaState; players: HalbaPlayer[] }) {
  const fighters = state.fighters ?? [];
  const knocked = state.knocked ?? [];
  const order = participants(state, players).sort(
    (a, b) => Number(knocked.includes(a.id)) - Number(knocked.includes(b.id)) || b.score - a.score,
  );
  const max = state.max_lives ?? 1;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {order.map((p, i) => {
        const out = knocked.includes(p.id);
        const waiting = !out && state.phase !== "over" && fighters.length > 0 && !fighters.includes(p.id);
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
            <span className={cx("min-w-0 flex-1 truncate text-[15px] font-semibold", out && "line-through")}>
              {p.player_name}
              {p.is_host ? <span className="ms-1.5 text-[12px] font-normal text-mist">(المضيف)</span> : null}
            </span>
            {out ? (
              <span className="text-[12px]">خارج الحلبة</span>
            ) : waiting ? (
              <span className="text-[12px] text-mist">يدخل الجولة القادمة</span>
            ) : inDuel ? (
              <span className="text-[12px] text-[#ffb3c4]">في النزال</span>
            ) : (
              <Hearts left={state.lives?.[p.id] ?? max} max={max} className="text-[13px]" />
            )}
            <span className="font-bold tabular-nums text-gold">{p.score}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ResultCard({ result, maxLives }: { result: HalbaResult; maxLives: number }) {
  const lost = !result.success;
  return (
    <div className={cx("rounded-[20px] border p-4 text-center", result.success ? "border-correct/50 bg-correct-fill/15" : "border-wrong/50 bg-wrong-fill/15")}>
      <p className="font-display text-[22px] font-extrabold text-ivory">
        {result.success
          ? `${result.bidder_name} نجح!`
          : result.knocked_out
            ? `${result.bidder_name} فشل وخرج من الحلبة`
            : `${result.bidder_name} فشل وخسر محاولة`}
      </p>
      <p className="mt-1 text-[15px] text-mist">
        ذكر {result.count} من {result.bid} · {result.success ? "+" : "−"}
        {result.points} نقطة
        {result.challenger_name ? ` · ${result.success ? "خسرها" : "كسبها"} ${result.challenger_name}` : ""}
      </p>
      {lost && !result.knocked_out && maxLives > 1 ? (
        <p className="mt-1 inline-flex items-center gap-2 text-[14px] text-ivory">
          بقي له <Hearts left={result.lives_left ?? 0} max={maxLives} />
        </p>
      ) : null}
    </div>
  );
}

/* ---------------- Typed answers ---------------- */

const STATUS_STYLE: Record<HalbaAnswer["status"], string> = {
  pending: "border-line-strong/60 bg-deep-2/70 text-ivory",
  ok: "border-correct/60 bg-correct-fill/20 text-ivory",
  no: "border-wrong/50 bg-wrong-fill/15 text-faint line-through",
};

/** The bidder's answers so far, with their judging. */
export function AnswersList({ answers, big = false }: { answers: HalbaAnswer[]; big?: boolean }) {
  if (answers.length === 0) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-2">
      {answers.map((a) => (
        <li key={a.n} className={cx("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold", big ? "text-[clamp(18px,1.8vw,34px)]" : "text-[15px]", STATUS_STYLE[a.status])}>
          {a.status === "ok" ? <Glyph name="check" className="size-[1em] text-correct" /> : a.status === "no" ? <Glyph name="x" className="size-[1em] text-wrong" /> : null}
          {a.text}
        </li>
      ))}
    </ul>
  );
}

/** The bidder types answers one by one; the box stays focused for the next one. */
function AnswerInput({ roomId, reload }: { roomId: string; reload: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setMessage(null);
    const { error } = await call("halba_answer", { p_room_id: roomId, p_text: value });
    if (error) setMessage(error);
    else setText("");
    await reload();
    setBusy(false);
    box.current?.focus();
  }

  return (
    <form onSubmit={send} className="grid gap-2">
      <div className="flex gap-2">
        <input
          ref={box}
          autoFocus
          className={cx(inputClass, "min-h-14 text-[18px]")}
          value={text}
          maxLength={60}
          onChange={(e) => setText(e.target.value)}
          placeholder="اكتب إجابة واضغط إرسال"
          enterKeyHint="send"
          autoComplete="off"
        />
        <Button type="submit" tone="primary" className="min-h-14 shrink-0 px-5" disabled={busy || !text.trim()}>
          إرسال
        </Button>
      </div>
      {message ? <p className="text-[14px] font-semibold text-wrong">{message}</p> : null}
    </form>
  );
}

/* ---------------- Fighter and judge controls ---------------- */

/** Bidding, challenging and "your turn": shown on any phone that is in the ring (the host's too). */
function FighterControls({
  roomId,
  meId,
  state,
  players,
  reload,
}: {
  roomId: string;
  meId: string | null;
  state: HalbaState;
  players: HalbaPlayer[];
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const phase = state.phase ?? "";
  const bidLeft = useSecondsLeft(phase === "bid" ? state.bid_ends_at : null);
  const fighting = canFight(state, meId);
  const knocked = !!meId && (state.knocked ?? []).includes(meId);
  const iAmBidder = !!meId && state.bidder === meId;
  const current = state.bid ?? 0;

  useEffect(() => setMessage(null), [state.phase, state.round]);

  async function act(fn: string, args: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const { error } = await call(fn, { p_room_id: roomId, ...args });
    if (error) setMessage(error);
    await reload();
    setBusy(false);
  }

  if (knocked && phase !== "over") {
    return <p className="rounded-[14px] border border-wrong/40 bg-wrong-fill/10 p-3 text-[15px] text-ivory">خرجت من الحلبة. تابع النزالات وشجّع!</p>;
  }

  if (phase === "bid") {
    return (
      <div className="grid gap-3">
        <p className="text-[17px] text-ivory">
          {state.bidder_name ? (
            <>
              أعلى مزايدة <b className="font-display text-[30px] text-gold">{current}</b> عند <b>{iAmBidder ? "أنت" : state.bidder_name}</b>
            </>
          ) : (
            <>كم إجابة تقدر تذكر؟ المزايدة تبدأ من {state.topic?.min ?? 1}</>
          )}
        </p>
        {fighting ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((n) => (
                <Button
                  key={n}
                  tone={n === 1 ? "primary" : "quiet"}
                  className="min-h-16 flex-col gap-0 px-2 text-[22px] font-extrabold"
                  onClick={() => act("halba_bid", { p_amount: current + n })}
                  disabled={busy || bidLeft === 0}
                >
                  {current + n}
                  <span className="text-[12px] font-semibold opacity-80">أزايد</span>
                </Button>
              ))}
            </div>
            {state.bidder && !iAmBidder ? (
              <button
                type="button"
                onClick={() => act("halba_challenge")}
                disabled={busy}
                className="min-h-16 rounded-full bg-[linear-gradient(90deg,#ff5a7a,#c21d4f)] px-6 font-display text-[24px] font-extrabold text-ivory shadow-[0_10px_30px_-8px_#ff5a7a] transition active:scale-[0.97] disabled:opacity-50"
              >
                تحدي! 🥊
              </button>
            ) : null}
            {iAmBidder ? <p className="text-[14px] text-mist">مزايدتك الأعلى. انتظر: أحد يزايد عليك أو يتحداك.</p> : null}
          </>
        ) : (
          <p className="text-[14px] text-mist">هذه الجولة نزال بين لاعبين آخرين. تابع!</p>
        )}
        {message ? <p className="text-[14px] font-semibold text-wrong">{message}</p> : null}
      </div>
    );
  }

  if (phase === "prove" && iAmBidder) {
    return (
      <div className="grid gap-3">
        <p className="rounded-[18px] border border-gold/50 bg-gold/10 p-4 font-display text-[22px] font-extrabold text-ivory">
          دورك! اكتب {state.bid} إجابات، أو قلها بصوت عالٍ
          <span className="block text-[15px] font-semibold text-mist">
            {state.challenger ? `${nameOf(players, state.challenger) || state.challenger_name} يحكم على إجاباتك` : "الحَكَم يحكم على إجاباتك"}
          </span>
        </p>
        <AnswerInput roomId={roomId} reload={reload} />
      </div>
    );
  }
  return null;
}

/** The answer counter, for whoever judges this proof. Ends by itself when the clock runs out. */
function JudgeControls({ roomId, state, reload, compact = false }: { roomId: string; state: HalbaState; reload: () => Promise<void>; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const left = useSecondsLeft(state.prove_ends_at);
  const finishing = useRef(false);

  async function act(fn: string, args: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const { error } = await call(fn, { p_room_id: roomId, ...args });
    if (error) setMessage(error);
    await reload();
    setBusy(false);
  }

  const answers = state.answers ?? [];
  const pending = answers.filter((a) => a.status === "pending").length;

  // After the clock: a moment for the last answer to land, then close by itself, once nothing waits for a ✓/✗.
  useEffect(() => {
    if (left === 0 && pending === 0 && !finishing.current) {
      finishing.current = true;
      const t = window.setTimeout(() => void act("halba_finish"), 2500);
      return () => window.clearTimeout(t);
    }
    // act only needs the latest room id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, pending]);

  return (
    <div className="grid gap-3 rounded-[22px] border border-gold/40 bg-gold/5 p-4">
      <p className="text-[14px] font-semibold text-gold">أنت الحَكَم: ✓ للإجابة الصحيحة، ✗ للخاطئة</p>
      {answers.length > 0 ? (
        <ul className="grid gap-2">
          {answers.map((a) => (
            <li key={a.n} className={cx("flex items-center gap-2 rounded-[14px] border px-3 py-1.5", STATUS_STYLE[a.status])}>
              <span className="min-w-0 flex-1 truncate text-start text-[17px] font-semibold">{a.text}</span>
              <button
                type="button"
                onClick={() => act("halba_mark", { p_n: a.n, p_ok: true })}
                disabled={busy}
                aria-label={`قبول ${a.text}`}
                className={cx("grid size-11 place-items-center rounded-full border transition", a.status === "ok" ? "border-correct bg-correct-fill text-night" : "border-correct/60 text-correct hover:bg-correct-fill/20")}
              >
                <Glyph name="check" className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => act("halba_mark", { p_n: a.n, p_ok: false })}
                disabled={busy}
                aria-label={`رفض ${a.text}`}
                className={cx("grid size-11 place-items-center rounded-full border transition", a.status === "no" ? "border-wrong bg-wrong-fill text-ivory" : "border-wrong/60 text-wrong hover:bg-wrong-fill/20")}
              >
                <Glyph name="x" className="size-5" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-mist">الإجابات المكتوبة تظهر هنا. إذا قالها بصوت عالٍ، استخدم +1.</p>
      )}
      {pending > 0 && left === 0 ? <p className="text-[13px] font-semibold text-gold">احكم على الإجابات الباقية ({pending}) لتنتهي الجولة.</p> : null}
      <div className="flex items-center justify-center gap-4">
        <Button tone="quiet" className="size-14 rounded-full p-0 text-[24px]" onClick={() => act("halba_count", { p_delta: -1 })} disabled={busy || left === 0} aria-label="إنقاص إجابة">
          −
        </Button>
        <p className={cx("min-w-28 font-display leading-none font-extrabold tabular-nums text-ivory", compact ? "text-[52px]" : "text-[64px]")}>
          {state.count ?? 0}
          <span className="text-[0.45em] text-mist">/{state.bid}</span>
        </p>
        <Button tone="primary" className="size-16 rounded-full p-0 text-[26px]" onClick={() => act("halba_count", { p_delta: 1 })} disabled={busy || left === 0} aria-label="إجابة صحيحة منطوقة">
          <span dir="ltr">+1</span>
        </Button>
      </div>
      <Button tone="quiet" className="mx-auto" onClick={() => act("halba_finish")} disabled={busy}>
        أنهِ الجولة الآن
      </Button>
      {message ? <p className="text-[14px] font-semibold text-wrong">{message}</p> : null}
    </div>
  );
}

/** Shown to everyone else during the proof. */
function ProofView({ state, players }: { state: HalbaState; players: HalbaPlayer[] }) {
  return (
    <div className="grid gap-3">
    <AnswersList answers={state.answers ?? []} />
    <p className="font-display text-[56px] leading-none font-extrabold tabular-nums text-ivory">
      {state.count ?? 0}
      <span className="text-[24px] text-mist">/{state.bid}</span>
      <span className="mt-2 block font-sans text-[14px] font-normal text-mist">
        {state.challenger ? `يحكم ${nameOf(players, state.challenger) || state.challenger_name}` : "يحكم الحَكَم"}
      </span>
    </p>
    </div>
  );
}

/* ---------------- Host panel ---------------- */

/** Host device: settings, rounds, judging, and the host's own bids when they play. */
export function HalbaHostPanel({ roomId, roomCode, roomStatus }: { roomId: string; roomCode: string; roomStatus: string }) {
  const { state, players, reload } = useHalbaLive(roomId);
  const [mode, setMode] = useState<"ffa" | "duel">("ffa");
  const [rounds, setRounds] = useState(7);
  const [lives, setLives] = useState(2);
  const [hostPlays, setHostPlays] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(roomStatus === "finished");
  const closing = useRef(false);
  const hostId = players.find((p) => p.is_host)?.id ?? null;
  useHalbaCues(state, { sound: true, meId: hostId });

  async function step(fn: string, args: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: message } = await call(fn, { p_room_id: roomId, ...args });
    if (message) setError(message);
    await reload();
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
  const iJudge = canJudge(state, players, hostId, true);
  const guests = players.filter((p) => !p.is_host).length;

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
            <p className="text-[15px] text-mist">اختاروا طريقة اللعب، ثم ابدأوا أول جولة. في الغرفة {guests + 1} {guests + 1 > 10 ? "شخصًا" : "أشخاص"} مع المضيف.</p>
            <div className="mx-auto grid w-full max-w-md gap-3">
              <Choice
                label="المضيف"
                value={hostPlays ? "play" : "judge"}
                onChange={(v) => setHostPlays(v === "play")}
                options={[
                  { value: "play", label: "أشارك في اللعب" },
                  { value: "judge", label: "حَكَم فقط" },
                ]}
              />
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
                label="المحاولات لكل لاعب"
                value={String(lives)}
                onChange={(v) => setLives(Number(v))}
                options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
              />
              <p className="-mt-1 text-start text-[13px] text-mist">{lives === 1 ? "أول خطأ يُخرج اللاعب من الحلبة." : `كل خطأ ينقص محاولة، ومن تخلص محاولاته الـ${lives} يخرج.`}</p>
              <Choice
                label="عدد الجولات"
                value={String(rounds)}
                onChange={(v) => setRounds(Number(v))}
                options={[3, 5, 7, 10].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
            <Button
              tone="primary"
              className="mx-auto min-h-14 px-10 text-[17px]"
              onClick={() => step("halba_start_round", { p_mode: mode, p_rounds: rounds, p_host_plays: hostPlays, p_lives: lives })}
              disabled={busy}
            >
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
            <Timer seconds={bidLeft} label="وقت المزايدة" />
            {state.host_plays ? (
              <FighterControls roomId={roomId} meId={hostId} state={state} players={players} reload={reload} />
            ) : (
              <p className="text-[17px] text-ivory">
                {state.bidder_name ? (
                  <>
                    أعلى مزايدة: <b className="font-display text-[28px] text-gold">{state.bid}</b> عند <b>{state.bidder_name}</b>
                  </>
                ) : (
                  <>المزايدة تبدأ من {state.topic?.min ?? 1}</>
                )}
              </p>
            )}
            <Button tone="quiet" className="mx-auto" onClick={() => step("halba_close_bids")} disabled={busy}>
              أغلق المزايدة الآن
            </Button>
          </>
        ) : null}

        {phase === "prove" ? (
          <>
            <p className="text-[17px] text-ivory">
              <b>{state.bidder_name}</b> يذكر <b className="text-gold">{state.bid}</b> إجابات بصوت عالٍ
              {state.challenger_name ? <span className="text-mist"> · تحدّاه {state.challenger_name}</span> : null}
            </p>
            <Timer seconds={proveLeft} label={proveLeft === 0 ? "انتهى الوقت" : "الوقت المتبقي"} />
            {iJudge ? (
              <JudgeControls roomId={roomId} state={state} reload={reload} />
            ) : (
              <>
                <FighterControls roomId={roomId} meId={hostId} state={state} players={players} reload={reload} />
                <ProofView state={state} players={players} />
              </>
            )}
          </>
        ) : null}

        {phase === "result" && state.result ? (
          <>
            <ResultCard result={state.result} maxLives={state.max_lives ?? 1} />
            <Button tone="primary" className="mx-auto min-h-14 px-10 text-[17px]" onClick={() => step("halba_start_round")} disabled={busy}>
              الجولة التالية
            </Button>
          </>
        ) : null}

        {phase === "over" ? (
          <>
            {state.result ? <ResultCard result={state.result} maxLives={state.max_lives ?? 1} /> : null}
            <Glyph name="trophy" className="mx-auto size-12 text-gold" />
            <p className="font-display text-[30px] font-extrabold text-ivory">{winner ? `الفائز: ${winner.name}` : "انتهت المباراة"}</p>
            {winner ? <p className="text-[15px] text-mist">{winner.why}</p> : null}
            <Button tone="primary" className="mx-auto min-h-14 px-10 text-[17px]" onClick={() => step("halba_reset")} disabled={busy}>
              مباراة جديدة
            </Button>
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
            className={cx("min-h-11 flex-1 rounded-full px-3 text-[14px] font-semibold transition sm:text-[15px]", value === o.value ? "btn-gold" : "text-mist hover:text-ivory")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Player panel ---------------- */

/** A player's phone in الحلبة: bid, challenge, judge when it's their turn to count, and follow the ring. */
export function HalbaPlayerPanel({ roomId, meId }: { roomId: string; meId: string | null }) {
  const { state, players, reload } = useHalbaLive(roomId);
  useHalbaCues(state, { meId });
  const phase = state.phase ?? "";
  const bidLeft = useSecondsLeft(phase === "bid" ? state.bid_ends_at : null);
  const proveLeft = useSecondsLeft(phase === "prove" ? state.prove_ends_at : null);
  const closing = useRef(false);
  const fighting = canFight(state, meId);
  const iJudge = canJudge(state, players, meId, false);
  const iAmBidder = !!meId && state.bidder === meId;
  const winner = phase === "over" ? halbaWinner(state, players) : null;

  // A fighter's phone also closes the bidding when the clock hits zero (in case the host's screen is asleep).
  useEffect(() => {
    if (phase !== "bid") {
      closing.current = false;
      return;
    }
    if (bidLeft === 0 && !closing.current && fighting) {
      closing.current = true;
      const t = window.setTimeout(() => void call("halba_close_bids", { p_room_id: roomId }).then(reload), 1500);
      return () => window.clearTimeout(t);
    }
  }, [phase, bidLeft, fighting, roomId, reload]);

  return (
    <section className="glass-card mb-5 grid gap-4 rounded-[28px] p-5 text-center">
      <p className="text-xs font-bold text-violet-text">الحلبة{state.round ? ` · الجولة ${state.round}` : ""}</p>

      {phase === "" || phase === "idle" ? <p className="text-[15px] text-mist">انتظروا المضيف ليبدأ أول جولة.</p> : null}

      {state.topic && (phase === "bid" || phase === "prove" || phase === "result") ? <TopicCard topic={state.topic} /> : null}

      {phase === "bid" ? <Timer seconds={bidLeft} label="وقت المزايدة" /> : null}
      {phase === "prove" ? (
        <>
          {!iAmBidder ? (
            <p className="text-[17px] text-ivory">
              <b>{state.bidder_name}</b> يذكر {state.bid} إجابات
              {state.challenger_name ? <span className="text-mist"> · تحدّاه {state.challenger_name}</span> : null}
            </p>
          ) : null}
          <Timer seconds={proveLeft} label={proveLeft === 0 ? "انتهى الوقت" : "الوقت"} />
        </>
      ) : null}

      <FighterControls roomId={roomId} meId={meId} state={state} players={players} reload={reload} />

      {phase === "prove" ? iJudge ? <JudgeControls roomId={roomId} state={state} reload={reload} compact /> : <ProofView state={state} players={players} /> : null}

      {phase === "result" && state.result ? <ResultCard result={state.result} maxLives={state.max_lives ?? 1} /> : null}

      {phase === "over" ? (
        <>
          <Glyph name="trophy" className="mx-auto size-10 text-gold" />
          <p className="font-display text-[26px] font-extrabold text-ivory">{winner ? `الفائز: ${winner.name}` : "انتهت المباراة"}</p>
          {winner ? <p className="text-[14px] text-mist">{winner.why}</p> : null}
        </>
      ) : null}

      {Array.isArray(state.fighters) ? (
        <div className="text-start">
          <h3 className="mb-2 text-[15px] font-bold text-ivory">الحلبة</h3>
          <Ring state={state} players={players} />
        </div>
      ) : null}
    </section>
  );
}

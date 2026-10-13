import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Egg, Glyph } from "@/components/brand";
import { HalbaShare } from "@/components/halba-share";
import { Button, cx, inputClass } from "@/components/ui";
import { playCue } from "@/lib/sfx";
import { supabase } from "@/lib/supabase";
import { useLivePoll } from "@/lib/live";
import { useSiteSettings } from "@/lib/site-settings";
import { vibrate } from "@/lib/prefs";

/**
 * «الحلبة»: shared state shape, helpers, and the host and player panels.
 * The rules live in the database (supabase/schema_alhalba.sql, then alhalba_v2/v3/v4.sql);
 * these panels only show the room's public state and call halba_* functions.
 *
 * A "side" is who fights: the player in solo modes, the team colour in team mode.
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
  doubled?: boolean;
  side?: string | null;
};
export type HalbaStealResult = { success: boolean; name: string | null; need: number; count: number; points: number };
export type HalbaStats = {
  best_bid?: { name: string | null; bid: number };
  bold?: { name: string | null; bid: number };
  correct?: Record<string, number>;
  cheers?: Record<string, number>;
  steal?: { name: string | null; need: number };
  group?: { side: string; points: number };
};
/** One side's answers in a group round: correct ones, and correct ones nobody else wrote. */
export type HalbaGroupRow = { side: string; points: number; answers: Array<{ text: string; valid: boolean; unique: boolean }> };
export type HalbaState = {
  phase?: string;
  mode?: "ffa" | "duel" | "teams";
  round?: number;
  max_rounds?: number;
  categories?: string[] | null;
  fighters?: string[];
  knocked?: string[];
  lives?: Record<string, number>;
  max_lives?: number;
  host_plays?: boolean;
  duel?: string[] | null;
  teams?: Record<string, "red" | "blue">;
  team_scores?: Record<string, number>;
  topic?: HalbaTopic | null;
  bid?: number;
  bidder?: string | null;
  bidder_name?: string | null;
  bidder_side?: string | null;
  challenger?: string | null;
  challenger_name?: string | null;
  challenger_side?: string | null;
  performer_side?: string | null;
  bid_ends_at?: string | null;
  prove_ends_at?: string | null;
  offer_ends_at?: string | null;
  count?: number;
  answers?: HalbaAnswer[];
  double?: boolean;
  double_by?: string | null;
  swapped_by?: string | null;
  steal_need?: number | null;
  steal_result?: HalbaStealResult | null;
  predictions?: Record<string, boolean>;
  powers?: Record<string, string[]>;
  stats?: HalbaStats;
  result?: HalbaResult | null;
  /** alhalba_v5.sql: how answers are matched, the host's times, the check after typing, duels per player. */
  judge?: "auto" | "manual" | "both";
  answer_seconds?: number;
  bid_seconds?: number;
  checking?: boolean;
  duels?: Record<string, number>;
  /** alhalba_v6.sql: seconds per answer of the bid, the win rule, the automatic next round,
   *  a group round every N rounds, topic levels, and the group round's state. */
  pace?: number;
  win_rule?: "score" | "last";
  auto_next?: boolean;
  group_every?: number;
  levels?: number[] | null;
  result_at?: string | null;
  group_ends_at?: string | null;
  group_counts?: Record<string, number>;
  group_result?: HalbaGroupRow[] | null;
  topic_open?: boolean;
};
/** wait = typed, not checked yet; pending = waits for the judge. */
export type HalbaAnswer = { n: number; text: string; status: "wait" | "pending" | "ok" | "no"; by?: string | null; steal?: boolean; auto?: boolean; near?: boolean };
export type HalbaPlayer = { id: string; player_name: string; score: number; is_host: boolean; team_color?: string | null; avatar?: { c?: number; e?: string | null } | null };

export const HALBA_ERRORS: Record<string, string> = {
  NOT_ENOUGH_PLAYERS: "تحتاج الحلبة لاعبين اثنين على الأقل.",
  NOT_ENOUGH_GUESTS: "تحتاج لاعبين اثنين غيرك. شغّل «أشارك في اللعب» أو ادعُ لاعبًا آخر.",
  ROOM_NOT_PLAYING: "ابدأ الغرفة أولًا.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  GAME_OVER: "انتهت المباراة.",
  NO_TOPICS: "لا توجد مواضيع كافية في التصنيفات المختارة. اختر تصنيفات أكثر أو أضف مواضيع من لوحة الإدارة.",
  TIME_UP: "انتهى الوقت.",
  NOT_FIGHTING: "لست في الحلبة هذه الجولة.",
  BID_TOO_LOW: "سبقك أحد بمزايدة أعلى. زايد من جديد.",
  BID_TOO_HIGH: "أعلى مزايدة 15 إجابة.",
  PAUSED: "أوقف المضيف الانتقال التلقائي.",
  OWN_BID: "لا تقدر تتحدى مزايدتك أو مزايدة فريقك.",
  NO_BID: "ما فيه مزايدة تتحداها بعد.",
  NOT_YET: "المزايدة ما خلصت بعد.",
  NOT_IN_ROOM: "انضم للغرفة أولًا.",
  NOT_JUDGE: "الحَكَم هو من يحسب الإجابات.",
  NOT_BIDDER: "الطرف الذي يجيب هو فقط من يكتب الإجابات.",
  BAD_ANSWER: "اكتب إجابة قصيرة.",
  TOO_MANY: "وصلت لأقصى عدد من الإجابات.",
  DUPLICATE: "كُتبت من قبل.",
  NO_ANSWER: "هذه الإجابة غير موجودة.",
  USED: "استخدمت هذه الورقة من قبل في المباراة.",
  ALREADY_DOUBLE: "الجولة مضاعفة أصلًا.",
  TOO_LATE: "فات وقتها.",
  FIGHTING: "التوقع للمتفرجين فقط، وأنت في الحلبة هذه الجولة.",
  NOT_CHALLENGER: "السرقة للمتحدي فقط.",
  CHECKING: "اكتملت الإجابات، وجاري مطابقتها.",
  ENOUGH: "كتبت العدد المطلوب. انتظر المطابقة.",
  NOT_CHECKED: "تُطابَق الإجابات بعد اكتمالها أو انتهاء الوقت.",
};

export const TEAMS: Record<string, { name: string; short: string; color: string; fill: string }> = {
  red: { name: "الفريق الأحمر", short: "الأحمر", color: "#ff5a7a", fill: "#83184340" },
  blue: { name: "الفريق الأزرق", short: "الأزرق", color: "#6bb8ff", fill: "#1e3a8a40" },
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

/** A short tick for each of the last 5 seconds. */
export function useTicks(seconds: number | null, sound: boolean) {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (seconds === last.current) return;
    last.current = seconds;
    if (sound && seconds !== null && seconds > 0 && seconds <= 5) playCue("tick");
  }, [seconds, sound]);
}

/** The side a player fights for: their team in team mode, else themselves. */
export function sideOf(state: HalbaState, playerId: string | null | undefined): string | null {
  if (!playerId) return null;
  return state.mode === "teams" ? (state.teams?.[playerId] ?? null) : playerId;
}

export function nameOf(players: HalbaPlayer[], id: string | null | undefined) {
  return players.find((p) => p.id === id)?.player_name ?? "";
}

/** A side's display name: the team, or the player. */
export function sideName(state: HalbaState, players: HalbaPlayer[], side: string | null | undefined) {
  if (!side) return "";
  return state.mode === "teams" ? (TEAMS[side]?.name ?? "") : nameOf(players, side);
}

/** Who may bid this round: the duel pair, or every side still in the ring. */
export function canFight(state: HalbaState, playerId: string | null | undefined) {
  const side = sideOf(state, playerId);
  if (!side) return false;
  if (!(state.fighters ?? []).includes(side)) return false;
  if (Array.isArray(state.duel) && state.duel.length > 0) return state.duel.includes(side);
  return true;
}

export const isAnswering = (state: HalbaState) => state.phase === "prove" || state.phase === "steal";

/** The side answering now (rooms started before alhalba_v4.sql have no performer_side: the bidder). */
export function performerSide(state: HalbaState): string | null {
  return state.performer_side ?? state.bidder_side ?? sideOf(state, state.bidder) ?? null;
}

/** Is this player on the side that answers right now? */
export function onAnsweringSide(state: HalbaState, playerId: string | null | undefined) {
  const side = performerSide(state);
  return isAnswering(state) && !!playerId && !!side && sideOf(state, playerId) === side;
}

/** Same rule as halba_may_judge(): who counts answers right now. */
export function canJudge(state: HalbaState, players: HalbaPlayer[], meId: string | null | undefined, iAmHost: boolean) {
  if (!isAnswering(state)) return false;
  const mine = sideOf(state, meId);
  const perf = performerSide(state);
  if (meId && mine && mine === perf) return false;
  if (iAmHost) return true;
  if (meId && state.phase === "prove" && state.challenger === meId) return true;
  if (meId && state.phase === "steal" && state.bidder === meId) return true;
  const hostId = players.find((p) => p.is_host)?.id;
  return !!meId && !!mine && sideOf(state, hostId) === perf;
}

/** Same rule as halba_predict(): outside the ring while bidding; once answering, anyone but the two sides. */
export function canPredict(state: HalbaState, meId: string | null | undefined) {
  if (!meId) return false;
  const side = sideOf(state, meId);
  if (state.phase === "bid") return !canFight(state, meId);
  if (state.phase === "prove") return side !== performerSide(state) && (!state.challenger_side || side !== state.challenger_side);
  return false;
}

export function usedPower(state: HalbaState, playerId: string | null | undefined, power: string) {
  return !!playerId && (state.powers?.[playerId] ?? []).includes(power);
}

/** Who answers now, in words: a team, the thief, or the bidder. */
export function performerLabel(state: HalbaState, players: HalbaPlayer[]) {
  if (state.mode === "teams") return sideName(state, players, performerSide(state));
  return state.phase === "steal" ? (state.challenger_name ?? "") : (state.bidder_name ?? "");
}

/** How many answers the running phase needs. */
export const goalOf = (state: HalbaState) => (state.phase === "steal" ? (state.steal_need ?? 1) : (state.bid ?? 1));

/** Answers of the running phase only (a steal starts a fresh list). */
export const phaseAnswers = (state: HalbaState) => (state.answers ?? []).filter((a) => !!a.steal === (state.phase === "steal"));

/** Checked answers that wait for the judge. */
export const pendingOf = (state: HalbaState) => phaseAnswers(state).filter((a) => a.status === "pending").length;

/** Typed answers not checked yet. */
export const waitingOf = (state: HalbaState) => phaseAnswers(state).filter((a) => a.status === "wait").length;

/** Progress toward the goal: accepted (and spoken) answers, plus typed ones waiting for the check. */
export const progressOf = (state: HalbaState) => (state.count ?? 0) + waitingOf(state);

/** "الجولة 3 من 7", or an extra duel round that lets everyone fight. */
export function roundLabel(round?: number, maxRounds?: number) {
  if (!round) return "";
  if (maxRounds && round > maxRounds) return `الجولة ${round} (إضافية ليلعب الجميع)`;
  return `الجولة ${round}${maxRounds ? ` من ${maxRounds}` : ""}`;
}

export const JUDGE_NAMES: Record<string, string> = { auto: "مطابقة تلقائية", manual: "مطابقة يدوية", both: "تلقائية ويدوية" };

/** Everyone who takes part: guests, plus the host when they play; in team mode, the team members. */
export function participants(state: HalbaState, players: HalbaPlayer[]) {
  if (state.mode === "teams" && state.teams) return players.filter((p) => !!state.teams?.[p.id]);
  return players.filter((p) => !p.is_host || state.host_plays);
}

/** Winner text once the match is over: last one standing, else the top score. */
export function halbaWinner(state: HalbaState, players: HalbaPlayer[]) {
  const fighters = state.fighters ?? [];
  // «آخر من بقي» decides only with that rule (and in rooms from before the rule existed).
  const lastWins = state.win_rule !== "score";
  if (state.mode === "teams") {
    if (lastWins && fighters.length === 1) return { name: sideName(state, players, fighters[0]), why: "آخر فريق بقي في الحلبة" };
    const red = state.team_scores?.red ?? 0;
    const blue = state.team_scores?.blue ?? 0;
    if (red === blue) return { name: "تعادل الفريقين", why: `${red} نقطة لكل فريق` };
    return red > blue ? { name: TEAMS.red.name, why: `${red} مقابل ${blue}` } : { name: TEAMS.blue.name, why: `${blue} مقابل ${red}` };
  }
  if (lastWins && fighters.length === 1) return { name: nameOf(players, fighters[0]), why: "آخر من بقي في الحلبة" };
  const ranked = participants(state, players).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top) return null;
  const tied = ranked.filter((p) => p.score === top.score);
  return tied.length > 1
    ? { name: tied.map((p) => p.player_name).join("، "), why: `تعادل بـ ${top.score} نقطة` }
    : { name: top.player_name, why: `بـ ${top.score} نقطة` };
}

export type HalbaAward = { key: string; title: string; name: string; detail: string };

/** End-of-match awards, from what actually happened in this match. */
export function halbaAwards(state: HalbaState, players: HalbaPlayer[]): HalbaAward[] {
  const stats = state.stats ?? {};
  const out: HalbaAward[] = [];
  const top = (map: Record<string, number> | undefined) => {
    const rows = Object.entries(map ?? {}).filter(([id, n]) => n > 0 && nameOf(players, id));
    if (rows.length === 0) return null;
    const best = Math.max(...rows.map(([, n]) => n));
    return { names: rows.filter(([, n]) => n === best).map(([id]) => nameOf(players, id)).join("، "), n: best };
  };
  if (stats.best_bid?.name) out.push({ key: "bid", title: "أعلى مزايدة نجحت", name: stats.best_bid.name, detail: `${stats.best_bid.bid} ${stats.best_bid.bid <= 10 ? "إجابات" : "إجابة"}` });
  const correct = top(stats.correct);
  if (correct) out.push({ key: "correct", title: "أكثر من أجاب صح", name: correct.names, detail: `${correct.n} ${correct.n >= 3 && correct.n <= 10 ? "إجابات صحيحة" : "إجابة صحيحة"}` });
  if (stats.bold?.name) out.push({ key: "bold", title: "أجرأ تحدٍّ", name: stats.bold.name, detail: `أسقط مزايدة ${stats.bold.bid}` });
  if (stats.steal?.name) out.push({ key: "steal", title: "أفضل سرقة", name: stats.steal.name, detail: `سرق ${stats.steal.need} ${stats.steal.need === 1 ? "إجابة" : stats.steal.need === 2 ? "إجابتين" : stats.steal.need <= 10 ? "إجابات" : "إجابة"}` });
  if (stats.group?.side && stats.group.points > 0) {
    const name = state.mode === "teams" ? (TEAMS[stats.group.side]?.name ?? "") : nameOf(players, stats.group.side);
    if (name) out.push({ key: "group", title: "بطل الجولة الجماعية", name, detail: `${stats.group.points} نقطة بإجابات لم يكتبها غيره` });
  }
  const cheers = top(stats.cheers);
  if (cheers) out.push({ key: "cheer", title: "أفضل مشجّع", name: cheers.names, detail: `${cheers.n} نقطة تشجيع` });
  return out;
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
      supabase.from("room_players").select("*").eq("room_id", roomId).order("joined_at"),
    ]);
    if (gs) setState((gs.state_data ?? {}) as HalbaState);
    if (ps) setPlayers(ps as HalbaPlayer[]);
  }, [roomId]);

  // Realtime first; a 2-second poll only while realtime is not connected (8 seconds otherwise).
  useLivePoll(`halba-${roomId}`, [{ table: "room_game_state", filter: `room_id=eq.${roomId}` }, { table: "room_players", filter: `room_id=eq.${roomId}` }], load);

  return { state, players, reload: load };
}

function buzz(pattern: number[]) {
  vibrate(pattern);
}

/**
 * Sounds on the big screen and host device, vibration on the phones whose turn it is.
 * A cue per change of phase, and a short chime for every accepted answer.
 */
export function useHalbaCues(state: HalbaState, opts: { sound?: boolean; meId?: string | null }) {
  const last = useRef<string>("");
  const lastCount = useRef<number>(0);
  useEffect(() => {
    const key = `${state.round ?? 0}:${state.phase ?? ""}`;
    const count = state.count ?? 0;
    if (!last.current) {
      last.current = key;
      lastCount.current = count;
      return;
    }
    if (key === last.current) {
      if (count > lastCount.current && isAnswering(state) && opts.sound) playCue("correct");
      lastCount.current = count;
      return;
    }
    last.current = key;
    lastCount.current = count;
    const phase = state.phase ?? "";
    if (opts.sound) {
      if (phase === "bid") playCue("round");
      else if (phase === "prove") playCue("countdown");
      else if (phase === "steal_offer" || phase === "steal") playCue("steal");
      else if (phase === "result") playCue((state.steal_result?.success ?? state.result?.success) ? "correct" : "wrong");
      else if (phase === "over") playCue("victory");
    }
    if (opts.meId && isAnswering(state) && onAnsweringSide(state, opts.meId)) buzz([200, 80, 200]);
    if (opts.meId && phase === "steal_offer" && state.challenger === opts.meId) buzz([120, 60, 120, 60, 120]);
    // Only the phase, round and count decide a cue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.round, state.phase, state.count, opts.sound, opts.meId]);
}

/* ---------------- Shared pieces ---------------- */

export function TopicCard({ topic, round, maxRounds }: { topic: HalbaTopic; round?: number; maxRounds?: number }) {
  return (
    <div className="rounded-[22px] border border-[#ff5a7a55] bg-[linear-gradient(160deg,#831843cc,#1e1b4bcc)] p-5 text-center shadow-[0_0_40px_-12px_#ff5a7a]">
      <p className="text-[13px] font-semibold text-[#ffb3c4]">
        {[roundLabel(round, maxRounds), topic.category ?? ""].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-2 font-display text-[26px] leading-10 font-extrabold text-ivory">{topic.text}</p>
    </div>
  );
}

/** Countdown. The last 5 seconds pulse (and tick, where sound is on). */
export function Timer({ seconds, label, sound = false }: { seconds: number | null; label: string; sound?: boolean }) {
  useTicks(seconds, sound);
  if (seconds === null) return null;
  const hot = seconds > 0 && seconds <= 5;
  return (
    <p className="inline-flex items-center gap-2 text-[15px] text-mist">
      <Glyph name="clock" className="size-5 text-gold" />
      {label}
      <span dir="ltr" key={hot ? seconds : "calm"} className={cx("font-display text-[24px] font-extrabold tabular-nums", seconds <= 5 ? "text-wrong" : "text-gold", hot && "beat")}>
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

/** Badges for what changed this round: doubled points, a swapped topic. */
export function RoundBadges({ state, className }: { state: HalbaState; className?: string }) {
  const items: string[] = [];
  if (state.double) items.push(`×2 مضاعفة${state.double_by ? ` من ${state.double_by}` : ""}`);
  if (state.swapped_by && state.phase === "bid") items.push(`🔄 بدّل ${state.swapped_by} الموضوع`);
  if (items.length === 0) return null;
  return (
    <div className={cx("flex flex-wrap justify-center gap-2", className)}>
      {items.map((t) => (
        <span key={t} className="rounded-full border border-gold/50 bg-gold/10 px-3 py-1 text-[0.85em] font-bold text-gold">
          {t}
        </span>
      ))}
    </div>
  );
}

/** Spectator guesses so far: how many say it succeeds, how many say it fails. */
export function predictionTally(state: HalbaState) {
  const values = Object.values(state.predictions ?? {});
  return { yes: values.filter(Boolean).length, no: values.filter((v) => !v).length };
}

export function Ring({ state, players }: { state: HalbaState; players: HalbaPlayer[] }) {
  if (state.mode === "teams") return <TeamsRing state={state} players={players} />;
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
            <Egg name={p.player_name} index={i + 1} avatar={p.avatar} size="sm" className={cx(out && "opacity-40")} />
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
            <span dir="ltr" className="font-bold tabular-nums text-gold">{p.score}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Team mode: the two teams side by side, each with its score, lives and members. */
export function TeamsRing({ state, players, big = false }: { state: HalbaState; players: HalbaPlayer[]; big?: boolean }) {
  const max = state.max_lives ?? 1;
  return (
    <div className={cx("grid gap-2", big ? "grid-cols-1 gap-[1.5vh]" : "grid-cols-2")}>
      {(["red", "blue"] as const).map((team) => {
        const out = (state.knocked ?? []).includes(team);
        const members = players.filter((p) => state.teams?.[p.id] === team);
        const active = isAnswering(state) && performerSide(state) === team;
        return (
          <div
            key={team}
            className={cx("min-w-0 rounded-[16px] border p-3 text-start", out && "opacity-50")}
            style={{ borderColor: active ? TEAMS[team].color : `${TEAMS[team].color}66`, background: TEAMS[team].fill }}
          >
            <p className={cx("flex items-center justify-between gap-2 font-extrabold", big ? "text-[clamp(18px,1.7vw,32px)]" : "text-[15px]")} style={{ color: TEAMS[team].color }}>
              <span className="truncate">{TEAMS[team].short}</span>
              <span dir="ltr" className="tabular-nums text-gold">{state.team_scores?.[team] ?? 0}</span>
            </p>
            <div className="mt-1">{out ? <span className="text-[12px] text-faint">خارج الحلبة</span> : <Hearts left={state.lives?.[team] ?? max} max={max} className="text-[13px]" />}</div>
            <ul className={cx("mt-2 grid gap-1 text-ivory", big ? "text-[clamp(14px,1.3vw,26px)]" : "text-[14px]")}>
              {members.map((p) => (
                <li key={p.id} className="truncate">
                  {p.player_name}
                  {p.is_host ? <span className="text-[0.8em] text-mist"> (المضيف)</span> : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ResultCard({ state, players }: { state: HalbaState; players: HalbaPlayer[] }) {
  const result = state.result;
  if (!result) return null;
  const maxLives = state.max_lives ?? 1;
  const who = state.mode === "teams" ? sideName(state, players, result.side) : result.bidder_name;
  const lost = !result.success;
  const guessed = Object.entries(state.predictions ?? {})
    .filter(([, v]) => v === result.success)
    .map(([id]) => nameOf(players, id))
    .filter(Boolean);
  return (
    <div className={cx("rounded-[20px] border p-4 text-center", result.success ? "border-correct/50 bg-correct-fill/15" : "border-wrong/50 bg-wrong-fill/15")}>
      <p className="font-display text-[22px] font-extrabold text-ivory">
        {result.success ? `${who} نجح!` : result.knocked_out ? `${who} فشل وخرج من الحلبة` : `${who} فشل وخسر محاولة`}
      </p>
      <p className="mt-1 text-[15px] text-mist">
        ذكر {result.count} من {result.bid} ·{" "}
        <span dir="ltr" className="inline-block">
          {result.success ? "+" : "−"}
          {result.points}
        </span>{" "}
        نقطة{result.doubled ? " (مضاعفة)" : ""}
        {result.challenger_name ? ` · ${result.success ? "خسرها" : "كسبها"} ${state.mode === "teams" ? sideName(state, players, state.challenger_side) : result.challenger_name}` : ""}
      </p>
      {lost && !result.knocked_out && maxLives > 1 ? (
        <p className="mt-1 inline-flex items-center gap-2 text-[14px] text-ivory">
          بقي <Hearts left={result.lives_left ?? 0} max={maxLives} />
        </p>
      ) : null}
      {guessed.length > 0 ? <p className="mt-1 text-[14px] text-gold">أصاب التوقع: {guessed.join("، ")} (+50)</p> : null}
      {state.steal_result ? (
        <p className={cx("mt-3 rounded-[14px] border px-3 py-2 text-[15px] font-bold", state.steal_result.success ? "border-correct/50 text-correct" : "border-wrong/40 text-ivory")}>
          {state.steal_result.success
            ? <>🦹 {state.steal_result.name} سرق الجولة! ذكر {state.steal_result.count} من {state.steal_result.need} · <span dir="ltr" className="inline-block">+{state.steal_result.points}</span></>
            : `🦹 فشلت سرقة ${state.steal_result.name}: ذكر ${state.steal_result.count} من ${state.steal_result.need}`}
        </p>
      ) : null}
    </div>
  );
}

/** End-of-match awards. */
export function MatchSummary({ state, players, big = false }: { state: HalbaState; players: HalbaPlayer[]; big?: boolean }) {
  const awards = halbaAwards(state, players);
  if (awards.length === 0) return null;
  const icons: Record<string, string> = { bid: "🏆", correct: "🧠", bold: "🥊", cheer: "📣", steal: "🦹", group: "👥" };
  return (
    <ul className={cx("grid gap-2", big ? "grid-cols-2 gap-[1vw]" : "sm:grid-cols-2")}>
      {awards.map((a) => (
        <li key={a.key} className={cx("rounded-[16px] border border-gold/30 bg-deep-2/60 text-start", big ? "px-[1.2vw] py-[1.2vh]" : "px-3 py-2")}>
          <p className={cx("font-semibold text-mist", big ? "text-[clamp(14px,1.3vw,26px)]" : "text-[13px]")}>
            {icons[a.key]} {a.title}
          </p>
          <p className={cx("truncate font-display font-extrabold text-ivory", big ? "text-[clamp(20px,2vw,40px)]" : "text-[18px]")}>{a.name}</p>
          <p className={cx("text-gold", big ? "text-[clamp(14px,1.3vw,26px)]" : "text-[13px]")}>{a.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Typed answers ---------------- */

const STATUS_STYLE: Record<HalbaAnswer["status"], string> = {
  wait: "border-line-strong/40 bg-deep-2/50 text-ivory",
  pending: "border-line-strong/60 bg-deep-2/70 text-ivory",
  ok: "border-correct/60 bg-correct-fill/20 text-ivory",
  no: "border-wrong/50 bg-wrong-fill/15 text-faint line-through",
};

/** The answers so far, with their judging. */
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

/** Answers are typed one by one; the box stays focused for the next one. */
function AnswerInput({ roomId, state, reload }: { roomId: string; state: HalbaState; reload: () => Promise<void> }) {
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

  const goal = goalOf(state);
  const done = progressOf(state);
  if (state.checking || done >= goal) {
    return (
      <p className="rounded-[14px] border border-gold/40 bg-gold/10 p-3 text-[15px] font-semibold text-ivory">
        {state.checking ? (pendingOf(state) > 0 ? "تمت المطابقة، والحَكَم يراجع الباقي…" : "تمت المطابقة.") : "اكتملت إجاباتك، وجاري المطابقة…"}
      </p>
    );
  }

  return (
    <form onSubmit={send} className="grid gap-2">
      <p className="text-[14px] text-mist">
        كتبت <b className="tabular-nums text-gold">{done}</b> من <b className="tabular-nums">{goal}</b>. عند الإجابة رقم {goal} تتوقف الكتابة وتُطابَق كلها.
      </p>
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

/* ---------------- Power cards ---------------- */

function useAct(roomId: string, reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const act = useCallback(
    async (fn: string, args: Record<string, unknown> = {}) => {
      setBusy(true);
      setMessage(null);
      const { error } = await call(fn, { p_room_id: roomId, ...args });
      if (error) setMessage(error);
      await reload();
      setBusy(false);
    },
    [roomId, reload],
  );
  return { busy, message, setMessage, act };
}

/**
 * The three cards a player holds for the whole match. Each is played once:
 * مضاعفة in the first 10 seconds of answering, تبديل الموضوع during bidding,
 * سرقة when the bid you challenged fails.
 */
function PowerCards({ roomId, meId, state, reload }: { roomId: string; meId: string | null; state: HalbaState; reload: () => Promise<void> }) {
  const { busy, message, setMessage, act } = useAct(roomId, reload);
  const proveLeft = useSecondsLeft(state.phase === "prove" ? state.prove_ends_at : null);
  useEffect(() => setMessage(null), [state.phase, state.round, setMessage]);
  if (!meId || !sideOf(state, meId) || state.phase === "over" || (state.knocked ?? []).includes(sideOf(state, meId) ?? "")) return null;

  const elapsed = proveLeft === null ? null : (state.topic?.seconds ?? 30) - proveLeft;
  const canDouble =
    state.phase === "prove" && onAnsweringSide(state, meId) && !state.double && (state.count ?? 0) === 0 && elapsed !== null && elapsed < 10 && !usedPower(state, meId, "double");
  const canSwap = state.phase === "bid" && canFight(state, meId) && !usedPower(state, meId, "swap");
  const cards = [
    { key: "double", icon: "×2", label: "مضاعفة", hint: "نقاط الجولة ×2، ربحًا أو خسارة", ready: canDouble, fn: "halba_double" },
    { key: "swap", icon: "🔄", label: "تبديل الموضوع", hint: "موضوع جديد والمزايدة من جديد", ready: canSwap, fn: "halba_swap" },
    { key: "steal", icon: "🦹", label: "سرقة", hint: "إذا فشل من تحديته، تكمل الباقي", ready: false, fn: "" },
  ];
  return (
    <div className="grid gap-1.5">
      <p className="text-start text-[12px] font-semibold text-mist">أوراقك (كل ورقة مرة في المباراة)</p>
      <div className="grid grid-cols-3 gap-2">
        {cards.map((c) => {
          const used = usedPower(state, meId, c.key);
          return (
            <button
              key={c.key}
              type="button"
              title={c.hint}
              disabled={!c.ready || busy}
              onClick={() => c.fn && act(c.fn)}
              className={cx(
                "grid min-h-16 place-items-center gap-0.5 rounded-[14px] border px-1 py-1.5 text-center transition active:scale-[0.97]",
                used
                  ? "border-line/40 bg-deep/40 text-faint line-through"
                  : c.ready
                    ? "border-gold bg-gold/15 text-ivory shadow-[0_0_18px_-6px_#ffb547]"
                    : "border-line-strong/50 bg-deep-2/50 text-mist",
              )}
            >
              <span className="font-display text-[20px] leading-none font-extrabold">{c.icon}</span>
              <span className="text-[12px] leading-4 font-bold">{c.label}</span>
            </button>
          );
        })}
      </div>
      {message ? <p className="text-[13px] font-semibold text-wrong">{message}</p> : null}
    </div>
  );
}

/** After a failed bid: the challenger may steal the rest. Others see the offer and its clock. */
function StealOffer({ roomId, meId, state, iAmHost, reload }: { roomId: string; meId: string | null; state: HalbaState; iAmHost: boolean; reload: () => Promise<void> }) {
  const { busy, message, act } = useAct(roomId, reload);
  const left = useSecondsLeft(state.offer_ends_at);
  const skipping = useRef(false);
  const mine = !!meId && state.challenger === meId;
  const need = (state.bid ?? 0) - (state.count ?? 0);

  // When the offer runs out, close it (the host's screen, or the challenger's phone).
  useEffect(() => {
    if (left === 0 && !skipping.current && (iAmHost || mine)) {
      skipping.current = true;
      void act("halba_steal", { p_take: false });
    }
  }, [left, iAmHost, mine, act]);

  return (
    <div className="grid gap-3 rounded-[20px] border border-gold/50 bg-gold/10 p-4">
      <p className="font-display text-[22px] font-extrabold text-ivory">
        🦹 {mine ? "تقدر تسرق الجولة!" : `${state.challenger_name} يقدر يسرق الجولة`}
      </p>
      <p className="text-[15px] text-mist">
        يكمل الباقي ({need}) خلال وقت أقصر، وإذا نجح يأخذ {(state.bid ?? 0) * 100} نقطة إضافية.
      </p>
      <Timer seconds={left} label="القرار خلال" />
      {mine ? (
        <div className="grid grid-cols-2 gap-2">
          <Button tone="primary" className="min-h-14 text-[17px]" onClick={() => act("halba_steal", { p_take: true })} disabled={busy}>
            اسرق!
          </Button>
          <Button tone="quiet" className="min-h-14" onClick={() => act("halba_steal", { p_take: false })} disabled={busy}>
            لا، شكرًا
          </Button>
        </div>
      ) : iAmHost ? (
        <Button tone="quiet" className="mx-auto" onClick={() => act("halba_steal", { p_take: false })} disabled={busy}>
          تخطَّ السرقة
        </Button>
      ) : null}
      {message ? <p className="text-[14px] font-semibold text-wrong">{message}</p> : null}
    </div>
  );
}

/** Spectators guess whether the answering side makes it: +50 for a right guess. */
function PredictBox({ roomId, meId, state, reload }: { roomId: string; meId: string | null; state: HalbaState; reload: () => Promise<void> }) {
  const { busy, message, act } = useAct(roomId, reload);
  const proveLeft = useSecondsLeft(state.phase === "prove" ? state.prove_ends_at : null);
  if (!meId) return null;
  const open =
    (state.phase === "bid" && !!state.bidder) ||
    (state.phase === "prove" && proveLeft !== null && (state.topic?.seconds ?? 30) - proveLeft < 10);
  if (!open || !canPredict(state, meId)) return null;
  const knockedOut = (state.knocked ?? []).includes(sideOf(state, meId) ?? "");
  const mine = state.predictions?.[meId];
  const who = state.phase === "bid" ? (state.mode === "teams" ? sideName(state, [], state.bidder_side) : state.bidder_name) : null;
  return (
    <div className="grid gap-2 rounded-[18px] border border-violet-text/40 bg-violet-fill/10 p-3">
      {knockedOut ? <p className="text-[13px] font-semibold text-violet-text">📣 أنت مشجّع الآن: كل توقع صحيح يعطيك 50 نقطة.</p> : null}
      <p className="text-[15px] font-bold text-ivory">توقّع: {who ? `هل ينجح ${who}؟` : "هل ينجح في ذكر الإجابات؟"}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button tone={mine === true ? "correct" : "quiet"} className="min-h-12" onClick={() => act("halba_predict", { p_success: true })} disabled={busy}>
          ينجح ✓
        </Button>
        <Button tone={mine === false ? "danger" : "quiet"} className="min-h-12" onClick={() => act("halba_predict", { p_success: false })} disabled={busy}>
          يفشل ✗
        </Button>
      </div>
      <p className="text-[12px] text-mist">التوقع الصحيح = 50 نقطة تشجيع. تقدر تغيّر رأيك حتى أول 10 ثوانٍ من الإجابة.</p>
      {message ? <p className="text-[13px] font-semibold text-wrong">{message}</p> : null}
    </div>
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
  const { busy, message, setMessage, act } = useAct(roomId, reload);
  const phase = state.phase ?? "";
  const bidLeft = useSecondsLeft(phase === "bid" ? state.bid_ends_at : null);
  const fighting = canFight(state, meId);
  const mySide = sideOf(state, meId);
  const knocked = !!mySide && (state.knocked ?? []).includes(mySide);
  const teams = state.mode === "teams";
  const ourBid = !!mySide && state.bidder_side === mySide;
  const iAmBidder = !!meId && state.bidder === meId;
  const current = state.bid ?? 0;

  useEffect(() => setMessage(null), [state.phase, state.round, setMessage]);

  if (knocked && phase !== "over") {
    return (
      <p className="rounded-[14px] border border-wrong/40 bg-wrong-fill/10 p-3 text-[15px] text-ivory">
        {teams ? "خرج فريقك من الحلبة." : "خرجت من الحلبة."} صرت مشجّعًا: توقّع نتيجة كل جولة واكسب 50 نقطة لكل توقع صحيح، وشارك في الجولات الجماعية.
      </p>
    );
  }

  if (phase === "bid") {
    return (
      <div className="grid gap-3">
        {teams && mySide ? (
          <p className="text-[14px] font-bold" style={{ color: TEAMS[mySide]?.color }}>
            أنت في {TEAMS[mySide]?.name}
          </p>
        ) : null}
        <p className="text-[17px] text-ivory">
          {state.bidder_name ? (
            <>
              أعلى مزايدة <b className="font-display text-[30px] text-gold">{current}</b> عند{" "}
              <b>{iAmBidder ? "أنت" : teams ? `${state.bidder_name} (${sideName(state, players, state.bidder_side)})` : state.bidder_name}</b>
            </>
          ) : (
            <>كم إجابة تقدر{teams ? "ون" : ""} تذكر{teams ? "ون" : ""}؟ المزايدة تبدأ من {state.topic?.min ?? 1}</>
          )}
        </p>
        {fighting ? (
          <>
            <BidStepper
              current={current}
              disabled={busy || bidLeft === 0}
              onBid={(n) => act("halba_bid", { p_amount: n })}
              pace={state.pace ?? 6}
              fixed={state.answer_seconds ?? 0}
            />
            {state.bidder && !ourBid ? (
              <button
                type="button"
                onClick={() => act("halba_challenge")}
                disabled={busy}
                className="min-h-16 rounded-full bg-[linear-gradient(90deg,#ff5a7a,#c21d4f)] px-6 font-display text-[24px] font-extrabold text-ivory shadow-[0_10px_30px_-8px_#ff5a7a] transition active:scale-[0.97] disabled:opacity-50"
              >
                تحدي! 🥊
              </button>
            ) : null}
            {ourBid ? (
              <p className="text-[14px] text-mist">{teams ? "مزايدة فريقك الأعلى." : "مزايدتك الأعلى."} انتظر: أحد يزايد عليك أو يتحداك.</p>
            ) : null}
          </>
        ) : (
          <p className="text-[14px] text-mist">هذه الجولة نزال بين لاعبين آخرين. تابع!</p>
        )}
        {message ? <p className="text-[14px] font-semibold text-wrong">{message}</p> : null}
      </div>
    );
  }

  if (isAnswering(state) && onAnsweringSide(state, meId)) {
    const goal = goalOf(state);
    const judge = phase === "steal" ? state.bidder_name : state.challenger ? state.challenger_name : null;
    return (
      <div className="grid gap-3">
        <p className="rounded-[18px] border border-gold/50 bg-gold/10 p-4 font-display text-[22px] font-extrabold text-ivory">
          {phase === "steal" ? "اسرقها! " : teams ? "دور فريقك! " : "دورك! "}
          اكتب{teams ? "وا" : ""} {goal} إجابات
          {state.judge === "manual" ? <>، أو قول{teams ? "وها" : "ها"} بصوت عالٍ</> : null}
          <span className="block text-[15px] font-semibold text-mist">
            {state.judge === "auto"
              ? "يطابقها النظام تلقائيًا بعد اكتمالها"
              : judge
                ? `${judge} يحكم على ما لا يطابقه النظام`
                : "الحَكَم يحكم على ما لا يطابقه النظام"}
          </span>
        </p>
        <AnswerInput roomId={roomId} state={state} reload={reload} />
      </div>
    );
  }
  return null;
}

/** Choose any bid up to 15: the stepper starts one above the current bid. */
export const MAX_BID = 15;
function BidStepper({ current, disabled, onBid, pace, fixed }: { current: number; disabled: boolean; onBid: (n: number) => void; pace: number; fixed: number }) {
  const min = current + 1;
  const [value, setValue] = useState(min);
  // A higher bid from someone else moves the stepper up with it.
  useEffect(() => setValue((v) => Math.min(MAX_BID, Math.max(v, min))), [min]);
  if (min > MAX_BID) return <p className="text-[14px] text-mist">وصلت المزايدة للحد الأعلى ({MAX_BID}). تقدر تتحدى فقط.</p>;
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-center gap-3">
        <Button tone="quiet" className="size-14 rounded-full p-0 text-[26px]" onClick={() => setValue((v) => Math.max(min, v - 1))} disabled={disabled || value <= min} aria-label="أقل">
          −
        </Button>
        <p className="min-w-20 font-display text-[44px] leading-none font-extrabold tabular-nums text-gold">{value}</p>
        <Button tone="quiet" className="size-14 rounded-full p-0 text-[26px]" onClick={() => setValue((v) => Math.min(MAX_BID, v + 1))} disabled={disabled || value >= MAX_BID} aria-label="أكثر">
          +
        </Button>
      </div>
      <Button tone="primary" className="min-h-14 text-[19px] font-extrabold" onClick={() => onBid(value)} disabled={disabled}>
        أزايد بـ {value} {value <= 10 && value >= 3 ? "إجابات" : value === 2 ? "إجابتين" : value === 1 ? "إجابة" : "إجابة"}
      </Button>
      <p className="text-[12px] text-mist">
        {fixed > 0 ? `وقت الإجابة ${fixed} ثانية.` : `وقت الإجابة لـ ${value} ${value >= 3 && value <= 10 ? "إجابات" : "إجابة"}: ${Math.min(180, 10 + pace * value)} ثانية.`} أعلى مزايدة {MAX_BID}.
      </p>
    </div>
  );
}

/** The answer counter, for whoever judges. Ends by itself when the clock runs out. */
function JudgeControls({ roomId, state, reload, compact = false }: { roomId: string; state: HalbaState; reload: () => Promise<void>; compact?: boolean }) {
  const { busy, message, act } = useAct(roomId, reload);
  const left = useSecondsLeft(state.prove_ends_at);
  const finishing = useRef(false);
  const answers = phaseAnswers(state);
  const pending = answers.filter((a) => a.status === "pending").length;
  const checking = !!state.checking;
  // Spoken answers (+1) only when the host chose manual judging (and in rooms started before v5).
  const spoken = !state.judge || state.judge === "manual";

  // After the clock: a moment for the last answer to land, then close by itself, once nothing waits for a ✓/✗.
  useEffect(() => {
    if (left === 0 && pending === 0 && !finishing.current) {
      finishing.current = true;
      const t = window.setTimeout(() => void act("halba_finish"), 2500);
      return () => window.clearTimeout(t);
    }
  }, [left, pending, act]);

  return (
    <div className="grid gap-3 rounded-[22px] border border-gold/40 bg-gold/5 p-4">
      <p className="text-[14px] font-semibold text-gold">
        {checking
          ? pending > 0
            ? `أنت الحَكَم: احكم على ${pending === 1 ? "الإجابة التي لم يطابقها" : `الإجابات (${pending}) التي لم يطابقها`} النظام، ✓ صحيحة أو ✗ خاطئة.`
            : "تمت المطابقة."
          : !state.judge
            ? "أنت الحَكَم: ✓ للإجابة الصحيحة، ✗ للخاطئة."
            : `أنت الحَكَم. الإجابات تُطابَق كلها عند اكتمال ${goalOf(state)} أو انتهاء الوقت${state.judge ? ` (${JUDGE_NAMES[state.judge]})` : ""}.`}
      </p>
      {answers.length > 0 ? (
        <ul className="grid gap-2">
          {answers.map((a) => (
            <li key={a.n} className={cx("flex items-center gap-2 rounded-[14px] border px-3 py-1.5", STATUS_STYLE[a.status])}>
              <span className="min-w-0 flex-1 truncate text-start text-[17px] font-semibold">
                {a.text}
                {a.auto ? <span className="ms-2 text-[12px] font-normal text-correct">تلقائي</span> : null}
                {a.near && !a.auto ? <span className="ms-2 text-[12px] font-normal text-gold">قريبة من القائمة</span> : null}
              </span>
              {a.status === "wait" ? <span className="shrink-0 text-[12px] text-mist">بانتظار المطابقة</span> : null}
              {a.status === "wait" ? null : (
              <>
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
              </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-mist">الإجابات المكتوبة تظهر هنا.{spoken ? " إذا قالها بصوت عالٍ، استخدم +1." : ""}</p>
      )}
      {pending > 0 && left === 0 ? <p className="text-[13px] font-semibold text-gold">احكم على الإجابات الباقية ({pending}) لتنتهي الجولة.</p> : null}
      <div className="flex items-center justify-center gap-4">
        {spoken ? (
          <Button tone="quiet" className="size-14 rounded-full p-0 text-[24px]" onClick={() => act("halba_count", { p_delta: -1 })} disabled={busy || left === 0} aria-label="إنقاص إجابة">
            −
          </Button>
        ) : null}
        <p className={cx("min-w-28 font-display leading-none font-extrabold tabular-nums text-ivory", compact ? "text-[52px]" : "text-[64px]")}>
          {checking ? (state.count ?? 0) : progressOf(state)}
          <span className="text-[0.45em] text-mist">/{goalOf(state)}</span>
          <span className="mt-1 block font-sans text-[13px] font-normal text-mist">{checking || !state.judge ? "صحيحة" : "مكتوبة"}</span>
        </p>
        {spoken ? (
          <Button tone="primary" className="size-16 rounded-full p-0 text-[26px]" onClick={() => act("halba_count", { p_delta: 1 })} disabled={busy || left === 0} aria-label="إجابة صحيحة منطوقة">
            <span dir="ltr">+1</span>
          </Button>
        ) : null}
      </div>
      <Button tone="quiet" className="mx-auto" onClick={() => act("halba_finish")} disabled={busy}>
        {checking || answers.length === 0 ? "أنهِ الجولة الآن" : "طابِق الآن وأنهِ الكتابة"}
      </Button>
      {message ? <p className="text-[14px] font-semibold text-wrong">{message}</p> : null}
    </div>
  );
}

/** Shown to everyone else while answers come in. */
function ProofView({ state }: { state: HalbaState }) {
  const judge = state.phase === "steal" ? state.bidder_name : state.challenger_name;
  return (
    <div className="grid gap-3">
      <AnswersList answers={phaseAnswers(state)} />
      <p className="font-display text-[56px] leading-none font-extrabold tabular-nums text-ivory">
        {state.checking ? (state.count ?? 0) : progressOf(state)}
        <span className="text-[24px] text-mist">/{goalOf(state)}</span>
        <span className="mt-2 block font-sans text-[14px] font-normal text-mist">
          {state.checking
            ? pendingOf(state) > 0
              ? `صحيحة · ${judge ? `${judge} يراجع الباقي` : "الحَكَم يراجع الباقي"}`
              : "صحيحة"
            : state.judge
              ? "مكتوبة · تُطابَق عند الاكتمال"
              : judge
                ? `يحكم ${judge}`
                : "يحكم الحَكَم"}
        </span>
      </p>
    </div>
  );
}

/** One line on who answers now. */
function ProveHeadline({ state, players }: { state: HalbaState; players: HalbaPlayer[] }) {
  return (
    <p className="text-[17px] text-ivory">
      {state.phase === "steal" ? "🦹 " : ""}
      <b>{performerLabel(state, players)}</b> {state.phase === "steal" ? "يسرق ويذكر" : "يذكر"} <b className="text-gold">{goalOf(state)}</b> إجابات
      {state.phase === "prove" && state.challenger_name ? <span className="text-mist"> · تحدّاه {state.challenger_name}</span> : null}
    </p>
  );
}

/* ---------------- Group round and the automatic next round (alhalba_v6.sql) ---------------- */

/** A side's name in a group round's result: the team, or the player. */
export function groupSideName(state: HalbaState, players: HalbaPlayer[], side: string) {
  return state.mode === "teams" ? (TEAMS[side]?.name ?? "") : nameOf(players, side);
}

/** Everyone types at once. My answers stay on my phone until the round ends. */
export function GroupPlay({ roomId, state }: { roomId: string; state: HalbaState }) {
  const [mine, setMine] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const left = useSecondsLeft(state.group_ends_at);
  const loadMine = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.rpc("halba_group_mine", { p_room_id: roomId });
    if (Array.isArray(data)) setMine((data as Array<{ text: string }>).map((r) => r.text));
  }, [roomId]);
  useEffect(() => {
    void loadMine();
  }, [loadMine, state.round]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setMessage(null);
    const { error } = await call("halba_group_answer", { p_room_id: roomId, p_text: value });
    if (error) setMessage(error);
    else setText("");
    await loadMine();
    setBusy(false);
    box.current?.focus();
  }

  return (
    <div className="grid gap-3">
      <p className="rounded-[18px] border border-gold/50 bg-gold/10 p-3 text-[15px] font-semibold text-ivory">
        👥 جولة جماعية: اكتبوا كل ما تعرفون. كل إجابة صحيحة <b>ما كتبها غيرك</b> = 100 نقطة.
        {state.mode === "teams" ? " إجابات فريقك قائمة واحدة." : ""}
      </p>
      {left !== 0 ? (
        <form onSubmit={send} className="flex gap-2">
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
        </form>
      ) : (
        <p className="text-[14px] text-mist">انتهى الوقت. ننتظر النتيجة…</p>
      )}
      {message ? <p className="text-[14px] font-semibold text-wrong">{message}</p> : null}
      {mine.length > 0 ? (
        <div className="grid gap-1.5">
          <p className="text-[13px] text-mist">إجاباتك ({mine.length}):</p>
          <ul className="flex flex-wrap justify-center gap-2">
            {mine.map((t) => (
              <li key={t} className="rounded-full border border-line-strong/60 bg-deep-2/70 px-3 py-1 text-[15px] font-semibold text-ivory">
                {t}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** How many answers each player has written so far (not what). */
export function GroupCounts({ state, players, big = false }: { state: HalbaState; players: HalbaPlayer[]; big?: boolean }) {
  const counts = Object.entries(state.group_counts ?? {}).filter(([, n]) => n > 0);
  if (counts.length === 0) return <p className={cx("text-mist", big ? "text-[clamp(16px,1.5vw,30px)]" : "text-[14px]")}>لم يكتب أحد بعد…</p>;
  return (
    <ul className={cx("flex flex-wrap justify-center gap-2", big ? "text-[clamp(16px,1.6vw,32px)]" : "text-[14px]")}>
      {counts
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => (
          <li key={id} className="rounded-full border border-line bg-deep-2/60 px-3 py-1 font-semibold text-ivory">
            {nameOf(players, id)} <span className="tabular-nums text-gold">{n}</span>
          </li>
        ))}
    </ul>
  );
}

/** The group round's result: each side's answers, unique ones in gold, wrong ones struck through. */
export function GroupResult({ state, players, big = false }: { state: HalbaState; players: HalbaPlayer[]; big?: boolean }) {
  const rows = state.group_result ?? [];
  if (rows.length === 0) return <p className="text-[15px] text-mist">لم يكتب أحد إجابات في الجولة الجماعية.</p>;
  return (
    <ul className={cx("grid gap-2 text-start", big ? "text-[clamp(15px,1.4vw,28px)]" : "text-[14px]")}>
      {rows.map((r) => (
        <li key={r.side} className="rounded-[16px] border border-line bg-deep-2/50 px-3 py-2">
          <p className="flex items-center justify-between gap-2 font-bold text-ivory">
            <span style={state.mode === "teams" ? { color: TEAMS[r.side]?.color } : undefined}>{groupSideName(state, players, r.side)}</span>
            <span className="tabular-nums text-gold" dir="ltr">
              +{r.points}
            </span>
          </p>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {r.answers.map((a) => (
              <span
                key={a.text}
                className={cx(
                  "rounded-full border px-2 py-0.5",
                  a.unique ? "border-gold bg-gold/15 text-ivory" : a.valid ? "border-line text-mist" : "border-wrong/40 text-faint line-through",
                )}
              >
                {a.text}
              </span>
            ))}
          </p>
        </li>
      ))}
      <li className="text-[12px] text-mist">بالذهبي: صحيحة وما كتبها غيره (100 نقطة). العادية: صحيحة لكن تكررت. المشطوبة: ليست في القائمة.</li>
    </ul>
  );
}

/** Ends the group round when its clock runs out: the host's device at once, players' a moment later. */
export function useGroupFinish(roomId: string, state: HalbaState, isHost: boolean, reload: () => Promise<void>) {
  const left = useSecondsLeft(state.phase === "group" ? state.group_ends_at : null);
  const done = useRef("");
  useEffect(() => {
    if (state.phase !== "group" || left !== 0) return;
    const key = String(state.round ?? 0);
    if (done.current === key) return;
    done.current = key;
    const t = window.setTimeout(() => void call("halba_group_finish", { p_room_id: roomId }).then(reload), isHost ? 600 : 3000);
    return () => window.clearTimeout(t);
  }, [state.phase, state.round, left, isHost, roomId, reload]);
  return left;
}

/** Seconds until the next round starts by itself (null when it won't). Starts it at zero. */
export function useAutoNext(roomId: string, state: HalbaState, isHost: boolean, reload: () => Promise<void>) {
  const target = state.phase === "result" && state.auto_next && state.result_at ? new Date((parseTime(state.result_at) ?? 0) + 8000).toISOString() : null;
  const left = useSecondsLeft(target);
  const done = useRef("");
  useEffect(() => {
    if (left !== 0 || !target) return;
    if (done.current === target) return;
    done.current = target;
    // The host's device first; the players' phones a little later, in case it is asleep.
    const t = window.setTimeout(() => void call("halba_auto_next", { p_room_id: roomId }).then(reload), isHost ? 200 : 2500 + Math.random() * 1500);
    return () => window.clearTimeout(t);
  }, [left, target, isHost, roomId, reload]);
  return target ? left : null;
}

/**
 * The big screen's answers: after the check, they appear one by one, each with its sound.
 * Before the check (typing), they show as they come in.
 */
export function RevealAnswers({ state }: { state: HalbaState }) {
  const answers = phaseAnswers(state);
  const checked = answers.filter((a) => a.status !== "wait");
  const key = `${state.round}-${state.phase}`;
  const [shown, setShown] = useState(0);
  const seen = useRef<{ key: string; n: number }>({ key: "", n: 0 });
  useEffect(() => {
    if (seen.current.key !== key) seen.current = { key, n: 0 };
    if (checked.length <= seen.current.n) {
      setShown(checked.length);
      return;
    }
    let i = seen.current.n;
    setShown(i);
    const t = window.setInterval(() => {
      const a = checked[i];
      if (a) playCue(a.status === "ok" ? "correct" : a.status === "no" ? "wrong" : "tick");
      i += 1;
      setShown(i);
      seen.current.n = i;
      if (i >= checked.length) window.clearInterval(t);
    }, 700);
    return () => window.clearInterval(t);
    // Re-run when answers get checked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, checked.length, checked.map((a) => a.status).join()]);
  const visible = answers.filter((a) => a.status === "wait" || checked.indexOf(a) < shown);
  return <AnswersList answers={visible} big />;
}

/* ---------------- Host panel ---------------- */

/** Host device: settings, rounds, judging, and the host's own bids when they play. */
export function HalbaHostPanel({ roomId, roomCode, roomStatus }: { roomId: string; roomCode: string; roomStatus: string }) {
  const { state, players, reload } = useHalbaLive(roomId);
  const [mode, setMode] = useState<"ffa" | "duel" | "teams">("ffa");
  const [rounds, setRounds] = useState(7);
  const [lives, setLives] = useState(2);
  const [hostPlays, setHostPlays] = useState(true);
  const [judge, setJudge] = useState<"auto" | "manual" | "both">("both");
  const [answerSeconds] = useState(0);
  // v6: seconds per answer of the bid, the win rule, the automatic next round, the group round, topic levels.
  const [pace, setPace] = useState(6);
  const [winRule, setWinRule] = useState<"score" | "last">("score");
  const [autoNext, setAutoNext] = useState(true);
  const [groupEvery, setGroupEvery] = useState(3);
  const [levels, setLevels] = useState<number[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [bidSeconds, setBidSeconds] = useState(20);
  const [categories, setCategories] = useState<Array<{ category: string; topics: number }>>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(roomStatus === "finished");
  const closing = useRef(false);
  const hostId = players.find((p) => p.is_host)?.id ?? null;
  useHalbaCues(state, { sound: true, meId: hostId });

  // The admin's defaults (admin panel → الموقع) preselect the setup; the host can still change them.
  const site = useSiteSettings();
  const appliedDefaults = useRef(false);
  useEffect(() => {
    const d = site?.game_defaults?.alhalba;
    if (!d || appliedDefaults.current) return;
    appliedDefaults.current = true;
    if (d.mode === "ffa" || d.mode === "duel" || d.mode === "teams") setMode(d.mode);
    if (typeof d.rounds === "number" && [3, 5, 7, 10].includes(d.rounds)) setRounds(d.rounds);
    if (typeof d.lives === "number" && d.lives >= 1 && d.lives <= 3) setLives(d.lives);
    if (typeof d.host_plays === "boolean") setHostPlays(d.host_plays);
    if (typeof d.bid_seconds === "number" && [10, 20, 30, 45].includes(d.bid_seconds)) setBidSeconds(d.bid_seconds);
    if (d.judge === "auto" || d.judge === "manual" || d.judge === "both") setJudge(d.judge);
    if (typeof d.pace === "number" && [4, 6, 8].includes(d.pace)) setPace(d.pace);
    if (d.win_rule === "score" || d.win_rule === "last") setWinRule(d.win_rule);
    if (typeof d.auto_next === "boolean") setAutoNext(d.auto_next);
    if (typeof d.group_every === "number" && [0, 3, 4, 5].includes(d.group_every)) setGroupEvery(d.group_every);
    if (Array.isArray(d.levels)) setLevels(d.levels.filter((n) => n === 1 || n === 2 || n === 3).sort());
  }, [site]);

  // Topic categories for the setup (needs alhalba_v4.sql; hidden until it is applied).
  useEffect(() => {
    if (!supabase) return;
    void supabase.rpc("halba_categories").then(({ data }) => {
      if (Array.isArray(data)) setCategories(data as Array<{ category: string; topics: number }>);
    });
  }, []);

  const step = useCallback(
    async (fn: string, args: Record<string, unknown> = {}) => {
      setBusy(true);
      setError(null);
      const { error: message } = await call(fn, { p_room_id: roomId, ...args });
      if (message) setError(message);
      await reload();
      setBusy(false);
    },
    [roomId, reload],
  );

  const phase = state.phase ?? "";
  const bidLeft = useSecondsLeft(phase === "bid" ? state.bid_ends_at : null);
  const proveLeft = useSecondsLeft(isAnswering(state) ? state.prove_ends_at : null);
  const groupLeft = useGroupFinish(roomId, state, true, reload);
  const nextIn = useAutoNext(roomId, state, true, reload);

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
  }, [phase, bidLeft, step]);

  // The first round, with the host's settings. Before alhalba_v5.sql the function has no
  // judge/time parameters: start without them.
  async function startMatch() {
    const base = {
      p_mode: mode,
      p_rounds: rounds,
      p_host_plays: hostPlays,
      p_lives: lives,
      ...(categories.length > 0 ? { p_categories: picked.length > 0 ? picked : null } : {}),
    };
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const v5 = { ...base, p_judge: judge, p_answer_seconds: answerSeconds || null, p_bid_seconds: bidSeconds };
    const extra = { pace, win_rule: winRule, auto_next: autoNext, group_every: groupEvery, levels: levels.length > 0 && levels.length < 3 ? levels : null };
    // Newest first; a database without alhalba_v6.sql (or v5) answers "function not found".
    const missing = (e: { code?: string; message: string } | null) => !!e && (e.code === "PGRST202" || /function/i.test(e.message));
    let probe = await supabase.rpc("halba_start_round", { p_room_id: roomId, ...v5, p_extra: extra });
    if (missing(probe.error)) probe = await supabase.rpc("halba_start_round", { p_room_id: roomId, ...v5 });
    setBusy(false);
    if (missing(probe.error)) return step("halba_start_round", base);
    if (probe.error) return setError("تعذّر تنفيذ الخطوة، حاول مرة أخرى.");
    const result = probe.data as { ok: boolean; reason?: string };
    if (!result?.ok) setError(HALBA_ERRORS[result?.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.");
    await reload();
  }

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
  const modeName = [
    state.mode === "teams" ? "فريقان" : state.mode === "duel" ? "نزال ثنائي" : state.mode ? "الكل ضد الكل" : "",
    state.judge ? JUDGE_NAMES[state.judge] : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const tally = predictionTally(state);

  return (
    <section className="mx-auto mt-2 grid max-w-3xl gap-4 tv:max-w-5xl">
      <div className="surface flex flex-wrap items-center justify-between gap-3 rounded-[22px] px-4 py-3 lg:px-6 lg:py-4">
        <h1 className="flex flex-wrap items-center gap-3 text-xl font-extrabold text-ivory lg:text-2xl tv:text-4xl">
          رمز الغرفة{" "}
          <span className="room-code rounded-[12px] border border-gold/40 bg-night/60 px-3 py-0.5 text-gold shadow-glow-gold">{roomCode}</span>
        </h1>
        <span className="text-sm text-muted">الحلبة{modeName ? ` · ${modeName}` : ""}</span>
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
                onChange={(v) => setMode(v as "ffa" | "duel" | "teams")}
                options={[
                  { value: "ffa", label: "الكل ضد الكل" },
                  { value: "duel", label: "نزال ثنائي" },
                  { value: "teams", label: "فريقان" },
                ]}
              />
              {mode === "teams" ? <p className="-mt-1 text-start text-[13px] text-mist">نقسّمكم عشوائيًا لفريقين. أي عضو يزايد ويتحدى ويكتب لفريقه.</p> : null}
              <button
                type="button"
                aria-expanded={advanced}
                onClick={() => setAdvanced((v) => !v)}
                className="flex min-h-11 items-center justify-between rounded-[14px] border border-line-strong/60 bg-deep-2/50 px-4 text-[14px] font-semibold text-ivory"
              >
                <span>⚙️ إعدادات متقدمة</span>
                <span className="text-mist">{advanced ? "إخفاء" : "عرض"}</span>
              </button>
              {!advanced ? (
                <p className="-mt-1 text-start text-[13px] leading-6 text-mist">
                  المقترح: {rounds} جولات، {lives === 1 ? "محاولة واحدة" : lives === 2 ? "محاولتان" : "3 محاولات"}، مطابقة تلقائية ويدوية، الوقت حسب المزايدة، جولة جماعية كل 3 جولات، والفائز صاحب أعلى نقاط.
                </p>
              ) : null}
              {advanced ? (
              <>
              <Choice
                label={mode === "teams" ? "المحاولات لكل فريق" : "المحاولات لكل لاعب"}
                value={String(lives)}
                onChange={(v) => setLives(Number(v))}
                options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
              />
              <p className="-mt-1 text-start text-[13px] text-mist">
                {lives === 1 ? "أول خطأ يُخرج من الحلبة." : `كل خطأ ينقص محاولة، ومن تخلص محاولاته الـ${lives} يخرج.`}
              </p>
              <Choice
                label="عدد الجولات"
                value={String(rounds)}
                onChange={(v) => setRounds(Number(v))}
                options={[3, 5, 7, 10].map((n) => ({ value: String(n), label: String(n) }))}
              />
              {mode === "duel" ? (
                <p className="-mt-1 text-start text-[13px] text-mist">
                  كل جولة نزال بين لاعبَين، ويدخل كل لاعب نزالاته بالدور حتى يلعب الجميع. إذا انتهت الجولات قبل أن يلعب الكل بالتساوي، تُضاف جولات حتى يكتملوا.
                </p>
              ) : null}
              <Choice
                label="مطابقة الإجابات"
                value={judge}
                onChange={(v) => setJudge(v as "auto" | "manual" | "both")}
                options={[
                  { value: "both", label: "الاثنان" },
                  { value: "auto", label: "تلقائي" },
                  { value: "manual", label: "يدوي" },
                ]}
              />
              <p className="-mt-1 text-start text-[13px] text-mist">
                {judge === "auto"
                  ? "يطابق النظام الإجابات مع قائمة الموضوع ويرفض ما لا يطابقها، بدون حَكَم. الموضوع الذي ليس له قائمة يحكم فيه الحَكَم."
                  : judge === "manual"
                    ? "الحَكَم يحكم على كل إجابة بـ ✓ أو ✗، ويقدر يحسب الإجابات المنطوقة بـ +1."
                    : "يقبل النظام ما يطابق قائمة الموضوع، والحَكَم يحكم على الباقي."}{" "}
                في كل الطرق يكتب صاحب المزايدة عدد إجاباته بالضبط، ثم تُطابَق كلها مرة واحدة.
              </p>
              <Choice
                label="وقت المزايدة"
                value={String(bidSeconds)}
                onChange={(v) => setBidSeconds(Number(v))}
                options={[10, 20, 30, 45].map((n) => ({ value: String(n), label: `${n} ث` }))}
              />
              <Choice
                label="وقت الإجابة"
                value={String(pace)}
                onChange={(v) => setPace(Number(v))}
                options={[
                  { value: "4", label: "سريع" },
                  { value: "6", label: "عادي" },
                  { value: "8", label: "مريح" },
                ]}
              />
              <p className="-mt-1 text-start text-[13px] text-mist">
                يكبر مع المزايدة: 10 ثوانٍ + {pace} ثوانٍ لكل إجابة. مزايدة 5 = {10 + pace * 5} ثانية، ومزايدة 10 = {10 + pace * 10} ثانية.
              </p>
              <Choice
                label="الفائز"
                value={winRule}
                onChange={(v) => setWinRule(v as "score" | "last")}
                options={[
                  { value: "score", label: "أعلى نقاط" },
                  { value: "last", label: "آخر من بقي" },
                ]}
              />
              <p className="-mt-1 text-start text-[13px] text-mist">
                {winRule === "score" ? "يفوز صاحب أعلى نقاط في النهاية، حتى لو خرج من الحلبة قبلها." : "إذا بقي لاعب (أو فريق) واحد في الحلبة يفوز فورًا، وإلا يفوز صاحب أعلى نقاط."}
              </p>
              <Choice
                label="جولة جماعية"
                value={String(groupEvery)}
                onChange={(v) => setGroupEvery(Number(v))}
                options={[
                  { value: "0", label: "بدون" },
                  { value: "3", label: "كل 3" },
                  { value: "4", label: "كل 4" },
                  { value: "5", label: "كل 5" },
                ]}
              />
              <p className="-mt-1 text-start text-[13px] text-mist">الكل يكتب في نفس الوقت لمدة دقيقة، وكل إجابة صحيحة ما كتبها غيرك = 100 نقطة.</p>
              <div className="grid gap-1.5 text-start">
                <span className="text-[14px] font-semibold text-ivory">مستوى المواضيع</span>
                <div className="flex flex-wrap gap-1.5">
                  <Chip on={levels.length === 0} onClick={() => setLevels([])}>
                    الكل
                  </Chip>
                  {[
                    { n: 1, label: "سهل" },
                    { n: 2, label: "متوسط" },
                    { n: 3, label: "صعب" },
                  ].map((l) => (
                    <Chip key={l.n} on={levels.includes(l.n)} onClick={() => setLevels((v) => (v.includes(l.n) ? v.filter((x) => x !== l.n) : [...v, l.n].sort()))}>
                      {l.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <label className="flex items-start gap-3 rounded-[14px] border border-line bg-deep-2/50 p-3 text-start">
                <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} className="mt-1 size-5 accent-[var(--color-gold)]" />
                <span>
                  <b className="text-[14px] text-ivory">الجولة التالية تلقائيًا</b>
                  <span className="block text-[13px] text-mist">بعد 8 ثوانٍ من النتيجة، وتقدر توقفها أثناء اللعب.</span>
                </span>
              </label>
              {categories.length > 1 ? (
                <div className="grid gap-1.5 text-start">
                  <span className="text-[14px] font-semibold text-ivory">التصنيفات</span>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip on={picked.length === 0} onClick={() => setPicked([])}>
                      الكل
                    </Chip>
                    {categories.map((c) => (
                      <Chip
                        key={c.category}
                        on={picked.includes(c.category)}
                        onClick={() => setPicked((p) => (p.includes(c.category) ? p.filter((x) => x !== c.category) : [...p, c.category]))}
                      >
                        {c.category} <span className="text-[0.8em] opacity-70">({c.topics})</span>
                      </Chip>
                    ))}
                  </div>
                </div>
              ) : null}
              </>
              ) : null}
            </div>
            <Button
              tone="primary"
              className="mx-auto min-h-14 px-10 text-[17px]"
              onClick={() => void startMatch()}
              disabled={busy}
            >
              {advanced ? "ابدأ المباراة" : "ابدأ بالإعدادات المقترحة"}
            </Button>
          </>
        ) : null}

        {state.topic && ["bid", "prove", "steal_offer", "steal", "result", "group"].includes(phase) ? (
          <TopicCard topic={state.topic} round={state.round} maxRounds={state.max_rounds} />
        ) : null}

        {phase === "group" ? (
          <>
            <Timer seconds={groupLeft} label="الجولة الجماعية" sound />
            {state.host_plays ? <GroupPlay roomId={roomId} state={state} /> : null}
            <GroupCounts state={state} players={players} />
            <Button tone="quiet" className="mx-auto" onClick={() => step("halba_group_finish")} disabled={busy}>
              أنهِ الجولة الجماعية الآن
            </Button>
          </>
        ) : null}
        <RoundBadges state={state} />

        {phase === "bid" ? (
          <>
            {Array.isArray(state.duel) && state.duel.length === 2 ? (
              <p className="font-display text-[20px] font-bold text-ivory">
                {nameOf(players, state.duel[0])} <span className="text-[#ff5a7a]">ضد</span> {nameOf(players, state.duel[1])}
              </p>
            ) : null}
            <Timer seconds={bidLeft} label="وقت المزايدة" sound />
            {canFight(state, hostId) ? (
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

        {isAnswering(state) ? (
          <>
            <ProveHeadline state={state} players={players} />
            <Timer seconds={proveLeft} label={proveLeft === 0 ? "انتهى الوقت" : "الوقت المتبقي"} sound />
            {iJudge ? (
              <JudgeControls key={`${state.round}-${phase}`} roomId={roomId} state={state} reload={reload} />
            ) : (
              <>
                <FighterControls roomId={roomId} meId={hostId} state={state} players={players} reload={reload} />
                <ProofView state={state} />
              </>
            )}
          </>
        ) : null}

        {(phase === "bid" || phase === "prove") && tally.yes + tally.no > 0 ? (
          <p className="text-[14px] text-mist">
            توقعات الجمهور: ينجح {tally.yes} · يفشل {tally.no}
          </p>
        ) : null}

        {state.host_plays && hostId && ["bid", "prove"].includes(phase) ? <PowerCards roomId={roomId} meId={hostId} state={state} reload={reload} /> : null}

        {phase === "steal_offer" ? (
          <>
            <ResultCard state={state} players={players} />
            <StealOffer key={state.round} roomId={roomId} meId={hostId} state={state} iAmHost reload={reload} />
          </>
        ) : null}

        {phase === "result" && (state.result || state.group_result) ? (
          <>
            {state.group_result ? <GroupResult state={state} players={players} /> : <ResultCard state={state} players={players} />}
            {nextIn !== null ? (
              <p className="text-[15px] font-semibold text-gold">الجولة التالية بعد {nextIn}…</p>
            ) : null}
            <div className="flex flex-wrap justify-center gap-2">
              <Button tone="primary" className="min-h-14 px-10 text-[17px]" onClick={() => step("halba_start_round")} disabled={busy}>
                الجولة التالية
              </Button>
              {state.auto_next !== undefined ? (
                <Button tone="quiet" className="min-h-14" onClick={() => step("halba_set_auto", { p_on: !state.auto_next })} disabled={busy}>
                  {state.auto_next ? "⏸ أوقف التلقائي" : "▶ شغّل التلقائي"}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}

        {phase === "over" ? (
          <>
            {state.group_result ? <GroupResult state={state} players={players} /> : state.result ? <ResultCard state={state} players={players} /> : null}
            <Glyph name="trophy" className="mx-auto size-12 text-gold" />
            <p className="font-display text-[30px] font-extrabold text-ivory">{winner ? `الفائز: ${winner.name}` : "انتهت المباراة"}</p>
            {winner ? <p className="text-[15px] text-mist">{winner.why}</p> : null}
            <MatchSummary state={state} players={players} />
            <HalbaShare state={state} players={players} />
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

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx("min-h-10 rounded-full border px-3 text-[14px] font-semibold transition", on ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/60 text-mist hover:text-ivory")}
    >
      {children}
    </button>
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
            className={cx("min-h-11 flex-1 rounded-full px-1.5 text-[13px] font-semibold whitespace-nowrap transition sm:px-3 sm:text-[15px]", value === o.value ? "btn-gold" : "text-mist hover:text-ivory")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Player panel ---------------- */

/** A player's phone in الحلبة: bid, challenge, play cards, judge when it's their turn, predict, and follow the ring. */
export function HalbaPlayerPanel({ roomId, meId }: { roomId: string; meId: string | null }) {
  const { state, players, reload } = useHalbaLive(roomId);
  useHalbaCues(state, { meId });
  const phase = state.phase ?? "";
  const bidLeft = useSecondsLeft(phase === "bid" ? state.bid_ends_at : null);
  const proveLeft = useSecondsLeft(isAnswering(state) ? state.prove_ends_at : null);
  const closing = useRef(false);
  const fighting = canFight(state, meId);
  const iJudge = canJudge(state, players, meId, false);
  const winner = phase === "over" ? halbaWinner(state, players) : null;
  const mySide = sideOf(state, meId);
  const groupLeft = useGroupFinish(roomId, state, false, reload);
  const nextIn = useAutoNext(roomId, state, false, reload);
  const inGroup = !!meId && players.some((p) => p.id === meId && (!p.is_host || state.host_plays)) && (state.mode !== "teams" || !!state.teams?.[meId]);

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
      <p className="text-xs font-bold text-violet-text">
        الحلبة{state.round ? ` · ${roundLabel(state.round, state.max_rounds)}` : ""}
        {state.mode === "teams" && mySide ? (
          <span style={{ color: TEAMS[mySide]?.color }}> · {TEAMS[mySide]?.name}</span>
        ) : null}
      </p>

      {phase === "" || phase === "idle" ? <p className="text-[15px] text-mist">انتظروا المضيف ليبدأ أول جولة.</p> : null}

      {state.topic && ["bid", "prove", "steal_offer", "steal", "result", "group"].includes(phase) ? <TopicCard topic={state.topic} /> : null}
      <RoundBadges state={state} />

      {phase === "group" ? (
        <>
          <Timer seconds={groupLeft} label="الجولة الجماعية" />
          {inGroup ? <GroupPlay roomId={roomId} state={state} /> : null}
          <GroupCounts state={state} players={players} />
        </>
      ) : null}

      {phase === "bid" ? <Timer seconds={bidLeft} label="وقت المزايدة" /> : null}
      {isAnswering(state) ? (
        <>
          {!onAnsweringSide(state, meId) ? <ProveHeadline state={state} players={players} /> : null}
          <Timer seconds={proveLeft} label={proveLeft === 0 ? "انتهى الوقت" : "الوقت"} />
        </>
      ) : null}

      <FighterControls roomId={roomId} meId={meId} state={state} players={players} reload={reload} />

      {isAnswering(state) ? (
        iJudge ? (
          <JudgeControls key={`${state.round}-${phase}`} roomId={roomId} state={state} reload={reload} compact />
        ) : (
          <ProofView state={state} />
        )
      ) : null}

      <PredictBox roomId={roomId} meId={meId} state={state} reload={reload} />
      {["bid", "prove"].includes(phase) ? <PowerCards roomId={roomId} meId={meId} state={state} reload={reload} /> : null}

      {phase === "steal_offer" ? (
        <>
          <ResultCard state={state} players={players} />
          <StealOffer key={state.round} roomId={roomId} meId={meId} state={state} iAmHost={false} reload={reload} />
        </>
      ) : null}

      {phase === "result" && state.group_result ? <GroupResult state={state} players={players} /> : null}
      {phase === "result" && !state.group_result && state.result ? <ResultCard state={state} players={players} /> : null}
      {phase === "result" && nextIn !== null ? <p className="text-[14px] text-gold">الجولة التالية بعد {nextIn}…</p> : null}

      {phase === "over" ? (
        <>
          <Glyph name="trophy" className="mx-auto size-10 text-gold" />
          <p className="font-display text-[26px] font-extrabold text-ivory">{winner ? `الفائز: ${winner.name}` : "انتهت المباراة"}</p>
          {winner ? <p className="text-[14px] text-mist">{winner.why}</p> : null}
          <MatchSummary state={state} players={players} />
          <HalbaShare state={state} players={players} />
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

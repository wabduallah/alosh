import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Glyph } from "@/components/brand";
import { Button, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { playCue } from "@/lib/sfx";
import { vibrate } from "@/lib/prefs";
import { useSecondsLeft } from "@/components/halba";
import { ResultShare, type ShareResult } from "@/components/result-share";
import { useLivePoll } from "@/lib/live";
import { useSiteSettings } from "@/lib/site-settings";
import { setVoicePreference, speak, voicePreference } from "@/components/mafia";
import { phaseGuide, suggestQuestions } from "@/lib/court-phase-guide";
import { ANSWER_RULES, OBJECTION_RULES, answerRulesFor, objectionHint } from "@/lib/court-rules";
import { GUIDE_PHASES, HOST_START, MEMO, PLAYER_START, ROLE_GUIDES, SPEECHES, fillSpeech, type GuidePhase, type GuideRole } from "@/lib/court-guide";
import type { Generated } from "@/lib/court-ai";
import { GameIntro, type IntroStep } from "@/components/game-intro";
import type { CourtCase } from "@/components/admin/cases";

// The case editor and the generator load only when a host opens them.
const CaseEditor = lazy(() => import("@/components/admin/cases").then((m) => ({ default: m.CaseEditor })));
const GenerateSheet = lazy(() => import("@/components/court-generate").then((m) => ({ default: m.GenerateSheet })));

/**
 * «المحكمة»: a case, secret role cards, evidence in rounds, questioning, closing speeches,
 * a guilty / not guilty vote, then the truth. The rules run on the server (supabase/court_v1.sql);
 * the host moves the session forward with one button, and every screen follows the same phase.
 */

export type CourtKind = "accused" | "prosecutor" | "lawyer" | "detective" | "witness" | "juror";
type Step = { phase: CourtPhase; stage?: number; side?: "prosecutor" | "lawyer"; seconds?: number };
type CourtPhase = "intro" | "evidence" | "question" | "closing" | "vote" | "verdict" | "over";
export type CourtEvidence = { stage: number; title: string; text: string; icon: string; time?: string | null; presented?: boolean; by_kind?: CourtKind; by_name?: string; by_player?: string };
type CastRow = { player_id: string; player_name: string; kind: CourtKind; name: string; brief: string | null; role_key?: string };
type PointsRow = { player_id: string; player_name: string; kind: CourtKind; name: string; vote: boolean | null; pick?: string | null; points: number; why: string[]; verdicts?: Record<string, boolean> | null };
/** One accused (court_v5.sql): a case can have two, each with its own verdict and truth. */
type AccusedRow = { key: string; name: string; player_id: string };
type VerdictRow = { key: string; name: string; player_name: string; player_id: string; guilty: boolean; votes_guilty: number; votes_innocent: number };
type TruthRow = VerdictRow & { truth: boolean; correct: boolean };
type CardReveal = { player_name: string; kind: CourtKind; name: string; secret: string; later: string | null; goal?: string | null; win?: Win | null; clue?: string | null };
type Win = "truth" | "convict" | "acquit";
type QueueRow = { player_id: string; name: string; at: string };
type Suspect = { key: string; name: string };
type GoalRow = { player_id: string; player_name: string; name: string; goal: string };

export type CourtState = {
  game?: "court";
  phase?: CourtPhase;
  step?: number;
  steps?: Step[];
  stage?: number;
  side?: "prosecutor" | "lawyer" | null;
  ends_at?: string | null;
  case?: { id: string; title: string; category: string | null; intro: string; difficulty: number; versions?: number };
  cast?: CastRow[];
  evidence?: CourtEvidence[];
  stand?: string | null;
  /** The last slot of the automatic stand order the server applied (court_v5.sql). */
  stand_slot?: number | null;
  accused?: AccusedRow[];
  objection?: {
    by?: string;
    kind: CourtKind;
    name: string;
    at: string;
    n: number;
    status?: "pending" | "accepted" | "rejected";
    ruled_at?: string;
    /** With the system as judge (court_v9.sql): the jury's votes, and the count once settled. */
    votes?: Record<string, boolean>;
    tally?: { yes: number; no: number };
  } | null;
  queue?: QueueRow[];
  asking?: string | null;
  golden?: { by: string; by_name: string; target: string; target_name: string; at: string } | null;
  suspects?: Suspect[] | null;
  goals?: GoalRow[] | null;
  goals_awarded?: Record<string, boolean>;
  goal_votes?: Record<string, { yes: number; no: number; of: number }>;
  judge_id?: string | null;
  judge_name?: string | null;
  asking_since?: string | null;
  /** The judge paused the timers of this step (court_v6.sql): seconds left when paused. */
  paused?: { step: number; left: number | null; at: string } | null;
  golden_kinds?: CourtKind[];
  presented?: { title: string; icon: string; by_kind: CourtKind; by_name: string; at: string } | null;
  pleading?: { prosecutor: number; lawyer: number; winner: "prosecutor" | "lawyer" | null } | null;
  votes_count?: number;
  voters_count?: number;
  verdict?: { guilty: boolean; votes_guilty: number; votes_innocent: number; list?: VerdictRow[] } | null;
  truth?: { guilty: boolean; text: string; correct: boolean; culprit?: string | null; culprit_key?: string | null; list?: TruthRow[]; no_votes?: boolean } | null;
  points?: PointsRow[] | null;
  cards?: CardReveal[] | null;
  settings?: CourtSettings;
  last_settings?: CourtSettings | null;
  /** How many turns to ask each player took in this case (court_v8.sql). */
  asked?: Record<string, number>;
  /** The last «التالي»: the judge can take it back for a few seconds (court_v8.sql). */
  undo?: { step: number; at: string } | null;
  /** «نظام في المحكمة!» or the evening ranking on every screen (court_v8.sql). */
  flash?: { kind: "order" | "evening"; at: string } | null;
};
type EveningRow = { name: string; points: number; matches: number; smart: number; speaker: number };
type CourtSettings = {
  case_id?: string | null;
  host_plays?: boolean;
  auto?: boolean;
  quick?: boolean;
  /** The stand moves by itself during questioning: witnesses, the detective, then the accused. */
  escalate?: boolean;
  /** Advanced (court_v6.sql): objections each, the turn to ask, reading time, who has a golden question. */
  objections?: number;
  turn_seconds?: number;
  read_seconds?: number;
  golden?: "jurors" | "all" | "off";
  /** «النظام» (court_v9.sql): nobody judges by hand, the server runs the session. */
  judge?: "host" | "random" | "system";
  new_evening?: boolean;
  question_seconds?: number;
  closing_seconds?: number;
  vote_seconds?: number;
  used_cases?: string[];
  evening?: { matches?: number; totals?: Record<string, EveningRow> };
};
type MyCard = {
  started: boolean;
  late?: boolean;
  kind?: CourtKind;
  kind_ar?: string;
  name?: string;
  brief?: string | null;
  secret?: string;
  later?: string | null;
  later_pending?: boolean;
  vote?: boolean | null;
  /** My verdict for each accused, by role key (court_v5.sql). */
  verdicts?: Record<string, boolean>;
  pick?: string | null;
  objections_left?: number;
  player_id?: string;
  clue?: string | null;
  goal?: string | null;
  win?: Win | null;
  golden_left?: boolean;
  judge?: boolean;
  pleading?: "prosecutor" | "lawyer" | null;
  exhibits?: Array<{ title: string; text: string; icon?: string; time?: string }> | null;
  exhibits_used?: number[];
  goal_votes?: Record<string, boolean>;
};
type Player = { id: string; player_name: string; is_host: boolean };

export const KINDS: Record<CourtKind, { label: string; icon: string; goal: string }> = {
  accused: { label: "المتهم", icon: "🙍", goal: "دافع عن نفسك. تكسب 300 نقطة إذا حُكم ببراءتك، سواء كنت بريئًا أو لا." },
  prosecutor: { label: "المدعي العام", icon: "📂", goal: "أثبت التهمة. تكسب 200 إذا أُدين المتهم، و100 إذا كان الحكم صحيحًا." },
  lawyer: { label: "المحامي", icon: "💼", goal: "دافع عن موكلك واكشف الثغرات. تكسب 200 إذا بُرّئ، و100 إذا كان الحكم صحيحًا." },
  detective: { label: "المحقق", icon: "🔎", goal: "اربط الأدلة بالأحداث وساعد المحكمة على الحقيقة." },
  witness: { label: "شاهد", icon: "👁️", goal: "أجب بما تعرفه حين تُسأل." },
  juror: { label: "محلّف", icon: "🗳️", goal: "استمع واسأل، ثم صوّت. صوتك الصحيح = 100 نقطة، ولك سؤال ذهبي واحد." },
};

/** How a role wins, in one line for its card. */
export function winText(kind: CourtKind, win?: Win | null) {
  if (kind === "accused" || kind === "prosecutor" || kind === "lawyer" || kind === "juror") return KINDS[kind].goal;
  const how = win === "convict" ? "تكسب 200 إذا أُدين المتهم، مهما كانت الحقيقة." : win === "acquit" ? "تكسب 200 إذا بُرّئ المتهم، مهما كانت الحقيقة." : "تكسب 200 إذا كان الحكم صحيحًا.";
  return `${KINDS[kind].goal} ${how}`;
}
export const WIN_LABELS: Record<Win, string> = { truth: "الحكم الصحيح", convict: "إدانة المتهم", acquit: "تبرئة المتهم" };
const KIND_ORDER: CourtKind[] = ["accused", "prosecutor", "lawyer", "detective", "witness", "juror"];

const ERRORS: Record<string, string> = {
  NOT_HOST: "هذا للمضيف فقط.",
  NOT_PLAYING: "ابدأ اللعبة من صفحة الغرفة أولًا.",
  NOT_ENOUGH_PLAYERS: "المحكمة تحتاج 4 لاعبين على الأقل.",
  TOO_MANY_PLAYERS: "المحكمة تتسع لـ 20 لاعبًا كحد أقصى.",
  NO_CASE: "لا توجد قضية مناسبة لهذا العدد. أضف قضايا من لوحة الإدارة.",
  CASE_NEEDS_MORE: "هذه القضية تحتاج لاعبين أكثر.",
  ALREADY_STARTED: "المحاكمة بدأت.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  NOT_ALLOWED: "الاعتراض للمدعي والمحامي فقط.",
  NO_OBJECTIONS: "استخدمت اعتراضيك.",
  BUSY: "هناك اعتراض ينتظر حكم القاضي.",
  NO_OBJECTION: "لا يوجد اعتراض ينتظر الحكم.",
  JURORS_ONLY: "السؤال الذهبي للمحلّفين فقط.",
  GOLDEN_USED: "استخدمت سؤالك الذهبي.",
  ALREADY_PRESENTED: "قدّمت هذا الدليل.",
  NOT_ENOUGH_WITH_JUDGE: "مع قاضٍ من اللاعبين تحتاجون 5 أشخاص على الأقل.",
  BAD_SUSPECT: "اختر من قائمة المشتبهين.",
  ACCUSED: "المتهم لا يصوّت.",
  NOT_IN_CASE: "لست من أطراف هذه القضية.",
  BAD_PLAYER: "اختر لاعبًا آخر من الغرفة.",
  HAS_ROLE: "هذا اللاعب له دور في القضية. اختر من دخل بعد التوزيع أو محلّفًا.",
  NO_ROLE: "تعذّر إيجاد الدور في القضية.",
  OVER: "انتهت المحاكمة.",
  NO_TIMER: "لا يوجد مؤقت في هذه المرحلة.",
  NO_UNDO: "لا توجد خطوة للتراجع عنها.",
  TOO_LATE: "فات وقت التراجع.",
  BAD_CASE: "القضية ناقصة، راجعها:",
};
const SETUP_HINT = "لعبة المحكمة تحتاج تشغيل ملفات المحكمة في supabase (حتى court_v8.sql).";

const isCourt = (s: CourtState) => s.game === "court";

function stepLabel(step: Step | undefined) {
  if (!step) return "";
  switch (step.phase) {
    case "intro":
      return "القضية";
    case "evidence":
      return `أدلة الجولة ${step.stage}`;
    case "question":
      return `الاستجواب ${step.stage}`;
    case "closing":
      return step.side === "prosecutor" ? "مرافعة المدعي" : "مرافعة المحامي";
    case "vote":
      return "التصويت";
    case "verdict":
      return "الحكم";
    case "over":
      return "الحقيقة";
  }
}

/** What the host's button says: the next step, as an action. */
function nextAction(step: Step | undefined) {
  if (!step) return "التالي";
  switch (step.phase) {
    case "evidence":
      return `اعرض أدلة الجولة ${step.stage}`;
    case "question":
      return "ابدأ الاستجواب";
    case "closing":
      return step.side === "prosecutor" ? "مرافعة المدعي العام" : "مرافعة المحامي";
    case "vote":
      return "افتح التصويت";
    case "verdict":
      return "أعلن الحكم";
    case "over":
      return "اكشف الحقيقة";
    default:
      return "التالي";
  }
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Live state and players, from realtime with a polling fallback. */
export function useCourtLive(roomId: string) {
  const [state, setState] = useState<CourtState>({});
  const [players, setPlayers] = useState<Player[]>([]);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [{ data: gs }, { data: ps }] = await Promise.all([
      supabase.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
      supabase.from("room_players").select("id, player_name, is_host").eq("room_id", roomId).order("joined_at"),
    ]);
    if (gs) setState((gs.state_data ?? {}) as CourtState);
    if (ps) setPlayers(ps as Player[]);
  }, [roomId]);
  useLivePoll(`court-${roomId}`, [{ table: "room_game_state", filter: `room_id=eq.${roomId}` }, { table: "room_players", filter: `room_id=eq.${roomId}` }], load);
  return { state, players, reload: load };
}

/** My role card: reloaded when the phase, round or objections change. */
function useMyCard(roomId: string, state: CourtState) {
  const [card, setCard] = useState<MyCard | null>(null);
  const key = `${state.game ?? ""}:${state.step ?? -1}:${state.stage ?? 0}:${state.objection?.at ?? ""}:${state.votes_count ?? 0}:${state.golden?.at ?? ""}:${state.presented?.at ?? ""}:${JSON.stringify(state.goal_votes ?? {})}:${(state.cast ?? []).length}`;
  const reload = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.rpc("court_my_card", { p_room_id: roomId });
    setCard((data ?? null) as MyCard | null);
  }, [roomId]);
  useEffect(() => {
    void reload();
  }, [reload, key]);
  return { card, reload };
}

/** Sounds on the big screen and host; vibration on phones when something concerns everyone. */
function useCourtCues(state: CourtState, opts: { sound?: boolean; vibe?: boolean }) {
  const last = useRef("");
  const lastObjection = useRef<string | null>(null);
  useEffect(() => {
    const key = `${state.step ?? -1}`;
    if (key === last.current) return;
    const first = last.current === "";
    last.current = key;
    if (first || !isCourt(state)) return;
    if (opts.sound) {
      if (state.phase === "evidence") playCue("round");
      else if (state.phase === "verdict" || state.phase === "intro") playCue("gavel");
      else if (state.phase === "over") playCue(state.truth?.correct ? "victory" : "wrong");
      else playCue("click");
    }
    if (opts.vibe && (state.phase === "vote" || state.phase === "evidence")) vibrate([150, 60, 150]);
  }, [state.step, state.phase, state.truth?.correct, opts.sound, opts.vibe]);
  useEffect(() => {
    const at = state.objection?.at ?? null;
    if (!at || at === lastObjection.current) return;
    const first = lastObjection.current === null && Date.now() - Date.parse(at) > 6000;
    lastObjection.current = at;
    if (first) return;
    if (opts.sound) playCue("gavel");
    if (opts.vibe) vibrate(120);
  }, [state.objection?.at, opts.sound, opts.vibe]);
  // «🔨 نظام في المحكمة!» (court_v8.sql): the gavel on the big screen, a buzz on phones.
  const lastFlash = useRef<string | null>(null);
  useEffect(() => {
    const f = state.flash;
    if (!f?.at || f.at === lastFlash.current) return;
    const first = lastFlash.current === null && Date.now() - Date.parse(f.at) > 6000;
    lastFlash.current = f.at;
    if (first || f.kind !== "order") return;
    if (opts.sound) playCue("gavel");
    if (opts.vibe) vibrate([80, 40, 80, 40, 80]);
  }, [state.flash?.at, state.flash?.kind, opts.sound, opts.vibe]);
}

/** The system is the judge (court_v9.sql): the server moves the session and the jury settles objections. */
const systemJudge = (s: CourtState) => s.settings?.judge === "system";
/** How long a pending objection waits: the jury votes for 15 seconds, a judge rules within 10. */
const objectionMs = (s: CourtState) => (systemJudge(s) ? 15000 : 10000);

/** The judge paused this step (court_v6.sql). A pause from an earlier step no longer counts. */
const isPaused = (s: CourtState) => !!s.paused && s.paused.step === s.step;
/** How long a turn to ask lasts (45 seconds unless the host chose otherwise). */
const turnMs = (s: CourtState) => (s.settings?.turn_seconds ?? 45) * 1000;

/** Seconds left on the step's timer, or null when it has none. While paused: the seconds kept. */
function useStepLeft(state: CourtState) {
  const left = useSecondsLeft(state.ends_at ?? null);
  return isPaused(state) ? (state.paused?.left ?? null) : left;
}

/**
 * Automatic moves (supabase/court_v2.sql): when the timer of a step ends and the host chose
 * «انتقال تلقائي», any screen in the room asks the server to move on. The TV asks first, then the
 * host, then the phones, so one request usually does it; the server ignores late or early ones.
 */
function useAutoTick(roomId: string, state: CourtState, delayMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);
  const asked = useRef<string | null>(null);
  const step = state.step ?? -1;
  // Deadlines the server acts on: the step timer (when automatic, and with the system as judge the
  // introduction and the verdict too), the turn to ask (45 s), and a pending objection (10 or 15 s).
  const deadlines: Array<[string, number]> = [];
  if (state.settings?.auto && state.ends_at) deadlines.push(["step", Date.parse(state.ends_at)]);
  if (state.phase === "question" && state.asking && state.asking_since && !isPaused(state)) deadlines.push([`turn:${state.asking_since}`, Date.parse(state.asking_since) + turnMs(state)]);
  if (state.objection?.status === "pending" && state.objection.at) deadlines.push([`obj:${state.objection.at}`, Date.parse(state.objection.at) + objectionMs(state)]);
  // The next turn on the stand (court_v5.sql): the server moves it when its slot starts.
  const esc = escalation(state);
  if (esc && esc.nextAt !== null) deadlines.push([`esc:${esc.nextIndex}`, esc.nextAt]);
  const due = deadlines.find(([, t]) => now >= t);
  const key = due ? `${step}:${due[0]}` : null;
  useEffect(() => {
    if (!supabase || !key || asked.current === key || state.phase === "over") return;
    asked.current = key;
    const client = supabase;
    const t = window.setTimeout(() => {
      void client.rpc("court_tick", { p_room_id: roomId, p_step: step });
    }, delayMs);
    return () => window.clearTimeout(t);
  }, [roomId, key, step, state.phase, delayMs]);
}

/** A gavel when a timer runs out, on the screens that make sound. */
function useTimeUpCue(state: CourtState, on: boolean) {
  const left = useStepLeft(state);
  const rang = useRef<string | null>(null);
  useEffect(() => {
    const key = `${state.step ?? -1}`;
    if (!on || left !== 0 || rang.current === key) return;
    rang.current = key;
    playCue("gavel");
  }, [on, left, state.step]);
}

/** The week from Saturday, so «السبت 21:00» comes before «الأحد 06:00» on the timeline. */
const WEEK = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

/**
 * Minutes for the timeline. A day may come before the time: a weekday («الأحد 22:10») or the next
 * day («الغد 09:30»), so a case that spans days or midnight stays in order.
 */
export function timeValue(t: string | null | undefined): number | null {
  if (!t) return null;
  const latin = t.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const m = latin.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const day = WEEK.findIndex((d) => latin.includes(d));
  const offset = day >= 0 ? day * 1440 : /الغد|التالي/.test(latin) ? 1440 : 0;
  return offset + Number(m[1]) * 60 + Number(m[2]);
}

/** Evidence with a time, as a line from the earliest to the latest: contradictions show at a glance. */
function Timeline({ items, stage, big = false }: { items: CourtEvidence[]; stage?: number; big?: boolean }) {
  const points = items
    .map((e) => ({ e, v: timeValue(e.time) }))
    .filter((x): x is { e: CourtEvidence; v: number } => x.v !== null)
    .sort((a, b) => a.v - b.v);
  if (points.length < 2) return null;
  return (
    <div className={cx("rounded-[20px] border border-gold/30 bg-night/50 px-4 pt-3 pb-4", big && "rounded-[1.4vw] px-[1.6vw] pt-[1vw] pb-[1.4vw]")}>
      <p className={cx("mb-2 font-bold text-gold", big ? "text-[clamp(14px,1.4vw,28px)]" : "text-[13px]")}>🕰️ الخط الزمني</p>
      {/* Desktop and TV: a line of the times in order. Phones: a list. */}
      <div className={cx(big ? "block" : "hidden sm:block")}>
        <div dir="ltr" className="relative mx-[6%]" style={{ height: big ? "clamp(110px,15vh,190px)" : "120px" }}>
          <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-gold/40" />
          {points.map(({ e }, i) => {
            // Evenly spaced in time order: close times stay readable.
            const x = (i / (points.length - 1)) * 100;
            const up = i % 2 === 0;
            const fresh = stage !== undefined && e.stage === stage;
            return (
              <div key={`${e.title}-${i}`} className="absolute top-1/2 grid -translate-x-1/2 justify-items-center" style={{ left: `${x}%` }}>
                <span className={cx("absolute -translate-y-1/2 rounded-full border-2", fresh ? "border-gold bg-gold" : "border-gold/70 bg-night", big ? "size-[clamp(12px,1.1vw,22px)]" : "size-3")} />
                <span
                  dir="rtl"
                  className={cx(
                    "absolute w-max max-w-[16vw] text-center leading-tight",
                    up ? "bottom-3" : "top-3",
                    big ? "text-[clamp(11px,1.05vw,20px)]" : "max-w-32 text-[11px]",
                  )}
                >
                  <b dir="ltr" className={cx("block font-display tabular-nums", fresh ? "text-gold" : "text-ivory")}>
                    {e.time}
                  </b>
                  <span className="text-mist">
                    {e.icon} {e.title}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <ol className={cx("grid gap-1", big ? "hidden" : "sm:hidden")}>
        {points.map(({ e }, i) => (
          <li key={i} className="flex items-baseline gap-2 text-[13px]">
            <b dir="ltr" className="w-12 shrink-0 font-display tabular-nums text-gold">
              {e.time}
            </b>
            <span className="text-ivory">
              {e.icon} {e.title}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------- Shared pieces ---------------- */

function Clock({ seconds, big = false, paused = false }: { seconds: number | null; big?: boolean; paused?: boolean }) {
  if (seconds === null && !paused) return null;
  if (paused)
    return (
      <span dir="ltr" className={cx("inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 font-display font-extrabold tabular-nums text-mist", big ? "py-1 text-[clamp(22px,2.6vw,52px)]" : "py-0.5 text-[20px]")}>
        ⏸ {seconds !== null ? mmss(seconds) : ""}
      </span>
    );
  if (seconds === null) return null;
  const hot = seconds <= 10;
  return (
    <span
      dir="ltr"
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-3 font-display font-extrabold tabular-nums",
        big ? "py-1 text-[clamp(22px,2.6vw,52px)]" : "py-0.5 text-[20px]",
        seconds === 0 ? "border-wrong/60 text-wrong" : hot ? "beat border-wrong/60 text-wrong" : "border-gold/50 text-gold",
      )}
    >
      {seconds === 0 ? "انتهى الوقت" : mmss(seconds)}
    </span>
  );
}

function Steps({ state, big = false }: { state: CourtState; big?: boolean }) {
  const all = state.steps ?? [];
  const cur = state.step ?? 0;
  // The verdict is part of «الحكم»: it shows on the vote's chip.
  const at = all[cur]?.phase === "verdict" ? cur - 1 : cur;
  const list = useRef<HTMLOListElement>(null);
  // Keep the current step in view on narrow screens.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-current="step"]');
    const box = list.current;
    if (el && box) box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
  }, [at]);
  return (
    <ol ref={list} className={cx("no-scrollbar flex gap-1 overflow-x-auto", big ? "text-[clamp(11px,1vw,18px)]" : "text-[11px]")} aria-label="مراحل الجلسة">
      {all.map((s, i) =>
        s.phase === "verdict" ? null : (
          <li
            key={i}
            aria-current={i === at ? "step" : undefined}
            className={cx("shrink-0 rounded-full px-2.5 py-1 font-semibold whitespace-nowrap", i === at ? "btn-gold" : i < at ? "bg-gold/15 text-gold" : "bg-deep-2/70 text-faint")}
          >
            {stepLabel(s)}
          </li>
        ),
      )}
    </ol>
  );
}

/** «🎙️ الاستجواب · الجولة 2 من 3»: where the session is, in one line (phones and the judge). */
function phaseLine(state: CourtState) {
  const stages = Math.max(1, ...(state.steps ?? []).map((x) => x.stage ?? 0));
  const round = stages > 1 && state.stage ? ` · الجولة ${state.stage} من ${stages}` : "";
  switch (state.phase) {
    case "intro":
      return "📜 القضية: اقرأ بطاقتك";
    case "evidence":
      return `📁 الأدلة${round}`;
    case "question":
      return `🎙️ الاستجواب${round}`;
    case "closing":
      return state.side === "lawyer" ? "🎤 مرافعة المحامي" : "🎤 مرافعة المدعي";
    case "vote":
      return "🗳️ التصويت";
    case "verdict":
      return "⚖️ الحكم";
    case "over":
      return "🔓 الحقيقة";
    default:
      return "";
  }
}

function CaseHeader({ state, big = false, children }: { state: CourtState; big?: boolean; children?: ReactNode }) {
  const left = useStepLeft(state);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {big ? (
          <h2 className="min-w-0 flex-1 font-display text-[clamp(22px,2.6vw,52px)] leading-tight font-extrabold text-ivory">
            <span aria-hidden="true">⚖️ </span>
            {state.case?.title}
          </h2>
        ) : (
          <div className="grid min-w-0 flex-1">
            <span className="truncate text-[13px] text-mist">⚖️ {state.case?.title}</span>
            <span className="font-display text-[19px] leading-8 font-extrabold text-ivory">{phaseLine(state)}</span>
          </div>
        )}
        <Clock seconds={left} big={big} paused={isPaused(state)} />
        {children}
      </div>
      {big ? <Steps state={state} big={big} /> : null}
      {isPaused(state) ? (
        <p role="status" className={cx("rounded-[14px] border border-line-strong bg-deep-2/70 p-2 text-center font-bold text-ivory", big ? "text-[clamp(16px,1.8vw,36px)]" : "text-[15px]")}>
          ⏸️ القاضي أوقف الوقت مؤقتًا
        </p>
      ) : null}
    </div>
  );
}

function EvidenceGrid({ items, stage, big = false, compact = false }: { items: CourtEvidence[]; stage?: number; big?: boolean; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className={cx("grid gap-2", big ? "grid-cols-2 gap-[1vw] xl:grid-cols-3" : compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
      {items.map((e, i) => {
        const fresh = stage !== undefined && e.stage === stage;
        return (
          <li
            key={`${e.stage}-${i}`}
            className={cx(
              "rise flex gap-3 rounded-[18px] border p-3",
              big && "rounded-[1.4vw] p-[1.1vw]",
              fresh ? "border-gold/60 bg-gold/10" : "border-line bg-deep-2/50",
            )}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <span aria-hidden="true" className={cx("shrink-0 leading-none", big ? "text-[clamp(26px,2.8vw,56px)]" : "text-[26px]")}>
              {e.icon}
            </span>
            <span className="grid min-w-0 gap-1">
              <span className={cx("font-bold text-ivory", big ? "text-[clamp(16px,1.7vw,34px)]" : "text-[15px]")}>
                {e.title}
                {e.time ? (
                  <span dir="ltr" className={cx("ms-2 rounded-full bg-deep-2 px-2 font-display tabular-nums text-gold", big ? "text-[0.75em]" : "text-[12px]")}>
                    🕰️ {e.time}
                  </span>
                ) : null}
                {fresh && !big ? <span className="ms-2 rounded-full bg-gold/20 px-2 text-[11px] text-gold">جديد</span> : null}
                {e.presented ? (
                  <span className={cx("ms-2 rounded-full bg-violet-text/15 px-2 font-semibold text-violet-text", big ? "text-[0.7em]" : "text-[11px]")}>📎 قدّمه {e.by_kind ? KINDS[e.by_kind].label : e.by_name}</span>
                ) : null}
              </span>
              <span className={cx("text-mist", big ? "text-[clamp(14px,1.45vw,30px)] leading-snug" : "text-[14px] leading-6")}>{e.text}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function CastGrid({ state, big = false, onPick, busy = false, briefs = true }: { state: CourtState; big?: boolean; onPick?: (id: string | null) => void; busy?: boolean; briefs?: boolean }) {
  const cast = [...(state.cast ?? [])].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const roles = cast.filter((c) => c.kind !== "juror");
  const jurors = cast.filter((c) => c.kind === "juror");
  return (
    <div className="grid gap-2">
      <ul className={cx("grid gap-2", big ? "grid-cols-3 gap-[0.8vw]" : "grid-cols-1 sm:grid-cols-2")}>
        {roles.map((c) => {
          const on = state.stand === c.player_id;
          const Tag = onPick ? "button" : "div";
          return (
            <li key={c.player_id}>
              <Tag
                {...(onPick ? { type: "button" as const, disabled: busy, onClick: () => onPick(on ? null : c.player_id), "aria-pressed": on } : {})}
                className={cx(
                  "flex w-full items-start gap-2.5 rounded-[16px] border p-2.5 text-start transition",
                  big && "rounded-[1.2vw] p-[0.8vw]",
                  on ? "border-gold bg-gold/15 shadow-glow-gold" : "border-line bg-deep-2/50",
                  onPick && !on && "hover:border-glow",
                )}
              >
                <span aria-hidden="true" className={cx("leading-none", big ? "text-[clamp(22px,2.2vw,44px)]" : "text-[22px]")}>
                  {KINDS[c.kind].icon}
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className={cx("font-bold text-ivory", big ? "text-[clamp(15px,1.5vw,30px)]" : "text-[15px]")}>
                    {c.name}
                    {on ? <span className="ms-2 text-gold">· على المنصة</span> : null}
                  </span>
                  <span className={cx("text-mist", big ? "text-[clamp(12px,1.15vw,22px)]" : "text-[12px]")}>
                    {c.kind === "witness" || c.kind === "detective" ? `${KINDS[c.kind].label} · ` : ""}
                    يلعبه <bdi className="text-ivory">{c.player_name}</bdi>
                  </span>
                  {c.brief && big && briefs ? <span className="text-[clamp(12px,1.1vw,20px)] text-faint">{c.brief}</span> : null}
                </span>
              </Tag>
            </li>
          );
        })}
      </ul>
      {jurors.length ? (
        <p className={cx("text-mist", big ? "text-[clamp(13px,1.3vw,26px)]" : "text-[13px]")}>
          🗳️ هيئة المحلفين: {jurors.map((j) => j.player_name).join("، ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The automatic stand order (court_v5.sql, court_tick): the witnesses, then the detective, then the
 * accused, each for an equal part of the questioning time (30 seconds at least). A golden question
 * pauses it. The same formula as the server, so every screen shows who is next and when.
 */
function escalation(state: CourtState) {
  if (state.phase !== "question" || state.settings?.escalate !== true || !state.ends_at || state.golden) return null;
  const secs = state.steps?.[state.step ?? -1]?.seconds ?? 0;
  const rank = (k: CourtKind) => (k === "witness" ? 1 : k === "detective" ? 2 : k === "accused" ? 3 : 0);
  const order = (state.cast ?? [])
    .map((c, i) => ({ c, i }))
    .filter((x) => rank(x.c.kind) > 0)
    .sort((a, b) => rank(a.c.kind) - rank(b.c.kind) || a.i - b.i)
    .map((x) => x.c);
  if (!secs || !order.length) return null;
  const start = Date.parse(state.ends_at) - secs * 1000;
  const slot = Math.max(30, secs / order.length) * 1000;
  const nextIndex = (state.stand_slot ?? -1) + 1;
  const next = nextIndex < order.length ? order[nextIndex] : null;
  return { order, next, nextIndex, nextAt: next ? start + nextIndex * slot - 1000 : null };
}

/**
 * «لوحة الجلسة»: who is on the stand, who asks (and for how long), who waits, and who the stand
 * goes to next. The same board on phones, the host screen and the TV.
 */
function SessionBoard({ state, big = false, queue: showQueue = true }: { state: CourtState; big?: boolean; queue?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (state.phase !== "question") return null;
  const cast = state.cast ?? [];
  const stand = cast.find((c) => c.player_id === state.stand);
  const asker = cast.find((c) => c.player_id === state.asking);
  const queue = state.queue ?? [];
  const g = state.golden;
  const goldenNow = !!g && g.by === state.asking;
  const esc = escalation(state);
  const nextIn = esc?.nextAt ? Math.max(0, Math.ceil((esc.nextAt - now) / 1000)) : null;
  const t = (small: string, large: string) => (big ? large : small);
  return (
    <div className={cx("grid gap-2 rounded-[22px] border border-gold/40 bg-night/60 p-3", big && "gap-[0.8vw] rounded-[1.6vw] p-[1.2vw]")}>
      <p className={cx("text-center font-bold text-gold", t("text-[13px]", "text-[clamp(14px,1.4vw,28px)]"))}>لوحة الجلسة</p>
      <div className={cx("grid gap-2", big ? "grid-cols-2 gap-[0.8vw]" : "grid-cols-1 sm:grid-cols-2")}>
        <div className={cx("rise grid gap-0.5 rounded-[16px] border p-3 text-center", stand ? "border-gold/60 bg-gold/10" : "border-line bg-deep-2/50", big && "rounded-[1.2vw] p-[1vw]")}>
          <span className={cx("text-mist", t("text-[12px]", "text-[clamp(12px,1.2vw,24px)]"))}>🎙️ على المنصة</span>
          <span className={cx("font-display font-extrabold text-ivory", t("text-[18px]", "text-[clamp(20px,2.4vw,48px)]"))}>
            {stand ? stand.name : "لا أحد بعد"}
            {stand ? <span className="ms-1.5 text-gold">({stand.player_name})</span> : null}
          </span>
        </div>
        <div
          className={cx(
            "grid gap-0.5 rounded-[16px] border p-3 text-center",
            goldenNow ? "border-gold bg-[linear-gradient(135deg,#ffb13b33,#ffe27a22)] shadow-glow-gold" : asker ? "border-line-strong bg-deep-2/60" : "border-line bg-deep-2/50",
            big && "rounded-[1.2vw] p-[1vw]",
          )}
        >
          <span className={cx("text-mist", t("text-[12px]", "text-[clamp(12px,1.2vw,24px)]"))}>{goldenNow ? "⭐ سؤال ذهبي" : "🙋 يسأل الآن"}</span>
          {asker ? (
            <span className="flex flex-wrap items-center justify-center gap-2">
              <span className={cx("font-display font-extrabold", goldenNow ? "text-gold" : "text-ivory", t("text-[18px]", "text-[clamp(20px,2.4vw,48px)]"))}>{asker.player_name}</span>
              {isPaused(state) ? null : <TurnClock since={state.asking_since} big={big} ms={turnMs(state)} />}
            </span>
          ) : (
            <span className={cx("font-semibold text-ivory", t("text-[15px]", "text-[clamp(16px,1.7vw,34px)]"))}>الدور مفتوح: «✋ أبي أسأل»</span>
          )}
          {goldenNow ? <span className={cx("text-ivory", t("text-[13px]", "text-[clamp(13px,1.3vw,26px)]"))}>{g.target_name} يجب أن يجيب</span> : null}
        </div>
      </div>
      {queue.length && showQueue ? (
        <p className={cx("text-center text-mist", t("text-[13px]", "text-[clamp(13px,1.3vw,26px)]"))}>✋ ينتظرون الدور: {queue.map((q, i) => `${i + 1}. ${q.name}`).join("  ·  ")}</p>
      ) : null}
      {esc?.next ? (
        <p className={cx("text-center text-ivory", t("text-[13px]", "text-[clamp(13px,1.3vw,26px)]"))}>
          ⏫ التالي على المنصة: <b>{esc.next.name}</b> ({esc.next.player_name})
          {nextIn !== null ? <span dir="ltr" className="ms-1.5 font-display font-bold tabular-nums text-gold">{mmss(nextIn)}</span> : null}
        </p>
      ) : g && state.settings?.escalate ? (
        <p className={cx("text-center text-mist", t("text-[13px]", "text-[clamp(13px,1.3vw,26px)]"))}>⏸️ المنصة ثابتة حتى ينتهي السؤال الذهبي.</p>
      ) : null}
    </div>
  );
}

function ObjectionFlash({ state, big = false }: { state: CourtState; big?: boolean }) {
  const o = state.objection;
  const ruled = o?.ruled_at ? Date.parse(o.ruled_at) : 0;
  const at = o?.at ? Date.parse(o.at) : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [at, ruled]);
  if (!o || !at) return null;
  const pending = o.status === "pending";
  // Pending: until the host rules. Ruled (or an old objection without a ruling): a few seconds.
  if (!pending && now - (ruled || at) > 6000) return null;
  const accepted = o.status === "accepted";
  // Phones: one slim line at the top, so the screen does not jump.
  if (!big)
    return (
      <p
        role="status"
        className={cx(
          "sticky top-0 z-30 rounded-full border px-3 py-1.5 text-center text-[13px] font-bold",
          pending ? "beat border-wrong bg-[#2b0f1d] text-wrong" : accepted ? "border-correct bg-correct-fill/20 text-correct" : "border-line-strong bg-deep-2 text-mist",
        )}
      >
        ✋ {pending ? "اعتراض" : accepted ? "اعتراض مقبول: السؤال ملغى" : "اعتراض مرفوض: أكمِل"} · {KINDS[o.kind]?.label}
        {pending ? (systemJudge(state) ? " · الهيئة تصوّت" : " · بانتظار القاضي") : ""}
      </p>
    );
  return (
    <div
      role="status"
      className={cx(
        "rounded-[20px] border-2 bg-[#2b0f1d] p-3 text-center",
        pending && "beat",
        accepted ? "border-correct" : o.status === "rejected" ? "border-line-strong" : "border-wrong",
        big && "fixed inset-x-[12vw] top-[28vh] z-40 rounded-[2vw] p-[2.4vw] shadow-[0_30px_120px_#000c]",
      )}
    >
      <p className={cx("font-display font-extrabold", accepted ? "text-correct" : "text-wrong", big ? "text-[clamp(48px,7vw,140px)] leading-none" : "text-[30px]")}>
        {pending ? "اعتراض!" : accepted ? "اعتراض مقبول" : "اعتراض مرفوض"}
      </p>
      <p className={cx("font-bold text-ivory", big ? "text-[clamp(18px,2vw,40px)]" : "text-[15px]")}>
        {KINDS[o.kind]?.label}: {o.name}
        {pending ? (systemJudge(state) ? " · الهيئة تصوّت" : " · بانتظار القاضي") : accepted ? " · السؤال ملغى" : " · أكمِل"}
        {!pending && o.tally ? ` (👍 ${o.tally.yes} · 👎 ${o.tally.no})` : ""}
      </p>
    </div>
  );
}

/** A player just presented evidence from their file. */
function PresentedFlash({ state, big = false }: { state: CourtState; big?: boolean }) {
  const p = state.presented;
  const at = p?.at ? Date.parse(p.at) : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [at]);
  if (!p || !at || now - at > 7000) return null;
  return (
    <div
      role="status"
      className={cx(
        "rise rounded-[20px] border-2 border-gold bg-[#2a1d08] p-3 text-center",
        big && "fixed inset-x-[14vw] top-[30vh] z-40 rounded-[2vw] p-[2.2vw] shadow-[0_30px_120px_#000c]",
      )}
    >
      <p className={cx("font-display font-extrabold text-gold", big ? "text-[clamp(30px,4.4vw,88px)] leading-tight" : "text-[22px]")}>📎 دليل جديد!</p>
      <p className={cx("font-bold text-ivory", big ? "text-[clamp(18px,2.2vw,44px)]" : "text-[16px]")}>
        {p.icon} {p.title}
      </p>
      <p className={cx("text-mist", big ? "text-[clamp(14px,1.5vw,30px)]" : "text-[13px]")}>قدّمه {KINDS[p.by_kind]?.label ?? p.by_name}</p>
    </div>
  );
}

/**
 * What the judge put on every screen (court_v8.sql): «🔨 نظام في المحكمة!» for a few seconds, or the
 * evening ranking until it is hidden (or after 15 seconds).
 */
function CourtFlash({ state, big = false }: { state: CourtState; big?: boolean }) {
  const f = state.flash;
  const at = f?.at ? Date.parse(f.at) : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [at]);
  if (!f || !at) return null;
  if (f.kind === "order") {
    if (now - at > 4000) return null;
    return (
      <div
        role="status"
        className={cx(
          "beat rounded-[20px] border-2 border-gold bg-[#2a1d08] p-3 text-center",
          big && "fixed inset-x-[12vw] top-[28vh] z-40 rounded-[2vw] p-[2.4vw] shadow-[0_30px_120px_#000c]",
        )}
      >
        <p className={cx("font-display font-extrabold text-gold", big ? "text-[clamp(48px,7vw,140px)] leading-none" : "text-[28px]")}>🔨 نظام في المحكمة!</p>
        <p className={cx("font-bold text-ivory", big ? "text-[clamp(18px,2vw,40px)]" : "text-[15px]")}>هدوء، والكلام بإذن القاضي.</p>
      </div>
    );
  }
  if (now - at > 15000) return null;
  return (
    <div className={cx(big && "fixed inset-x-[20vw] top-[14vh] z-40 rounded-[1.6vw] bg-night shadow-[0_30px_120px_#000c] [&_ol]:grid-cols-1")}>
      <EveningBoard state={state} big={big} min={1} />
    </div>
  );
}

/** «ترتيب السهرة»: points from case to case, with titles. */
function EveningBoard({ state, big = false, min = 2 }: { state: CourtState; big?: boolean; min?: number }) {
  const ev = state.settings?.evening;
  const rows = Object.entries(ev?.totals ?? {}).map(([id, r]) => ({ id, ...(r as EveningRow) }));
  if ((ev?.matches ?? 0) < min || rows.length === 0) return null;
  rows.sort((a, b) => b.points - a.points);
  const best = (k: "smart" | "speaker") => {
    const top = [...rows].sort((a, b) => b[k] - a[k])[0];
    return top && top[k] > 0 ? top : null;
  };
  const smart = best("smart");
  const speaker = best("speaker");
  return (
    <div className={cx("grid gap-3 rounded-[24px] border border-gold/40 bg-night/60 p-4", big && "rounded-[1.6vw] p-[1.4vw]")}>
      <p className={cx("font-display font-extrabold text-gold", big ? "text-[clamp(18px,2vw,40px)]" : "text-[18px]")}>
        🌙 ترتيب السهرة ·{" "}
        {(ev?.matches ?? 0) === 1 ? "قضية واحدة" : (ev?.matches ?? 0) === 2 ? "قضيتان" : `${ev?.matches} ${(ev?.matches ?? 0) <= 10 ? "قضايا" : "قضية"}`}
      </p>
      <div className="flex flex-wrap gap-2">
        <span className={cx("rounded-full bg-gold/15 px-3 py-1 font-bold text-gold", big ? "text-[clamp(13px,1.3vw,26px)]" : "text-[13px]")}>⭐ نجم السهرة: {rows[0].name}</span>
        {speaker ? <span className={cx("rounded-full bg-deep-2 px-3 py-1 font-bold text-ivory", big ? "text-[clamp(13px,1.3vw,26px)]" : "text-[13px]")}>💼 محامي السهرة: {speaker.name}</span> : null}
        {smart ? <span className={cx("rounded-full bg-deep-2 px-3 py-1 font-bold text-ivory", big ? "text-[clamp(13px,1.3vw,26px)]" : "text-[13px]")}>🧠 أذكى محلّف: {smart.name}</span> : null}
      </div>
      <ol className={cx("grid gap-1", big && "grid-cols-2 gap-x-[1.4vw]")}>
        {rows.map((r, i) => (
          <li key={r.id} className={cx("flex items-center gap-2 text-ivory", big ? "text-[clamp(14px,1.4vw,28px)]" : "text-[14px]")}>
            <span className="w-6 text-mist tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
            <span dir="ltr" className="font-display font-extrabold tabular-nums text-gold">{r.points}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ClosingBanner({ state, big = false }: { state: CourtState; big?: boolean }) {
  const side = state.side ?? "prosecutor";
  const who = (state.cast ?? []).find((c) => c.kind === side);
  return (
    <div className={cx("grid justify-items-center gap-2 rounded-[24px] border border-gold/40 bg-night/60 p-5 text-center shadow-glow-gold", big && "p-[2.4vw]")}>
      <span aria-hidden="true" className={big ? "text-[clamp(40px,5vw,96px)]" : "text-[40px]"}>
        {KINDS[side].icon}
      </span>
      <p className={cx("font-display font-extrabold text-ivory", big ? "text-[clamp(28px,3.6vw,72px)]" : "text-[26px]")}>{side === "prosecutor" ? "مرافعة المدعي العام" : "مرافعة المحامي"}</p>
      {who ? <p className={cx("text-mist", big ? "text-[clamp(16px,1.8vw,34px)]" : "text-[15px]")}>يتكلم {who.player_name}، والباقون يستمعون.</p> : null}
    </div>
  );
}

function VerdictCard({ state, big = false }: { state: CourtState; big?: boolean }) {
  const v = state.verdict;
  if (!v) return null;
  if ((v.list?.length ?? 0) > 1) return <DualVerdict state={state} big={big} />;
  const accused = (state.cast ?? []).find((c) => c.kind === "accused");
  return (
    <div
      className={cx(
        "rise grid justify-items-center gap-2 rounded-[28px] border-2 p-6 text-center",
        big && "p-[3vw]",
        v.guilty ? "border-wrong/70 bg-wrong-fill/15" : "border-correct/60 bg-correct-fill/15",
      )}
    >
      <p className={cx("text-mist", big ? "text-[clamp(16px,1.8vw,34px)]" : "text-[15px]")}>حكم هيئة المحلفين على {accused?.name ?? "المتهم"}</p>
      <p className={cx("font-display font-extrabold", big ? "text-[clamp(56px,8vw,160px)] leading-none" : "text-[46px] leading-[56px]", v.guilty ? "text-wrong" : "text-correct")}>
        {v.guilty ? "مذنب" : "بريء"}
      </p>
      <p dir="rtl" className={cx("font-bold text-ivory", big ? "text-[clamp(16px,1.8vw,34px)]" : "text-[15px]")}>
        مذنب {v.votes_guilty} · بريء {v.votes_innocent}
        {v.votes_guilty === v.votes_innocent ? " · التعادل لصالح المتهم" : ""}
      </p>
      {state.pleading?.winner ? (
        <p className={cx("text-gold", big ? "text-[clamp(14px,1.5vw,30px)]" : "text-[14px]")}>
          🎤 أفضل مرافعة: {KINDS[state.pleading.winner].label} ({state.pleading[state.pleading.winner]} صوت)
        </p>
      ) : null}
    </div>
  );
}

/** Two accused: a verdict for each, side by side. */
function DualVerdict({ state, big = false }: { state: CourtState; big?: boolean }) {
  const list = state.verdict?.list ?? [];
  return (
    <div className={cx("rise grid gap-3 rounded-[28px] border-2 border-gold/50 bg-night/60 p-5 text-center", big && "gap-[1vw] p-[2vw]")}>
      <p className={cx("text-mist", big ? "text-[clamp(16px,1.8vw,34px)]" : "text-[15px]")}>حكم هيئة المحلفين</p>
      <div className="grid grid-cols-2 gap-3">
        {list.map((r) => (
          <div key={r.key} className={cx("grid gap-1 rounded-[20px] border-2 p-3", r.guilty ? "border-wrong/70 bg-wrong-fill/15" : "border-correct/60 bg-correct-fill/15", big && "rounded-[1.4vw] p-[1.2vw]")}>
            <p className={cx("font-bold text-ivory", big ? "text-[clamp(14px,1.5vw,30px)]" : "text-[14px] leading-6")}>{r.name}</p>
            <p className={cx("text-mist", big ? "text-[clamp(12px,1.2vw,24px)]" : "text-[12px]")}>{r.player_name}</p>
            <p className={cx("font-display font-extrabold", big ? "text-[clamp(40px,5.5vw,110px)] leading-none" : "text-[34px] leading-[44px]", r.guilty ? "text-wrong" : "text-correct")}>{r.guilty ? "مذنب" : "بريء"}</p>
            <p dir="rtl" className={cx("font-bold text-ivory", big ? "text-[clamp(13px,1.3vw,26px)]" : "text-[13px]")}>
              مذنب {r.votes_guilty} · بريء {r.votes_innocent}
              {r.votes_guilty === r.votes_innocent ? " · التعادل لصالحه" : ""}
            </p>
          </div>
        ))}
      </div>
      {state.pleading?.winner ? (
        <p className={cx("text-gold", big ? "text-[clamp(14px,1.5vw,30px)]" : "text-[14px]")}>
          🎤 أفضل مرافعة: {KINDS[state.pleading.winner].label} ({state.pleading[state.pleading.winner]} صوت)
        </p>
      ) : null}
    </div>
  );
}

function TruthCard({ state, big = false }: { state: CourtState; big?: boolean }) {
  const t = state.truth;
  if (!t) return null;
  if (t.no_votes)
    return (
      <div className={cx("grid gap-3 rounded-[24px] border border-line-strong bg-night/60 p-5", big && "p-[2vw]")}>
        <p className={cx("font-display font-extrabold text-mist", big ? "text-[clamp(22px,2.6vw,52px)]" : "text-[20px]")}>🗳️ لم يصوّت أحد: لا نقاط للحكم هذه المرة</p>
        <p className={cx("leading-relaxed text-ivory", big ? "text-[clamp(16px,1.7vw,34px)]" : "text-[16px] leading-7")}>{t.text}</p>
      </div>
    );
  const list = t.list && t.list.length > 1 ? t.list : null;
  const right = list ? list.filter((r) => r.correct).length : 0;
  return (
    <div className={cx("grid gap-3 rounded-[24px] border border-gold/40 bg-night/60 p-5", big && "p-[2vw]")}>
      {list ? (
        <>
          <p className={cx("font-display font-extrabold", big ? "text-[clamp(22px,2.6vw,52px)]" : "text-[20px]", t.correct ? "text-correct" : right ? "text-gold" : "text-wrong")}>
            {t.correct ? "⚖️ تحققت العدالة في الحكمين" : right ? "⚖️ أصابت الهيئة في حكم واحد" : "⚠️ خطأ قضائي في الحكمين"}
          </p>
          <ul className="grid gap-1.5">
            {list.map((r) => (
              <li key={r.key} className={cx("flex flex-wrap items-center gap-x-2 rounded-[14px] border px-3 py-2", r.correct ? "border-correct/50" : "border-wrong/50", big && "rounded-[1vw] px-[1vw] py-[0.6vw]")}>
                <span aria-hidden="true">{r.correct ? "✅" : "❌"}</span>
                <span className={cx("font-bold text-ivory", big ? "text-[clamp(14px,1.5vw,30px)]" : "text-[15px]")}>{r.name}</span>
                <span className={cx("text-mist", big ? "text-[clamp(13px,1.3vw,26px)]" : "text-[13px]")}>
                  الحقيقة: {r.truth ? "مذنب" : "بريء"} · الحكم: {r.guilty ? "مذنب" : "بريء"}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={cx("font-display font-extrabold", big ? "text-[clamp(22px,2.6vw,52px)]" : "text-[20px]", t.correct ? "text-correct" : "text-wrong")}>
          {t.correct ? "⚖️ تحققت العدالة" : "⚠️ خطأ قضائي"}
          <span className={cx("ms-2 text-ivory", big ? "text-[clamp(16px,1.8vw,34px)]" : "text-[15px]")}>الحقيقة: المتهم {t.guilty ? "مذنب" : "بريء"}</span>
        </p>
      )}
      {t.culprit ? (
        <p className={cx("font-bold text-gold", big ? "text-[clamp(18px,2vw,40px)]" : "text-[17px]")}>
          🕵️ الفاعل الحقيقي: {t.culprit}
          <span className={cx("ms-2 font-normal text-mist", big ? "text-[clamp(13px,1.3vw,26px)]" : "text-[13px]")}>
            عرفه {(state.points ?? []).filter((r) => r.pick && r.pick === t.culprit_key).length} من {(state.points ?? []).filter((r) => r.pick).length}
          </span>
        </p>
      ) : null}
      <p className={cx("leading-relaxed text-ivory", big ? "text-[clamp(16px,1.7vw,34px)]" : "text-[16px] leading-7")}>{t.text}</p>
    </div>
  );
}

/** «صوّت مذنب», or for two accused «فهد: مذنب، سعد: بريء». */
function votesText(state: CourtState, r: PointsRow) {
  const list = state.verdict?.list ?? [];
  if (list.length > 1) {
    const parts = list.map((a) => {
      const v = r.verdicts?.[a.key] ?? (a.key === list[0].key ? r.vote : null);
      return v === null || v === undefined ? null : `${a.player_name}: ${v ? "مذنب" : "بريء"}`;
    });
    return parts.some(Boolean) ? ` · صوّت ${parts.filter(Boolean).join("، ")}` : "";
  }
  return r.vote !== null && r.vote !== undefined ? ` · صوّت ${r.vote ? "مذنب" : "بريء"}` : "";
}

function PointsTable({ state, big = false, meId }: { state: CourtState; big?: boolean; meId?: string | null }) {
  const rows = state.points ?? [];
  if (!rows.length) return null;
  return (
    <ol className={cx("grid gap-1.5", big && "grid-cols-2 gap-[0.6vw]")}>
      {rows.map((r, i) => (
        <li
          key={r.player_id}
          className={cx(
            "flex items-center gap-2 rounded-[14px] border px-3 py-2",
            big && "rounded-[1vw] px-[1vw] py-[0.6vw]",
            r.player_id === meId ? "border-gold/60 bg-gold/10" : "border-line bg-deep-2/50",
          )}
        >
          <span className={cx("w-6 shrink-0 text-center font-display font-bold text-mist tabular-nums", big && "w-[2vw] text-[clamp(14px,1.4vw,28px)]")}>{i + 1}</span>
          <span aria-hidden="true" className={big ? "text-[clamp(18px,1.8vw,36px)]" : "text-[18px]"}>
            {KINDS[r.kind]?.icon}
          </span>
          <span className="grid min-w-0 flex-1">
            <span className={cx("truncate font-bold text-ivory", big ? "text-[clamp(14px,1.45vw,30px)]" : "text-[15px]")}>{r.player_name}</span>
            <span className={cx("text-mist", big ? "truncate text-[clamp(11px,1vw,20px)]" : "text-[12px] leading-5")}>
              {r.kind === "juror" ? "محلّف" : r.name}
              {votesText(state, r)}
              {r.pick ? ` · الفاعل: ${(state.suspects ?? []).find((x) => x.key === r.pick)?.name ?? ""}` : ""}
              {r.why.length ? ` · ${r.why.join("، ")}` : ""}
            </span>
          </span>
          <span dir="ltr" className={cx("font-display font-extrabold tabular-nums", big ? "text-[clamp(18px,2vw,40px)]" : "text-[20px]", r.points ? "text-gold" : "text-faint")}>
            +{r.points}
          </span>
        </li>
      ))}
    </ol>
  );
}

function CardsReveal({ state, big = false }: { state: CourtState; big?: boolean }) {
  const cards = state.cards ?? [];
  if (!cards.length) return null;
  return (
    <details className={cx("surface rounded-[20px] p-4", big && "p-[1.4vw]")} open={big}>
      <summary className={cx("cursor-pointer font-bold text-ivory", big ? "text-[clamp(16px,1.6vw,32px)]" : "text-[15px]")}>🃏 كشف البطاقات</summary>
      <ul className={cx("mt-3 grid gap-2", big ? "grid-cols-3 gap-[0.8vw]" : "grid-cols-1")}>
        {cards.map((c, i) => (
          <li key={i} className={cx("rounded-[14px] border border-line bg-deep-2/50 p-3", big && "p-[0.8vw]")}>
            <p className={cx("font-bold text-ivory", big ? "text-[clamp(13px,1.3vw,26px)]" : "text-[14px]")}>
              {KINDS[c.kind]?.icon} {c.name} <span className="font-normal text-mist">({c.player_name})</span>
            </p>
            <p className={cx("mt-1 text-mist", big ? "text-[clamp(11px,1vw,20px)] leading-snug" : "text-[13px] leading-6")}>{c.secret}</p>
            {c.later ? <p className={cx("mt-1 text-gold", big ? "text-[clamp(11px,1vw,20px)]" : "text-[13px] leading-6")}>لاحقًا: {c.later}</p> : null}
            {c.clue ? <p className={cx("mt-1 text-gold", big ? "text-[clamp(11px,1vw,20px)]" : "text-[13px] leading-6")}>🔎 {c.clue}</p> : null}
            {c.goal ? <p className={cx("mt-1 text-violet-text", big ? "text-[clamp(11px,1vw,20px)]" : "text-[13px] leading-6")}>🎯 هدفه السري: {c.goal}</p> : null}
            {c.win && c.win !== "truth" && (c.kind === "witness" || c.kind === "detective") ? (
              <p className={cx("mt-1 font-semibold text-wrong", big ? "text-[clamp(11px,1vw,20px)]" : "text-[13px]")}>⚠️ كان يريد {WIN_LABELS[c.win]}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function courtShare(state: CourtState): ShareResult {
  const rows = (state.points ?? []).slice(0, 8);
  const v = state.verdict;
  return {
    slug: "court",
    title: "⚖️ المحكمة",
    headline: state.truth?.no_votes ? "لم يصوّت أحد" : state.truth ? (state.truth.correct ? "تحققت العدالة" : (state.truth.list ?? []).some((r) => r.correct) ? "عدالة ناقصة" : "خطأ قضائي") : "المحكمة",
    sub: `${state.case?.title ?? ""}${
      v && (v.list?.length ?? 0) > 1 ? ` · ${v.list!.map((a) => `${a.player_name}: ${a.guilty ? "مذنب" : "بريء"}`).join("، ")}` : v ? ` · الحكم: ${v.guilty ? "مذنب" : "بريء"}` : ""
    }`,
    rows: rows.map((r) => ({ name: `${KINDS[r.kind]?.icon ?? ""} ${r.player_name}`, value: `+${r.points}` })),
  };
}

/**
 * The player's role card. The secret shows only while the player holds the button down, so a
 * neighbour glancing at the phone sees nothing. New information is announced, not shown.
 */
function RoleCard({ card, fresh }: { card: MyCard; fresh: boolean }) {
  const [open, setOpen] = useState(false);
  if (!card.kind) return null;
  const k = KINDS[card.kind];
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <div className="grid gap-3 rounded-[24px] border border-gold/50 bg-[linear-gradient(160deg,#3a2210cc,#140c2bcc)] p-5 shadow-glow-gold">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="text-[36px] leading-none">
          {k.icon}
        </span>
        <div className="grid min-w-0 flex-1">
          <span className="text-[13px] font-semibold text-gold">{card.name === (card.kind_ar ?? k.label) ? "دورك" : `دورك: ${card.kind_ar ?? k.label}`}</span>
          <span className="font-display text-[21px] leading-8 font-extrabold text-ivory">{card.name}</span>
        </div>
      </div>
      {card.brief ? <p className="text-[14px] text-mist">{card.brief}</p> : null}
      <button
        type="button"
        aria-pressed={open}
        onPointerDown={(e) => {
          e.preventDefault();
          show();
        }}
        onPointerUp={hide}
        onPointerLeave={hide}
        onPointerCancel={hide}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
        className={cx(
          "grid min-h-24 touch-none gap-2 rounded-[16px] border p-3 text-start transition select-none [-webkit-touch-callout:none]",
          open ? "border-gold/60 bg-night/80" : "border-dashed border-line-strong/70 bg-night/40",
        )}
      >
        {open ? (
          <>
            <span className="text-[12px] font-bold text-gold">🔒 سري، لك وحدك</span>
            <span className="text-[16px] leading-7 text-ivory">{card.secret}</span>
            {card.clue ? (
              <span className="grid gap-1 rounded-[12px] border border-gold/50 bg-gold/10 p-2.5">
                <span className="text-[12px] font-bold text-gold">🔎 معلومة وصلتك وحدك (قد تكون شكًّا)</span>
                <span className="text-[16px] leading-7 text-ivory">{card.clue}</span>
              </span>
            ) : null}
            {card.goal ? (
              <span className="grid gap-1 rounded-[12px] border border-violet-text/50 bg-violet-text/10 p-2.5">
                <span className="text-[12px] font-bold text-violet-text">🎯 هدفك السري (+100 إذا حققته)</span>
                <span className="text-[16px] leading-7 text-ivory">{card.goal}</span>
              </span>
            ) : null}
            {card.later ? (
              <span className="grid gap-1 rounded-[12px] border border-gold/60 bg-gold/10 p-2.5">
                <span className="text-[12px] font-bold text-gold">✉️ معلومة وصلتك لاحقًا</span>
                <span className="text-[16px] leading-7 text-ivory">{card.later}</span>
              </span>
            ) : null}
          </>
        ) : (
          <span className="grid justify-items-center gap-1 py-2 text-center">
            <span aria-hidden="true" className="text-[26px]">
              👆
            </span>
            <span className="text-[15px] font-bold text-ivory">المس البطاقة وأبقِ إصبعك لتقرأ سرّك</span>
            <span className="text-[12px] text-mist">تختفي حين ترفع إصبعك.</span>
          </span>
        )}
      </button>
      {fresh ? (
        <p className="beat rounded-[12px] bg-gold/15 p-2 text-center text-[14px] font-bold text-gold">✉️ وصلتك معلومة جديدة! المس البطاقة لتقرأها</p>
      ) : card.later_pending ? (
        <p className="text-[13px] text-mist">✉️ ستصلك معلومة إضافية في جولة لاحقة.</p>
      ) : null}
      <p className="text-[13px] leading-6 text-mist">🏆 {winText(card.kind, card.win)}</p>
    </div>
  );
}

/** Private notes on this phone, kept for this case only. */
function Notes({ roomId, caseId }: { roomId: string; caseId?: string }) {
  const key = `alosh-court-notes:${roomId}:${caseId ?? ""}`;
  const [text, setText] = useState("");
  useEffect(() => {
    try {
      setText(localStorage.getItem(key) ?? "");
    } catch {
      setText("");
    }
  }, [key]);
  return (
    <details className="surface rounded-[20px] p-4">
      <summary className="cursor-pointer text-[15px] font-semibold text-ivory">📝 ملاحظاتي {text.trim() ? <span className="text-[12px] font-normal text-mist">(محفوظة في جوالك)</span> : null}</summary>
      <textarea
        className="mt-3 min-h-28 w-full rounded-[14px] border border-line-strong bg-deep-2/70 p-3 text-[15px] leading-7 text-ivory outline-none placeholder:text-faint focus:border-gold"
        value={text}
        maxLength={2000}
        placeholder="مثل: نورة قالت 9:00، والخزنة فُتحت 9:20…"
        onChange={(e) => {
          setText(e.target.value);
          try {
            localStorage.setItem(key, e.target.value);
          } catch {
            // Storage blocked: the notes stay for this visit.
          }
        }}
      />
    </details>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="surface rounded-[18px] p-4 text-center text-[15px] leading-7 text-mist">{children}</p>;
}

/**
 * «📘 دليل دورك»: what to do in this phase, questions to ask, and the rules that concern the role
 * (objections for the prosecutor and the lawyer, answers for the accused and witnesses).
 */
/**
 * The stand order (the same as the server's escalation, court_v5.sql): the witnesses, then the
 * detective, then the accused. With a questioning timer and the stand moving by itself, each one's
 * turn starts at a known minute of every questioning round.
 */
function standPlan(state: CourtState) {
  const rank = (k: CourtKind) => (k === "witness" ? 1 : k === "detective" ? 2 : k === "accused" ? 3 : 0);
  const order = (state.cast ?? [])
    .map((c, i) => ({ c, i }))
    .filter((x) => rank(x.c.kind) > 0)
    .sort((a, b) => rank(a.c.kind) - rank(b.c.kind) || a.i - b.i)
    .map((x) => x.c);
  const secs = (state.steps ?? []).find((st) => st.phase === "question")?.seconds ?? 0;
  const auto = state.settings?.escalate !== false && secs > 0;
  const slot = order.length ? Math.max(30, secs / order.length) : 0;
  // «at»: seconds into each questioning round when their turn starts.
  return order.map((c, i) => ({ c, at: auto ? Math.round(i * slot) : null, auto }));
}

/** Who asks first, on whoever is on the stand: the prosecutor, the lawyer, then everyone else by turn. */
function askPlan(state: CourtState) {
  const cast = state.cast ?? [];
  const one = (k: CourtKind) => cast.find((c) => c.kind === k);
  return [
    { label: "المدعي العام", who: one("prosecutor")?.player_name ?? "", icon: KINDS.prosecutor.icon },
    { label: "المحامي", who: one("lawyer")?.player_name ?? "", icon: KINDS.lawyer.icon },
    { label: "المحقق والمحلّفون والشهود", who: "بالدور: «✋ أبي أسأل»", icon: "🙋" },
  ];
}

/**
 * «خطة الاستجواب»: who takes the stand, in order (and from which minute when it moves by itself),
 * and who asks first on each one. The same on phones and on the TV, so nobody needs to ask.
 */
function SessionPlan({ state, meId = null, big = false }: { state: CourtState; meId?: string | null; big?: boolean }) {
  const stand = standPlan(state);
  const asks = askPlan(state);
  if (!stand.length) return null;
  const t = (small: string, large: string) => (big ? large : small);
  const auto = stand[0]?.auto;
  const cast = state.cast ?? [];
  const asker = cast.find((c) => c.player_id === state.asking);
  const queue = state.queue ?? [];
  const live = state.phase === "question" && !big;
  const jurors = cast.filter((c) => c.kind === "juror");
  return (
    <div className={cx("grid gap-3 rounded-[22px] border border-gold/40 bg-night/60 p-4", big && "rounded-[1.6vw] p-[1.4vw]")}>
      <p className={cx("font-bold text-gold", t("text-[14px]", "text-[clamp(16px,1.6vw,32px)]"))}>📋 خطة الاستجواب</p>
      {live ? (
        <div className="grid gap-1 rounded-[14px] border border-line-strong bg-deep-2/60 p-2.5 text-[14px]">
          <p className="flex flex-wrap items-center gap-2 text-ivory">
            {state.golden && state.golden.by === state.asking ? "⭐ سؤال ذهبي:" : "🙋 يسأل الآن:"}
            <b>{asker ? asker.player_name : "الدور مفتوح"}</b>
            {asker && !isPaused(state) ? <TurnClock since={state.asking_since} ms={turnMs(state)} /> : null}
          </p>
          {queue.length ? <p className="text-[13px] text-mist">✋ بالدور: {queue.map((q, i) => `${i + 1}. ${q.name}`).join("  ·  ")}</p> : null}
        </div>
      ) : null}
      <div className={cx("grid gap-3", big ? "grid-cols-2 gap-[1.4vw]" : "sm:grid-cols-2")}>
        <div className="grid content-start gap-1.5">
          <p className={cx("font-semibold text-ivory", t("text-[13px]", "text-[clamp(14px,1.4vw,28px)]"))}>🎙️ من يصعد المنصة بالترتيب</p>
          <ol className="grid gap-1">
            {stand.map(({ c, at }, i) => {
              const mine = !!meId && c.player_id === meId;
              const now = state.phase === "question" && state.stand === c.player_id;
              return (
                <li
                  key={c.player_id}
                  className={cx(
                    "flex items-center gap-2 rounded-[12px] px-2.5 py-1.5",
                    now ? "bg-gold/20" : mine ? "bg-violet-text/15" : "bg-deep-2/50",
                    t("text-[13px]", "text-[clamp(13px,1.3vw,26px)]"),
                  )}
                >
                  <span className="w-5 shrink-0 font-bold tabular-nums text-gold">{i + 1}</span>
                  <span aria-hidden="true">{KINDS[c.kind].icon}</span>
                  <span className="min-w-0 flex-1 truncate text-ivory">
                    {c.name} <span className="text-mist">({c.player_name})</span>
                  </span>
                  {mine ? <span className={cx("shrink-0 font-bold text-violet-text", t("text-[11px]", "text-[0.8em]"))}>أنت</span> : null}
                  {now ? <span className={cx("shrink-0 font-bold text-gold", t("text-[11px]", "text-[0.8em]"))}>الآن</span> : at !== null ? <span dir="ltr" className={cx("shrink-0 text-mist tabular-nums", t("text-[11px]", "text-[0.8em]"))}>{mmss(at)}</span> : null}
                </li>
              );
            })}
          </ol>
          <p className={cx("text-mist", t("text-[12px]", "text-[clamp(12px,1.1vw,22px)]"))}>
            {auto ? "تنتقل وحدها. الوقت: متى يبدأ دوره في كل جولة." : "القاضي يستدعي بهذا الترتيب."}
          </p>
        </div>
        <div className="grid content-start gap-1.5">
          <p className={cx("font-semibold text-ivory", t("text-[13px]", "text-[clamp(14px,1.4vw,28px)]"))}>✋ من يسأل أولًا (على كل من يصعد)</p>
          <ol className="grid gap-1">
            {asks.map((x, i) => (
              <li key={x.label} className={cx("flex items-center gap-2 rounded-[12px] bg-deep-2/50 px-2.5 py-1.5", t("text-[13px]", "text-[clamp(13px,1.3vw,26px)]"))}>
                <span className="w-5 shrink-0 font-bold tabular-nums text-gold">{i + 1}</span>
                <span aria-hidden="true">{x.icon}</span>
                <span className="min-w-0 flex-1 text-ivory">
                  {x.label} {x.who ? <span className="text-mist">({x.who})</span> : null}
                </span>
              </li>
            ))}
          </ol>
          <p className={cx("text-mist", t("text-[12px]", "text-[clamp(12px,1.1vw,22px)]"))}>سؤال واحد واضح في كل دور، ثم الدور للي بعدك.</p>
          {jurors.length ? <p className={cx("text-mist", t("text-[12px]", "text-[clamp(12px,1.1vw,22px)]"))}>🗳️ المحلّفون: {jurors.map((j) => j.player_name).join("، ")}</p> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * «احفظها وارفع راسك»: three lines a player can remember, so they play looking at the room, not
 * the phone. Plus their own place: on the stand (number and minute), or first or second to ask.
 */
function MemoCard({ state, card, meId = null }: { state: CourtState; card: MyCard; meId?: string | null }) {
  if (!card.kind || card.kind === ("judge" as CourtKind)) return null;
  const lines = [...MEMO[card.kind as Exclude<GuideRole, "judge">]];
  if (card.kind === "juror" && (state.settings?.golden === "off" || card.golden_left === false)) lines[2] = "زرّك: «✋ أبي أسأل». وفي النهاية صوّت على كل متهم.";
  const stand = standPlan(state);
  const me = card.player_id ?? meId;
  const n = stand.findIndex((x) => x.c.player_id === me);
  const place =
    n >= 0
      ? `📍 أنت رقم ${n + 1} على المنصة${stand[n].at !== null ? `، يبدأ دورك عند ${mmss(stand[n].at ?? 0)} من كل جولة استجواب` : ""}.`
      : card.kind === "prosecutor"
        ? "📍 أنت أول من يسأل، وأول من يترافع."
        : card.kind === "lawyer"
          ? "📍 تسأل بعد المدعي، وتترافع بعده."
          : "📍 تسأل بعد المدعي والمحامي، بالضغط على «أبي أسأل».";
  return (
    <div className="grid gap-2 rounded-[22px] border-2 border-gold/60 bg-[linear-gradient(160deg,#2a1d08cc,#140c2bcc)] p-4">
      <p className="text-[14px] font-extrabold text-gold">🧠 احفظها وارفع راسك</p>
      <ol className="grid gap-1.5">
        {lines.map((x, i) => (
          <li key={x} className="flex gap-2 text-[15px] leading-7 text-ivory">
            <span className="btn-gold grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold">{i + 1}</span>
            <span>{x}</span>
          </li>
        ))}
      </ol>
      <p className="rounded-[12px] bg-violet-text/15 px-3 py-2 text-[14px] font-semibold leading-6 text-ivory">{place}</p>
      <p className="text-[12px] text-mist">وسرّك في البطاقة تحت: اقرأه مرة، ثم اقفل الجوال.</p>
    </div>
  );
}

/** A titled list, the building block of the guides. */
function GuideList({ title, items, tone = "mist" }: { title?: string; items: string[]; tone?: "mist" | "ivory" }) {
  if (!items.length) return null;
  return (
    <div className="grid gap-1">
      {title ? <p className="text-[13px] font-bold text-gold">{title}</p> : null}
      <ul className="grid gap-1">
        {items.map((x) => (
          <li key={x} className={cx("ms-4 list-disc text-[13px] leading-6", tone === "ivory" ? "text-ivory" : "text-mist")}>
            {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The accused names of the case, for the speech template. */
const accusedNames = (state: CourtState) =>
  state.accused?.length ? state.accused.map((a) => a.name) : (state.cast ?? []).filter((c) => c.kind === "accused").map((c) => c.name);

/**
 * «قالب المرافعة»: five parts in a minute for the prosecutor or the lawyer, with the seconds for each,
 * what to say, and an example with the case's names. Open while it is their turn.
 */
function SpeechGuide({ state, side, open = false, live = false }: { state: CourtState; side: "prosecutor" | "lawyer"; open?: boolean; live?: boolean }) {
  const sp = SPEECHES[side];
  const names = accusedNames(state);
  const total = sp.parts.reduce((n, x) => n + x.seconds, 0);
  // Five words to glance at while speaking; the hints and examples fold below.
  const words = (
    <ol className="grid gap-1.5">
      {sp.parts.map((x, i) => (
        <li key={x.title} className="flex items-center gap-2 rounded-[12px] bg-deep-2/60 px-3 py-2">
          <span className="btn-gold grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold">{i + 1}</span>
          <span className="flex-1 text-[17px] font-extrabold text-ivory">{x.title}</span>
          <span className="rounded-full bg-deep-2 px-2 text-[12px] font-semibold tabular-nums text-gold">{x.seconds} ث</span>
        </li>
      ))}
    </ol>
  );
  const more = (
    <details className="rounded-[12px] border border-line p-2.5">
      <summary className="cursor-pointer text-[13px] font-semibold text-mist">الشرح والأمثلة</summary>
      <ol className="mt-2 grid gap-2">
        {sp.parts.map((x, i) => (
          <li key={x.title} className="grid gap-0.5 text-[13px] leading-6">
            <span className="font-bold text-ivory">
              {i + 1}. {x.title}: <span className="font-normal text-mist">{x.hint}</span>
            </span>
            <span className="text-ivory">«{fillSpeech(x.example, names)}»</span>
          </li>
        ))}
      </ol>
      <div className="mt-2">
        <GuideList items={sp.tips} />
      </div>
    </details>
  );
  if (live)
    return (
      <div className="grid gap-2 rounded-[20px] border-2 border-gold bg-gold/10 p-3 shadow-glow-gold">
        <p className="text-[14px] font-bold text-gold">🎤 {sp.title} · قرابة {total} ثانية</p>
        {words}
        {more}
      </div>
    );
  return (
    <details className="rounded-[20px] border border-gold/40 bg-night/50 p-3" open={open}>
      <summary className="cursor-pointer text-[14px] font-bold text-gold">🎤 حضّر {sp.title} · قرابة {total} ثانية</summary>
      <div className="mt-2 grid gap-2">
        {words}
        {more}
      </div>
    </details>
  );
}

/**
 * «دليل دورك»: the mission, what to do now, the speech for the prosecutor and the lawyer, the plan
 * for every phase, habits that win and mistakes that lose, then the rules of objections and answers.
 */
function RoleGuide({ state, kind }: { state: CourtState; kind?: CourtKind | "judge" }) {
  if (!kind || !state.phase || state.phase === "over" || state.phase === "verdict") return null;
  const doc = ROLE_GUIDES[kind as GuideRole];
  if (!doc) return null;
  const phase = state.phase as GuidePhase;
  const now = phase === "intro" ? doc.first : (doc.phases[phase] ?? []);
  const phaseLabel = GUIDE_PHASES.find((x) => x.key === phase);
  const asks = state.phase === "question" && kind !== "accused" && kind !== "witness" && kind !== "judge" ? suggestQuestions(kind, state.stage) : [];
  const answers = kind === "judge" ? [] : answerRulesFor(kind);
  const objects = kind === "prosecutor" || kind === "lawyer";
  const dual = (state.accused?.length ?? 0) > 1;
  const golden = state.settings?.golden ?? "jurors";
  return (
    <details className="surface rounded-[20px] p-4">
      <summary className="cursor-pointer text-[15px] font-semibold text-ivory">📘 {kind === "judge" ? "دليل القاضي" : `الدليل الكامل لدورك: ${KINDS[kind].label}`}</summary>
      <div className="mt-3 grid gap-4">
        <p className="rounded-[14px] border border-line bg-deep-2/60 p-3 text-[14px] leading-6 text-ivory">🎯 {doc.mission}</p>
        {now.length ? (
          <div className="rounded-[14px] border border-gold/50 bg-gold/5 p-3">
            <GuideList title={phase === "intro" ? "⏱️ أول دقيقة" : `${phaseLabel?.icon ?? ""} الآن: ${phaseLabel?.label ?? ""}`} items={now} tone="ivory" />
          </div>
        ) : null}
        {dual ? (
          <p className="text-[13px] leading-6 text-gold">
            ⚖️ في القضية متهمان، ولكل واحد حكم مستقل وحقيقة مستقلة: {state.accused!.map((a) => a.name).join(" و")}.
            {kind === "accused" ? " تكسب 300 إذا بُرّئت أنت، مهما كان حكم الآخر." : ""}
          </p>
        ) : null}
        {kind === "juror" && golden === "off" ? <p className="text-[12px] leading-5 text-faint">لا سؤال ذهبي في هذه الجلسة.</p> : null}
        {asks.length ? <GuideList title="❓ أسئلة تقدر تبدأ بها" items={asks} /> : null}
        {objects ? <SpeechGuide state={state} side={kind} open={state.phase === "closing"} /> : null}
        <details className="rounded-[14px] border border-line bg-deep-2/40 p-3">
          <summary className="cursor-pointer text-[14px] font-semibold text-ivory">🗺️ خطتك مرحلة بمرحلة</summary>
          <ol className="mt-3 grid gap-3">
            {GUIDE_PHASES.map((x) => {
              const items = x.key === "intro" ? doc.first : (doc.phases[x.key] ?? []);
              if (!items.length) return null;
              return (
                <li key={x.key} className={cx("rounded-[12px] p-2", x.key === phase && "bg-gold/10")}>
                  <GuideList title={`${x.icon} ${x.label}${x.key === phase ? " (الآن)" : ""}`} items={items} />
                </li>
              );
            })}
          </ol>
        </details>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[14px] border border-correct/40 bg-correct-fill/10 p-3">
            <GuideList title="✅ افعل" items={doc.dos} />
          </div>
          <div className="rounded-[14px] border border-wrong/40 bg-wrong-fill/10 p-3">
            <GuideList title="⛔ تجنّب" items={doc.donts} />
          </div>
        </div>
        {objects || answers.length ? (
          <details className="rounded-[14px] border border-line bg-deep-2/40 p-3">
            <summary className="cursor-pointer text-[14px] font-semibold text-ivory">📏 القواعد</summary>
            <div className="mt-3 grid gap-3">
              {objects ? (
                <div className="grid gap-1">
                  <p className="text-[13px] font-bold text-gold">الاعتراض</p>
                  <p className="text-[13px] leading-6 text-mist">{OBJECTION_RULES.who}</p>
                  <GuideList items={[...OBJECTION_RULES.when]} />
                  <p className="text-[13px] leading-6 text-mist">
                    {systemJudge(state)
                      ? "المس «اعتراض!» ويصوّت المحلّفون والشهود والمحقق خلال 15 ثانية: الأكثرية تقبله فيُلغى السؤال وتأخذ 50 نقطة."
                      : OBJECTION_RULES.how}
                  </p>
                  <p className="text-[13px] font-semibold leading-6 text-ivory">{objectionHint(kind)}</p>
                </div>
              ) : null}
              {answers.length ? <GuideList title={kind === "accused" ? "إجابات المتهم" : "إجابات الشاهد"} items={answers} /> : null}
            </div>
          </details>
        ) : null}
        <p className="text-[12px] leading-5 text-faint">{ANSWER_RULES.general}</p>
      </div>
    </details>
  );
}

/** «كيف نبدأ»: what a player does from joining to the verdict. */
function StartGuide({ items, title, open = false }: { items: string[]; title: string; open?: boolean }) {
  return (
    <details className="surface rounded-[20px] p-4" open={open}>
      <summary className="cursor-pointer text-[15px] font-semibold text-ivory">{title}</summary>
      <ol className="mt-3 grid gap-2">
        {items.map((x, i) => (
          <li key={x} className="flex gap-2.5 text-[14px] leading-6 text-mist">
            <span className="btn-gold grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-bold">{i + 1}</span>
            <span>{x}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function useRun(roomId: string, reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (fn: string, args: Record<string, unknown> = {}) => {
      if (!supabase) return false;
      setBusy(true);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc(fn, { p_room_id: roomId, ...args });
      setBusy(false);
      if (rpcError) {
        const missing = rpcError.code === "PGRST202" || rpcError.code === "42883";
        setError(missing ? SETUP_HINT : "تعذّر تنفيذ الخطوة، حاول مرة أخرى.");
        return false;
      }
      const res = data as { ok: boolean; reason?: string; min?: number };
      if (!res?.ok) {
        setError((ERRORS[res?.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.") + (res?.min ? ` (${res.min} على الأقل)` : ""));
        return false;
      }
      await reload();
      return true;
    },
    [roomId, reload],
  );
  return { run, busy, error, setError };
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-center justify-center gap-1.5 text-center text-[14px] font-semibold text-wrong">
      <Glyph name="alert" className="size-4 shrink-0" />
      {error}
    </p>
  );
}

/**
 * The player's actions, in three parts so each sits where it belongs (court focus):
 * «top»: what needs reading now (the speech template, the jury's objection vote, the file's evidence);
 * «bar»: the buttons of the questioning, fixed at the bottom of the screen;
 * «ballot»: the vote alone, verdicts first, then the real culprit, then the best speech.
 */
function Actions({ roomId, state, card, reloadCard, part, inline = false }: { roomId: string; state: CourtState; card: MyCard | null; reloadCard: () => Promise<void>; part: "top" | "bar" | "ballot"; inline?: boolean }) {
  const { run, busy, error } = useRun(roomId, reloadCard);
  const [aiming, setAiming] = useState(false);
  if (!card?.kind) return null;
  const canObject = (card.kind === "prosecutor" || card.kind === "lawyer") && (state.phase === "question" || state.phase === "closing");
  const suspects = state.suspects ?? [];
  const me = card.player_id ?? "";
  const queue = state.queue ?? [];
  const place = queue.findIndex((q) => q.player_id === me);
  const asking = state.asking === me;
  const pendingObjection = state.objection?.status === "pending";
  const rates = card.kind !== "prosecutor" && card.kind !== "lawyer";
  // One verdict per accused (court_v5.sql); older servers have one accused and no list.
  const accusedList = state.accused?.length ? state.accused : null;
  const verdictOf = (key: string | null) => {
    if (!key) return card.vote;
    const v = card.verdicts?.[key];
    return v ?? (key === accusedList?.[0]?.key ? card.vote : null);
  };
  const ballots: Array<{ key: string | null; label: string }> =
    accusedList && accusedList.length > 1
      ? accusedList.map((a) => ({ key: a.key, label: `${a.name}؟` }))
      : [{ key: accusedList?.[0]?.key ?? null, label: "حكمك على المتهم؟" }];
  const voted = ballots.every((b) => verdictOf(b.key) !== null && verdictOf(b.key) !== undefined) && (!suspects.length || !!card.pick) && (!rates || !!card.pleading);

  if (part === "top")
    return (
      <>
        {state.phase === "closing" && (card.kind === "prosecutor" || card.kind === "lawyer") ? (
          state.side === card.kind ? (
            <SpeechGuide state={state} side={card.kind} open live />
          ) : state.side === "prosecutor" && card.kind === "lawyer" ? (
            <SpeechGuide state={state} side="lawyer" />
          ) : null
        ) : null}
        {systemJudge(state) && pendingObjection && (card.kind === "juror" || card.kind === "witness" || card.kind === "detective") && state.objection?.by !== me ? (
          <ObjectionVote state={state} mine={state.objection?.votes?.[me]} busy={busy} onVote={(v) => run("court_objection_vote", { p_accept: v })} />
        ) : null}
        {(state.phase === "question" || state.phase === "closing") && (card.exhibits ?? []).length ? (
          <details className="rounded-[20px] border border-gold/40 bg-night/50 p-3">
            <summary className="cursor-pointer text-[14px] font-bold text-gold">
              📎 أدلة في ملفك ({(card.exhibits ?? []).length - (card.exhibits_used ?? []).length} لم تُعرض)
            </summary>
            <div className="mt-2 grid gap-2">
              {(card.exhibits ?? []).map((x, i) => {
                const used = (card.exhibits_used ?? []).includes(i);
                return (
                  <div key={i} className={cx("grid gap-1 rounded-[14px] border p-2.5", used ? "border-line opacity-60" : "border-line-strong bg-deep-2/60")}>
                    <p className="text-[15px] font-bold text-ivory">
                      {x.icon || "📄"} {x.title}
                      {x.time ? <span dir="ltr" className="ms-2 text-[12px] text-gold">{x.time}</span> : null}
                    </p>
                    <p className="text-[13px] leading-6 text-mist">{x.text}</p>
                    <Button tone={used ? "quiet" : "primary"} className="min-h-10" disabled={busy || used} onClick={() => run("court_present", { p_index: i })}>
                      {used ? "قُدِّم" : "اعرضه على الشاشة"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </details>
        ) : null}
        <ErrorLine error={error} />
      </>
    );

  if (part === "bar") {
    if (state.phase !== "question" && !canObject) return null;
    return (
      <div className={cx("grid gap-2", !inline && "sticky bottom-0 z-20 -mx-1 rounded-t-[20px] border-t border-line bg-night/95 px-1 pt-2 pb-[max(10px,env(safe-area-inset-bottom))] backdrop-blur")}>
        {aiming ? (
          <div className="grid gap-2 rounded-[18px] border border-gold/60 bg-gold/10 p-3">
            <p className="text-center text-[15px] font-bold text-gold">⭐ من تستدعي؟ يجب أن يجيبك.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {(state.cast ?? [])
                .filter((c) => c.kind !== "juror")
                .map((c) => (
                  <button
                    key={c.player_id}
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (await run("court_golden", { p_target: c.player_id })) setAiming(false);
                    }}
                    className="min-h-11 rounded-full border border-gold/60 px-4 text-[14px] font-semibold text-ivory hover:bg-gold/15"
                  >
                    {KINDS[c.kind].icon} {c.name}
                  </button>
                ))}
            </div>
            <button type="button" className="text-[13px] text-mist underline" onClick={() => setAiming(false)}>
              إلغاء
            </button>
          </div>
        ) : null}
        {state.phase === "question" ? (
          asking ? (
            <Button tone="primary" className="beat min-h-14 text-[17px]" disabled={busy} onClick={() => run("court_raise", { p_on: false })}>
              🎙️ دورك تسأل · ✅ انتهى سؤالي
            </Button>
          ) : (
            <Button tone={place >= 0 ? "quiet" : "primary"} className="min-h-14 text-[17px]" disabled={busy} onClick={() => run("court_raise", { p_on: place < 0 })}>
              {place >= 0 ? `✋ أنت رقم ${place + 1} في الدور · إلغاء` : "✋ أبي أسأل"}
            </Button>
          )
        ) : null}
        {(state.phase === "question" && card.golden_left && !aiming) || canObject ? (
          <div className="flex gap-2">
            {state.phase === "question" && card.golden_left && !aiming ? (
              <Button tone="quiet" className="min-h-11 flex-1 border-gold/60 text-[14px] text-gold" disabled={busy} onClick={() => setAiming(true)}>
                ⭐ السؤال الذهبي
              </Button>
            ) : null}
            {canObject ? (
              <Button tone="danger" className="min-h-11 flex-1 text-[14px]" disabled={busy || pendingObjection || (card.objections_left ?? 0) <= 0} onClick={() => run("court_object")}>
                ✋ اعتراض! ({card.objections_left ?? 0})
              </Button>
            ) : null}
          </div>
        ) : null}
        <ErrorLine error={error} />
      </div>
    );
  }

  // part === "ballot"
  if (state.phase !== "vote") return null;
  if (card.kind === "accused") return <Note>المحلفون يصوّتون الآن على مصيرك… ({state.votes_count ?? 0} من {state.voters_count ?? 0})</Note>;
  const step = (n: number, title: string, done: boolean) => (
    <p className="flex items-center gap-2 text-[16px] font-bold text-ivory">
      <span className={cx("grid size-6 shrink-0 place-items-center rounded-full text-[12px]", done ? "bg-correct text-night" : "btn-gold")}>{done ? "✓" : n}</span>
      {title}
    </p>
  );
  let n = 0;
  return (
    <div className="grid gap-4 rounded-[22px] border border-gold/40 bg-night/60 p-4">
      {ballots.map((b) => {
        const mine = verdictOf(b.key);
        n += 1;
        return (
          <div key={b.key ?? "one"} className="grid gap-2">
            {step(n, b.key && ballots.length > 1 ? `حكمك على ${b.label}` : b.label, mine !== null && mine !== undefined)}
            <div className="grid grid-cols-2 gap-3">
              {[
                { v: true, label: "مذنب", on: "border-wrong bg-wrong-fill/30 text-wrong", hover: "hover:border-wrong/70" },
                { v: false, label: "بريء", on: "border-correct bg-correct-fill/30 text-correct", hover: "hover:border-correct/70" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  disabled={busy}
                  aria-pressed={mine === o.v}
                  onClick={() => run("court_vote", b.key ? { p_guilty: o.v, p_accused: b.key } : { p_guilty: o.v })}
                  className={cx("min-h-16 rounded-[18px] border-2 font-display text-[22px] font-extrabold transition", mine === o.v ? o.on : cx("border-line-strong/70 bg-deep-2/60 text-ivory", o.hover))}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {suspects.length ? (
        <div className="grid gap-2">
          {step(++n, "من الفاعل الحقيقي؟ (+150)", !!card.pick)}
          <div className="grid gap-2 sm:grid-cols-2">
            {suspects.map((x) => (
              <button
                key={x.key}
                type="button"
                disabled={busy}
                aria-pressed={card.pick === x.key}
                onClick={() => run("court_vote", { p_culprit: x.key })}
                className={cx("min-h-12 rounded-[16px] border-2 px-3 text-[16px] font-bold transition", card.pick === x.key ? "border-gold bg-gold/15 text-gold" : "border-line-strong/70 bg-deep-2/60 text-ivory hover:border-gold/60")}
              >
                {x.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {rates ? (
        <div className="grid gap-2">
          {step(++n, "أقنعتك مرافعة مين؟ (+50 لصاحبها)", !!card.pleading)}
          <div className="grid grid-cols-2 gap-3">
            {(["prosecutor", "lawyer"] as const).map((k) => (
              <button
                key={k}
                type="button"
                disabled={busy}
                aria-pressed={card.pleading === k}
                onClick={() => run("court_vote", { p_pleading: k })}
                className={cx("min-h-12 rounded-[16px] border-2 text-[16px] font-bold transition", card.pleading === k ? "border-gold bg-gold/15 text-gold" : "border-line-strong/70 bg-deep-2/60 text-ivory hover:border-gold/60")}
              >
                {KINDS[k].icon} {KINDS[k].label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <p className={cx("rounded-[14px] p-2 text-center text-[14px] font-bold", voted ? "bg-correct-fill/20 text-correct" : "text-mist")}>
        {voted ? "✅ اكتمل صوتك. تقدر تغيّره حتى يُعلن الحكم." : "صوتك سري حتى النهاية."} ({state.votes_count ?? 0} من {state.voters_count ?? 0})
      </p>
      <ErrorLine error={error} />
    </div>
  );
}

/** With the system as judge: the jury rules on an objection, in 15 seconds. */
function ObjectionVote({ state, mine, busy, onVote }: { state: CourtState; mine?: boolean; busy: boolean; onVote: (accept: boolean) => Promise<boolean> }) {
  const o = state.objection;
  const at = o?.at ? Date.parse(o.at) : 0;
  const left = useSecondsLeft(at ? new Date(at + objectionMs(state)).toISOString() : null);
  if (!o) return null;
  return (
    <div className="beat grid gap-2 rounded-[20px] border-2 border-wrong bg-[#2b0f1d] p-3 text-center">
      <p className="text-[17px] font-extrabold text-wrong">
        ✋ اعتراض من {KINDS[o.kind]?.label}! تقبله؟
      </p>
      <p className="text-[13px] text-mist">أنتم القضاة هنا: الأكثرية تقبله فيُلغى السؤال. {left !== null ? `باقي ${left} ث.` : ""}</p>
      <div className="grid grid-cols-2 gap-2">
        {[
          { v: true, label: "👍 مقبول" },
          { v: false, label: "👎 مرفوض" },
        ].map((x) => (
          <button
            key={x.label}
            type="button"
            disabled={busy}
            aria-pressed={mine === x.v}
            onClick={() => onVote(x.v)}
            className={cx("min-h-12 rounded-[16px] border-2 text-[16px] font-bold transition", mine === x.v ? "border-gold bg-gold/15 text-gold" : "border-line-strong/70 bg-deep-2/60 text-ivory hover:border-gold/60")}
          >
            {x.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TurnClock({ since, big = false, ms = 45000 }: { since?: string | null; big?: boolean; ms?: number }) {
  const left = useSecondsLeft(since ? new Date(Date.parse(since) + ms).toISOString() : null);
  if (left === null) return null;
  return (
    <span dir="ltr" className={cx("rounded-full border px-2 font-display font-bold tabular-nums", left <= 10 ? "border-wrong/60 text-wrong" : "border-line-strong text-mist", big ? "text-[clamp(14px,1.5vw,30px)]" : "text-[13px]")}>
      {left}s
    </span>
  );
}

/** The first-time intro for a court role: the role, how the session runs, how to score. */
function courtIntro(kind: CourtKind, win?: Win | null): IntroStep[] {
  const k = KINDS[kind];
  return [
    { icon: k.icon, title: `دورك: ${k.label}`, text: kind === "juror" ? "تستمع للقضية والأدلة، وتسأل، ثم تصوّت. ومعلومتك (إن وصلتك) في بطاقتك." : "معلوماتك السرية في بطاقتك: المس البطاقة مطوّلًا لتقرأها، ولا تُرِها لأحد." },
    { icon: "⚖️", title: "كيف تجري الجلسة", text: `القضية ← الأدلة ← الاستجواب ← المرافعة ← التصويت ← الحقيقة. في الاستجواب: ${phaseGuide(kind, "question")}` },
    { icon: "🏆", title: "كيف تكسب النقاط", text: winText(kind, win) },
  ];
}

/** Everything after the start, for a phone: the host's (when the host plays) and the players'. */
function PlayView({ roomId, state, meId, card, reloadCard, host = false }: { roomId: string; state: CourtState; meId: string | null; card: MyCard | null; reloadCard: () => Promise<void>; host?: boolean }) {
  // New information is announced with a vibration until the next phase.
  const laterSeen = useRef<string | null>(null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (card?.later && card.later !== laterSeen.current) {
      laterSeen.current = card.later;
      setFresh(true);
      vibrate([100, 60, 100]);
    }
  }, [card?.later]);
  useEffect(() => {
    if (state.phase !== "evidence") setFresh(false);
  }, [state.phase]);
  const over = state.phase === "over";

  // Three tabs keep the phone short: the role, the evidence, the session. The tab follows the phase,
  // and the player can switch freely until the next phase.
  type Tab = "role" | "evidence" | "session";
  const phaseTab = (p?: string): Tab => (p === "evidence" ? "evidence" : p === "question" || p === "closing" || p === "verdict" ? "session" : "role");
  const [tab, setTab] = useState<Tab>(() => phaseTab(state.phase));
  const evidenceCount = (state.evidence ?? []).length;
  const seenEvidence = useRef(evidenceCount);
  const [newEvidence, setNewEvidence] = useState(false);
  useEffect(() => {
    setTab(phaseTab(state.phase));
  }, [state.phase, state.step]);
  useEffect(() => {
    if (evidenceCount > seenEvidence.current && tab !== "evidence") setNewEvidence(true);
    seenEvidence.current = evidenceCount;
  }, [evidenceCount, tab]);
  useEffect(() => {
    if (tab === "evidence") setNewEvidence(false);
  }, [tab]);

  if (over)
    return (
      <div className="grid gap-4">
        <PresentedFlash state={state} />
        <VerdictCard state={state} />
        <TruthCard state={state} />
        <GoalVotes roomId={roomId} state={state} card={card} reloadCard={reloadCard} />
        <EveningBoard state={state} />
        <PointsTable state={state} meId={meId} />
        <CardsReveal state={state} />
      </div>
    );

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "role", label: "🃏 دوري" },
    { key: "evidence", label: `📁 الأدلة${evidenceCount ? ` (${evidenceCount})` : ""}` },
    { key: "session", label: "🎙️ الجلسة" },
  ];
  const me = card?.player_id ?? meId;
  const flashes = (
    <>
      {card?.started && card.kind ? <GameIntro game="court" role={card.kind} steps={courtIntro(card.kind, card.win)} /> : null}
      {host ? null : <ObjectionFlash state={state} />}
      <CourtFlash state={state} />
      <PresentedFlash state={state} />
    </>
  );
  // The vote: the ballot and nothing else.
  if (state.phase === "vote" && card?.kind)
    return (
      <div className="grid gap-3">
        {flashes}
        <Actions roomId={roomId} state={state} card={card} reloadCard={reloadCard} part="ballot" />
      </div>
    );
  const onStand = state.phase === "question" && !!me && state.stand === me;
  return (
    <div className="grid gap-3">
      {flashes}
      {state.phase === "verdict" ? <VerdictCard state={state} /> : null}
      {onStand ? <p className="beat rounded-[16px] border-2 border-gold bg-gold/15 p-3 text-center text-[17px] font-extrabold text-gold">🎙️ أنت على المنصة الحين: أجب باختصار</p> : null}
      <Actions roomId={roomId} state={state} card={card} reloadCard={reloadCard} part="top" />
      <div role="tablist" aria-label="أقسام الجلسة" className="sticky top-0 z-10 grid grid-cols-3 gap-1 rounded-[16px] border border-line bg-night/90 p-1 backdrop-blur">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cx("relative min-h-11 rounded-[12px] text-[14px] font-bold transition", tab === t.key ? "btn-gold" : "text-mist hover:text-ivory")}
          >
            {t.label}
            {t.key === "evidence" && newEvidence ? <span className="absolute end-2 top-2 size-2 rounded-full bg-wrong" aria-label="أدلة جديدة" /> : null}
          </button>
        ))}
      </div>
      {tab === "role" ? (
        <div role="tabpanel" className="grid gap-3">
          {card?.started ? <MemoCard state={state} card={card} meId={meId} /> : null}
          {card?.started ? <RoleCard card={card} fresh={fresh} /> : null}
          {card?.started ? <RoleGuide state={state} kind={card.kind} /> : null}
          {card?.started ? <Notes roomId={roomId} caseId={state.case?.id} /> : null}
        </div>
      ) : null}
      {tab === "evidence" ? (
        <div role="tabpanel" className="grid gap-3">
          <div className="surface grid gap-2 rounded-[20px] p-4">
            <p className="text-[13px] font-bold text-gold">القضية</p>
            <p className="text-[15px] leading-7 text-ivory">{state.case?.intro}</p>
          </div>
          {evidenceCount ? (
            <>
              <Timeline items={state.evidence ?? []} stage={state.phase === "evidence" ? state.stage : undefined} />
              <EvidenceGrid items={state.evidence ?? []} stage={state.phase === "evidence" ? state.stage : undefined} compact />
            </>
          ) : (
            <Note>الأدلة تظهر هنا مع كل جولة.</Note>
          )}
        </div>
      ) : null}
      {tab === "session" ? (
        <div role="tabpanel" className="grid gap-3">
          {state.phase === "closing" ? <ClosingBanner state={state} /> : <SessionPlan state={state} meId={me} />}
        </div>
      ) : null}
      <Actions roomId={roomId} state={state} card={card} reloadCard={reloadCard} part="bar" />
    </div>
  );
}

/* ---------------- Host ---------------- */

type CaseItem = {
  id: string;
  title: string;
  category: string | null;
  difficulty: number;
  summary: string;
  min: number;
  roles: number;
  versions?: number;
  accused?: number;
  parts?: Array<{ k: string; o: boolean }>;
  /** Evidence rounds and evidence count (court_cases_v7.sql): how long the case takes. */
  stages?: number;
  evidence?: number;
};

/**
 * Rough length of a session, in minutes: reading the case and the cards (2 minutes), each evidence
 * round (reading, about 12 seconds an item, then the questioning timer), the two closing speeches,
 * the vote, and the verdict with the truth and the cards (2.5 minutes). A second accused adds a
 * verdict to vote on and a truth to read. Talk runs over the timers: real sessions took about 1.3×.
 * Without a case: two rounds of seven items. The quick session puts every item in one round.
 */
export function estimateMinutes({ quick, q, c, v, stages = 2, evidence = 7, accused = 1 }: { quick: boolean; q: number; c: number; v: number; stages?: number; evidence?: number; accused?: number }) {
  const rounds = quick ? 1 : Math.max(1, stages);
  const read = quick ? Math.max(60, evidence * 10) : Math.max(45, Math.ceil(evidence / rounds) * 12);
  const qs = quick ? 120 : q || 150;
  const cs = quick ? 30 : c || 60;
  const vs = (quick ? 30 : v || 45) + (accused > 1 ? 30 : 0);
  const end = 150 + (accused > 1 ? 30 : 0);
  const minutes = ((120 + rounds * (read + qs) + 2 * cs + vs + end) * 1.3) / 60;
  return minutes < 20 ? Math.round(minutes) : Math.round(minutes / 5) * 5;
}
const LEVEL = ["", "سهلة", "متوسطة", "صعبة"];
const roundsText = (n: number) => (n === 1 ? "جولة أدلة واحدة" : n === 2 ? "جولتا أدلة" : `${n} جولات أدلة`);

export function CourtHostPanel({ roomId, tools }: { roomId: string; tools?: ReactNode }) {
  const { state, players, reload } = useCourtLive(roomId);
  const { card, reload: reloadCard } = useMyCard(roomId, state);
  const { run, busy, error } = useRun(roomId, reload);
  useCourtCues(state, { sound: true });
  useTimeUpCue(state, true);
  useAutoTick(roomId, state, 700);
  const me = players.find((p) => p.is_host) ?? null;

  // A case the host generated and reviewed (court_v5.sql): saved inactive for the admin, then played.
  const startCustom = async (settings: CourtSettings, c: CourtCase, source: "ai" | "room"): Promise<string | null> => {
    if (!supabase) return "تعذّر الاتصال.";
    // Older servers ignore custom_case and would deal a random case instead: check first.
    const probe = await supabase.rpc("court_ai_quota");
    if (probe.error && (probe.error.code === "PGRST202" || probe.error.code === "42883")) return "قضايا الغرف تحتاج تشغيل ملف court_v5.sql في supabase.";
    const { id: _id, is_active: _a, variants: _v, ...rest } = c;
    const { data, error: e } = await supabase.rpc("court_start", { p_room_id: roomId, p_settings: { ...settings, case_id: null, custom_case: { ...rest, source } } });
    if (e) return e.code === "PGRST202" || e.code === "42883" ? SETUP_HINT : "تعذّر بدء الجلسة، حاول مرة أخرى.";
    const res = data as { ok: boolean; reason?: string; detail?: string; min?: number };
    if (!res?.ok) {
      return `${ERRORS[res?.reason ?? ""] ?? "تعذّر بدء الجلسة."}${res?.detail ? ` ${res.detail}` : ""}${res?.min ? ` (${res.min} على الأقل)` : ""}`;
    }
    await reload();
    return null;
  };

  if (!isCourt(state) || !state.phase)
    return (
      <>
        {tools}
        <CourtSetup state={state} players={players} busy={busy} error={error} onStart={(settings) => run("court_start", { p_settings: settings })} onStartCustom={startCustom} />
      </>
    );

  // Someone else judges: a player drawn by lot, or the system (court_v9.sql). The host's tools fold.
  const judgeIsOther = (!!state.judge_id && state.judge_id !== me?.id) || systemJudge(state);
  const over = state.phase === "over";
  const controls = <JudgeControls state={state} players={players} run={run} busy={busy} error={error} />;
  // The host judges and plays a role: one screen, the judge's tools first and the card folded below.
  const judgePlaying = !judgeIsOther && !!card?.started && !card.judge && !over;
  // During the case the room tools (share, TV, players) fold into one line under the session.
  const toolsView = tools ? (
    over ? (
      tools
    ) : (
      <details className="surface mx-auto w-full max-w-3xl rounded-[20px] p-3">
        <summary className="cursor-pointer text-[14px] font-bold text-mist">⋯ أدوات الغرفة (المشاركة، التلفزيون، اللاعبون)</summary>
        <div className="mt-3">{tools}</div>
      </details>
    )
  ) : null;
  return (
    <>
    {over ? toolsView : null}
    <section className="mx-auto mt-2 grid max-w-3xl gap-4">
      {judgeIsOther ? (
        <>
          <div className="surface grid gap-2 rounded-[24px] p-4">
            <CaseHeader state={state} />
            <p className="text-center text-[14px] text-mist">
              {systemJudge(state)
                ? "🤖 القاضي هو النظام: ينقل الجلسة ويعطي الأدوار والهيئة تحسم الاعتراضات. العب معهم براحتك."
                : `⚖️ القاضي ${state.judge_name} يدير الجلسة من جواله.`}
            </p>
          </div>
          <details className="surface rounded-[20px] p-4">
            <summary className="cursor-pointer text-[15px] font-semibold text-ivory">
              {systemJudge(state) ? "🛠️ أدوات احتياطية (إيقاف الوقت، التالي، استبدال لاعب)" : "🛠️ أدوات احتياطية (إذا تعطّل جوال القاضي)"}
            </summary>
            <div className="mt-3 grid gap-4">{controls}</div>
          </details>
        </>
      ) : (
        controls
      )}
      {judgePlaying && card ? (
        <>
          <MyCardFold roomId={roomId} state={state} card={card} reloadCard={reloadCard} />
          <Spectator state={state} judge />
        </>
      ) : card?.started && !card.judge ? (
        <PlayView roomId={roomId} state={state} meId={me?.id ?? null} card={card} reloadCard={reloadCard} host={!judgeIsOther} />
      ) : (
        <Spectator state={state} judge={!judgeIsOther} />
      )}
      {over ? <ResultShare result={courtShare(state)} fileName="al3sh-court.png" /> : null}
    </section>
    {over ? null : toolsView}
    </>
  );
}

/** The judge's own role, when the host judges and plays: the actions at hand, the card folded. */
function MyCardFold({ roomId, state, card, reloadCard }: { roomId: string; state: CourtState; card: MyCard; reloadCard: () => Promise<void> }) {
  return (
    <div className="grid gap-3">
      {/* The role's introduction only before the first step, so it never covers the judge's tools mid-session. */}
      {state.phase === "intro" && card.kind ? <GameIntro game="court" role={card.kind} steps={courtIntro(card.kind, card.win)} /> : null}
      <Actions roomId={roomId} state={state} card={card} reloadCard={reloadCard} part="top" />
      <Actions roomId={roomId} state={state} card={card} reloadCard={reloadCard} part="ballot" />
      <Actions roomId={roomId} state={state} card={card} reloadCard={reloadCard} part="bar" inline />
      <details className="surface rounded-[20px] p-4">
        <summary className="cursor-pointer text-[15px] font-semibold text-ivory">
          🃏 بطاقتي ودوري <span className="text-[13px] font-normal text-mist">({card.kind_ar}{card.name ? `: ${card.name}` : ""})</span>
        </summary>
        <div className="mt-3 grid gap-3">
          <RoleCard card={card} fresh={false} />
          <RoleGuide state={state} kind={card.kind} />
          <Notes roomId={roomId} caseId={state.case?.id} />
        </div>
      </details>
    </div>
  );
}

/** What someone without a role sees (the judge, or a host who only runs the session). */
function Spectator({ state, judge = false }: { state: CourtState; judge?: boolean }) {
  const over = state.phase === "over";
  // The judge has the objection and the questioning in their own panels above.
  return (
    <>
      {judge ? null : <ObjectionFlash state={state} />}
      <CourtFlash state={state} />
      <PresentedFlash state={state} />
      {judge || state.phase !== "question" ? null : <SessionPlan state={state} />}
      {state.phase === "closing" ? <ClosingBanner state={state} /> : null}
      {state.phase === "verdict" || over ? <VerdictCard state={state} /> : null}
      {over ? (
        <>
          <TruthCard state={state} />
          <EveningBoard state={state} />
          <PointsTable state={state} />
          <CardsReveal state={state} />
        </>
      ) : null}
      {state.phase === "intro" ? <Note>{state.case?.intro}</Note> : null}
      {state.phase === "intro" ? <SessionPlan state={state} /> : null}
      {/* The evidence is on the TV: here it folds, except while a round is being read. */}
      {!over && (state.evidence ?? []).length ? (
        <details className="surface rounded-[20px] p-4" open={state.phase === "evidence" && !judge}>
          <summary className="cursor-pointer text-[15px] font-semibold text-ivory">📁 الأدلة ({(state.evidence ?? []).length})</summary>
          <div className="mt-3 grid gap-3">
            <Timeline items={state.evidence ?? []} stage={state.phase === "evidence" ? state.stage : undefined} />
            <EvidenceGrid items={state.evidence ?? []} stage={state.phase === "evidence" ? state.stage : undefined} compact />
          </div>
        </details>
      ) : null}
    </>
  );
}

/** What the judge says aloud now, in their own voice: one line per phase (the session is spoken in a diwaniya). */
function judgeLine(state: CourtState): string {
  const cast = state.cast ?? [];
  const of = (k: CourtKind) => cast.filter((c) => c.kind === k);
  switch (state.phase) {
    case "intro": {
      const accused = of("accused");
      const pros = of("prosecutor")[0];
      const law = of("lawyer")[0];
      return `محكمة! تُفتح الآن جلسة قضية «${state.case?.title ?? ""}». ${accused.length > 1 ? "المتهمان" : "المتهم"}: ${accused.map((c) => `${c.name} (${c.player_name})`).join(" و")}.${pros ? ` الادعاء: ${pros.player_name}.` : ""}${law ? ` الدفاع: ${law.player_name}.` : ""} اقرؤوا بطاقاتكم بصمت، ولا يكشف أحد سرّه.`;
    }
    case "evidence":
      return `أمام المحكمة أدلة الجولة ${state.stage ?? 1}. اقرؤوها على الشاشة بتمعّن، وكل طرف يدوّن ما يخدمه.`;
    case "question": {
      const stand = cast.find((c) => c.player_id === state.stand);
      return `بدأ الاستجواب. من عنده سؤال يضغط «أبي أسأل»، والكلام بإذن المحكمة.${stand ? ` ${stand.name}، تفضّل إلى المنصة وأجب بما تعرفه.` : ""}`;
    }
    case "closing": {
      const side = state.side ?? "prosecutor";
      const who = of(side)[0];
      return `${side === "prosecutor" ? "الكلمة للمدعي العام" : "الكلمة للدفاع"}${who ? `، ${who.player_name}` : ""}. تفضّل بمرافعتك، والجميع يستمع بلا مقاطعة.`;
    }
    case "vote":
      return "انتهت المرافعات. على هيئة المحلفين أن تحكم: مذنب أم بريء؟ صوّتوا من جوالاتكم، والأصوات سرية.";
    case "verdict": {
      const list = state.verdict?.list ?? [];
      if (list.length > 1) return `بعد المداولة، حكمت هيئة المحلفين: ${list.map((a) => `${a.name} ${a.guilty ? "مذنب" : "بريء"}`).join("، و")}.`;
      const v = state.verdict;
      if (!v) return "";
      return `بعد المداولة، حكمت هيئة المحلفين بأن المتهم ${v.guilty ? "مذنب" : "بريء"}، بـ ${v.guilty ? v.votes_guilty : v.votes_innocent} مقابل ${v.guilty ? v.votes_innocent : v.votes_guilty}.${v.votes_guilty === v.votes_innocent ? " والتعادل لصالح المتهم." : ""}`;
    }
    case "over":
      return "رُفعت الجلسة. والآن… الحقيقة على الشاشة.";
    default:
      return "";
  }
}

const SCRIPT_KEY = "al3sh.court.script";

/** «📜 قل الآن»: the judge's line for this phase. Hidden or shown, remembered on this device. */
function JudgeScript({ state }: { state: CourtState }) {
  const [on, setOn] = useState(true);
  const [more, setMore] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SCRIPT_KEY) === "off") setOn(false);
    } catch {
      // Private mode: shown.
    }
  }, []);
  const toggle = (next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(SCRIPT_KEY, next ? "on" : "off");
    } catch {
      // Private mode: for this visit only.
    }
  };
  const line = judgeLine(state);
  if (!line) return null;
  if (!on)
    return (
      <button type="button" className="justify-self-start text-[13px] font-semibold text-gold underline-offset-4 hover:underline" onClick={() => toggle(true)}>
        📜 نص القاضي
      </button>
    );
  return (
    <div className="grid gap-1 rounded-[16px] border border-gold/40 bg-gold/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold text-gold">📜 قل بصوتك</span>
        <span className="flex gap-3">
          <button type="button" className="text-[12px] text-gold" onClick={() => setMore(!more)}>
            {more ? "أقل" : "المزيد"}
          </button>
          <button type="button" className="text-[12px] text-mist hover:text-ivory" onClick={() => toggle(false)}>
            إخفاء
          </button>
        </span>
      </div>
      <p className={cx("text-[15px] leading-7 text-ivory", !more && "line-clamp-1")}>«{line}»</p>
    </div>
  );
}

/** «↩️ تراجع»: for 10 seconds after «التالي» (court_v8.sql). Counted from when this screen saw it, so clocks need not agree. */
function useUndoLeft(state: CourtState) {
  const u = state.undo;
  const valid = !!u && u.step === state.step && state.phase !== "over";
  const seen = useRef<{ at: string; local: number } | null>(null);
  if (valid && u && seen.current?.at !== u.at) {
    // A step taken long ago (a page opened later) is not offered.
    const age = Date.now() - Date.parse(u.at);
    seen.current = { at: u.at, local: age > 15000 || age < -15000 ? 0 : Date.now() };
  }
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!valid) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 500);
    const stop = window.setTimeout(() => window.clearInterval(t), 11000);
    return () => {
      window.clearInterval(t);
      window.clearTimeout(stop);
    };
  }, [valid, u?.at]);
  if (!valid || !seen.current?.local) return 0;
  return Math.max(0, Math.ceil((seen.current.local + 10000 - now) / 1000));
}

/** The judge's tools: the host's, or a player's when the judge was drawn by lot. */
function JudgeControls({
  state,
  players,
  run,
  busy,
  error,
}: {
  state: CourtState;
  players: Player[];
  run: (fn: string, args?: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  error: string | null;
}) {
  const steps = state.steps ?? [];
  const step = state.step ?? 0;
  const next = steps[step + 1];
  const over = state.phase === "over";
  const left = useStepLeft(state);
  const undoLeft = useUndoLeft(state);
  const matches = state.settings?.evening?.matches ?? 0;
  const present = new Set(players.map((p) => p.id));
  const someoneLeft = (state.cast ?? []).some((c) => !present.has(c.player_id));
  const eveningOn = state.flash?.kind === "evening" && Date.now() - Date.parse(state.flash.at) < 15000;

  // A pending objection asks for the judge at once: a buzz, and the panel stays at the top.
  const buzzed = useRef<string | null>(null);
  useEffect(() => {
    const o = state.objection;
    if (o?.status !== "pending" || !o.at || buzzed.current === o.at) return;
    buzzed.current = o.at;
    if (Date.now() - Date.parse(o.at) < 8000) vibrate([200, 80, 200]);
  }, [state.objection?.at, state.objection?.status]);

  const goNext = () => {
    if (state.phase === "vote" && !(state.votes_count ?? 0) && !window.confirm("لم يصوّت أحد! إذا أعلنت الحكم الآن يُبرّأ المتهم بلا أصوات، ولا يأخذ أحد نقاط الحكم. تعلنه الآن؟")) return;
    if (["evidence", "question", "closing"].includes(state.phase ?? "") && left !== null && left > 15 && !window.confirm(`باقي ${mmss(left)} على هذه المرحلة. تنتقل الآن؟`)) return;
    void run("court_next", { p_step: step });
  };

  return (
    <>
      {state.objection?.status === "pending" ? (
        <div className="sticky top-2 z-30">
          <RulingPanel state={state} busy={busy} onRule={(accept) => run("court_rule", { p_accept: accept })} />
        </div>
      ) : null}

      <div className="surface grid gap-3 rounded-[24px] p-4">
        <CaseHeader state={state} />
        <JudgeScript state={state} />
        {!over ? (
          <Button tone="primary" className="min-h-14 text-[18px]" disabled={busy} onClick={goNext}>
            {nextAction(next)}
            <Glyph name="forward" />
          </Button>
        ) : null}
        {undoLeft > 0 ? (
          <button
            type="button"
            disabled={busy}
            className="mx-auto min-h-10 rounded-full border border-line-strong/70 px-4 text-[14px] font-semibold text-ivory hover:border-gold"
            onClick={() => void run("court_undo", { p_step: step })}
          >
            ↩️ تراجع عن «{stepLabel(steps[step])}» <span className="tabular-nums text-mist">({undoLeft})</span>
          </button>
        ) : null}
        {state.phase === "vote" ? (
          <p className="text-center text-[14px] text-mist">
            صوّت {state.votes_count ?? 0} من {state.voters_count ?? 0}. يُعلن وحده إذا اكتملوا.
          </p>
        ) : state.settings?.auto && !over && state.ends_at ? (
          <p className="text-center text-[13px] text-mist">⏩ الانتقال تلقائي حين ينتهي الوقت.</p>
        ) : null}
        <TimerControls state={state} busy={busy} run={run} />
        <ErrorLine error={error} />
      </div>

      {state.phase === "question" ? <QuestioningPanel state={state} busy={busy} run={run} /> : null}

      {/* A player left: the replacement shows at once. Otherwise it waits in the tools. */}
      {!over && state.phase !== "verdict" && someoneLeft ? <ReplacePanel state={state} players={players} busy={busy} onReplace={(from, to) => run("court_replace", { p_from: from, p_to: to })} /> : null}

      {over && (state.goals ?? []).length ? <GoalsPanel state={state} busy={busy} onToggle={(id, on) => run("court_goal", { p_player_id: id, p_on: on })} /> : null}

      {!over ? (
        <details className="surface rounded-[20px] p-4">
          <summary className="cursor-pointer text-[15px] font-semibold text-ivory">⋯ أدوات القاضي</summary>
          <div className="mt-3 grid gap-3">
            <Button tone="quiet" className="min-h-12" disabled={busy} onClick={() => run("court_flash", { p_kind: "order" })}>
              🔨 نظام في المحكمة!
            </Button>
            {state.phase !== "verdict" && !someoneLeft ? <ReplacePanel state={state} players={players} busy={busy} onReplace={(from, to) => run("court_replace", { p_from: from, p_to: to })} /> : null}
            {matches > 0 ? (
              <details className="rounded-[16px] border border-line p-3">
                <summary className="cursor-pointer text-[14px] font-semibold text-ivory">🌙 ترتيب السهرة</summary>
                <div className="mt-3 grid gap-3">
                  <EveningBoard state={state} min={1} />
                  <Button tone="quiet" className="min-h-11" disabled={busy} onClick={() => run("court_flash", { p_kind: eveningOn ? "hide" : "evening" })}>
                    {eveningOn ? "أخفِه من الشاشات" : "📺 اعرضه على الشاشات (15 ث)"}
                  </Button>
                </div>
              </details>
            ) : null}
            <RoleGuide state={state} kind="judge" />
            <button
              type="button"
              disabled={busy}
              className="mx-auto min-h-11 rounded-full border border-wrong/50 px-5 text-[14px] font-semibold text-wrong hover:bg-wrong-fill/20"
              onClick={() => {
                if (window.confirm("إنهاء هذه القضية الآن؟ تُلغى الأدوار والأصوات بلا نقاط، وترجعون لشاشة الإعداد. ترتيب السهرة يبقى كما هو.")) void run("court_reset", { p_new_evening: false });
              }}
            >
              ⏹️ إنهاء القضية
            </button>
          </div>
        </details>
      ) : null}

      {over ? (
        <div className="grid gap-2">
          <Button tone="primary" className="min-h-14 text-[17px]" disabled={busy} onClick={() => run("court_reset", { p_new_evening: false })}>
            <Glyph name="refresh" />
            قضية جديدة (يكمل ترتيب السهرة)
          </Button>
          <button
            type="button"
            disabled={busy}
            className="text-[13px] text-mist underline-offset-4 hover:text-ivory hover:underline"
            onClick={() => {
              if (window.confirm("سهرة جديدة؟ يُمسح ترتيب السهرة ونقاط اللاعبين.")) void run("court_reset", { p_new_evening: true });
            }}
          >
            سهرة جديدة (تصفير الترتيب)
          </button>
        </div>
      ) : null}
    </>
  );
}

/** Pause and resume the timers of the step, or give 30 more seconds (court_v6.sql). */
function TimerControls({ state, busy, run }: { state: CourtState; busy: boolean; run: (fn: string, args?: Record<string, unknown>) => Promise<boolean> }) {
  if (!["evidence", "question", "closing", "vote"].includes(state.phase ?? "")) return null;
  const paused = isPaused(state);
  const timed = !!state.ends_at || (paused && state.paused?.left !== null && state.paused?.left !== undefined);
  if (!timed && !paused && !state.asking) return null;
  const step = state.step ?? 0;
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button tone={paused ? "primary" : "quiet"} className="min-h-12" disabled={busy} onClick={() => run("court_timer", { p_step: step, p_action: paused ? "resume" : "pause" })}>
        {paused ? "▶️ استئناف الوقت" : "⏸️ إيقاف الوقت"}
      </Button>
      <Button tone="quiet" className="min-h-12" disabled={busy || !timed} onClick={() => run("court_timer", { p_step: step, p_action: "add" })}>
        ➕ 30 ثانية
      </Button>
    </div>
  );
}

/** A pending objection: accept or reject. It is rejected by itself after 10 seconds. */
function RulingPanel({ state, busy, onRule }: { state: CourtState; busy: boolean; onRule: (accept: boolean) => Promise<boolean> }) {
  const at = state.objection?.at ? Date.parse(state.objection.at) : 0;
  const left = useSecondsLeft(at ? new Date(at + objectionMs(state)).toISOString() : null);
  if (!state.objection) return null;
  return (
    <div className="beat grid gap-3 rounded-[24px] border-2 border-wrong bg-[#2b0f1d] p-4 text-center shadow-[0_16px_50px_#000a]">
      <p className="font-display text-[22px] font-extrabold text-wrong">
        ✋ اعتراض من {KINDS[state.objection.kind]?.label}: {state.objection.name}
      </p>
      <p className="text-[13px] text-mist">
        {systemJudge(state)
          ? `الهيئة تصوّت الآن${left !== null ? ` (${left} ث)` : ""}، ولك أن تحسم بدلها. المقبول يُلغي السؤال ويعطي صاحبه 50 نقطة.`
          : `احكم: المقبول يُلغي السؤال ويعطي صاحبه 50 نقطة. ${left !== null ? `يُرفض وحده بعد ${left} ث.` : ""}`}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Button tone="primary" className="min-h-12" disabled={busy} onClick={() => onRule(true)}>
          مقبول
        </Button>
        <Button tone="quiet" className="min-h-12" disabled={busy} onClick={() => onRule(false)}>
          مرفوض
        </Button>
      </div>
    </div>
  );
}

/**
 * «إدارة الاستجواب»: one list for the questioning. Who is on the stand and who asks, then every
 * player once, in the stand order and then the askers: 🎙️ puts them on the stand (or takes them
 * down), 🙋 gives them the turn. Next to each name: their place in the line and how often they asked.
 */
function QuestioningPanel({ state, busy, run }: { state: CourtState; busy: boolean; run: (fn: string, args?: Record<string, unknown>) => Promise<boolean> }) {
  const queue = state.queue ?? [];
  const cast = state.cast ?? [];
  const asker = cast.find((c) => c.player_id === state.asking);
  const onStand = cast.find((c) => c.player_id === state.stand);
  const call = (id: string | null, drop: boolean) => run("court_call", { p_player_id: id, p_drop: drop });
  const asked = state.asked ?? {};
  const standers = standPlan(state).map((x) => x.c);
  const rank = (k: CourtKind) => (k === "prosecutor" ? 1 : k === "lawyer" ? 2 : 3);
  const others = cast.filter((c) => !standers.includes(c)).sort((x, y) => rank(x.kind) - rank(y.kind));
  const rows = [...standers, ...others];
  const queuePlace = (id: string) => queue.findIndex((q) => q.player_id === id);
  const esc = escalation(state);
  return (
    <div className="surface grid gap-3 rounded-[24px] p-4">
      <div className="grid gap-1 rounded-[16px] border border-gold/40 bg-night/60 p-3 text-[14px]">
        <p className="text-ivory">
          🎙️ على المنصة: <b>{onStand ? `${onStand.name} (${onStand.player_name})` : "لا أحد"}</b>
        </p>
        <p className="flex flex-wrap items-center gap-2 text-ivory">
          {state.golden && state.golden.by === state.asking ? "⭐ سؤال ذهبي:" : "🙋 يسأل:"} <b>{asker ? asker.player_name : "لا أحد"}</b>
          {asker && !isPaused(state) ? <TurnClock since={state.asking_since} ms={turnMs(state)} /> : null}
        </p>
        {esc?.next ? <p className="text-[12px] text-mist">⏫ بعده على المنصة: {esc.next.name}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {queue.length ? (
          <Button tone="primary" className="min-h-11 flex-1" disabled={busy} onClick={() => call(queue[0].player_id, false)}>
            الدور لـ {queue[0].name}
          </Button>
        ) : null}
        {asker ? (
          <Button tone="quiet" className="min-h-11 flex-1" disabled={busy} onClick={() => call(null, false)}>
            انتهى سؤال {asker.player_name}
          </Button>
        ) : null}
      </div>
      <ul className="grid gap-1.5">
        {rows.map((c) => {
          const up = state.stand === c.player_id;
          const isAsking = state.asking === c.player_id;
          const q = queuePlace(c.player_id);
          return (
            <li key={c.player_id} className={cx("flex items-center gap-2 rounded-[14px] border px-2.5 py-1.5", up ? "border-gold bg-gold/10" : isAsking ? "border-violet-text/60 bg-violet-text/10" : "border-line bg-deep-2/50")}>
              <span aria-hidden="true" className="text-[18px]">
                {KINDS[c.kind].icon}
              </span>
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-[14px] font-semibold text-ivory">{c.kind === "juror" ? c.player_name : c.name}</span>
                <span className="truncate text-[11px] text-mist">
                  {c.kind === "juror" ? "محلّف" : c.player_name}
                  {q >= 0 ? ` · ✋ رقم ${q + 1}` : ""}
                  {` · سأل ${asked[c.player_id] ?? 0}`}
                </span>
              </span>
              {c.kind !== "juror" ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={up}
                  aria-label={up ? `أنزل ${c.name} من المنصة` : `${c.name} إلى المنصة`}
                  onClick={() => run("court_stand", { p_player_id: up ? null : c.player_id })}
                  className={cx("min-h-10 rounded-full border px-3 text-[13px] font-bold", up ? "border-gold bg-gold/20 text-gold" : "border-line-strong/70 text-mist hover:text-ivory")}
                >
                  🎙️
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy || isAsking}
                aria-label={`أعط ${c.player_name} الدور`}
                onClick={() => call(c.player_id, false)}
                className={cx("min-h-10 rounded-full border px-3 text-[13px] font-bold", isAsking ? "border-violet-text bg-violet-text/20 text-violet-text" : "border-line-strong/70 text-mist hover:text-ivory")}
              >
                🙋
              </button>
              {q >= 0 ? (
                <button type="button" disabled={busy} className="px-1 text-mist hover:text-wrong" aria-label={`أخرج ${c.player_name} من الدور`} onClick={() => call(c.player_id, true)}>
                  ✕
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-mist">🎙️ يصعد المنصة أو ينزل · 🙋 يعطيه الدور. أعطِ الدور لمن سأل أقل.</p>
    </div>
  );
}

/** After the truth: everyone (but the owner) votes on each secret goal; the majority awards 100. */
function GoalVotes({ roomId, state, card, reloadCard }: { roomId: string; state: CourtState; card: MyCard | null; reloadCard: () => Promise<void> }) {
  const { run, busy, error } = useRun(roomId, reloadCard);
  const goals = state.goals ?? [];
  if (!goals.length) return null;
  const me = card?.player_id;
  const awarded = state.goals_awarded ?? {};
  return (
    <div className="surface grid gap-3 rounded-[24px] p-4">
      <p className="text-[15px] font-bold text-ivory">
        🎯 الأهداف السرية <span className="text-[13px] font-normal text-mist">هل حقق هدفه؟ الأغلبية تمنحه 100.</span>
      </p>
      <ul className="grid gap-2">
        {goals.map((g) => {
          const mine = card?.goal_votes?.[g.player_id];
          const tally = state.goal_votes?.[g.player_id];
          const own = g.player_id === me;
          return (
            <li key={g.player_id} className={cx("grid gap-2 rounded-[16px] border p-3", awarded[g.player_id] ? "border-correct bg-correct-fill/15" : "border-line bg-deep-2/50")}>
              <p className="text-[15px] font-bold text-ivory">
                {awarded[g.player_id] ? "✅ " : ""}
                {g.player_name} <span className="font-normal text-mist">({g.name})</span>
              </p>
              <p className="text-[14px] leading-6 text-mist">{g.goal}</p>
              {own ? (
                <p className="text-[13px] text-gold">هذا هدفك، والباقون يحكمون.</p>
              ) : (
                <div className="flex items-center gap-2">
                  {[
                    { v: true, label: "👍 حققه" },
                    { v: false, label: "👎 لا" },
                  ].map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      disabled={busy}
                      aria-pressed={mine === o.v}
                      onClick={() => run("court_goal_vote", { p_owner: g.player_id, p_yes: o.v })}
                      className={cx("min-h-10 rounded-full border px-4 text-[14px] font-semibold", mine === o.v ? "border-gold bg-gold/15 text-gold" : "border-line-strong/70 text-mist hover:text-ivory")}
                    >
                      {o.label}
                    </button>
                  ))}
                  {tally ? (
                    <span className="ms-auto text-[12px] text-mist tabular-nums">
                      👍 {tally.yes} · 👎 {tally.no} من {tally.of}
                    </span>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorLine error={error} />
    </div>
  );
}

/** After the truth: the judge can still award or withdraw a goal by hand (+100 each). */
function GoalsPanel({ state, busy, onToggle }: { state: CourtState; busy: boolean; onToggle: (id: string, on: boolean) => Promise<boolean> }) {
  const awarded = state.goals_awarded ?? {};
  return (
    <div className="surface grid gap-3 rounded-[24px] p-4">
      <p className="text-[15px] font-bold text-ivory">
        🎯 الأهداف السرية <span className="text-[13px] font-normal text-mist">اللاعبون يصوّتون من جوالاتهم، ولك أن تحسم هنا يدويًا.</span>
      </p>
      <ul className="grid gap-2">
        {(state.goals ?? []).map((g) => {
          const on = !!awarded[g.player_id];
          return (
            <li key={g.player_id}>
              <button
                type="button"
                disabled={busy}
                aria-pressed={on}
                onClick={() => onToggle(g.player_id, !on)}
                className={cx("grid w-full gap-0.5 rounded-[16px] border p-3 text-start transition", on ? "border-correct bg-correct-fill/15" : "border-line bg-deep-2/50 hover:border-glow")}
              >
                <span className="text-[15px] font-bold text-ivory">
                  {on ? "✅ " : "⬜ "}
                  {g.player_name} <span className="font-normal text-mist">({g.name})</span>
                </span>
                <span className="text-[14px] leading-6 text-mist">{g.goal}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A player left: the host gives the role to someone who joined later, or to a juror. */
function ReplacePanel({ state, players, busy, onReplace }: { state: CourtState; players: Player[]; busy: boolean; onReplace: (from: string, to: string) => Promise<boolean> }) {
  const present = new Set(players.map((p) => p.id));
  const cast = state.cast ?? [];
  const gone = cast.filter((c) => !present.has(c.player_id));
  const inCase = new Set(cast.map((c) => c.player_id));
  const candidates = [
    ...players.filter((p) => !inCase.has(p.id)).map((p) => ({ id: p.id, label: `${p.player_name} (دخل بعد التوزيع)` })),
    ...cast.filter((c) => c.kind === "juror" && present.has(c.player_id)).map((c) => ({ id: c.player_id, label: `${c.player_name} (محلّف)` })),
  ];
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  useEffect(() => {
    if (gone.length && !from) setFrom(gone[0].player_id);
  }, [gone.length, from]);
  const select = "min-h-11 w-full rounded-[14px] border border-line-strong bg-deep-2/70 px-3 text-[15px] text-ivory";
  return (
    <details className={cx("surface rounded-[20px] p-4", gone.length > 0 && "border border-wrong/50")} open={gone.length > 0}>
      <summary className="cursor-pointer text-[15px] font-semibold text-ivory">
        🔁 استبدال لاعب {gone.length ? <span className="text-wrong">· غادر {gone.map((g) => g.player_name).join("، ")}</span> : null}
      </summary>
      <div className="mt-3 grid gap-2">
        <p className="text-[13px] leading-6 text-mist">ينتقل الدور ببطاقته السرية إلى لاعب جديد في الغرفة أو محلّف، ويُلغى صوت كل منهما إن وُجد.</p>
        <select className={select} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="الدور">
          <option value="">اختر الدور…</option>
          {cast.map((c) => (
            <option key={c.player_id} value={c.player_id}>
              {KINDS[c.kind].icon} {c.kind === "juror" ? "محلّف" : c.name}: {c.player_name}
              {present.has(c.player_id) ? "" : " (غادر)"}
            </option>
          ))}
        </select>
        <select className={select} value={to} onChange={(e) => setTo(e.target.value)} aria-label="ينتقل إلى">
          <option value="">ينتقل إلى…</option>
          {candidates
            .filter((c) => c.id !== from)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
        </select>
        {candidates.length === 0 ? <p className="text-[13px] text-mist">لا يوجد لاعب متاح. اطلب من أحد الدخول للغرفة بالرمز.</p> : null}
        <Button
          tone="quiet"
          className="min-h-11"
          disabled={busy || !from || !to}
          onClick={async () => {
            if (await onReplace(from, to)) {
              setFrom("");
              setTo("");
            }
          }}
        >
          انقل الدور
        </Button>
      </div>
    </details>
  );
}

/** The host's choices, kept on this device as soon as they change. */
type SetupPrefs = {
  hostPlays: boolean;
  q: number;
  c: number;
  v: number;
  auto: boolean;
  quick: boolean;
  judge: "host" | "random" | "system";
  escalate: boolean;
  objections: number;
  turn: number;
  read: number;
  golden: "jurors" | "all" | "off";
};
const PREFS_KEY = "al3sh.court.setup";
// The system judges by default (court_v9.sql): everyone plays, and nobody has to run the session.
const DEFAULT_PREFS: SetupPrefs = { hostPlays: true, q: 180, c: 60, v: 60, auto: true, quick: false, judge: "system", escalate: true, objections: 2, turn: 45, read: 30, golden: "jurors" };
const PRESETS: Array<{ key: string; title: string; sub: string; prefs: Partial<SetupPrefs> }> = [
  { key: "system", title: "🤖 النظام يحكم", sub: "كل جولات الأدلة، والنظام يدير الجلسة والكل يلعب", prefs: { quick: false, judge: "system", hostPlays: true, auto: true, escalate: true } },
  { key: "quick", title: "⚡ سهرة سريعة", sub: "جولة أدلة واحدة، والنظام يحكم", prefs: { quick: true, judge: "system", hostPlays: true, auto: true, escalate: true } },
  { key: "full", title: "⚖️ أنت القاضي", sub: "كل جولات الأدلة، وأنت تنقل الجلسة بيدك", prefs: { quick: false, q: 180, c: 60, v: 60, auto: false, escalate: true, judge: "host", hostPlays: false } },
  { key: "free", title: "🎲 قاضٍ بالقرعة", sub: "لاعب يحكم من جواله، وأنت تلعب", prefs: { judge: "random", hostPlays: true, auto: true, escalate: true } },
];

function readPrefs(): Partial<SetupPrefs> | null {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<SetupPrefs>) : null;
  } catch {
    return null;
  }
}

/** «متهم، مدعٍ، محامٍ، شاهدان، محقق + 3 محلّفين»: what the case deals for this many players, as the server does. */
function dealPreview(parts: Array<{ k: string; o: boolean }>, n: number) {
  const required = parts.filter((x) => !x.o);
  let slots = n - required.length;
  const dealt = parts.filter((x) => {
    if (!x.o) return true;
    if (slots <= 0) return false;
    slots -= 1;
    return true;
  });
  const count = (k: string) => dealt.filter((x) => x.k === k).length;
  const jurors = Math.max(0, n - dealt.length);
  const out: string[] = [];
  const a = count("accused");
  out.push(a > 1 ? "متهمان" : "متهم", "مدعٍ", "محامٍ");
  const w = count("witness");
  if (w) out.push(w === 1 ? "شاهد" : w === 2 ? "شاهدان" : `${w} شهود`);
  if (count("detective")) out.push("محقق");
  const skipped = parts.length - dealt.length;
  return {
    text: `${out.join("، ")}${jurors ? ` + ${jurors === 1 ? "محلّف واحد" : jurors === 2 ? "محلّفان" : `${jurors} ${jurors <= 10 ? "محلّفين" : "محلّفًا"}`}` : " (بلا محلّفين)"}`,
    skipped,
  };
}

function CourtSetup({
  state,
  players,
  busy,
  error,
  onStart,
  onStartCustom,
}: {
  state: CourtState;
  players: Player[];
  busy: boolean;
  error: string | null;
  onStart: (settings: CourtSettings) => Promise<boolean>;
  onStartCustom: (settings: CourtSettings, c: CourtCase, source: "ai" | "room") => Promise<string | null>;
}) {
  const last = state.last_settings ?? null;
  const [cases, setCases] = useState<CaseItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [p, setP] = useState<SetupPrefs>(() => ({
    ...DEFAULT_PREFS,
    ...(last
      ? {
          hostPlays: last.host_plays ?? true,
          q: last.question_seconds ?? 180,
          c: last.closing_seconds ?? 60,
          v: last.vote_seconds ?? 60,
          auto: last.auto ?? false,
          quick: last.quick ?? false,
          judge: last.judge ?? "host",
          escalate: last.escalate ?? true,
          objections: last.objections ?? 2,
          turn: last.turn_seconds ?? 45,
          read: last.read_seconds ?? 30,
          golden: last.golden ?? "jurors",
        }
      : {}),
  }));
  const set = <K extends keyof SetupPrefs>(k: K, val: SetupPrefs[K]) => setP((x) => ({ ...x, [k]: val }));
  const [newEvening, setNewEvening] = useState(false);
  // After picking a ready preset the details fold under «تخصيص»; opened by hand, they stay open.
  const [custom, setCustom] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<Generated | null>(null);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState(0);
  const [category, setCategory] = useState("");
  const [dualOnly, setDualOnly] = useState(false);
  const [freshOnly, setFreshOnly] = useState(false);
  const used = new Set(last?.used_cases ?? []);
  const eveningMatches = last?.evening?.matches ?? 0;

  // Where the choices come from: this device's last choices, else the room's last match, else the admin's defaults.
  const site = useSiteSettings();
  const loaded = useRef(false);
  const touched = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    const saved = readPrefs();
    if (saved) {
      loaded.current = true;
      setP((x) => ({ ...x, ...saved }));
      return;
    }
    const d = site?.game_defaults?.court;
    if (!d) return;
    loaded.current = true;
    if (last) return;
    setP((x) => ({
      ...x,
      ...(typeof d.host_plays === "boolean" ? { hostPlays: d.host_plays } : {}),
      ...(typeof d.auto === "boolean" ? { auto: d.auto } : {}),
      ...(typeof d.quick === "boolean" ? { quick: d.quick } : {}),
      ...(typeof d.escalate === "boolean" ? { escalate: d.escalate } : {}),
      ...(d.judge === "host" || d.judge === "random" || d.judge === "system" ? { judge: d.judge } : {}),
      ...([0, 120, 180, 300].includes(d.question_seconds ?? -1) ? { q: d.question_seconds as number } : {}),
      ...([0, 30, 45, 60, 90].includes(d.closing_seconds ?? -1) ? { c: d.closing_seconds as number } : {}),
      ...([0, 30, 60, 90].includes(d.vote_seconds ?? -1) ? { v: d.vote_seconds as number } : {}),
      ...([0, 1, 2, 3].includes(d.objections ?? -1) ? { objections: d.objections as number } : {}),
      ...([30, 45, 60, 90].includes(d.turn_seconds ?? -1) ? { turn: d.turn_seconds as number } : {}),
      ...([15, 30, 45, 60].includes(d.read_seconds ?? -1) ? { read: d.read_seconds as number } : {}),
      ...(d.golden === "jurors" || d.golden === "all" || d.golden === "off" ? { golden: d.golden } : {}),
    }));
  }, [site, last]);
  useEffect(() => {
    if (!touched.current) {
      touched.current = true;
      return;
    }
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      // Private mode: the choices still apply to this match.
    }
  }, [p]);

  useEffect(() => {
    if (!supabase) return;
    supabase.rpc("court_cases_list").then(({ data, error: e }) => {
      if (e) setLoadError(e.code === "PGRST202" || e.code === "42883" ? SETUP_HINT : "تعذّر تحميل القضايا.");
      else setCases((data ?? []) as CaseItem[]);
    });
  }, []);

  // With a judge drawn by lot, one person runs the session and gets no role.
  const people = players.filter((x) => p.hostPlays || p.judge === "random" || !x.is_host).length;
  const n = p.judge === "random" ? (p.hostPlays ? people - 1 : players.filter((x) => !x.is_host).length - 1) : people;
  const picked = cases?.find((x) => x.id === caseId) ?? null;
  const fits = (cases ?? []).filter((x) => x.min <= n);
  const ready = n >= 4 && n <= 20 && (picked ? picked.min <= n : fits.length > 0);
  const timing = { quick: p.quick, q: p.q, c: p.c, v: p.v };
  const caseMinutes = (x: CaseItem) => estimateMinutes({ ...timing, stages: x.stages, evidence: x.evidence, accused: x.accused });
  // The picked case's length; for a random case, the range of the cases that fit.
  const fitMinutes = fits.map(caseMinutes);
  const duration = picked
    ? `قرابة ${caseMinutes(picked)} دقيقة${p.quick ? "" : ` · ${roundsText(picked.stages ?? 2)}`}`
    : fitMinutes.length && Math.min(...fitMinutes) !== Math.max(...fitMinutes)
      ? `بين ${Math.min(...fitMinutes)} و${Math.max(...fitMinutes)} دقيقة حسب القضية`
      : `قرابة ${fitMinutes[0] ?? estimateMinutes(timing)} دقيقة`;
  const spoilsRounds = p.quick && (picked ? (picked.stages ?? 2) > 2 : false);
  const settings: CourtSettings = {
    case_id: caseId,
    host_plays: p.hostPlays,
    question_seconds: p.q,
    closing_seconds: p.c,
    vote_seconds: p.v,
    auto: p.auto || p.judge === "system",
    quick: p.quick,
    judge: p.judge,
    new_evening: newEvening,
    escalate: p.escalate || p.judge === "system",
    objections: p.objections,
    turn_seconds: p.turn,
    read_seconds: p.read,
    golden: p.golden,
  };
  const conflict = p.hostPlays && p.judge === "host";
  const preset = PRESETS.find((x) => Object.entries(x.prefs).every(([k, val]) => p[k as keyof SetupPrefs] === val))?.key ?? null;
  const open = custom ?? !preset;

  const categories = [...new Set((cases ?? []).map((x) => x.category).filter((x): x is string => !!x))];
  const q = query.trim();
  const shown = (cases ?? []).filter(
    (x) =>
      (!q || x.title.includes(q) || x.summary.includes(q) || (x.category ?? "").includes(q)) &&
      (!level || x.difficulty === level) &&
      (!category || x.category === category) &&
      (!dualOnly || (x.accused ?? 1) > 1) &&
      (!freshOnly || !used.has(x.id)),
  );
  const filtering = !!q || !!level || !!category || dualOnly || freshOnly;
  const preview = picked?.parts && n >= 4 ? dealPreview(picked.parts, n) : null;
  const chip = (on: boolean) =>
    cx("min-h-10 rounded-full border px-3.5 text-[14px] font-semibold transition", on ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/60 text-mist hover:text-ivory");

  return (
    <section className="mx-auto mt-2 grid max-w-3xl gap-4">
      <StartGuide title="🚀 كيف تبدأ الجلسة؟ خمس خطوات" items={HOST_START} open={!last} />
      <div className="surface grid gap-3 rounded-[24px] p-5">
        <h2 className="text-[20px] leading-8">⚖️ جلسة جديدة</h2>
        <p className="text-[14px] leading-6 text-mist">
          👥 في الجلسة {n} {n >= 3 && n <= 10 ? "لاعبين" : "لاعبًا"} (من 4 إلى 20). لكل واحد دور.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((x) => (
            <button
              key={x.key}
              type="button"
              aria-pressed={preset === x.key}
              onClick={() => {
                setP((cur) => ({ ...cur, ...x.prefs }));
                setCustom(false);
              }}
              className={cx(
                "grid gap-0.5 rounded-[16px] border p-3 text-start transition",
                preset === x.key ? "border-gold bg-gold/10 shadow-[0_0_0_2px_#ffa53a33]" : "border-line bg-deep-2/50 hover:border-glow",
              )}
            >
              <span className="text-[15px] font-bold text-ivory">{x.title}</span>
              <span className="text-[12px] leading-5 text-mist">{x.sub}</span>
            </button>
          ))}
        </div>
        <Choice
          label="المضيف"
          value={p.hostPlays ? "play" : "judge"}
          onChange={(x) => set("hostPlays", x === "play")}
          options={[
            { value: "play", label: "يلعب معهم" },
            { value: "judge", label: "لا يلعب" },
          ]}
        />
        {open ? (
        <Choice
          label="القاضي (يدير الأسئلة والاعتراضات وينقل الجلسة)"
          value={p.judge}
          onChange={(x) =>
            setP((cur) => ({ ...cur, judge: x as SetupPrefs["judge"], ...(x === "system" ? { q: cur.q || 180, c: cur.c || 60, v: cur.v || 60 } : {}) }))
          }
          options={[
            { value: "system", label: "🤖 النظام" },
            { value: "host", label: "المضيف" },
            { value: "random", label: "لاعب بالقرعة" },
          ]}
        />
        ) : null}
        {p.judge === "system" && open ? (
          <p className="-mt-1 text-[13px] leading-6 text-mist">
            🤖 النظام يدير كل شيء والكل يلعب. ومعك أدوات احتياطية.
          </p>
        ) : null}
        {p.judge === "random" && open ? <p className="-mt-1 text-[13px] text-mist">🎲 لاعب يحكم من جواله بلا دور. ومعك أدوات احتياطية.</p> : null}
        {conflict ? (
          <div role="alert" className="grid gap-2 rounded-[16px] border border-gold/60 bg-gold/10 p-3">
            <p className="text-[14px] leading-6 text-ivory">
              ⚠️ تلعب وتحكم بنفس الوقت؟ قد يطلع لك دور المتهم.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button tone="primary" className="min-h-10" onClick={() => set("judge", "random")}>
                اجعل القاضي بالقرعة
              </Button>
              <Button tone="quiet" className="min-h-10" onClick={() => set("hostPlays", false)}>
                لن ألعب دورًا
              </Button>
            </div>
          </div>
        ) : null}
        {open ? (
          <Choice
            label="نوع الجلسة"
            value={p.quick ? "quick" : "full"}
            onChange={(x) => set("quick", x === "quick")}
            options={[
              { value: "full", label: "كاملة: كل جولات الأدلة" },
              { value: "quick", label: "سريعة: الأدلة في جولة واحدة" },
            ]}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-line bg-deep-2/40 p-3">
            <p className="text-[13px] leading-6 text-mist">
              {p.judge === "system" ? "🤖 القاضي: النظام" : p.judge === "random" ? "قاضٍ بالقرعة" : "القاضي: المضيف"} · {p.quick ? "جولة واحدة" : "كل جولات الأدلة"} · {p.auto || p.judge === "system" ? "انتقال تلقائي" : "القاضي ينقل الجلسة"}
              {p.escalate ? " · منصة تلقائية" : ""}
            </p>
            <button type="button" className="text-[14px] font-semibold text-gold underline-offset-4 hover:underline" onClick={() => setCustom(true)}>
              ⚙️ تخصيص
            </button>
          </div>
        )}
        <p className="rounded-[14px] bg-deep-2/60 p-3 text-center text-[15px] font-bold text-gold">⏱️ المدة المتوقعة: {duration}</p>
        {spoilsRounds ? (
          <p className="-mt-1 text-[13px] leading-6 text-mist">هذه القضية تكشف أدلتها على 3 جولات. في الجلسة السريعة تظهر الأدلة كلها مرة وحدة، والأمتع أن تلعبوها كاملة.</p>
        ) : null}
        {eveningMatches > 0 ? (
          <label className="flex items-center gap-2 text-[14px] text-ivory">
            <input type="checkbox" className="size-5 accent-[var(--color-gold)]" checked={newEvening} onChange={(e) => setNewEvening(e.target.checked)} />
            سهرة جديدة (يُمسح ترتيب السهرة بعد {eveningMatches} {eveningMatches > 2 && eveningMatches < 11 ? "قضايا" : "قضية"})
          </label>
        ) : null}
      </div>

      <div className="surface grid gap-3 rounded-[24px] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[18px] leading-7">القضية</h2>
          <Button tone="quiet" className="min-h-11 border-gold/60 text-gold" onClick={() => setGenerating(true)}>
            ✨ قضية جديدة بالذكاء الاصطناعي
          </Button>
        </div>
        {loadError ? <p className="text-[14px] text-wrong">{loadError}</p> : null}
        {cases === null && !loadError ? <p className="text-[14px] text-mist">جارٍ تحميل القضايا…</p> : null}
        {(cases ?? []).length > 4 ? (
          <div className="grid gap-2">
            <input type="search" className={cx(inputClass, "min-h-11")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔎 ابحث باسم القضية أو نوعها" aria-label="بحث في القضايا" />
            <div className="flex flex-wrap gap-1.5">
              {LEVEL.map((label, i) => (
                <button key={i} type="button" aria-pressed={level === i} className={chip(level === i)} onClick={() => setLevel(i)}>
                  {i === 0 ? "كل الصعوبات" : label}
                </button>
              ))}
              <button type="button" aria-pressed={dualOnly} className={chip(dualOnly)} onClick={() => setDualOnly(!dualOnly)}>
                ⚖️ متهمان
              </button>
              {used.size ? (
                <button type="button" aria-pressed={freshOnly} className={chip(freshOnly)} onClick={() => setFreshOnly(!freshOnly)}>
                  لم تُلعب
                </button>
              ) : null}
            </div>
            {categories.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" aria-pressed={!category} className={chip(!category)} onClick={() => setCategory("")}>
                  كل الأنواع
                </button>
                {categories.map((x) => (
                  <button key={x} type="button" aria-pressed={category === x} className={chip(category === x)} onClick={() => setCategory(category === x ? "" : x)}>
                    {x}
                  </button>
                ))}
              </div>
            ) : null}
            {filtering ? (
              <p className="text-[13px] text-mist">
                {shown.length} من {(cases ?? []).length} قضية.{" "}
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => {
                    setQuery("");
                    setLevel(0);
                    setCategory("");
                    setDualOnly(false);
                    setFreshOnly(false);
                  }}
                >
                  إظهار الكل
                </button>
              </p>
            ) : null}
          </div>
        ) : null}
        <ul className="grid gap-2">
          <li>
            <CaseOption on={caseId === null} onClick={() => setCaseId(null)} title="🎲 قضية عشوائية" sub={`تُختار قضية تناسب عددكم${used.size ? "، ولم تلعبوها في هذه الغرفة" : ""}.`} />
          </li>
          {shown.map((x) => (
            <li key={x.id}>
              <CaseOption
                on={caseId === x.id}
                disabled={x.min > n}
                onClick={() => setCaseId(x.id)}
                title={`${x.title}${(x.accused ?? 1) > 1 ? " · ⚖️ متهمان" : ""}`}
                sub={`${x.summary}${x.summary ? " · " : ""}${LEVEL[x.difficulty] ?? ""} · ⏱️ ${caseMinutes(x)} د${(x.stages ?? 2) > 2 && !p.quick ? ` · ${roundsText(x.stages ?? 2)}` : ""}${(x.versions ?? 1) > 1 ? ` · ${x.versions} حقائق ممكنة` : ""}${x.min > 4 ? ` · ${x.min} لاعبين على الأقل` : ""}${used.has(x.id) ? " · لُعبت" : ""}`}
              />
            </li>
          ))}
        </ul>
      </div>

      {open ? (
      <div className={cx("surface grid gap-4 rounded-[24px] p-5")}>
        <h2 className="text-[18px] leading-7">المؤقتات {p.quick ? <span className="text-[13px] font-normal text-mist">(السريعة تثبّتها: استجواب دقيقتان، مرافعة 30 ث، تصويت 30 ث)</span> : null}</h2>
        {p.quick ? null : (
          <>
            <Choice label="الاستجواب (لكل جولة)" value={String(p.q)} onChange={(x) => set("q", Number(x))} options={[...(p.judge === "system" ? [] : [{ value: "0", label: "بدون" }]), { value: "120", label: "2 د" }, { value: "180", label: "3 د" }, { value: "300", label: "5 د" }]} />
            <Choice label="المرافعة (لكل طرف)" value={String(p.c)} onChange={(x) => set("c", Number(x))} options={[...(p.judge === "system" ? [] : [{ value: "0", label: "بدون" }]), { value: "45", label: "45 ث" }, { value: "60", label: "دقيقة" }, { value: "90", label: "90 ث" }]} />
            <Choice label="التصويت" value={String(p.v)} onChange={(x) => set("v", Number(x))} options={[...(p.judge === "system" ? [] : [{ value: "0", label: "بدون" }]), { value: "30", label: "30 ث" }, { value: "60", label: "دقيقة" }, { value: "90", label: "90 ث" }]} />
          </>
        )}
        {p.judge === "system" ? (
          <p className="text-[13px] leading-6 text-mist">🤖 مع النظام: الانتقال والمنصة تلقائيان، ولكل مرحلة وقت.</p>
        ) : (
        <>
        <Choice
          label="الانتقال"
          value={p.auto ? "auto" : "manual"}
          onChange={(x) => set("auto", x === "auto")}
          options={[
            { value: "manual", label: "القاضي ينقل الجلسة" },
            { value: "auto", label: "تلقائي حين ينتهي الوقت" },
          ]}
        />
        <p className="text-[13px] text-mist">
          {p.auto ? `تنتقل وحدها مع الوقت، والأدلة ${p.read} ثانية للقراءة.` : "القاضي ينقلها بزر واحد متى شاء."}
        </p>
        <Choice
          label="المنصة أثناء الاستجواب"
          value={p.escalate ? "auto" : "judge"}
          onChange={(x) => set("escalate", x === "auto")}
          options={[
            { value: "auto", label: "تصعيد تلقائي" },
            { value: "judge", label: "القاضي يختار" },
          ]}
        />
        <p className="text-[13px] text-mist">
          {p.escalate
            ? p.q || p.quick
              ? "تنتقل وحدها: الشهود، ثم المحقق، ثم المتهم."
              : "التصعيد يحتاج مؤقتًا للاستجواب."
            : "القاضي يستدعي من يشاء للمنصة."}
        </p>
        </>
        )}
        <details className="rounded-[16px] border border-line bg-deep-2/40 p-3">
          <summary className="cursor-pointer text-[15px] font-semibold text-ivory">⚙️ إعدادات متقدمة</summary>
          <div className="mt-3 grid gap-4">
            <Choice label="الاعتراضات لكل من المدعي والمحامي" value={String(p.objections)} onChange={(x) => set("objections", Number(x))} options={[{ value: "0", label: "بدون" }, { value: "1", label: "1" }, { value: "2", label: "2" }, { value: "3", label: "3" }]} />
            <Choice label="دور السؤال (لكل سائل)" value={String(p.turn)} onChange={(x) => set("turn", Number(x))} options={[{ value: "30", label: "30 ث" }, { value: "45", label: "45 ث" }, { value: "60", label: "دقيقة" }, { value: "90", label: "90 ث" }]} />
            <Choice label="قراءة الأدلة (مع الانتقال التلقائي)" value={String(p.read)} onChange={(x) => set("read", Number(x))} options={[{ value: "15", label: "15 ث" }, { value: "30", label: "30 ث" }, { value: "45", label: "45 ث" }, { value: "60", label: "دقيقة" }]} />
            <Choice
              label="السؤال الذهبي"
              value={p.golden}
              onChange={(x) => set("golden", x as SetupPrefs["golden"])}
              options={[
                { value: "jurors", label: "للمحلّفين" },
                { value: "all", label: "للمحلّفين والشهود والمحقق" },
                { value: "off", label: "بدون" },
              ]}
            />
            <p className="text-[13px] text-mist">هذه الإعدادات تحتاج ملف court_v6.sql. وبدونه تعمل الجلسة بالقيم المعتادة.</p>
          </div>
        </details>
        {preset ? (
          <button type="button" className="justify-self-start text-[13px] text-mist underline-offset-4 hover:text-ivory hover:underline" onClick={() => setCustom(false)}>
            طيّ الإعدادات
          </button>
        ) : null}
      </div>
      ) : null}

      <div className="sticky bottom-0 z-20 -mx-4 grid gap-2 border-t border-line bg-night/90 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur sm:mx-0 sm:rounded-[20px] sm:border">
        <ErrorLine error={error} />
        {ready ? (
          <p className="text-center text-[13px] leading-5 text-mist">
            {picked ? <b className="text-ivory">{picked.title}: </b> : "🎲 قضية عشوائية · "}
            {preview ? preview.text : `${n} ${n <= 10 ? "لاعبين" : "لاعبًا"}، والأدوار حسب القضية`}
            {p.judge === "random" ? " · وقاضٍ بالقرعة" : ""}
            {preview?.skipped ? ` · ${preview.skipped === 1 ? "دور إضافي يصير إفادة" : `${preview.skipped} أدوار إضافية تصير إفادات`}` : ""}
          </p>
        ) : (
          <p className="text-center text-[13px] text-mist">
            {n < 4 ? (p.judge === "random" ? "مع قاضٍ بالقرعة تحتاجون 5 أشخاص على الأقل." : "تحتاجون 4 لاعبين على الأقل.") : n > 20 ? "الحد الأقصى 20 لاعبًا." : picked ? `هذه القضية تحتاج ${picked.min} لاعبين على الأقل.` : "لا توجد قضية تناسب هذا العدد."}
          </p>
        )}
        <Button tone="primary" className="min-h-14 text-[18px]" disabled={!ready || busy} onClick={() => onStart(settings)}>
          {busy ? "نوزّع الأدوار…" : "افتح الجلسة ووزّع الأدوار"}
        </Button>
      </div>
      {generating || draft ? (
        <Suspense fallback={null}>
          {generating ? (
            <GenerateSheet
              players={n}
              onClose={() => setGenerating(false)}
              onDraft={(g) => {
                setGenerating(false);
                setDraft(g);
              }}
            />
          ) : null}
          {draft ? (
            <CaseEditor
              initial={draft.draft}
              title="راجع القضية قبل اللعب"
              submitLabel="▶ العب بها الآن"
              note={`${draft.note ? `${draft.note} ` : ""}أنت ترى الحقيقة الآن، فالأفضل ألا تلعب دورًا: اختر «لا يلعب» أو «قاضٍ بالقرعة». تُحفظ القضية موقوفة في لوحة الإدارة للمراجعة.`}
              onClose={() => setDraft(null)}
              onSubmit={async (cs) => {
                const err = await onStartCustom(settings, cs, draft.source === "ai" ? "ai" : "room");
                if (!err) setDraft(null);
                return err;
              }}
            />
          ) : null}
        </Suspense>
      ) : null}
    </section>
  );
}

function CaseOption({ on, disabled = false, onClick, title, sub }: { on: boolean; disabled?: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "grid w-full gap-0.5 rounded-[16px] border p-3 text-start transition disabled:opacity-40",
        on ? "border-gold bg-gold/10 shadow-[0_0_0_2px_#ffa53a33]" : "border-line bg-deep-2/50 hover:border-glow",
      )}
    >
      <span className="text-[16px] font-bold text-ivory">{title}</span>
      <span className="text-[13px] leading-5 text-mist">{sub}</span>
    </button>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[14px] font-semibold text-ivory">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx("min-h-11 rounded-full border px-4 text-[15px] font-semibold transition", value === o.value ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/60 text-mist hover:text-ivory")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Player ---------------- */

export function CourtPlayerPanel({ roomId, meId }: { roomId: string; meId: string | null }) {
  const { state, players, reload } = useCourtLive(roomId);
  const { card, reload: reloadCard } = useMyCard(roomId, state);
  useCourtCues(state, { vibe: true });
  // Phones ask last (and at slightly different moments), only if the TV and host did not.
  const [delay] = useState(() => 1800 + Math.floor(Math.random() * 1500));
  useAutoTick(roomId, state, delay);

  // Joined after the roles were dealt: take a seat on the jury, until the vote ends.
  const joining = useRef(false);
  useEffect(() => {
    if (!supabase || joining.current || !card || card.started || !card.late) return;
    if (!["intro", "evidence", "question", "closing", "vote"].includes(state.phase ?? "")) return;
    joining.current = true;
    void supabase.rpc("court_join_jury", { p_room_id: roomId }).then(() => reloadCard());
  }, [card, state.phase, roomId, reloadCard]);

  if (!isCourt(state) || !state.phase)
    return (
      <section className="grid gap-4">
        <Note>المضيف يجهّز الجلسة ويختار القضية. ستصلك بطاقة دورك هنا.</Note>
        <StartGuide title="🚀 كيف نلعب؟ ست خطوات" items={PLAYER_START} open />
      </section>
    );
  if (card?.judge) return <JudgeView roomId={roomId} state={state} players={players} reload={reload} />;
  if (card && !card.started && card.late && state.phase !== "over") return <Note>دخلت بعد توزيع الأدوار. ننضمك إلى هيئة المحلفين…</Note>;
  return (
    <section className="grid gap-4">
      <div className="surface rounded-[22px] p-4">
        <CaseHeader state={state} />
      </div>
      <PlayView roomId={roomId} state={state} meId={meId} card={card} reloadCard={reloadCard} />
      {state.phase === "over" ? <ResultShare result={courtShare(state)} fileName="al3sh-court.png" /> : null}
    </section>
  );
}

/** The judge drawn by lot: the session's tools on this phone, without a role card. */
function JudgeView({ roomId, state, players, reload }: { roomId: string; state: CourtState; players: Player[]; reload: () => Promise<void> }) {
  const { run, busy, error } = useRun(roomId, reload);
  useTimeUpCue(state, true);
  return (
    <section className="grid gap-4">
      <p className="rounded-[18px] border border-gold/50 bg-gold/10 p-3 text-center text-[17px] font-extrabold text-gold">⚖️ أنت القاضي: تدير الجلسة ولا تلعب دورًا</p>
      <JudgeControls state={state} players={players} run={run} busy={busy} error={error} />
      <Spectator state={state} judge />
    </section>
  );
}

/* ---------------- TV ---------------- */

/** What the narrator says when the session moves on, the stand changes, or someone objects. */
function narration(state: CourtState): string {
  const p = state.phase;
  if (p === "intro") return `قضية: ${state.case?.title ?? ""}. ${state.case?.intro ?? ""}`;
  if (p === "evidence") {
    const items = (state.evidence ?? []).filter((e) => e.stage === state.stage);
    return `أدلة الجولة ${state.stage}. ${items.map((e) => `${e.title}${e.time ? `، الساعة ${e.time}` : ""}: ${e.text}`).join(" ")}`;
  }
  if (p === "question") return state.settings?.escalate ? "بدأ الاستجواب. المنصة تنتقل وحدها: الشهود، ثم المحقق، ثم المتهم." : "بدأ الاستجواب. اسألوا المتهم والشهود.";
  if (p === "closing") return state.side === "prosecutor" ? "الكلمة للمدعي العام." : "الكلمة للمحامي.";
  if (p === "vote") return "حان وقت التصويت. مذنب أم بريء؟";
  if (p === "verdict") {
    const list = state.verdict?.list ?? [];
    if (list.length > 1) return `حكمت هيئة المحلفين. ${list.map((a) => `${a.name}: ${a.guilty ? "مذنب" : "بريء"}`).join(". ")}.`;
    return `حكمت هيئة المحلفين: ${state.verdict?.guilty ? "مذنب" : "بريء"}.`;
  }
  if (p === "over") return `${state.truth?.correct ? "تحققت العدالة." : "خطأ قضائي."} الحقيقة: ${state.truth?.text ?? ""}`;
  return "";
}

function useNarrator(state: CourtState, on: boolean) {
  const lastStep = useRef<number | null>(null);
  const lastStand = useRef<string | null>(null);
  const lastObjection = useRef<string | null>(null);
  useEffect(() => {
    const step = state.step ?? -1;
    if (!on || !isCourt(state) || lastStep.current === step) return;
    lastStep.current = step;
    speak(narration(state));
  }, [on, state.step, state.phase]);
  useEffect(() => {
    const id = state.stand ?? null;
    if (!on || id === lastStand.current) return;
    lastStand.current = id;
    const who = (state.cast ?? []).find((c) => c.player_id === id);
    if (who) speak(`على المنصة: ${who.name}`);
  }, [on, state.stand]);
  useEffect(() => {
    const at = state.objection?.at ?? null;
    if (!on || !at || at === lastObjection.current) return;
    lastObjection.current = at;
    if (Date.now() - Date.parse(at) < 6000) speak("اعتراض!");
  }, [on, state.objection?.at]);
  const lastRuling = useRef<string | null>(null);
  useEffect(() => {
    const r = state.objection?.ruled_at ?? null;
    if (!on || !r || r === lastRuling.current) return;
    lastRuling.current = r;
    if (Date.now() - Date.parse(r) < 6000) speak(state.objection?.status === "accepted" ? "اعتراض مقبول. السؤال ملغى." : "اعتراض مرفوض. أكمِل.");
  }, [on, state.objection?.ruled_at]);
  const lastPresented = useRef<string | null>(null);
  useEffect(() => {
    const p = state.presented;
    if (!on || !p || p.at === lastPresented.current) return;
    lastPresented.current = p.at;
    if (Date.now() - Date.parse(p.at) < 8000) {
      const e = (state.evidence ?? []).find((x) => x.presented && x.title === p.title);
      speak(`دليل جديد من ${KINDS[p.by_kind]?.label ?? p.by_name}: ${p.title}. ${e?.text ?? ""}`);
    }
  }, [on, state.presented?.at]);
  const lastGolden = useRef<string | null>(null);
  useEffect(() => {
    const g = state.golden;
    if (!on || !g || g.at === lastGolden.current) return;
    lastGolden.current = g.at;
    if (Date.now() - Date.parse(g.at) < 8000) speak(`سؤال ذهبي من ${g.by_name}. ${g.target_name} على المنصة، ويجب أن يجيب.`);
  }, [on, state.golden?.at]);
}

function VoiceToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[clamp(13px,1.1vw,20px)] font-semibold",
        on ? "border-gold bg-gold/15 text-gold" : "border-line-strong/70 text-mist hover:text-ivory",
      )}
    >
      <Glyph name={on ? "volume" : "mute"} className="size-[1.2em]" />
      {on ? "صوت الراوي" : "الراوي صامت"}
    </button>
  );
}

export function CourtTv({ roomId }: { roomId: string }) {
  const { state, players } = useCourtLive(roomId);
  useCourtCues(state, { sound: true });
  useTimeUpCue(state, true);
  useAutoTick(roomId, state, 0);
  const [voice, setVoice] = useState(false);
  useEffect(() => setVoice(voicePreference()), []);
  useNarrator(state, voice);
  const toggleVoice = (next: boolean) => {
    setVoice(next);
    setVoicePreference(next);
    if (next) speak(narration(state) || "صوت الراوي يعمل.");
    else window.speechSynthesis?.cancel();
  };
  if (!isCourt(state) || !state.phase) {
    return (
      <div className="grid justify-items-center gap-[2vw] text-center">
        <span aria-hidden="true" className="text-[clamp(56px,8vw,160px)] leading-none">
          ⚖️
        </span>
        <p className="font-display text-[clamp(24px,3vw,56px)] font-extrabold text-ivory">المحكمة تستعد… المضيف يختار القضية</p>
        <p className="text-[clamp(16px,1.6vw,30px)] text-mist">في القاعة: {players.map((p) => p.player_name).join("، ")}</p>
      </div>
    );
  }
  const p = state.phase;
  return (
    <div className="grid gap-[1.4vw]">
      <CaseHeader state={state} big>
        <VoiceToggle on={voice} onChange={toggleVoice} />
      </CaseHeader>
      <ObjectionFlash state={state} big />
      <CourtFlash state={state} big />
      <PresentedFlash state={state} big />
      {p === "intro" ? (
        <>
          <p className="rise rounded-[1.6vw] border border-gold/40 bg-night/60 p-[1.6vw] text-[clamp(18px,2vw,40px)] leading-relaxed text-ivory">{state.case?.intro}</p>
          <SessionPlan state={state} big />
          <p className="text-center text-[clamp(14px,1.4vw,28px)] text-mist">
            📱 كل لاعب يقرأ بطاقته السرية في جواله.{systemJudge(state) ? " 🤖 القاضي: النظام." : state.judge_name ? ` ⚖️ القاضي: ${state.judge_name}.` : ""}
            {(state.case?.versions ?? 1) > 1 ? ` لهذه القضية ${state.case?.versions} حقائق ممكنة.` : ""}
          </p>
        </>
      ) : null}
      {p === "evidence" ? (
        <>
          <p className="text-center font-display text-[clamp(22px,2.6vw,52px)] font-extrabold text-gold">📁 أدلة الجولة {state.stage}</p>
          <EvidenceGrid items={(state.evidence ?? []).filter((e) => e.stage === state.stage)} big />
          <Timeline items={state.evidence ?? []} stage={state.stage} big />
          {(state.stage ?? 1) > 1 ? (
            <details className="text-[clamp(13px,1.2vw,24px)] text-mist">
              <summary>الأدلة السابقة</summary>
              <EvidenceGrid items={(state.evidence ?? []).filter((e) => e.stage !== state.stage)} big />
            </details>
          ) : null}
        </>
      ) : null}
      {p === "question" ? (
        <>
          <p className="text-center font-display text-[clamp(22px,2.6vw,52px)] font-extrabold text-ivory">🎙️ الاستجواب: اسألوا المتهم والشهود</p>
          <SessionBoard state={state} big />
          <Timeline items={state.evidence ?? []} big />
          <EvidenceGrid items={state.evidence ?? []} big />
          <CastGrid state={state} big briefs={false} />
        </>
      ) : null}
      {p === "closing" ? (
        <>
          <ClosingBanner state={state} big />
          <Timeline items={state.evidence ?? []} big />
          <EvidenceGrid items={state.evidence ?? []} big />
        </>
      ) : null}
      {p === "vote" ? (
        <div className="grid justify-items-center gap-[1.4vw] text-center">
          <span aria-hidden="true" className="text-[clamp(56px,7vw,140px)] leading-none">
            🗳️
          </span>
          <p className="font-display text-[clamp(30px,4vw,80px)] font-extrabold text-ivory">المحلفون يصوّتون: مذنب أم بريء؟</p>
          {(state.accused?.length ?? 0) > 1 ? <p className="text-[clamp(16px,1.7vw,34px)] text-gold">حكم مستقل لكل متهم: {state.accused!.map((a) => a.name).join(" · ")}</p> : null}
          <p dir="ltr" className="font-display text-[clamp(28px,3.4vw,68px)] font-extrabold tabular-nums text-gold">
            {state.votes_count ?? 0} / {state.voters_count ?? 0}
          </p>
          {(state.suspects ?? []).length ? (
            <p className="text-[clamp(16px,1.7vw,34px)] text-gold">ومن الفاعل الحقيقي؟ {(state.suspects ?? []).map((x) => x.name).join(" · ")}</p>
          ) : null}
          <p className="text-[clamp(14px,1.4vw,28px)] text-mist">الأصوات سرية حتى إعلان الحكم.</p>
        </div>
      ) : null}
      {p === "verdict" ? <VerdictCard state={state} big /> : null}
      {p === "over" ? (
        <>
          <div className="grid grid-cols-[1fr_1.4fr] items-start gap-[1.4vw]">
            <VerdictCard state={state} big />
            <TruthCard state={state} big />
          </div>
          <Timeline items={state.evidence ?? []} big />
          <EveningBoard state={state} big />
          <PointsTable state={state} big />
          <CardsReveal state={state} big />
        </>
      ) : null}
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useLivePoll } from "@/lib/live";
import { GameIntro, type IntroStep } from "@/components/game-intro";
import { useSiteSettings } from "@/lib/site-settings";
import {
  LOVERS_INFO,
  MafiaRecapView,
  MafiaShare,
  MafiaSummary,
  ROLE_HINTS,
  ROLE_ICONS,
  ROLE_NAMES,
  ROLE_INFO,
  TallyView,
  VotesView,
  WINNERS,
  mmss,
  narratorLine,
  pausedLeft,
  revealOrder,
  RevealCard,
  useCountdown,
  useMafiaRecap,
  type MafiaPlayerRow,
  type MafiaPublicState,
  type MafiaTally,
  type MafiaVote,
} from "@/components/mafia";

/**
 * «المافيا» screens shared by the host page and the player page (mafia_v5.sql):
 * the narrator's controls, a player's screen, and the host's screen that shows one or the other.
 */

type StateData = Record<string, unknown> & { phase?: unknown; round?: unknown };

type MafiaState = MafiaPublicState;

const MAFIA_HOST_ERRORS: Record<string, string> = {
  NOT_NARRATOR: "هذا للراوي فقط.",
  NOT_STARTED: "لم تبدأ اللعبة بعد.",
  ROOM_NOT_PLAYING: "ابدأ الغرفة أولًا.",
  ALREADY_STARTED: "اللعبة بدأت بالفعل.",
  NOT_ENOUGH_PLAYERS: "تحتاج المافيا إلى 5 لاعبين على الأقل غير الراوي.",
  TOO_MANY_PLAYERS: "الحد الأقصى 14 لاعبًا.",
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  NO_STATE: "تعذّر تحميل اللعبة.",
  BAD_MAFIA_COUNT: "عدد المافيا (مع الجاسوس) لازم يكون أقل من نصف اللاعبين.",
  NOT_YET: "لم ينتهِ وقت التصويت بعد.",
  TOO_MANY_ROLES: "الأدوار أكثر من اللاعبين. قلّل الأدوار الإضافية أو عدد المافيا.",
  NOT_OVER: "المباراة لم تنتهِ بعد.",
  NOMINEES: "اختر مرشحَين أو ثلاثة.",
  BAD_COUNTS: "تحقق من الأرقام.",
  NOT_IN_RUNOFF: "الإعادة بين المتعادلين فقط.",
};

/** mafia_progress(): votes for everyone, night actions for the host only (mafia_v2.sql). */
type MafiaProgress = { phase?: string; done?: number; total?: number; mafia_split?: boolean; waiting?: Array<string | { name: string; role: string }> };

/** «م1 (مافيا)، م6 (طبيب)» or «م1، م2»: who has not chosen or voted yet. */
const waitingText = (w: MafiaProgress["waiting"]) =>
  (w ?? []).map((x) => (typeof x === "string" ? x : `${x.name} (${ROLE_NAMES[x.role] ?? ""})`)).join("، ");

type NarratorRole = { player_id: string; player_name: string; role: string; alive: boolean; lover?: string | null };
/** mafia_night_live() (mafia_v7.sql): tonight's choices so far, for the narrator only. */
type NightLive = { actor: string; actor_role: string; kind: string; target: string; target_role: string };

/** The first-time intro for a mafia role: who you are, what you do, how you win. */
function mafiaIntro(role: string): IntroStep[] {
  const info = ROLE_INFO[role];
  if (!info) return [];
  return [
    { icon: ROLE_ICONS[role] ?? "🎭", title: `دورك: ${ROLE_NAMES[role] ?? ""}`, text: `فريقك: ${info.team}. احفظ دورك سرًّا، وتراه في أي وقت بلمس «بطاقتك السرية»، ويختفي حين ترفع إصبعك.` },
    { icon: "🌙", title: "ماذا تفعل ومتى", text: `${info.does} ${info.when}` },
    { icon: "🏆", title: "كيف تفوز", text: `${info.wins} في النهار ناقشوا وصوّتوا، ولا تُرِ جوالك لأحد.` },
  ];
}

/** «المتخفي» already unmasked by a vote: everyone knows. */
const isUnmasked = (state: Record<string, unknown> | MafiaPublicState, id: string) => {
  const u = (state as { unmasked?: unknown }).unmasked;
  return Array.isArray(u) && (u as string[]).includes(id);
};

/** The narrator's live night: who the mafia picked, whom the doctor saves, whom the detective checks… */
function NightLiveView({ rows }: { rows: NightLive[] }) {
  const kills = rows.filter((r) => r.kind === "kill");
  const line = (r: NightLive) => {
    const who = `${ROLE_ICONS[r.actor_role] ?? ""} ${r.actor}`;
    switch (r.kind) {
      case "save":
        return `${who} (الطبيب) يحمي ${r.target}`;
      case "guard":
        return `${who} (الحارس) يحرس ${r.target}`;
      case "inspect":
        return `${who} (المحقق) يحقق مع ${r.target} · ${r.target_role === "mafia" ? "سيظهر له مافيا" : "سيظهر له ليس مافيا"}`;
      case "spy":
        return `${who} (الجاسوس) تحقّق من ${r.target} · ${r.target_role === "citizen" ? "مواطن عادي" : "صاحب دور خاص"}`;
      default:
        return "";
    }
  };
  return (
    <div className="mx-auto mt-4 max-w-md rounded-2xl border border-violet-text/40 bg-violet-fill/10 p-3 text-start">
      <p className="text-sm font-bold text-violet-text">👁️ الليل مباشرة (للراوي فقط)</p>
      {rows.length === 0 ? <p className="mt-2 text-sm text-muted">لم يختر أحد بعد.</p> : null}
      {kills.length ? (
        <p className="mt-2 rounded-xl bg-wrong-fill/20 px-3 py-1.5 text-sm text-ivory">
          🔪 المافيا: {kills.map((k) => `${k.actor} ← ${k.target}`).join("، ")}
        </p>
      ) : null}
      <ul className="mt-1.5 grid gap-1 text-sm text-ivory">
        {rows
          .filter((r) => r.kind !== "kill")
          .map((r, i) => (
            <li key={i} className="rounded-xl bg-deep-2/60 px-3 py-1.5">
              {line(r)}
            </li>
          ))}
      </ul>
    </div>
  );
}

/**
 * The secret card: hidden unless the player touches and holds it, hidden again on release,
 * when the phone is locked or the tab is left. Neighbours never see a role on the screen.
 */
function SecretCard({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const hide = () => setOpen(false);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={open}
      aria-label="بطاقتك السرية: المس لتراها"
      onPointerDown={show}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          show();
        }
      }}
      onKeyUp={hide}
      onBlur={hide}
      className={cx(
        "mt-3 grid min-h-32 cursor-pointer touch-none select-none place-items-center rounded-[22px] border-2 border-dashed p-4 [-webkit-touch-callout:none]",
        open ? "border-gold/70 bg-night/70" : "border-violet-text/50 bg-violet-fill/10",
      )}
    >
      {open ? (
        <div className="w-full">{children}</div>
      ) : (
        <div className="grid justify-items-center gap-1">
          <span aria-hidden="true" className="text-[34px] leading-none">
            🂠
          </span>
          <p className="text-[16px] font-extrabold text-ivory">بطاقتك السرية</p>
          <p className="text-[13px] text-muted">المس هنا لترى دورك، ويختفي حين ترفع إصبعك.</p>
        </div>
      )}
    </div>
  );
}

/** The spy's findings: «مواطن عادي» or «صاحب دور خاص», for the spy and the mafia. */
function SpyChecks({ checks }: { checks: Array<{ round: number; name: string; special: boolean }> }) {
  return (
    <ul className="mx-auto mt-3 grid max-w-xs gap-1.5 text-sm">
      {checks.map((x) => (
        <li key={`${x.round}-${x.name}`} className="flex items-center justify-between gap-3 rounded-xl bg-deep-2/70 px-3 py-1.5">
          <span className="text-muted">🕶️ ليلة {x.round}</span>
          <span className="font-bold text-ivory">{x.name}</span>
          <span className={cx("font-bold", x.special ? "text-gold" : "text-mist")}>{x.special ? "صاحب دور خاص" : "مواطن عادي"}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * «المس لتظهر»: one tap opens the panel (no long press: phones, iPhone above all, often cancel a
 * held touch as their own gesture, so the names never showed). The player chooses, then closes it
 * with «أخفِ اللوحة» at the bottom. It also closes by itself when the phone is locked or the tab is
 * left, or after a minute, so an open phone on the table shows nothing for long.
 */
function TapPanel({ trigger, children, label }: { trigger: ReactNode; children: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setOpen(false), 60000);
    const hide = () => {
      if (document.visibilityState === "hidden") setOpen(false);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [open]);
  if (!open)
    return (
      <button type="button" aria-label={label} onClick={() => setOpen(true)} onContextMenu={(e) => e.preventDefault()} className="mt-4 block w-full select-none [-webkit-touch-callout:none]">
        {trigger}
      </button>
    );
  return (
    <div className="mt-4 rounded-[22px] border-2 border-gold/50 bg-night/70 p-4">
      {children}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-4 min-h-12 w-full rounded-full border border-line-strong/70 bg-deep-2/60 text-[15px] font-bold text-ivory hover:border-gold"
      >
        🙈 أخفِ اللوحة
      </button>
    </div>
  );
}

/**
 * A private ability (the sniper's shot, the seer's look) behind a neutral button that every living
 * player has, so having it gives nothing away.
 */
function SecretAbility({ children, has }: { children: ReactNode; has: boolean }) {
  return (
    <TapPanel label="قدرتي السرية: المس لتظهر" trigger={<span className="inline-flex min-h-11 items-center rounded-full border border-line px-5 text-sm font-bold text-mist">🤫 قدرتي السرية (المس لتظهر)</span>}>
      {has ? children : <p className="rounded-2xl border border-line bg-deep-2/60 p-3 text-sm text-muted">ليس لديك قدرة الآن. شارك في النقاش والتصويت.</p>}
    </TapPanel>
  );
}

/**
 * The night, the same on every phone: a neutral card that opens with a tap. Inside, each role finds
 * its own choice (citizens pick whom they suspect), so a glance at a phone or the sound of tapping
 * gives nothing away.
 */
function NightPanel({ children }: { children: ReactNode }) {
  return (
    <TapPanel
      label="لوحتك الليلية: المس لتظهر الأسماء"
      trigger={
        <span className="grid min-h-24 w-full place-items-center gap-1 rounded-[22px] border-2 border-dashed border-violet-text/50 bg-violet-fill/10 p-4">
          <span aria-hidden="true" className="text-[28px] leading-none">
            🌙
          </span>
          <span className="text-[15px] font-extrabold text-ivory">لوحتك الليلية</span>
          <span className="text-[12px] leading-5 text-muted">المس لتظهر الأسماء، اختر، ثم «أخفِ اللوحة». كل اللاعبين يختارون الليلة.</span>
        </span>
      }
    >
      {children}
    </TapPanel>
  );
}

/** Hidden until held: for anything a neighbour must not read (the roles a ghost sees). */
function HoldToSee({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const hide = () => setOpen(false);
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={open}
      onPointerDown={() => setOpen(true)}
      onPointerUp={() => setOpen(false)}
      onPointerLeave={() => setOpen(false)}
      onPointerCancel={() => setOpen(false)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setOpen(true)}
      onKeyUp={() => setOpen(false)}
      className="touch-none select-none [-webkit-touch-callout:none]"
    >
      {open ? children : <p className="rounded-xl border border-dashed border-line px-3 py-3 text-center text-sm text-muted">{label}</p>}
    </div>
  );
}

/**
 * The narrator's screen: setup (host only), each phase's controls, the roles of everyone
 * and who voted for whom (narrator only). Used by the host, or by the player the draw
 * picked as narrator.
 */
export function MafiaNarratorPanel({ roomId, roomCode, roomStatus, isHost = true }: { roomId: string; roomCode: string; roomStatus: string; isHost?: boolean }) {
  const [state, setState] = useState<MafiaState>({});
  const [rows, setRows] = useState<MafiaPlayerRow[]>([]);
  const [guests, setGuests] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ended = roomStatus === "finished";
  const [progress, setProgress] = useState<MafiaProgress | null>(null);
  const [auto, setAuto] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null);
  // Setup
  const [mafiaCount, setMafiaCount] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [daySeconds, setDaySeconds] = useState(0);
  const [jester, setJester] = useState(false);
  const [mayor, setMayor] = useState(false);
  const [bodyguard, setBodyguard] = useState(false);
  const [sniper, setSniper] = useState(false);
  const [seer, setSeer] = useState(false);
  const [spy, setSpy] = useState(false);
  const [voteSeconds, setVoteSeconds] = useState(60);
  const [nightSeconds, setNightSeconds] = useState(60);
  const [randomNarrator, setRandomNarrator] = useState(0);
  // If the narrator goes away (mafia_v13.sql): 0 = the server goes on with the timers, 1 = it waits.
  const [hostAway, setHostAway] = useState(0);
  const [lovers, setLovers] = useState(false);
  const [deadSee, setDeadSee] = useState(false);
  const [nominate, setNominate] = useState(false);
  const [voteMode, setVoteMode] = useState<VoteMode>("phone");
  const [noFirstKill, setNoFirstKill] = useState(false);
  const [announceSaves, setAnnounceSaves] = useState(false);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [suspicions, setSuspicions] = useState<Suspicion[]>([]);
  const [disguised, setDisguised] = useState(false);
  const [nightLive, setNightLive] = useState<NightLive[]>([]);
  const [roles, setRoles] = useState<NarratorRole[]>([]);
  const [details, setDetails] = useState<(MafiaVote & { round: number; stage: number })[]>([]);

  // Everything reloads when the room's state or players change (realtime, with a slow safety poll);
  // the night and vote progress, which lives in tables without realtime, has its own light poll below.
  const loadAll = async () => {
    if (!supabase) return;
    const client = supabase;
    {
      const [{ data: gs }, { data: list }, { data: prog }, { count }, { data: secret }, { data: detail }] = await Promise.all([
        client.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
        client.rpc("mafia_players", { p_room_id: roomId }),
        client.rpc("mafia_progress", { p_room_id: roomId }),
        client.from("room_players").select("id", { count: "exact", head: true }).eq("room_id", roomId).eq("is_host", false),
        // Narrator only (mafia_v5.sql); empty for anyone else, and before that file runs.
        client.rpc("mafia_roles", { p_room_id: roomId }),
        client.rpc("mafia_vote_details", { p_room_id: roomId }),
      ]);
      setRoles(Array.isArray(secret) ? (secret as NarratorRole[]) : []);
      setDetails(
        Array.isArray(detail)
          ? (detail as Array<{ round: number; stage: number; voter: string; target: string; weight: number; auto: boolean }>).map((d) => ({ ...d }))
          : [],
      );
      if (gs) setState((gs.state_data ?? {}) as MafiaState);
      if (list) setRows(list as MafiaPlayerRow[]);
      setProgress((prog ?? null) as MafiaProgress | null);
      if (typeof count === "number") setGuests(count);
    }
  };
  useLivePoll(`mafia-narrator-${roomId}`, [{ table: "room_game_state", filter: `room_id=eq.${roomId}` }, { table: "room_players", filter: `room_id=eq.${roomId}` }], loadAll);

  async function step(
    fn: "mafia_start" | "mafia_resolve_night" | "mafia_open_vote" | "mafia_close_vote" | "mafia_reset" | "mafia_vote_timeout" | "mafia_nominate" | "mafia_oral_result" | "mafia_redeal",
    args: Record<string, unknown> = {},
  ) {
    if (!supabase || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc(fn, { p_room_id: roomId, ...args });
      if (rpcError) throw rpcError;
      const result = data as { ok: boolean; reason?: string };
      // The phase already moved on (the automatic move, a timer, or a second tap got there first):
      // nothing to report, the screen just catches up.
      if (!result.ok && result.reason === "WRONG_PHASE") await loadAll();
      else if (!result.ok) setError(MAFIA_HOST_ERRORS[result.reason ?? ""] ?? "تعذّر تنفيذ الخطوة.");
    } catch {
      setError("تعذّر تنفيذ الخطوة.");
    } finally {
      setBusy(false);
    }
  }

  const phase = state.phase ?? "";
  // The narrator's phone says «I'm here» every 15 seconds (mafia_v13.sql). Without it for a minute,
  // the server goes on by itself or waits, as the setup chose.
  const narrating = phase === "night" || phase === "day" || phase === "vote";
  useEffect(() => {
    if (!supabase || !narrating) return;
    const client = supabase;
    const ping = () => void client.rpc("mafia_narrator_ping", { p_room_id: roomId });
    ping();
    const t = window.setInterval(ping, 15000);
    return () => window.clearInterval(t);
  }, [roomId, narrating]);
  const round = state.round ?? 1;
  const over = phase === "over";
  const alive = rows.filter((p) => p.alive).length;
  const runoff = Array.isArray(state.runoff) ? state.runoff : null;
  const recap = useMafiaRecap(roomId, over);
  useEffect(() => {
    if (!supabase || !over) return;
    void supabase.rpc("mafia_suspicions", { p_room_id: roomId }).then(({ data }) => setSuspicions(Array.isArray(data) ? (data as Suspicion[]) : []));
  }, [roomId, over]);

  // Who has chosen or voted so far: every 2.5 seconds, during the night and the vote only.
  useEffect(() => {
    if (!supabase || (phase !== "night" && phase !== "vote")) return;
    const client = supabase;
    let live = true;
    const tick = () => {
      void client.rpc("mafia_progress", { p_room_id: roomId }).then(({ data }) => {
        if (live) setProgress((data ?? null) as MafiaProgress | null);
      });
      // The narrator watches the night as it happens (mafia_v7.sql; empty before it runs).
      if (phase === "night")
        void client.rpc("mafia_night_live", { p_room_id: roomId }).then(({ data }) => {
          if (live) setNightLive(Array.isArray(data) ? (data as NightLive[]) : []);
        });
      // Who voted for whom, as it happens (mafia_v9.sql).
      if (phase === "vote")
        void client.rpc("mafia_vote_details", { p_room_id: roomId }).then(({ data }) => {
          if (live && Array.isArray(data)) setDetails(data as typeof details);
        });
    };
    tick();
    const t = window.setInterval(() => document.visibilityState === "visible" && tick(), 2500);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [roomId, phase, round]);

  // After «مباراة جديدة», the setup starts from the last match's choices.
  const prefilled = useRef(false);
  useEffect(() => {
    const last = state.last_settings;
    if (phase !== "" || !last || prefilled.current) return;
    prefilled.current = true;
    setMafiaCount(last.auto_mafia === false ? (last.mafia ?? 0) : 0);
    setReveal(!!last.reveal_roles);
    setDaySeconds(last.day_seconds ?? 0);
    setJester(!!last.jester);
    setMayor(!!last.mayor);
    setBodyguard(!!last.bodyguard);
    setSniper(!!last.sniper);
    setSeer(!!last.seer);
    setSpy(!!last.spy);
    setVoteSeconds(last.vote_seconds ?? 60);
    setNightSeconds(last.night_seconds ?? 0);
    setRandomNarrator(last.narrator === "random" ? 1 : 0);
    setHostAway(last.host_away === "pause" ? 1 : 0);
    setLovers(!!last.lovers);
    setDeadSee(last.dead_see_roles === true);
    setDisguised(!!last.disguised);
    setNominate(!!last.nominate);
    setVoteMode(last.vote_mode === "pick" || last.vote_mode === "count" ? last.vote_mode : "phone");
    setNoFirstKill(!!last.no_first_kill);
    setAnnounceSaves(!!last.announce_saves);
    setPreset(last.preset ?? null);
  }, [phase, state.last_settings]);
  useEffect(() => {
    if (phase !== "") prefilled.current = false;
  }, [phase]);

  // The first match in a room starts from the admin's defaults (admin panel → الموقع).
  const site = useSiteSettings();
  useEffect(() => {
    const d = site?.game_defaults?.["social-mafia"];
    if (!d || phase !== "" || state.last_settings || prefilled.current) return;
    prefilled.current = true;
    if (typeof d.random_narrator === "boolean") setRandomNarrator(d.random_narrator ? 1 : 0);
    if (typeof d.mafia_count === "number" && [0, 1, 2, 3, 4].includes(d.mafia_count)) setMafiaCount(d.mafia_count);
    if (typeof d.reveal === "boolean") setReveal(d.reveal);
    if (typeof d.day_seconds === "number" && [0, 60, 120, 180, 300].includes(d.day_seconds)) setDaySeconds(d.day_seconds);
    if (typeof d.vote_seconds === "number" && [0, 30, 45, 60, 90, 120].includes(d.vote_seconds)) setVoteSeconds(d.vote_seconds);
    if (typeof d.night_seconds === "number" && [0, 45, 60, 90, 120].includes(d.night_seconds)) setNightSeconds(d.night_seconds);
    if (typeof d.dead_see_roles === "boolean") setDeadSee(d.dead_see_roles);
    const r = d.roles ?? {};
    setJester(!!r.jester);
    setMayor(!!r.mayor);
    setBodyguard(!!r.bodyguard);
    setSniper(!!r.sniper);
    setSeer(!!r.seer);
    setSpy(!!r.spy);
    setLovers(!!r.lovers);
    setDisguised(!!r.disguised);
  }, [site, phase, state.last_settings]);

  const dayLeft = useCountdown(phase === "day" ? state.day_ends_at : null);
  const voteLeft = useCountdown(phase === "vote" ? state.vote_ends_at : null);
  const nightLeft = useCountdown(phase === "night" ? state.night_ends_at : null);
  // Everyone has chosen, and at night the mafia agree (mafia_v12.sql: no kill otherwise).
  const complete =
    !!progress && progress.phase === phase && (phase === "night" || phase === "vote") && (progress.total ?? 0) > 0 && (progress.done ?? 0) >= (progress.total ?? 0) && !(phase === "night" && progress.mafia_split);
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

  // The night timer ran out: the night is settled with what was chosen (mafia_v8.sql).
  const nightDone = useRef("");
  useEffect(() => {
    if (phase !== "night" || nightLeft !== 0 || nightDone.current === stepKey || !supabase) return;
    nightDone.current = stepKey;
    void supabase.rpc("mafia_night_timeout", { p_room_id: roomId });
    // A one-shot call when the timer hits zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, nightLeft, stepKey]);

  /** Settling the night or closing the vote with choices missing: ask first. */
  function confirmMissing(kind: "night" | "vote") {
    const p = progress && progress.phase === kind ? progress : null;
    const done = p?.done ?? 0;
    const names = waitingText(p?.waiting);
    if (kind === "night") {
      if (done === 0) return window.confirm("لم يختر أحد من أصحاب الأدوار بعد! إذا حسمت الليل الآن لن يحدث شيء الليلة. تأكد أن الجميع فتح جواله. تحسم الليل الآن؟");
      if (names) return window.confirm(`لم يختر بعد: ${names}. تحسم الليل الآن؟`);
      return true;
    }
    if (done === 0) return window.confirm("لم يصوّت أحد! إذا أغلقت التصويت الآن ينتهي اليوم بلا إقصاء. تغلقه الآن؟");
    if (names) return window.confirm(`لم يصوّت بعد: ${names}. تغلق التصويت الآن؟`);
    return true;
  }

  // The vote timer ran out: the system votes at random for whoever hasn't, and shows the result.
  const voteDone = useRef("");
  useEffect(() => {
    if (phase !== "vote" || voteLeft !== 0 || voteDone.current === stepKey) return;
    voteDone.current = stepKey;
    void step("mafia_vote_timeout");
    // step is stable for this one-shot call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, voteLeft, stepKey]);

  /** One tap sets everything for a kind of evening; «إعدادات متقدمة» still changes any of it. */
  function applyPreset(k: Preset) {
    setPreset(k);
    setMafiaCount(0);
    setReveal(false);
    setDaySeconds(0);
    setDeadSee(false);
    setVoteMode("phone");
    setNoFirstKill(false);
    const roles = { jester: false, mayor: false, bodyguard: false, sniper: false, seer: false, spy: false, lovers: false, disguised: false };
    if (k === "quick") {
      setNightSeconds(60);
      setVoteSeconds(45);
      setNominate(false);
    } else if (k === "beginners") {
      setNightSeconds(0);
      setVoteSeconds(0);
      setNominate(false);
    } else {
      setNightSeconds(90);
      setVoteSeconds(0);
      setNominate(true);
      // As many extra roles as the room fits, in this order.
      const order: Array<keyof typeof roles> = ["bodyguard", "mayor", "jester", "sniper", "seer", "spy", "disguised", "lovers"];
      const mafia = guests >= 10 ? 3 : guests >= 7 ? 2 : 1;
      let special = 2;
      for (const r of order) {
        const cost = r === "lovers" ? 0 : 1;
        const spyTooMany = r === "spy" && (mafia + 1) * 2 >= guests;
        if (mafia + special + cost < guests && !spyTooMany) {
          roles[r] = true;
          special += cost;
        }
      }
    }
    setJester(roles.jester);
    setMayor(roles.mayor);
    setBodyguard(roles.bodyguard);
    setSniper(roles.sniper);
    setSeer(roles.seer);
    setSpy(roles.spy);
    setLovers(roles.lovers);
    setDisguised(roles.disguised);
  }

  const settingsNow = (state.settings ?? {}) as { vote_mode?: string; nominate?: boolean; no_first_kill?: boolean; spy?: boolean; bodyguard?: boolean };
  const oralMode = settingsNow.vote_mode === "pick" || settingsNow.vote_mode === "count" ? (settingsNow.vote_mode as "pick" | "count") : null;

  const headline =
    phase === "" ? "جاهزون للبدء؟"
    : phase === "night" ? `🌙 ليل الجولة ${round}`
    : phase === "day" ? `☀️ نهار الجولة ${round}`
    : phase === "vote" ? (runoff ? "إعادة التصويت" : "التصويت")
    : "انتهت اللعبة";

  const maxMafia = Math.max(1, Math.floor((guests - 1) / 2));
  const autoMafia = guests >= 10 ? 3 : guests >= 7 ? 2 : 1;
  // A chosen count larger than the room allows (a default, or players who left) falls back to automatic.
  const plannedMafia = (mafiaCount <= maxMafia ? mafiaCount : 0) || autoMafia;
  const special = 2 + Number(jester) + Number(mayor) + Number(bodyguard) + Number(sniper) + Number(seer) + Number(spy) + Number(disguised);
  const fits = guests >= 5 && (plannedMafia + Number(spy)) * 2 < guests && plannedMafia + special < guests;
  const roundVotes = details.filter((d) => d.round === round);
  const shownVotes = roundVotes.length ? roundVotes.filter((d) => d.stage === Math.max(...roundVotes.map((x) => x.stage))) : details.filter((d) => d.round === round - 1);

  return (
    <section className="mx-auto mt-2 max-w-2xl lg:max-w-3xl tv:max-w-5xl">
      <div className="glass-card rounded-[28px] p-6 text-center">
        <p className="text-xs font-bold text-violet-text">رمز الغرفة</p>
        <p className="room-code mt-1 text-3xl text-gold">{roomCode}</p>
        <p className="mt-4 text-xl font-extrabold text-ivory">{headline}</p>
        {!isHost ? <p className="mt-1 text-xs font-bold text-violet-text">🎙️ أنت الراوي: لا تلعب، وتدير الجولات من هنا.</p> : null}
        {state.last_result ? <p className="mt-3 text-sm font-bold text-ivory">{state.last_result}</p> : null}

        {phase === "night" ? <NightSteps state={state} /> : null}
        {phase !== "night" && narratorLine(state, rows) ? (
          <div className="mt-4 rounded-2xl border border-violet-text/40 bg-violet-fill/10 p-3 text-start">
            <p className="text-xs font-bold text-violet-text">🎙️ اقرأ بصوت عالٍ</p>
            <p className="mt-1 text-[15px] leading-7 text-ivory">{narratorLine(state, rows)}</p>
          </div>
        ) : null}

        {phase === "" && !isHost ? <p className="mt-4 text-sm text-muted">المضيف يجهّز اللعبة.</p> : null}
        {phase === "" ? <EveningView roomId={roomId} phase={phase} /> : null}
        {phase === "" && isHost ? (
          <div className="mt-5 grid gap-4 text-start">
            <p className="text-center text-sm text-muted">
              يلعب {guests} {guests > 2 && guests < 11 ? "لاعبين" : "لاعبًا"}، والراوي لا يلعب.
            </p>
            <div className="grid gap-1.5">
              <span className="text-sm font-bold text-ivory">جلسة جاهزة</span>
              <div className="grid grid-cols-3 gap-2">
                {PRESETS.map((x) => (
                  <button
                    key={x.key}
                    type="button"
                    aria-pressed={preset === x.key}
                    onClick={() => applyPreset(x.key)}
                    className={cx("grid min-h-20 content-center gap-0.5 rounded-2xl border p-2 text-center", preset === x.key ? "border-gold bg-gold/10" : "border-line bg-deep-2/50")}
                  >
                    <span className="text-[20px] leading-none">{x.icon}</span>
                    <b className="text-[14px] text-ivory">{x.label}</b>
                    <span className="text-[11px] leading-4 text-muted">{x.text}</span>
                  </button>
                ))}
              </div>
            </div>
            <MafiaChoice
              label="من الراوي؟"
              value={randomNarrator}
              onChange={setRandomNarrator}
              options={[
                { value: 0, label: "المضيف" },
                { value: 1, label: "لاعب بالقرعة" },
              ]}
            />
            {randomNarrator ? (
              <p className="-mt-2 text-xs text-muted">يُختار الراوي عشوائيًا من الجميع (والمضيف معهم)، ويلعب المضيف مثل الباقين إن لم يقع عليه الاختيار. يظهر للراوي أزرار التحكم في جواله.</p>
            ) : null}
            <details className="group grid gap-4 rounded-2xl border border-line p-3" open={preset === null}>
            <summary className="cursor-pointer text-sm font-bold text-ivory">⚙️ إعدادات متقدمة</summary>
            <div className="mt-3 grid gap-4">
            <MafiaChoice
              label="إذا غاب الراوي أكثر من دقيقة"
              value={hostAway}
              onChange={setHostAway}
              options={[
                { value: 0, label: "🤖 يكمل النظام بالوقت" },
                { value: 1, label: "⏸️ تتوقف حتى يرجع" },
              ]}
            />
            <MafiaChoice
              label="طريقة التصويت"
              value={voteMode === "phone" ? 0 : voteMode === "pick" ? 1 : 2}
              onChange={(v) => setVoteMode(v === 1 ? "pick" : v === 2 ? "count" : "phone")}
              options={[
                { value: 0, label: "بالجوال" },
                { value: 1, label: "شفوي: الراوي يختار الخارج" },
                { value: 2, label: "شفوي: الراوي يكتب الأصوات" },
              ]}
            />
            <label className="flex items-start gap-3 rounded-2xl border border-line bg-deep-2/50 p-3">
              <input type="checkbox" checked={nominate} onChange={(e) => setNominate(e.target.checked)} className="mt-1 size-5 accent-[var(--color-gold)]" />
              <span>
                <b className="text-ivory">🗳️ ترشيح قبل التصويت</b>
                <span className="block text-xs text-muted">الراوي يختار مرشحَين أو ثلاثة حسب النقاش، والتصويت عليهم فقط.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-2xl border border-line bg-deep-2/50 p-3">
              <input type="checkbox" checked={noFirstKill} onChange={(e) => setNoFirstKill(e.target.checked)} className="mt-1 size-5 accent-[var(--color-gold)]" />
              <span>
                <b className="text-ivory">🌙 الليلة الأولى بلا قتل</b>
                <span className="block text-xs text-muted">ليلة تعارف: المافيا تتعرف على بعضها ولا تختار ضحية.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-2xl border border-line bg-deep-2/50 p-3">
              <input type="checkbox" checked={announceSaves} onChange={(e) => setAnnounceSaves(e.target.checked)} className="mt-1 size-5 accent-[var(--color-gold)]" />
              <span>
                <b className="text-ivory">🩺 أعلن المحاولة الفاشلة</b>
                <span className="block text-xs text-muted">إذا نجت الضحية يُقال «حاولت المافيا القتل، لكن الطبيب أنقذ الضحية» بدون ذكر الاسم.</span>
              </span>
            </label>
            <MafiaChoice
              label="عدد المافيا"
              value={mafiaCount <= maxMafia ? mafiaCount : 0}
              onChange={setMafiaCount}
              options={[{ value: 0, label: `تلقائي (${autoMafia})` }, ...[1, 2, 3, 4].filter((n) => n <= maxMafia).map((n) => ({ value: n, label: String(n) }))]}
            />
            <MafiaChoice
              label="مؤقت النهار (للنقاش)"
              value={daySeconds}
              onChange={setDaySeconds}
              options={[
                { value: 0, label: "بدون (الراوي يفتح التصويت)" },
                { value: 60, label: "دقيقة" },
                { value: 120, label: "دقيقتان" },
                { value: 180, label: "3 دقائق" },
                { value: 300, label: "5 دقائق" },
              ]}
            />
            <MafiaChoice
              label="مؤقت الليل"
              value={nightSeconds}
              onChange={setNightSeconds}
              options={[
                { value: 0, label: "بدون" },
                { value: 45, label: "45 ثانية" },
                { value: 60, label: "دقيقة" },
                { value: 90, label: "دقيقة ونصف" },
                { value: 120, label: "دقيقتان" },
              ]}
            />
            {nightSeconds ? <p className="-mt-2 text-xs text-muted">حين ينتهي وقت الليل يُحسم بما اختاره أصحاب الأدوار حتى تلك اللحظة.</p> : null}
            <MafiaChoice
              label="مؤقت التصويت"
              value={voteSeconds}
              onChange={setVoteSeconds}
              options={[
                { value: 0, label: "بدون" },
                { value: 30, label: "30 ثانية" },
                { value: 45, label: "45 ثانية" },
                { value: 60, label: "دقيقة" },
                { value: 90, label: "دقيقة ونصف" },
                { value: 120, label: "دقيقتان" },
              ]}
            />
            {voteSeconds ? <p className="-mt-2 text-xs text-muted">إذا انتهى الوقت، من لم يصوّت يُحسب ممتنعًا وتظهر النتيجة مباشرة.</p> : null}
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
                { on: spy, set: setSpy, role: "spy", text: "حليف المافيا: يعرفهم ويعرفونه ولا يختار ضحية، ويفوز معهم." },
                { on: lovers, set: setLovers, role: "lovers", text: "لاعبان من فريق المواطنين يعرف كل منهما الآخر، وإذا مات أحدهما مات الآخر حزنًا." },
                { on: disguised, set: setDisguised, role: "disguised", text: "إذا صُوِّت عليه نهارًا لا يموت في المرة الأولى: يُعلن أنه المتخفي وينتهي تصويت اليوم بلا إقصاء." },
              ].map((r) => (
                <label key={r.role} className="flex items-start gap-3 rounded-2xl border border-line bg-deep-2/50 p-3">
                  <input type="checkbox" checked={r.on} onChange={(e) => r.set(e.target.checked)} className="mt-1 size-5 accent-[var(--color-gold)]" />
                  <span>
                    <b className="text-ivory">{r.role === "lovers" ? "❤️ العاشقان" : `${ROLE_ICONS[r.role]} ${ROLE_NAMES[r.role]}`}</b>
                    <span className="block text-xs text-muted">{r.text}</span>
                  </span>
                </label>
              ))}
            </div>
            <label className="flex items-start gap-3 rounded-2xl border border-line bg-deep-2/50 p-3">
              <input type="checkbox" checked={deadSee} onChange={(e) => setDeadSee(e.target.checked)} className="mt-1 size-5 accent-[var(--color-gold)]" />
              <span>
                <b className="text-ivory">👻 المقتولون يرون الأدوار</b>
                <span className="block text-xs text-muted">من يخرج يتابع اللعبة ويرى أدوار الجميع في جواله (باللمس)، بشرط ألا يتكلم أو يلمّح.</span>
              </span>
            </label>
            </div>
            </details>
            <p className={cx("text-center text-xs", fits ? "text-muted" : "text-gold")}>
              {guests < 5
                ? "تحتاجون 5 لاعبين على الأقل غير الراوي."
                : fits
                  ? `الأدوار: ${plannedMafia} مافيا${spy ? "، جاسوس" : ""}، طبيب، محقق${bodyguard ? "، حارس" : ""}${mayor ? "، عمدة" : ""}${jester ? "، مهرّج" : ""}${sniper ? "، قنّاص" : ""}${seer ? "، عرّافة" : ""}${disguised ? "، متخفٍّ" : ""}، والباقي مواطنون (${guests - plannedMafia - special})${lovers ? "، واثنان من فريق المواطنين عاشقان" : ""}.`
                  : "الأدوار أكثر من اللاعبين. قلّل الأدوار الإضافية أو عدد المافيا."}
            </p>
          </div>
        ) : null}

        {over ? null : <NarratorGrid rows={rows} roles={roles} state={state} runoff={runoff} showRoles={over} />}
        {phase !== "" && !over ? <p className="mt-3 text-xs text-muted">الأحياء: {alive}</p> : null}

        {phase === "day" ? <TimerControls roomId={roomId} state={state} left={dayLeft} /> : null}

        {progress && progress.phase === phase && (phase === "night" || phase === "vote") ? (
          <div className="mt-4 grid justify-items-center gap-2">
            <p className="text-lg font-extrabold text-ivory">
              {phase === "night" ? "اختار" : "صوّت"} <span className="tabular-nums text-gold">{progress.done ?? 0}</span> من{" "}
              <span className="tabular-nums">{progress.total ?? 0}</span>
            </p>
            {phase === "night" && progress.mafia_split ? <p className="text-xs font-semibold text-gold">⚠️ المافيا لم تتفق بعد على ضحية واحدة. الانتقال التلقائي ينتظر اتفاقهم، وإذا أنهيت الليلة وهم مختلفون فلا قتل.</p> : null}
            {waitingText(progress.waiting) ? (
              <p className="text-sm text-gold">⏳ {phase === "night" ? "لم يختر بعد" : "لم يصوّت بعد"}: {waitingText(progress.waiting)}</p>
            ) : null}
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

        {phase === "night" ? <TimerControls roomId={roomId} state={state} left={nightLeft} icon="🌙 " /> : null}

        {phase === "vote" ? <TimerControls roomId={roomId} state={state} left={voteLeft} /> : null}

        {phase === "night" && roles.length > 0 ? <NightLiveView rows={nightLive} /> : null}
        {(phase === "day" || phase === "vote") && roles.length > 0 ? <NightReport roomId={roomId} round={round} /> : null}

        {(phase === "night" || phase === "vote") && shownVotes.length > 0 ? (
          <div className="mx-auto mt-4 max-w-md">
            <VotesView votes={shownVotes} />
          </div>
        ) : null}

        {phase === "day" && !oralMode && settingsNow.nominate ? (
          <Nominate rows={rows} busy={busy} onNominate={(ids) => step("mafia_nominate", { p_nominees: ids })} onAll={() => step("mafia_open_vote")} />
        ) : null}
        {oralMode && (phase === "day" || phase === "vote") ? (
          <OralVote
            mode={oralMode}
            rows={rows.filter((p) => p.alive && (!runoff || runoff.includes(p.player_id)))}
            nominate={!!settingsNow.nominate && !runoff}
            busy={busy}
            onSubmit={(counts, pick) => step("mafia_oral_result", { p_counts: counts, p_pick: pick })}
          />
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {phase === "" && isHost ? (
            <Button
              type="button"
              tone="primary"
              onClick={() =>
                step("mafia_start", {
                  p_settings: {
                    mafia: (mafiaCount <= maxMafia ? mafiaCount : 0) || null,
                    reveal_roles: reveal,
                    day_seconds: daySeconds,
                    vote_seconds: voteSeconds,
                    night_seconds: nightSeconds,
                    narrator: randomNarrator ? "random" : "host",
                    host_away: hostAway ? "pause" : "auto",
                    jester,
                    mayor,
                    bodyguard,
                    sniper,
                    seer,
                    spy,
                    lovers,
                    disguised,
                    dead_see_roles: deadSee,
                    nominate,
                    vote_mode: voteMode,
                    no_first_kill: noFirstKill,
                    announce_saves: announceSaves,
                    preset,
                  },
                })
              }
              disabled={busy || !fits}
            >
              وزّع الأدوار وابدأ
            </Button>
          ) : null}
          {phase === "night" ? (
            <Button type="button" tone="primary" onClick={() => confirmMissing("night") && step("mafia_resolve_night")} disabled={busy}>
              الفجر: احسم الليل
            </Button>
          ) : null}
          {phase === "day" && !oralMode && !settingsNow.nominate ? (
            <Button type="button" tone="primary" onClick={() => step("mafia_open_vote")} disabled={busy}>
              افتح التصويت
            </Button>
          ) : null}
          {phase === "vote" && !oralMode ? (
            <Button type="button" tone="primary" onClick={() => confirmMissing("vote") && step("mafia_close_vote")} disabled={busy}>
              أغلق التصويت
            </Button>
          ) : null}
        </div>

        {over ? (
          <div className="mt-5 grid gap-4">
            <p className="text-2xl font-extrabold text-ivory">{WINNERS[state.winner ?? ""] ?? "انتهت اللعبة"}</p>
            <MafiaSummary state={state} rows={rows} />
            <SuspicionsView list={suspicions} />
            <EveningView roomId={roomId} phase={phase} />
            <RevealControls roomId={roomId} state={state} rows={rows} />
            <MafiaRecapView recap={recap} />
            <MafiaShare state={state} rows={rows} recap={recap} />
            {isHost ? (
              <Button type="button" tone="primary" className="mx-auto" onClick={() => step("mafia_reset")} disabled={busy}>
                مباراة جديدة بنفس اللاعبين
              </Button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-wrong">
            {error}
          </p>
        ) : null}
        {phase !== "" ? (
          <div className="mt-6 border-t border-line pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("إعادة توزيع الأدوار من جديد؟ تبدأ مباراة جديدة بنفس الإعدادات، والحالية تنتهي بلا نتيجة.")) void step("mafia_redeal");
              }}
              className="mx-auto flex min-h-11 items-center gap-2 rounded-full border border-line-strong/70 px-5 text-sm font-bold text-mist hover:border-gold hover:text-ivory"
            >
              🔄 إعادة توزيع الأدوار
            </button>
          </div>
        ) : null}
      </div>

      {isHost && (ended || roomStatus === "finished") ? <p className="mt-6 text-center text-sm text-muted">انتهت الغرفة.</p> : null}
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

type VoteMode = "phone" | "pick" | "count";
type Preset = "quick" | "diwaniya" | "beginners";
type Suspicion = { name: string; times: number; role: string | null };

const PRESETS: Array<{ key: Preset; icon: string; label: string; text: string }> = [
  { key: "quick", icon: "⚡", label: "سريعة", text: "بلا أدوار إضافية، ومؤقتات قصيرة" },
  { key: "diwaniya", icon: "🏠", label: "ديوانية كاملة", text: "كل الأدوار، بلا مؤقت للنقاش، مع ترشيح" },
  { key: "beginners", icon: "🌱", label: "مبتدئين", text: "مافيا وطبيب ومحقق فقط" },
];

/** The night, one call at a time: the narrator reads a line, waits, then taps «التالي». */
function NightSteps({ state }: { state: MafiaState }) {
  const s = (state.settings ?? {}) as { spy?: boolean; bodyguard?: boolean; no_first_kill?: boolean };
  const round = state.round ?? 1;
  const firstSafe = !!s.no_first_kill && round === 1;
  const steps = [
    round > 1 ? "حلّ الليل من جديد… أغمضوا أعينكم جميعًا. كل واحد يفتح لوحته الليلية من جواله." : "حلّ الليل… أغمضوا أعينكم جميعًا. كل واحد يفتح لوحته الليلية من جواله.",
    firstSafe
      ? `المافيا${s.spy ? " والجاسوس" : ""}: افتحوا أعينكم وتعرّفوا على بعض… لا ضحية الليلة. أغمضوا.`
      : s.spy && round <= 1
        ? "المافيا والجاسوس: افتحوا أعينكم وتعرّفوا على بعض. المافيا تختار ضحيتها من الجوال… ثم أغمضوا."
        : "المافيا: اختاروا ضحيتكم من الجوال بهدوء… ثم أغمضوا.",
    "الطبيب: من تحمي الليلة؟",
    "المحقق: من تشكّ فيه؟",
    ...(s.bodyguard ? ["الحارس: من تحرس؟"] : []),
    ...(s.spy ? ["الجاسوس: إن حان دورك (كل جولتين) تحقّق من لاعب."] : []),
    "والباقون: اختاروا من تشكّون فيه، ثم ضعوا جوالاتكم.",
  ];
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [round]);
  return (
    <div className="mt-4 rounded-2xl border border-violet-text/40 bg-violet-fill/10 p-3 text-start">
      <p className="text-xs font-bold text-violet-text">
        🎙️ اقرأ بصوت عالٍ · {i + 1} من {steps.length}
      </p>
      <p className="mt-1 min-h-14 text-[17px] font-bold leading-8 text-ivory">{steps[i]}</p>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-2">
        <Button type="button" tone="quiet" className="min-h-11 px-4" disabled={i === 0} onClick={() => setI(i - 1)}>
          السابق
        </Button>
        <Button type="button" tone="secondary" className="min-h-11" disabled={i === steps.length - 1} onClick={() => setI(i + 1)}>
          التالي
        </Button>
      </div>
    </div>
  );
}

/** Nominations: the narrator picks 2 or 3 players from the discussion; the vote is on them only. */
function Nominate({ rows, busy, onNominate, onAll }: { rows: MafiaPlayerRow[]; busy: boolean; onNominate: (ids: string[]) => void; onAll: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <div className="mx-auto mt-4 grid max-w-md gap-2 rounded-2xl border border-gold/40 bg-gold/5 p-3 text-start">
      <p className="text-sm font-bold text-ivory">🗳️ المرشحون ({picked.length} من 3)</p>
      <p className="text-xs text-muted">اختر مرشحَين أو ثلاثة حسب النقاش، ثم افتح التصويت عليهم.</p>
      <div className="flex flex-wrap gap-2">
        {rows
          .filter((p) => p.alive)
          .map((p) => {
            const on = picked.includes(p.player_id);
            return (
              <button
                key={p.player_id}
                type="button"
                aria-pressed={on}
                disabled={!on && picked.length >= 3}
                onClick={() => setPicked(on ? picked.filter((x) => x !== p.player_id) : [...picked, p.player_id])}
                className={cx("min-h-11 rounded-full border px-4 text-sm font-bold disabled:opacity-40", on ? "border-gold bg-gold/15 text-gold" : "border-line text-ivory")}
              >
                {p.player_name}
              </button>
            );
          })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" tone="primary" disabled={busy || picked.length < 2} onClick={() => onNominate(picked)}>
          افتح التصويت على المرشحين
        </Button>
        <Button type="button" tone="quiet" disabled={busy} onClick={onAll}>
          تصويت على الكل
        </Button>
      </div>
    </div>
  );
}

/** The oral vote: hands go up, and the narrator records who goes out, or the count for each player. */
function OralVote({ mode, rows, nominate, busy, onSubmit }: { mode: "pick" | "count"; rows: MafiaPlayerRow[]; nominate: boolean; busy: boolean; onSubmit: (counts: Record<string, number>, pick: boolean) => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [nominees, setNominees] = useState<string[]>([]);
  const list = nominate && nominees.length >= 2 ? rows.filter((p) => nominees.includes(p.player_id)) : rows;
  const total = (Object.values(counts) as number[]).reduce((a, b) => a + b, 0);
  return (
    <div className="mx-auto mt-4 grid max-w-md gap-3 rounded-2xl border border-gold/40 bg-gold/5 p-3 text-start">
      <p className="text-sm font-bold text-ivory">✋ التصويت برفع اليد</p>
      {nominate ? (
        <div className="grid gap-1.5">
          <p className="text-xs text-muted">المرشحون (اختياري، 2 أو 3):</p>
          <div className="flex flex-wrap gap-1.5">
            {rows.map((p) => {
              const on = nominees.includes(p.player_id);
              return (
                <button
                  key={p.player_id}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && nominees.length >= 3}
                  onClick={() => setNominees(on ? nominees.filter((x) => x !== p.player_id) : [...nominees, p.player_id])}
                  className={cx("min-h-10 rounded-full border px-3 text-[13px] font-bold disabled:opacity-40", on ? "border-gold bg-gold/15 text-gold" : "border-line text-mist")}
                >
                  {p.player_name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {mode === "pick" ? (
        <>
          <p className="text-xs text-muted">من خرج بالتصويت؟</p>
          <div className="flex flex-wrap gap-2">
            {list.map((p) => (
              <button
                key={p.player_id}
                type="button"
                aria-pressed={pick === p.player_id}
                onClick={() => setPick(pick === p.player_id ? null : p.player_id)}
                className={cx("min-h-11 rounded-full border px-4 text-sm font-bold", pick === p.player_id ? "border-wrong bg-wrong-fill/20 text-ivory" : "border-line text-ivory")}
              >
                {p.is_mayor ? "👑 " : ""}
                {p.player_name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" tone="primary" disabled={busy || !pick} onClick={() => pick && onSubmit({ [pick]: 1 }, true)}>
              أعلن خروجه
            </Button>
            <Button type="button" tone="quiet" disabled={busy} onClick={() => window.confirm("لا إقصاء اليوم؟") && onSubmit({}, true)}>
              لا إقصاء
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">عدد الأيدي لكل لاعب (صوت العمدة بصوتين). التعادل يعيد التصويت بين المتعادلين.</p>
          <ul className="grid gap-1.5">
            {list.map((p) => (
              <li key={p.player_id} className="flex items-center gap-2 rounded-xl bg-deep-2/60 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-ivory">
                  {p.is_mayor ? "👑 " : ""}
                  {p.player_name}
                </span>
                <button type="button" aria-label={`أنقص ${p.player_name}`} className="grid size-10 place-items-center rounded-full border border-line text-ivory" onClick={() => setCounts({ ...counts, [p.player_id]: Math.max(0, (counts[p.player_id] ?? 0) - 1) })}>
                  −
                </button>
                <span dir="ltr" className="w-8 text-center font-display text-xl font-extrabold tabular-nums text-gold">
                  {counts[p.player_id] ?? 0}
                </span>
                <button type="button" aria-label={`زِد ${p.player_name}`} className="grid size-10 place-items-center rounded-full border border-line text-ivory" onClick={() => setCounts({ ...counts, [p.player_id]: (counts[p.player_id] ?? 0) + 1 })}>
                  +
                </button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            tone="primary"
            disabled={busy}
            onClick={() => (total > 0 || window.confirm("لم تسجّل أي صوت. ينتهي اليوم بلا إقصاء؟")) && onSubmit(Object.fromEntries((Object.entries(counts) as Array<[string, number]>).filter(([, n]) => n > 0)), false)}
          >
            أعلن النتيجة ({total} {total === 1 ? "صوت" : "أصوات"})
          </Button>
        </>
      )}
    </div>
  );
}

/** At the end: who the players suspected most at night, and what they really were. */
function SuspicionsView({ list }: { list: Suspicion[] }) {
  if (!list.length) return null;
  return (
    <div className="rounded-[14px] border border-violet-text/40 bg-violet-fill/10 px-3 py-2 text-start text-[13px]">
      <p className="font-bold text-violet-text">🤔 أكثر من اشتبهتم فيه ليلًا</p>
      <ul className="mt-1 grid gap-1">
        {list.map((x) => (
          <li key={x.name} className="text-ivory">
            {x.name}: {x.times === 1 ? "مرة" : x.times === 2 ? "مرتان" : `${x.times} مرات`}
            {x.role ? <span className="text-mist"> · وكان {ROLE_NAMES[x.role] ?? ""}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The narrator's one grid: every player with role, and status (out, mayor, lover, unmasked). */
function NarratorGrid({ rows, roles, state, runoff, showRoles }: { rows: MafiaPlayerRow[]; roles: NarratorRole[]; state: MafiaState; runoff: string[] | null; showRoles: boolean }) {
  const byId = new Map(roles.map((r) => [r.player_id, r]));
  return (
    <ul className="mt-6 grid grid-cols-2 gap-2 text-start sm:grid-cols-3">
      {rows.map((p) => {
        const r = byId.get(p.player_id);
        const role = r?.role ?? (showRoles || !p.alive ? p.player_role : null) ?? null;
        const evil = role === "mafia" || role === "spy";
        return (
          <li
            key={p.player_id}
            className={cx(
              "flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2",
              evil ? "bg-wrong-fill/20" : "bg-deep-2/70",
              !p.alive && "opacity-55",
              runoff?.includes(p.player_id) && "ring-2 ring-gold",
              (state.nominees ?? []).includes(p.player_id) && "ring-2 ring-gold/60",
            )}
          >
            <span aria-hidden="true" className="text-[20px] leading-none">
              {role ? ROLE_ICONS[role] : "•"}
            </span>
            <span className="grid min-w-0 flex-1">
              <span className={cx("truncate text-sm font-bold", p.alive ? "text-ivory" : "text-muted line-through")}>
                {p.player_name}
                {p.is_mayor ? " 👑" : ""}
                {r?.lover ? " ❤️" : ""}
                {isUnmasked(state, p.player_id) ? " 🎭" : ""}
              </span>
              <span className="truncate text-[11px] text-mist">
                {role ? ROLE_NAMES[role] : ""}
                {!p.alive ? " · خرج" : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

type NightReportData = {
  round: number;
  target: string | null;
  picks: Array<{ by: string; target: string }>;
  save: string | null;
  saved: boolean;
  guard: string | null;
  guard_by: string | null;
  victim: string | null;
  inspect: { by: string; target: string; mafia: boolean } | null;
  spy: { by: string; target: string; special: boolean } | null;
};

/** What happened last night, for the narrator only (mafia_v10.sql). */
function NightReport({ roomId, round }: { roomId: string; round: number }) {
  const [r, setR] = useState<NightReportData | null>(null);
  useEffect(() => {
    if (!supabase) return;
    void supabase.rpc("mafia_night_report", { p_room_id: roomId }).then(({ data }) => setR((data ?? null) as NightReportData | null));
  }, [roomId, round]);
  if (!r) return null;
  const lines = [
    r.target
      ? `🔪 المافيا اختارت ${r.target}${r.picks.length > 1 ? ` (${r.picks.map((x) => `${x.by} ← ${x.target}`).join("، ")})` : ""}`
      : r.picks.length
        ? `🔪 المافيا لم تتفق، فلا قتل (${r.picks.map((x) => `${x.by} ← ${x.target}`).join("، ")})`
        : "🔪 المافيا لم تختر أحدًا",
    r.save ? `🩺 الطبيب حمى ${r.save}${r.saved ? " وأنقذه!" : ""}` : "🩺 الطبيب لم يحمِ أحدًا",
    r.guard ? `🛡️ ${r.guard_by ?? "الحارس"} حرس ${r.guard}` : null,
    r.inspect ? `🔍 ${r.inspect.by} حقق مع ${r.inspect.target}: ${r.inspect.mafia ? "مافيا" : "ليس مافيا"}` : null,
    r.spy ? `🕶️ ${r.spy.by} تحقق من ${r.spy.target}: ${r.spy.special ? "صاحب دور خاص" : "مواطن عادي"}` : null,
    r.victim ? `💀 مات ${r.victim}` : "💀 لم يمت أحد",
  ].filter(Boolean) as string[];
  return (
    <details className="mx-auto mt-4 max-w-md rounded-2xl border border-violet-text/40 bg-violet-fill/10 p-3 text-start">
      <summary className="cursor-pointer text-sm font-bold text-violet-text">🌙 ماذا حدث الليلة {r.round} (للراوي فقط)</summary>
      <ul className="mt-2 grid gap-1 text-sm text-ivory">
        {lines.map((l) => (
          <li key={l} className="rounded-xl bg-deep-2/60 px-3 py-1.5">
            {l}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The phase timer with pause, resume and +30 seconds (mafia_v10.sql). */
function TimerControls({ roomId, state, left, icon = "" }: { roomId: string; state: MafiaState; left: number | null; icon?: string }) {
  const paused = pausedLeft(state);
  const [busy, setBusy] = useState(false);
  if (left === null && paused === null) return null;
  async function act(action: "pause" | "resume" | "add") {
    if (!supabase) return;
    setBusy(true);
    await supabase.rpc("mafia_timer", { p_room_id: roomId, p_action: action });
    setBusy(false);
  }
  const shown = paused ?? left ?? 0;
  return (
    <div className="mt-4 grid justify-items-center gap-2">
      <p className={cx("font-display text-4xl font-extrabold tabular-nums", paused !== null ? "text-mist" : shown <= 10 ? "text-wrong" : "text-gold")} dir="ltr">
        {paused !== null ? "⏸ " : icon}
        {mmss(shown)}
      </p>
      <div className="flex gap-2">
        <Button type="button" tone="quiet" className="min-h-10 px-4 text-sm" disabled={busy} onClick={() => act(paused !== null ? "resume" : "pause")}>
          {paused !== null ? "▶ استئناف" : "⏸ إيقاف"}
        </Button>
        <Button type="button" tone="quiet" className="min-h-10 px-4 text-sm" disabled={busy} onClick={() => act("add")}>
          +30 ثانية
        </Button>
      </div>
    </div>
  );
}

type Evening = { matches: number; wins: { mafia?: number; citizens?: number; jester?: number }; players: Record<string, { played: number; won: number; finds: number }> };

/** The whole evening, match after match (mafia_v10.sql): wins per side, best player, best detective. */
export function EveningView({ roomId, phase, big = false }: { roomId: string; phase: string; big?: boolean }) {
  const [ev, setEv] = useState<Evening | null>(null);
  useEffect(() => {
    if (!supabase) return;
    void supabase.rpc("mafia_evening", { p_room_id: roomId }).then(({ data }) => setEv((data ?? null) as Evening | null));
  }, [roomId, phase]);
  if (!ev || !ev.matches) return null;
  const players = Object.entries(ev.players ?? {}) as Array<[string, { played: number; won: number; finds: number }]>;
  const best = [...players].sort((a, b) => b[1].won - a[1].won || a[1].played - b[1].played)[0];
  const sleuth = [...players].filter(([, p]) => p.finds > 0).sort((a, b) => b[1].finds - a[1].finds)[0];
  return (
    <div className={cx("rounded-[16px] border border-gold/40 bg-gold/5 px-3 py-2 text-start", big ? "text-[clamp(15px,1.4vw,28px)]" : "text-[13px]")}>
      <p className="font-bold text-gold">🏆 نتيجة السهرة · {ev.matches === 1 ? "مباراة واحدة" : ev.matches === 2 ? "مباراتان" : `${ev.matches} مباريات`}</p>
      <p className="mt-1 text-ivory">
        🔪 المافيا {ev.wins.mafia ?? 0} · 🙂 المواطنون {ev.wins.citizens ?? 0}
        {ev.wins.jester ? ` · 🃏 المهرّج ${ev.wins.jester}` : ""}
      </p>
      {best && best[1].won > 0 ? (
        <p className="text-ivory">
          ⭐ الأكثر فوزًا: {best[0]} ({best[1].won} من {best[1].played})
        </p>
      ) : null}
      {sleuth ? (
        <p className="text-ivory">
          🔍 أفضل محقق: {sleuth[0]} (كشف {sleuth[1].finds} من المافيا)
        </p>
      ) : null}
    </div>
  );
}

/** At the end: reveal the roles one by one, on this phone and on the TV (mafia_v10.sql). */
function RevealControls({ roomId, state, rows }: { roomId: string; state: MafiaState; rows: MafiaPlayerRow[] }) {
  const order = revealOrder(rows);
  const i = typeof state.reveal_i === "number" ? state.reveal_i : null;
  const [busy, setBusy] = useState(false);
  if (!order.length) return null;
  async function go(next: number | null) {
    if (!supabase) return;
    setBusy(true);
    await supabase.rpc("mafia_reveal_step", { p_room_id: roomId, p_index: next });
    setBusy(false);
  }
  if (i === null)
    return (
      <Button type="button" tone="secondary" className="mx-auto" onClick={() => go(0)} disabled={busy}>
        🎭 اكشف الأدوار واحدًا واحدًا
      </Button>
    );
  const done = i >= order.length;
  return (
    <div className="grid gap-3 rounded-[22px] border border-gold/50 bg-night/70 p-4">
      <RevealCard rows={order} index={i} />
      <div className="grid grid-cols-[auto_1fr_auto] gap-2">
        <Button type="button" tone="quiet" className="min-h-11 px-4" disabled={busy || i === 0} onClick={() => go(i - 1)}>
          السابق
        </Button>
        <Button type="button" tone="primary" className="min-h-11" disabled={busy || done} onClick={() => go(i + 1)}>
          {i + 1 >= order.length ? "النهاية" : "التالي"}
        </Button>
        <Button type="button" tone="quiet" className="min-h-11 px-4" disabled={busy} onClick={() => go(null)}>
          إغلاق
        </Button>
      </div>
      <p className="text-center text-xs text-muted">يظهر الكشف على شاشة التلفزيون أيضًا.</p>
    </div>
  );
}

type MafiaInspection = { round: number; name: string; mafia: boolean };
type MafiaMe = {
  started: boolean;
  /** Joined after the roles were dealt: plays the next match. */
  late?: boolean;
  /** The other lover's name, when this player is one of the lovers. */
  lover?: string | null;
  narrator?: boolean;
  spies?: string[];
  role?: string;
  alive?: boolean;
  teammates?: string[];
  inspect?: string | null;
  inspections?: MafiaInspection[];
  pending_inspect?: string | null;
  my_pick?: string | null;
  last_save?: string | null;
  self_save_used?: boolean | null;
  shot_used?: boolean | null;
  seer_result?: { name: string; role: string } | null;
  /** The spy's checks (mafia_v7.sql), seen by the spy and the mafia. */
  spy_checks?: Array<{ round: number; name: string; special: boolean }>;
  spy_ready?: boolean | null;
};
type MafiaRow = MafiaPlayerRow;
type MafiaPick = { player_name: string; target_id: string; target_name: string };

const MAFIA_PLAYER_ERRORS: Record<string, string> = {
  WRONG_PHASE: "انتهت هذه المرحلة قبل اختيارك. تابع المرحلة الجديدة.",
  NOT_ACTIVE: "لا يمكنك التصرف الآن.",
  BAD_TARGET: "هذا الاختيار غير صالح.",
  NOT_IN_ROOM: "تعذّر التعرف عليك في الغرفة.",
  LOCKED: "حققت الليلة. النتيجة تظهر بعد انتهاء الليل.",
  SAME_SAVE: "لا تقدر تحمي نفس اللاعب ليلتين متتاليتين.",
  SPY_WAIT: "تحققت قبل جولة. التحقق كل جولتين.",
  SELF_USED: "حميت نفسك من قبل. حماية النفس مرة واحدة في المباراة.",
  NOT_IN_RUNOFF: "إعادة التصويت بين المتعادلين فقط.",
  USED: "استخدمتها من قبل في هذه المباراة.",
  NOT_DEAD: "اختر لاعبًا خرج من اللعبة.",
  NOT_NOMINEE: "التصويت على المرشحين فقط.",
  FIRST_NIGHT: "الليلة الأولى للتعارف: لا ضحية الليلة.",
};

/** A player's screen: their role card, night choices, votes. The drawn narrator gets the narrator's screen. */
export function MafiaPlayerPanel({
  roomId,
  meId,
  state,
  roomCode = "",
  roomStatus = "playing",
}: {
  roomId: string;
  meId: string | null;
  state: StateData;
  roomCode?: string;
  roomStatus?: string;
}) {
  const [me, setMe] = useState<MafiaMe | null>(null);
  const [rows, setRows] = useState<MafiaRow[]>([]);
  const [picks, setPicks] = useState<MafiaPick[]>([]);
  const [progress, setProgress] = useState<{ phase?: string; done?: number; total?: number } | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const phase = String(state.phase ?? "");
  // The narrator away (mafia_v13.sql): every phone asks the server now and then. It does nothing while
  // the narrator is there; otherwise the server moves the phase on its timer, or waits.
  const inPlay = phase === "night" || phase === "day" || phase === "vote";
  const hostAway = (state as MafiaState).host_away ?? null;
  useEffect(() => {
    if (!supabase || !inPlay || me?.narrator) return;
    const client = supabase;
    const t = window.setInterval(() => void client.rpc("mafia_auto_step", { p_room_id: roomId }), 15000 + Math.floor(Math.random() * 5000));
    return () => window.clearInterval(t);
  }, [roomId, inPlay, me?.narrator]);
  const round = Number(state.round ?? 1);
  const winner = typeof state.winner === "string" ? state.winner : null;
  const lastResult = typeof state.last_result === "string" ? state.last_result : null;
  const runoff = Array.isArray(state.runoff) ? (state.runoff as string[]) : null;
  const nominees = Array.isArray(state.nominees) ? (state.nominees as string[]) : null;
  const settings = (state.settings ?? {}) as { vote_mode?: string; no_first_kill?: boolean };
  const oral = settings.vote_mode === "pick" || settings.vote_mode === "count";
  const firstSafe = !!settings.no_first_kill && round === 1;
  const tally = Array.isArray(state.last_tally) ? (state.last_tally as MafiaTally[]) : [];
  const dayLeft = useCountdown(phase === "day" ? (state.day_ends_at as string | null | undefined) : null);
  const voteLeft = useCountdown(phase === "vote" ? (state.vote_ends_at as string | null | undefined) : null);
  const narratorName = typeof state.narrator_name === "string" ? state.narrator_name : null;
  const nightLeft = useCountdown(phase === "night" ? (state.night_ends_at as string | null | undefined) : null);

  // A backup for the night timer (mafia_v8.sql): 3 seconds after it ends, any phone asks to settle the night.
  const nightKey = useRef("");
  useEffect(() => {
    if (phase !== "night" || nightLeft !== 0 || !supabase) return;
    const key = String(round);
    if (nightKey.current === key) return;
    nightKey.current = key;
    const client = supabase;
    const t = window.setTimeout(() => void client.rpc("mafia_night_timeout", { p_room_id: roomId }), 3000 + Math.floor(Math.random() * 1500));
    return () => window.clearTimeout(t);
  }, [phase, nightLeft, round, roomId]);

  // A backup for the vote timer, if the narrator's device is asleep: 3 seconds after time is up,
  // any phone can ask the server to finish the vote (the server checks the time itself).
  const timeoutKey = useRef("");
  useEffect(() => {
    if (phase !== "vote" || voteLeft !== 0 || !supabase) return;
    const key = `${round}:${runoff?.join(",") ?? ""}`;
    if (timeoutKey.current === key) return;
    timeoutKey.current = key;
    const client = supabase;
    const t = window.setTimeout(() => void client.rpc("mafia_vote_timeout", { p_room_id: roomId }), 3000);
    return () => window.clearTimeout(t);
  }, [phase, voteLeft, round, runoff?.join(","), roomId]);

  const load = async () => {
    if (!supabase) return;
    const client = supabase;
    {
      const [{ data: mine, error: e1 }, { data: list, error: e2 }, { data: prog }, { data: team }] = await Promise.all([
        client.rpc("mafia_my_role", { p_room_id: roomId }),
        client.rpc("mafia_players", { p_room_id: roomId }),
        client.rpc("mafia_progress", { p_room_id: roomId }),
        client.rpc("mafia_team_picks", { p_room_id: roomId }),
      ]);
      if (e1 || e2) return setMessage("تعذّر تحميل اللعبة.");
      setMe((mine ?? null) as MafiaMe | null);
      setRows((list ?? []) as MafiaRow[]);
      setProgress((prog ?? null) as typeof progress);
      setPicks(Array.isArray(team) ? (team as MafiaPick[]) : []);
    }
  };
  useLivePoll(`mafia-player-${roomId}`, [{ table: "room_game_state", filter: `room_id=eq.${roomId}` }, { table: "room_players", filter: `room_id=eq.${roomId}` }], load);

  // Inside a phase, only what changes without touching the room's state: the mafia's picks
  // at night (for the mafia), and the vote count during the vote. A light poll for each.
  const isMafia = me?.role === "mafia" && me?.alive !== false;
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const nightPicks = phase === "night" && isMafia;
    if (!nightPicks && phase !== "vote") return;
    let live = true;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (nightPicks)
        void client.rpc("mafia_team_picks", { p_room_id: roomId }).then(({ data }) => {
          if (live && Array.isArray(data)) setPicks(data as MafiaPick[]);
        });
      else
        void client.rpc("mafia_progress", { p_room_id: roomId }).then(({ data }) => {
          if (live) setProgress((data ?? null) as typeof progress);
        });
    };
    const t = window.setInterval(tick, nightPicks ? 3000 : 4000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
    // progress is only set here and in load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, phase, round, isMafia]);

  // A new phase, round or runoff starts with no choice made yet.
  useEffect(() => {
    setChosen(null);
    setMessage(null);
  }, [phase, round, runoff?.join(",")]);

  const iAmAlive = me?.started === true && me?.alive !== false;
  const role = me?.role ?? "";
  const teammates = me?.teammates ?? [];
  const inspectLocked = role === "detective" && phase === "night" && !!me?.pending_inspect;
  const canAct =
    iAmAlive && ((phase === "night" && ["mafia", "doctor", "detective", "bodyguard"].includes(role) && !inspectLocked && !(role === "mafia" && firstSafe)) || (phase === "vote" && !oral));
  const suspects = rows.filter((p) => p.alive && p.player_id !== meId);
  const picked = chosen ?? me?.my_pick ?? null;

  const targets = rows.filter((p) => {
    if (!p.alive) return false;
    if (phase === "vote") return p.player_id !== meId && (runoff ? runoff.includes(p.player_id) : !nominees || nominees.includes(p.player_id));
    if (phase === "night") {
      if (role === "doctor") return true;
      if (p.player_id === meId) return false;
      if (role === "mafia") return !teammates.includes(p.player_name) && !(me?.spies ?? []).includes(p.player_name);
      return true;
    }
    return false;
  });

  /** Why a doctor can't pick this player tonight, if they can't. */
  function blocked(id: string) {
    if (role !== "doctor" || phase !== "night") return null;
    if (me?.last_save === id) return "حميته البارحة";
    if (id === meId && me?.self_save_used) return "استخدمتها";
    return null;
  }

  async function pick(target: string) {
    if (!supabase || busy) return;
    const fn = phase === "vote" ? "mafia_vote" : "mafia_night_action";
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc(fn, { p_room_id: roomId, p_target_id: target });
      if (error) throw error;
      const result = data as { ok: boolean; reason?: string };
      if (!result.ok) setMessage(MAFIA_PLAYER_ERRORS[result.reason ?? ""] ?? "تعذّر تنفيذ الاختيار.");
      else setChosen(target);
    } catch {
      setMessage("تعذّر تنفيذ الاختيار.");
    } finally {
      setBusy(false);
    }
  }

  const [aim, setAim] = useState<string | null>(null);
  // Night suspicion for players without a night role (mafia_v9.sql): no effect on the game.
  const [suspect, setSuspect] = useState<string | null>(null);
  useEffect(() => {
    setSuspect(null);
    if (!supabase || phase !== "night") return;
    void supabase.rpc("mafia_my_suspect", { p_room_id: roomId }).then(({ data }) => typeof data === "string" && setSuspect(data));
  }, [roomId, phase, round]);
  async function pickSuspect(target: string) {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.rpc("mafia_suspect", { p_room_id: roomId, p_target_id: target });
    setBusy(false);
    const r = data as { ok?: boolean; reason?: string } | null;
    if (error || r?.ok === false) setMessage(MAFIA_PLAYER_ERRORS[r?.reason ?? ""] ?? "تعذّر الاختيار.");
    else setSuspect(target);
  }
  async function special(fn: "mafia_shoot" | "mafia_seer", target: string) {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc(fn, { p_room_id: roomId, p_target_id: target });
      if (error) throw error;
      const result = data as { ok: boolean; reason?: string };
      if (!result.ok) setMessage(MAFIA_PLAYER_ERRORS[result.reason ?? ""] ?? "تعذّر تنفيذ الاختيار.");
      setAim(null);
    } catch {
      setMessage("تعذّر تنفيذ الاختيار.");
    } finally {
      setBusy(false);
    }
  }
  async function spyCheck(target: string) {
    if (!supabase || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc("mafia_spy_check", { p_room_id: roomId, p_target_id: target });
      if (error) throw error;
      const result = data as { ok: boolean; reason?: string };
      if (!result.ok) setMessage(MAFIA_PLAYER_ERRORS[result.reason ?? ""] ?? "تعذّر التحقق.");
      await load();
    } catch {
      setMessage("تعذّر التحقق.");
    } finally {
      setBusy(false);
    }
  }
  const dead = rows.filter((p) => !p.alive);
  const showSniper = iAmAlive && role === "sniper" && phase === "day" && !me?.shot_used;
  const showSeer = iAmAlive && role === "seer" && phase !== "over" && phase !== "" && !me?.seer_result;

  const chosenName = rows.find((p) => p.player_id === picked)?.player_name ?? null;
  const over = phase === "over";
  const recap = useMafiaRecap(roomId, over);
  // The mafia kill only when they agree (mafia_v12.sql): every living mafia member on the same name.
  const mafiaNight = role === "mafia" && phase === "night";
  const livingMafia = 1 + teammates.filter((n) => rows.some((r) => r.player_name === n && r.alive)).length;
  const pickedTargets = new Set(picks.map((x) => x.target_id));
  const split = mafiaNight && pickedTargets.size > 1;
  const agreed = mafiaNight && pickedTargets.size === 1 && picks.length >= livingMafia ? (picks[0]?.target_name ?? null) : null;
  const waitingTeam = mafiaNight && livingMafia > 1 && !split && !agreed;

  /** The target buttons, for the vote and the night roles. */
  function renderTargets() {
    return (
      <>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {targets.map((p) => {
              const why = blocked(p.player_id);
              const team = role === "mafia" && phase === "night" ? picks.filter((x) => x.target_id === p.player_id) : [];
              return (
                <button
                  key={p.player_id}
                  type="button"
                  disabled={busy || !!why}
                  onClick={() => pick(p.player_id)}
                  aria-pressed={picked === p.player_id}
                  className={cx(
                    "grid min-h-11 place-items-center rounded-full border px-4 py-1 text-sm font-bold transition disabled:opacity-45",
                    picked === p.player_id ? "border-gold bg-gold/10 text-gold" : "border-line text-ivory",
                  )}
                >
                  {p.is_mayor ? "👑 " : ""}
                  {isUnmasked(state, p.player_id) ? "🎭 " : ""}
                  {p.player_name}
                  {why ? <span className="text-[11px] font-normal text-muted">{why}</span> : null}
                  {team.length > 0 ? <span className="text-[11px] font-normal text-wrong">🔪 {team.map((x) => x.player_name).join("، ")}</span> : null}
                </button>
              );
            })}
          </div>
          {chosenName ? (
            <p className="mt-3 text-sm text-muted">
              اخترتم: <span className="font-bold text-ivory">{chosenName}</span>
            </p>
          ) : null}
          {split ? <p className="mt-2 text-sm font-bold text-wrong">⚠️ لم تتفقوا بعد: الضحية لا تُعتمد إلا إذا اختار كل المافيا الاسم نفسه. إذا انتهت الليلة وأنتم مختلفون فلا قتل.</p> : null}
          {agreed ? <p className="mt-2 text-sm font-bold text-correct">✅ اتفقتم على {agreed}.</p> : null}
          {waitingTeam ? <p className="mt-2 text-sm text-muted">صوّتوا على اسم واحد: الضحية تُعتمد حين يختارها كل المافيا.</p> : null}
      </>
    );
  }

  if (me?.narrator) return <MafiaNarratorPanel roomId={roomId} roomCode={roomCode} roomStatus={roomStatus} isHost={false} />;

  return (
    <section className="glass-card mb-5 rounded-[28px] p-5 text-center">
      {me?.started && role && phase !== "over" ? <GameIntro game="mafia" role={role} steps={mafiaIntro(role)} secret /> : null}
      <p className="text-xs font-bold text-violet-text">
        المافيا · الجولة {round || 1}
        {narratorName ? ` · الراوي: ${narratorName}` : ""}
      </p>
      {hostAway && inPlay ? (
        <p role="status" className="mx-auto mt-3 max-w-md rounded-2xl border border-gold/50 bg-gold/10 px-3 py-2 text-sm font-bold text-gold">
          {hostAway === "pause" ? "⏸️ الراوي غاب. اللعبة متوقفة حتى يرجع." : "🤖 الراوي غاب. النظام يكمل اللعبة بالوقت."}
        </p>
      ) : null}

      {!me?.started ? (
        me?.late || (phase !== "" && phase !== "over" && !!me) ? (
          <p className="mt-4 rounded-2xl border border-gold/40 bg-gold/10 p-3 text-sm text-ivory">
            المباراة بدأت قبل انضمامك، فتدخل المباراة القادمة. تابع النقاش حتى ذلك الحين بدون أن تتدخل.
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted">انتظروا المضيف لبدء اللعبة.</p>
        )
      ) : (
        <>
          {over ? (
            <p className="mt-3 text-2xl font-extrabold text-ivory">
              {ROLE_ICONS[role] ?? ""} {ROLE_NAMES[role] ?? ""}
            </p>
          ) : (
            <SecretCard>
              <p className="text-sm text-muted">دورك</p>
              <p className="text-2xl font-extrabold text-ivory">
                {ROLE_ICONS[role] ?? ""} {ROLE_NAMES[role] ?? ""}
              </p>
              <p className="mt-2 text-sm leading-7 text-muted">{ROLE_HINTS[role] ?? ""}</p>
              {ROLE_INFO[role] ? (
                <dl className="mt-3 grid gap-1.5 rounded-[16px] border border-line bg-deep-2/50 p-3 text-start text-[13px] leading-6">
                  <div>
                    <dt className="inline font-bold text-gold">الفريق: </dt>
                    <dd className="inline text-ivory">{ROLE_INFO[role].team}</dd>
                  </div>
                  <div>
                    <dt className="inline font-bold text-gold">متى: </dt>
                    <dd className="inline text-ivory">{ROLE_INFO[role].when}</dd>
                  </div>
                  <div>
                    <dt className="inline font-bold text-gold">متى تفوز: </dt>
                    <dd className="inline text-ivory">{ROLE_INFO[role].wins}</dd>
                  </div>
                </dl>
              ) : null}
              {role === "mafia" && teammates.length > 0 ? (
                <p className="mt-2 text-sm text-muted">
                  زملاؤك المافيا: <span className="font-bold text-ivory">{teammates.join("، ")}</span>
                </p>
              ) : null}
              {role === "mafia" && (me?.spies ?? []).length > 0 ? (
                <p className="mt-2 text-sm text-muted">
                  🕶️ الجاسوس حليفكم: <span className="font-bold text-ivory">{(me?.spies ?? []).join("، ")}</span>
                </p>
              ) : null}
              {role === "spy" ? (
                <p className="mt-2 text-sm text-muted">{teammates.length > 0 ? <>🔪 المافيا: <b className="text-ivory">{teammates.join("، ")}</b></> : "لم يبقَ أحد من المافيا."}</p>
              ) : null}
              {(role === "spy" || role === "mafia") && (me?.spy_checks ?? []).length > 0 ? <SpyChecks checks={me?.spy_checks ?? []} /> : null}
              {role === "detective" && (me?.inspections ?? []).length > 0 ? (
                <ul className="mx-auto mt-3 grid max-w-xs gap-1.5 text-sm">
                  {(me?.inspections ?? []).map((x) => (
                    <li key={x.round} className="flex items-center justify-between gap-3 rounded-xl bg-deep-2/70 px-3 py-1.5">
                      <span className="text-muted">ليلة {x.round}</span>
                      <span className="font-bold text-ivory">{x.name}</span>
                      <span className={cx("font-bold", x.mafia ? "text-wrong" : "text-correct")}>{x.mafia ? "مافيا" : "ليس مافيا"}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {role === "seer" && me?.seer_result ? (
                <p className="mt-2 text-sm text-ivory">
                  🔮 {me.seer_result.name} كان <b>{ROLE_NAMES[me.seer_result.role] ?? ""}</b>
                </p>
              ) : null}
              {role === "sniper" && me?.shot_used ? <p className="mt-2 text-sm text-muted">🎯 أطلقت رصاصتك.</p> : null}
              {me?.lover ? (
                <div className="mt-3 rounded-2xl border border-[#ff5a7a66] bg-[#83184322] p-3 text-start text-sm">
                  <p className="font-bold text-ivory">❤️ عاشقك: {me.lover}</p>
                  <p className="mt-1 leading-6 text-muted">{LOVERS_INFO}</p>
                </div>
              ) : null}
            </SecretCard>
          )}
          {!iAmAlive && !over ? <GhostView roomId={roomId} phase={phase} /> : null}
        </>
      )}

      {lastResult ? <p className="mt-4 text-sm font-bold text-ivory">{lastResult}</p> : null}

      {(phase === "night" || phase === "day" || phase === "vote") && pausedLeft(state) !== null ? (
        <p className="mt-3 text-sm font-bold text-gold">⏸ الراوي أوقف المؤقت ({mmss(pausedLeft(state) ?? 0)})</p>
      ) : null}
      {phase === "night" && nightLeft !== null && me?.started ? (
        <p dir="ltr" className={cx("mt-3 font-display text-2xl font-extrabold tabular-nums", nightLeft <= 10 ? "text-wrong" : "text-gold")}>
          🌙 {mmss(nightLeft)}
        </p>
      ) : null}
      {phase === "night" && me?.started === true && iAmAlive ? (
        <NightPanel>
          <p className="text-xs font-bold text-violet-text">
            {ROLE_ICONS[role] ?? ""} {ROLE_NAMES[role] ?? ""}
          </p>
          {role === "mafia" && firstSafe ? (
            <p className="mt-2 text-sm text-ivory">
              الليلة الأولى للتعارف: تعرّفوا على زملائكم{teammates.length ? ` (${teammates.join("، ")})` : ""}، ولا ضحية الليلة.
            </p>
          ) : null}
          {role === "mafia" && (me?.spy_checks ?? []).length ? <SpyChecks checks={me?.spy_checks ?? []} /> : null}
          {inspectLocked ? (
            <p className="mt-2 rounded-2xl border border-gold/40 bg-gold/10 p-3 text-sm text-ivory">
              حققت الليلة مع <b>{me?.pending_inspect}</b>. النتيجة تظهر بعد انتهاء الليل.
            </p>
          ) : null}
          {role === "spy" ? (
            <div className="mt-2">
              <p className="text-sm text-muted">افتح عينك مع المافيا. لا تختار ضحية معهم.</p>
              {me?.spy_ready ? (
                <>
                  <p className="mt-2 text-sm font-bold text-ivory">🕶️ تحقّق من لاعب: مواطن عادي أم صاحب دور خاص؟</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {rows
                      .filter((p) => p.alive && p.player_id !== meId && !teammates.includes(p.player_name))
                      .map((p) => (
                        <button key={p.player_id} type="button" disabled={busy} onClick={() => spyCheck(p.player_id)} className="min-h-11 rounded-full border border-line px-4 text-sm font-bold text-ivory">
                          {p.player_name}
                        </button>
                      ))}
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">التحقق كل جولتين: تقدر تتحقق مرة ثانية الجولة القادمة.</p>
              )}
              {(me?.spy_checks ?? []).length ? <SpyChecks checks={me?.spy_checks ?? []} /> : null}
            </div>
          ) : null}
          {canAct ? (
            <div className="mt-2">
              <p className="text-sm text-muted">اختر:</p>
              {renderTargets()}
            </div>
          ) : null}
          {!["mafia", "doctor", "detective", "bodyguard", "spy"].includes(role) ? (
            <div className="mt-2">
              <p className="text-sm font-bold text-ivory">🤔 من تشك فيه الليلة؟</p>
              <p className="text-xs text-muted">اختيارك لا يؤثر على اللعب، وفي النهاية نعرف أكثر من اشتبهتم فيه.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {suspects.map((p) => (
                  <button
                    key={p.player_id}
                    type="button"
                    disabled={busy}
                    onClick={() => pickSuspect(p.player_id)}
                    aria-pressed={suspect === p.player_id}
                    className={cx("min-h-11 rounded-full border px-4 text-sm font-bold", suspect === p.player_id ? "border-gold bg-gold/10 text-gold" : "border-line text-ivory")}
                  >
                    {p.player_name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </NightPanel>
      ) : null}
      {phase === "night" && !iAmAlive && me?.started ? <p className="mt-4 text-sm text-muted">الليل… تابع بصمت.</p> : null}
      {phase === "day" ? (
        <p className="mt-4 text-sm text-muted">
          النهار: ناقشوا من تظنون أنه مافيا.
          {dayLeft !== null ? (
            <b dir="ltr" className={cx("mt-1 block font-display text-3xl tabular-nums", dayLeft <= 10 ? "text-wrong" : "text-gold")}>
              {mmss(dayLeft)}
            </b>
          ) : null}
        </p>
      ) : null}
      {(phase === "night" || (phase === "vote" && runoff)) && tally.length > 0 ? (
        <div className="mt-4">
          <TallyView tally={tally} />
        </div>
      ) : null}
      {phase === "vote" && voteLeft !== null ? (
        <p dir="ltr" className={cx("mt-3 font-display text-3xl font-extrabold tabular-nums", voteLeft <= 10 ? "text-wrong" : "text-gold")}>
          {mmss(voteLeft)}
        </p>
      ) : null}
      {phase === "vote" && voteLeft !== null && canAct && !picked ? (
        <p className="mt-1 text-xs text-muted">صوّت قبل انتهاء الوقت، وإلا يُحسب صوتك ممتنعًا.</p>
      ) : null}
      {phase === "vote" && progress?.phase === "vote" ? (
        <p className="mt-3 text-sm text-muted">
          صوّت <b className="tabular-nums text-ivory">{progress.done ?? 0}</b> من <b className="tabular-nums text-ivory">{progress.total ?? 0}</b>
        </p>
      ) : null}


      {iAmAlive && (phase === "day" || phase === "vote") ? (
        <SecretAbility has={showSniper || showSeer}>
          {showSniper ? (
            <div className="mt-5 rounded-2xl border border-wrong/40 bg-wrong-fill/10 p-4">
              <p className="text-sm font-bold text-ivory">🎯 رصاصتك الوحيدة: على من تطلقها؟</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {rows
                  .filter((p) => p.alive && p.player_id !== meId)
                  .map((p) => (
                    <button
                      key={p.player_id}
                      type="button"
                      disabled={busy}
                      onClick={() => setAim(aim === p.player_id ? null : p.player_id)}
                      aria-pressed={aim === p.player_id}
                      className={cx("min-h-11 rounded-full border px-4 text-sm font-bold", aim === p.player_id ? "border-wrong bg-wrong-fill/30 text-ivory" : "border-line text-ivory")}
                    >
                      {p.is_mayor ? "👑 " : ""}
                      {p.player_name}
                    </button>
                  ))}
              </div>
              {aim ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => special("mafia_shoot", aim)}
                  className="mt-3 min-h-12 rounded-full bg-[linear-gradient(90deg,#ff5a7a,#c21d4f)] px-6 text-sm font-extrabold text-ivory disabled:opacity-50"
                >
                  أطلق على {rows.find((p) => p.player_id === aim)?.player_name}
                </button>
              ) : (
                <p className="mt-2 text-xs text-muted">مرة واحدة في المباراة، ولا يعرف أحد من أطلقها.</p>
              )}
            </div>
          ) : null}

          {showSeer ? (
            <div className="mt-5 rounded-2xl border border-violet-text/40 bg-violet-fill/10 p-4">
              <p className="text-sm font-bold text-ivory">🔮 اكشف دور لاعب خرج (مرة واحدة)</p>
              {dead.length === 0 ? (
                <p className="mt-2 text-xs text-muted">لم يخرج أحد بعد.</p>
              ) : (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {dead.map((p) => (
                    <button key={p.player_id} type="button" disabled={busy} onClick={() => special("mafia_seer", p.player_id)} className="min-h-11 rounded-full border border-line px-4 text-sm font-bold text-ivory">
                      {p.player_name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

        </SecretAbility>
      ) : null}

      {canAct && phase === "vote" ? (
        <div className="mt-5">
          <p className="text-sm text-muted">{runoff ? "إعادة التصويت بين المتعادلين:" : nominees ? "صوّتوا على أحد المرشحين:" : "صوّتوا لإقصاء لاعب:"}</p>
          {renderTargets()}
        </div>
      ) : null}
      {(phase === "vote" || phase === "day") && oral && iAmAlive ? (
        <p className="mt-4 rounded-2xl border border-line bg-deep-2/60 p-3 text-sm text-ivory">✋ التصويت برفع اليد، والراوي يسجّل النتيجة.</p>
      ) : null}

      {over ? (
        <div className="mt-5 grid gap-4">
          <p className="text-xl font-extrabold text-ivory">{WINNERS[winner ?? ""] ?? "انتهت اللعبة"}</p>
          <MafiaSummary state={state as MafiaPublicState} rows={rows} />
          <EveningView roomId={roomId} phase={phase} />
          <MafiaRecapView recap={recap} />
          <MafiaShare state={state as MafiaPublicState} rows={rows} recap={recap} />
        </div>
      ) : null}

      {message ? (
        <p role="alert" className="mt-3 text-sm text-wrong">
          {message}
        </p>
      ) : null}
    </section>
  );
}


/**
 * Out of the game: watch quietly, and (when the host allows it) see everyone's role.
 * The roles come from mafia_roles(), which answers dead players only while the match runs.
 */
function GhostView({ roomId, phase }: { roomId: string; phase: string }) {
  const [roles, setRoles] = useState<Array<{ player_id: string; player_name: string; role: string; alive: boolean; lover?: string | null }>>([]);
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    void supabase.rpc("mafia_roles", { p_room_id: roomId }).then(({ data }) => {
      if (live && Array.isArray(data)) setRoles(data as typeof roles);
    });
    return () => {
      live = false;
    };
  }, [roomId, phase]);
  return (
    <div className="mt-3 grid gap-2 rounded-2xl border border-line bg-deep-2/60 p-3 text-start">
      <p className="text-sm font-bold text-ivory">👻 أنت خارج اللعبة</p>
      <p className="text-xs leading-6 text-muted">تابع بصمت: لا تتكلم ولا تلمّح بأي شيء تعرفه، حتى بتعابير وجهك.</p>
      {roles.length > 0 ? (
        <HoldToSee label="👁️ أدوار الجميع: المس هنا لتراها، ولا تُرِها لأحد.">
        <ul className="grid grid-cols-2 gap-1.5 text-sm">
          {roles.map((r) => (
            <li key={r.player_id} className={cx("flex min-w-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5", r.role === "mafia" || r.role === "spy" ? "bg-wrong-fill/20" : "bg-deep/60", !r.alive && "opacity-50 line-through")}>
              <span aria-hidden="true">{ROLE_ICONS[r.role]}</span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ivory">
                {r.player_name}
                {r.lover ? " ❤️" : ""}
              </span>
              <span className="shrink-0 text-xs text-mist">{ROLE_NAMES[r.role]}</span>
            </li>
          ))}
        </ul>
        </HoldToSee>
      ) : null}
    </div>
  );
}

/**
 * The host's page: the narrator's screen when the host narrates (or before the roles are dealt),
 * or a player's screen when the draw picked someone else, with the host's room controls under it.
 */
export function MafiaHostScreen({ roomId, roomCode, roomStatus, tools }: { roomId: string; roomCode: string; roomStatus: string; tools?: ReactNode }) {
  const [state, setState] = useState<StateData>({});
  const [mine, setMine] = useState<{ started?: boolean; narrator?: boolean } | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    if (!supabase) return;
    const [{ data: gs }, { data: role }, { data: pid }] = await Promise.all([
      supabase.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
      supabase.rpc("mafia_my_role", { p_room_id: roomId }),
      supabase.rpc("my_player_id", { p_room_id: roomId }),
    ]);
    if (gs) setState((gs.state_data ?? {}) as StateData);
    setMine((role ?? null) as typeof mine);
    setMeId((pid as string | null) ?? null);
  };
  useLivePoll(`mafia-host-${roomId}`, [{ table: "room_game_state", filter: `room_id=eq.${roomId}` }], load);

  const playing = !!mine?.started && !mine?.narrator;
  // Before the roles are dealt the room tools (share, TV, players) come first; during the match
  // they fold into one small menu under the game, so the narrator's screen starts at the top.
  const inMatch = !!state.phase && state.phase !== "over";
  const toolsView = tools ? (
    inMatch ? (
      <details className="mx-auto mt-4 max-w-2xl rounded-2xl border border-line bg-deep-2/40 p-3">
        <summary className="cursor-pointer text-sm font-bold text-mist">⋯ أدوات الغرفة (المشاركة، التلفزيون، اللاعبون)</summary>
        <div className="mt-3">{tools}</div>
      </details>
    ) : (
      tools
    )
  ) : null;
  if (!playing)
    return (
      <>
        {inMatch ? null : toolsView}
        <MafiaNarratorPanel roomId={roomId} roomCode={roomCode} roomStatus={roomStatus} isHost />
        {inMatch ? toolsView : null}
      </>
    );

  async function reset() {
    if (!supabase) return;
    setBusy(true);
    await supabase.rpc("mafia_reset", { p_room_id: roomId });
    setBusy(false);
    void load();
  }
  return (
    <section className="mx-auto mt-2 max-w-2xl">
      {inMatch ? null : toolsView}
      <MafiaPlayerPanel roomId={roomId} meId={meId} state={state} roomCode={roomCode} roomStatus={roomStatus} />
      {inMatch ? toolsView : null}
      <p className="text-center text-xs text-muted">أنت المضيف وتلعب هذه المرة، والراوي {String(state.narrator_name ?? "")} يدير الجولات من جواله.</p>
      {state.phase === "over" ? (
        <div className="mt-4 text-center">
          <Button type="button" tone="primary" onClick={reset} disabled={busy}>
            مباراة جديدة بنفس اللاعبين
          </Button>
        </div>
      ) : null}
      {roomStatus === "finished" ? <p className="mt-6 text-center text-sm text-muted">انتهت الغرفة.</p> : null}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useLivePoll } from "@/lib/live";
import {
  MafiaShare,
  MafiaSummary,
  ROLE_HINTS,
  ROLE_ICONS,
  ROLE_NAMES,
  RoleCard,
  TallyView,
  VotesView,
  WINNERS,
  mmss,
  narratorLine,
  useCountdown,
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
};

/** mafia_progress(): votes for everyone, night actions for the host only (mafia_v2.sql). */
type MafiaProgress = { phase?: string; done?: number; total?: number; mafia_split?: boolean };

type NarratorRole = { player_id: string; player_name: string; role: string; alive: boolean };

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
  const [spy, setSpy] = useState(false);
  const [voteSeconds, setVoteSeconds] = useState(60);
  const [randomNarrator, setRandomNarrator] = useState(0);
  const [roles, setRoles] = useState<NarratorRole[]>([]);
  const [details, setDetails] = useState<(MafiaVote & { round: number; stage: number })[]>([]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;
    async function load() {
      const [{ data: gs }, { data: list }, { data: prog }, { count }, { data: secret }, { data: detail }] = await Promise.all([
        client.from("room_game_state").select("state_data").eq("room_id", roomId).maybeSingle(),
        client.rpc("mafia_players", { p_room_id: roomId }),
        client.rpc("mafia_progress", { p_room_id: roomId }),
        client.from("room_players").select("id", { count: "exact", head: true }).eq("room_id", roomId).eq("is_host", false),
        // Narrator only (mafia_v5.sql); empty for anyone else, and before that file runs.
        client.rpc("mafia_roles", { p_room_id: roomId }),
        client.rpc("mafia_vote_details", { p_room_id: roomId }),
      ]);
      if (cancelled) return;
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
    load();
    const poll = window.setInterval(load, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [roomId]);

  async function step(fn: "mafia_start" | "mafia_resolve_night" | "mafia_open_vote" | "mafia_close_vote" | "mafia_reset" | "mafia_vote_timeout", args: Record<string, unknown> = {}) {
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
    setSpy(!!last.spy);
    setVoteSeconds(last.vote_seconds ?? 60);
    setRandomNarrator(last.narrator === "random" ? 1 : 0);
  }, [phase, state.last_settings]);
  useEffect(() => {
    if (phase !== "") prefilled.current = false;
  }, [phase]);

  const dayLeft = useCountdown(phase === "day" ? state.day_ends_at : null);
  const voteLeft = useCountdown(phase === "vote" ? state.vote_ends_at : null);
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

  // The vote timer ran out: the system votes at random for whoever hasn't, and shows the result.
  const voteDone = useRef("");
  useEffect(() => {
    if (phase !== "vote" || voteLeft !== 0 || voteDone.current === stepKey) return;
    voteDone.current = stepKey;
    void step("mafia_vote_timeout");
    // step is stable for this one-shot call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, voteLeft, stepKey]);

  const headline =
    phase === "" ? "جاهزون للبدء؟"
    : phase === "night" ? `🌙 ليل الجولة ${round}`
    : phase === "day" ? `☀️ نهار الجولة ${round}`
    : phase === "vote" ? (runoff ? "إعادة التصويت" : "التصويت")
    : "انتهت اللعبة";

  const maxMafia = Math.max(1, Math.floor((guests - 1) / 2));
  const autoMafia = guests >= 10 ? 3 : guests >= 7 ? 2 : 1;
  const plannedMafia = mafiaCount || autoMafia;
  const special = 2 + Number(jester) + Number(mayor) + Number(bodyguard) + Number(sniper) + Number(seer) + Number(spy);
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

        {narratorLine(state, rows) ? (
          <div className="mt-4 rounded-2xl border border-violet-text/40 bg-violet-fill/10 p-3 text-start">
            <p className="text-xs font-bold text-violet-text">🎙️ اقرأ بصوت عالٍ</p>
            <p className="mt-1 text-[15px] leading-7 text-ivory">{narratorLine(state, rows)}</p>
          </div>
        ) : null}

        {phase === "" && !isHost ? <p className="mt-4 text-sm text-muted">المضيف يجهّز اللعبة.</p> : null}
        {phase === "" && isHost ? (
          <div className="mt-5 grid gap-4 text-start">
            <p className="text-center text-sm text-muted">
              يلعب {guests} {guests > 2 && guests < 11 ? "لاعبين" : "لاعبًا"}، والراوي لا يلعب.
            </p>
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
            {voteSeconds ? <p className="-mt-2 text-xs text-muted">إذا انتهى الوقت ولم يصوّت أحدهم، يصوّت النظام عنه عشوائيًا وتظهر النتيجة مباشرة.</p> : null}
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
                ? "تحتاجون 5 لاعبين على الأقل غير الراوي."
                : fits
                  ? `الأدوار: ${plannedMafia} مافيا${spy ? "، جاسوس" : ""}، طبيب، محقق${bodyguard ? "، حارس" : ""}${mayor ? "، عمدة" : ""}${jester ? "، مهرّج" : ""}${sniper ? "، قنّاص" : ""}${seer ? "، عرّافة" : ""}، والباقي مواطنون (${guests - plannedMafia - special}).`
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

        {phase === "vote" && voteLeft !== null ? (
          <p className={cx("mt-4 font-display text-4xl font-extrabold tabular-nums", voteLeft <= 10 ? "text-wrong" : "text-gold")} dir="ltr">
            {mmss(voteLeft)}
          </p>
        ) : null}

        {(phase === "night" || phase === "vote") && shownVotes.length > 0 ? (
          <div className="mx-auto mt-4 max-w-md">
            <VotesView votes={shownVotes} />
          </div>
        ) : null}

        {phase !== "" && roles.length > 0 ? (
          <details open={round === 1 && phase === "night"} className="mx-auto mt-4 max-w-md rounded-2xl border border-violet-text/40 bg-violet-fill/10 p-3 text-start">
            <summary className="cursor-pointer text-sm font-bold text-violet-text">🎙️ أدوار اللاعبين (للراوي فقط)</summary>
            <ul className="mt-2 grid grid-cols-2 gap-1.5 text-sm">
              {roles.map((r) => (
                <li key={r.player_id} className={cx("flex min-w-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5", r.role === "mafia" || r.role === "spy" ? "bg-wrong-fill/20" : "bg-deep-2/60", !r.alive && "opacity-50 line-through")}>
                  <span aria-hidden="true">{ROLE_ICONS[r.role]}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-ivory">{r.player_name}</span>
                  <span className="shrink-0 text-xs text-mist">{ROLE_NAMES[r.role]}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {phase === "" && isHost ? (
            <Button
              type="button"
              tone="primary"
              onClick={() =>
                step("mafia_start", {
                  p_settings: {
                    mafia: mafiaCount || null,
                    reveal_roles: reveal,
                    day_seconds: daySeconds,
                    vote_seconds: voteSeconds,
                    narrator: randomNarrator ? "random" : "host",
                    jester,
                    mayor,
                    bodyguard,
                    sniper,
                    seer,
                    spy,
                  },
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
      </div>

      {!isHost ? null : !ended ? (
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

type MafiaInspection = { round: number; name: string; mafia: boolean };
type MafiaMe = {
  started: boolean;
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
};
type MafiaRow = MafiaPlayerRow;
type MafiaPick = { player_name: string; target_id: string; target_name: string };

const MAFIA_PLAYER_ERRORS: Record<string, string> = {
  WRONG_PHASE: "هذه الخطوة غير متاحة الآن.",
  NOT_ACTIVE: "لا يمكنك التصرف الآن.",
  BAD_TARGET: "هذا الاختيار غير صالح.",
  NOT_IN_ROOM: "تعذّر التعرف عليك في الغرفة.",
  LOCKED: "حققت الليلة. النتيجة تظهر بعد انتهاء الليل.",
  SAME_SAVE: "لا تقدر تحمي نفس اللاعب ليلتين متتاليتين.",
  SELF_USED: "حميت نفسك من قبل. حماية النفس مرة واحدة في المباراة.",
  NOT_IN_RUNOFF: "إعادة التصويت بين المتعادلين فقط.",
  USED: "استخدمتها من قبل في هذه المباراة.",
  NOT_DEAD: "اختر لاعبًا خرج من اللعبة.",
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
  const round = Number(state.round ?? 1);
  const winner = typeof state.winner === "string" ? state.winner : null;
  const lastResult = typeof state.last_result === "string" ? state.last_result : null;
  const runoff = Array.isArray(state.runoff) ? (state.runoff as string[]) : null;
  const tally = Array.isArray(state.last_tally) ? (state.last_tally as MafiaTally[]) : [];
  const dayLeft = useCountdown(phase === "day" ? (state.day_ends_at as string | null | undefined) : null);
  const voteLeft = useCountdown(phase === "vote" ? (state.vote_ends_at as string | null | undefined) : null);
  const narratorName = typeof state.narrator_name === "string" ? state.narrator_name : null;

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

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let cancelled = false;
    async function load() {
      const [{ data: mine, error: e1 }, { data: list, error: e2 }, { data: prog }, { data: team }] = await Promise.all([
        client.rpc("mafia_my_role", { p_room_id: roomId }),
        client.rpc("mafia_players", { p_room_id: roomId }),
        client.rpc("mafia_progress", { p_room_id: roomId }),
        client.rpc("mafia_team_picks", { p_room_id: roomId }),
      ]);
      if (cancelled) return;
      if (e1 || e2) return setMessage("تعذّر تحميل اللعبة.");
      setMe((mine ?? null) as MafiaMe | null);
      setRows((list ?? []) as MafiaRow[]);
      setProgress((prog ?? null) as typeof progress);
      setPicks(Array.isArray(team) ? (team as MafiaPick[]) : []);
    }
    load();
    const poll = window.setInterval(load, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
    // progress is only set inside load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

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
    iAmAlive && ((phase === "night" && ["mafia", "doctor", "detective", "bodyguard"].includes(role) && !inspectLocked) || phase === "vote");
  const picked = chosen ?? me?.my_pick ?? null;

  const targets = rows.filter((p) => {
    if (!p.alive) return false;
    if (phase === "vote") return p.player_id !== meId && (!runoff || runoff.includes(p.player_id));
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
  const dead = rows.filter((p) => !p.alive);
  const showSniper = iAmAlive && role === "sniper" && phase === "day" && !me?.shot_used;
  const showSeer = iAmAlive && role === "seer" && phase !== "over" && phase !== "" && !me?.seer_result;

  const chosenName = rows.find((p) => p.player_id === picked)?.player_name ?? null;
  const over = phase === "over";
  const split = role === "mafia" && phase === "night" && new Set(picks.map((x) => x.target_id)).size > 1;

  if (me?.narrator) return <MafiaNarratorPanel roomId={roomId} roomCode={roomCode} roomStatus={roomStatus} isHost={false} />;

  return (
    <section className="glass-card mb-5 rounded-[28px] p-5 text-center">
      <p className="text-xs font-bold text-violet-text">
        المافيا · الجولة {round || 1}
        {narratorName ? ` · الراوي: ${narratorName}` : ""}
      </p>

      {!me?.started ? (
        <p className="mt-4 text-sm text-muted">انتظروا المضيف لبدء اللعبة.</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted">دورك</p>
          <p className="text-2xl font-extrabold text-ivory">
            {ROLE_ICONS[role] ?? ""} {ROLE_NAMES[role] ?? ""}
          </p>
          <p className="mt-2 text-sm leading-7 text-muted">{ROLE_HINTS[role] ?? ""}</p>
          <RoleCard role={role} open={round <= 1 && phase === "night"} />
          {role === "mafia" && teammates.length > 0 ? (
            <p className="mt-2 text-sm text-muted">
              زملاؤك المافيا: <span className="font-bold text-ivory">{teammates.join("، ")}</span>
            </p>
          ) : null}
          {role === "mafia" && (me?.spies ?? []).length > 0 ? (
            <p className="mt-2 text-sm text-muted">
              🕶️ الجاسوس حليفكم: <span className="font-bold text-ivory">{(me?.spies ?? []).join("، ")}</span> (لا يختار معكم)
            </p>
          ) : null}
          {role === "spy" ? (
            <p className="mt-3 rounded-2xl border border-wrong/40 bg-wrong-fill/10 p-3 text-sm text-ivory">
              {teammates.length > 0 ? (
                <>
                  🔪 المافيا: <b>{teammates.join("، ")}</b>
                </>
              ) : (
                "لم يبقَ أحد من المافيا."
              )}
            </p>
          ) : null}
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
          {inspectLocked ? (
            <p className="mt-3 rounded-2xl border border-gold/40 bg-gold/10 p-3 text-sm text-ivory">
              حققت الليلة مع <b>{me?.pending_inspect}</b>. النتيجة تظهر بعد انتهاء الليل.
            </p>
          ) : null}
          {!iAmAlive ? (
            <p className="mt-3 rounded-2xl bg-deep-2/60 p-3 text-sm text-muted">أنت خارج اللعبة. يمكنك متابعة النقاش.</p>
          ) : null}
        </>
      )}

      {lastResult ? <p className="mt-4 text-sm font-bold text-ivory">{lastResult}</p> : null}

      {phase === "night" && me?.started === true && iAmAlive && !canAct && !inspectLocked && role !== "spy" ? (
        <p className="mt-4 text-sm text-muted">اغمضوا أعينكم. الليل لأصحاب الأدوار.</p>
      ) : null}
      {phase === "night" && role === "spy" && iAmAlive ? (
        <p className="mt-4 text-sm text-muted">افتح عينك مع المافيا وتعرّف عليهم. لا تختار ضحية؛ انتظر الصباح.</p>
      ) : null}
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
        <p className="mt-1 text-xs text-muted">صوّت قبل انتهاء الوقت، وإلا يصوّت النظام عنك عشوائيًا.</p>
      ) : null}
      {phase === "vote" && progress?.phase === "vote" ? (
        <p className="mt-3 text-sm text-muted">
          صوّت <b className="tabular-nums text-ivory">{progress.done ?? 0}</b> من <b className="tabular-nums text-ivory">{progress.total ?? 0}</b>
        </p>
      ) : null}

      {role === "seer" && me?.seer_result ? (
        <p className="mt-4 rounded-2xl border border-violet-text/40 bg-violet-fill/10 p-3 text-sm text-ivory">
          🔮 {me.seer_result.name} كان <b>{ROLE_NAMES[me.seer_result.role] ?? ""}</b>
        </p>
      ) : null}
      {role === "sniper" && me?.shot_used ? <p className="mt-4 text-sm text-muted">🎯 أطلقت رصاصتك.</p> : null}

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

      {canAct ? (
        <div className="mt-5">
          <p className="text-sm text-muted">{phase === "vote" ? (runoff ? "إعادة التصويت بين المتعادلين:" : "صوّتوا لإقصاء لاعب:") : "اختاروا:"}</p>
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
          {split ? <p className="mt-2 text-sm text-gold">لم تتفقوا بعد. إذا تعادلت الاختيارات تُختار الضحية بالقرعة.</p> : null}
        </div>
      ) : null}

      {over ? (
        <div className="mt-5 grid gap-4">
          <p className="text-xl font-extrabold text-ivory">{WINNERS[winner ?? ""] ?? "انتهت اللعبة"}</p>
          <MafiaSummary state={state as MafiaPublicState} rows={rows} />
          <MafiaShare state={state as MafiaPublicState} rows={rows} />
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
 * The host's page: the narrator's screen when the host narrates (or before the roles are dealt),
 * or a player's screen when the draw picked someone else, with the host's room controls under it.
 */
export function MafiaHostScreen({ roomId, roomCode, roomStatus }: { roomId: string; roomCode: string; roomStatus: string }) {
  const [state, setState] = useState<StateData>({});
  const [mine, setMine] = useState<{ started?: boolean; narrator?: boolean } | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(roomStatus === "finished");
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
  if (!playing) return <MafiaNarratorPanel roomId={roomId} roomCode={roomCode} roomStatus={roomStatus} isHost />;

  async function reset() {
    if (!supabase) return;
    setBusy(true);
    await supabase.rpc("mafia_reset", { p_room_id: roomId });
    setBusy(false);
    void load();
  }
  async function endRoom() {
    if (!supabase) return;
    setBusy(true);
    const { error } = await supabase.from("game_rooms").update({ status: "finished" }).eq("id", roomId);
    setBusy(false);
    if (!error) setEnded(true);
  }
  return (
    <section className="mx-auto mt-2 max-w-2xl">
      <MafiaPlayerPanel roomId={roomId} meId={meId} state={state} roomCode={roomCode} roomStatus={roomStatus} />
      <p className="text-center text-xs text-muted">أنت المضيف وتلعب هذه المرة، والراوي {String(state.narrator_name ?? "")} يدير الجولات من جواله.</p>
      {state.phase === "over" ? (
        <div className="mt-4 text-center">
          <Button type="button" tone="primary" onClick={reset} disabled={busy}>
            مباراة جديدة بنفس اللاعبين
          </Button>
        </div>
      ) : null}
      <div className="mt-6 text-center">
        {ended ? (
          <p className="text-sm text-muted">انتهت الغرفة.</p>
        ) : (
          <Button type="button" tone="violet" onClick={endRoom} disabled={busy}>
            إنهاء الغرفة للجميع
          </Button>
        )}
      </div>
    </section>
  );
}

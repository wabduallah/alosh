import { useEffect, useRef, useState } from "react";
import { Flame, Heart, Laugh, Sparkles, type LucideIcon } from "lucide-react";
import { GameIcon, PictureIcons } from "@/components/icons";
import { QrCode } from "@/components/qr-code";
import { Button, inputClass, joinLink } from "@/components/ui";
import { LETTER_CATS, type LetterCat } from "@/games/score";
import { useI18n } from "@/lib/i18n";
import { getSnapshot, hostAction, sendCheer, submitAnswer } from "@/lib/lamma/rpc";
import { watchRoom } from "@/lib/lamma/live";
import type { Cheer, CheerKind, GameCard, Reveal, Snapshot } from "@/lib/lamma/types";
import { CHEER_KINDS } from "@/lib/lamma/types";
import { lobbyPulse, playCue, unlockAudio } from "@/lib/sfx";

function readToken(code: string, role: "host" | "player") {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(`lamma:${role}:${code}`) ?? "";
}

export function useRoom(code: string) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState({ host: "", player: "" });

  useEffect(() => {
    setTokens({ host: readToken(code, "host"), player: readToken(code, "player") });
  }, [code]);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const tick = async () => {
      try {
        const res = await getSnapshot({
          data: {
            code,
            hostToken: tokens.host || undefined,
            playerToken: tokens.player || undefined,
          },
        });
        if (stop) return;
        if (!res.ok) setError(res.error);
        else {
          setError(null);
          setSnap(res);
        }
        const playing = res.ok && res.room.status !== "CLOSED" && res.room.status !== "FINISHED";
        timer = window.setTimeout(tick, playing ? 2500 : 4000);
      } catch {
        if (!stop) setError("SERVER");
        timer = window.setTimeout(tick, 3000);
      }
    };
    void tick();
    const unwatch = watchRoom(code, () => {
      window.clearTimeout(timer);
      void tick();
    });
    return () => {
      stop = true;
      window.clearTimeout(timer);
      unwatch();
    };
  }, [code, tokens.host, tokens.player]);

  return { snap, error, tokens, setTokens };
}

function Countdown({ endsAt, total }: { endsAt: string | null; total: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);
  const left = endsAt ? Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 1000)) : total;
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const pct = total > 0 ? left / total : 0;
  return (
    <div className="relative grid size-28 place-items-center">
      <svg viewBox="0 0 96 96" className="absolute size-28 -rotate-90">
        <circle cx="48" cy="48" r={radius} className="fill-none stroke-ivory/20" strokeWidth="6" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          className="fill-none stroke-bronze"
          strokeWidth="6"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
        />
      </svg>
      <span className="font-display text-5xl text-ivory tabular-nums">{left}</span>
    </div>
  );
}

function promptOf(snap: Snapshot, lang: "ar" | "en") {
  const q = snap.room.question;
  if (!q) return "";
  return lang === "en" ? q.promptEn : q.promptAr;
}

export function HostScreen({ code, games }: { code: string; games: GameCard[] }) {
  const { t, lang, bundle } = useI18n();
  const { snap, error, tokens } = useRoom(code);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [fields, setFields] = useState<Record<LetterCat, string>>({ boy: "", girl: "", animal: "", object: "", country: "" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const prev = useRef<Snapshot | null>(null);
  const link = joinLink(code);

  useEffect(() => {
    if (!snap) return;
    const before = prev.current;
    if (before) {
      const known = new Set(before.players.map((p) => p.id));
      for (const player of snap.players) {
        if (!known.has(player.id)) {
          setNote(t("toast.joined", { name: player.name }));
          if (snap.room.sound) playCue("click", bundle.sounds.click);
        }
      }
      if (before.room.status !== "PLAYING" && snap.room.status === "PLAYING") {
        setNote(t("toast.started"));
        if (snap.room.sound) playCue("round", bundle.sounds.round);
      }
      if (before.room.status === "PLAYING" && snap.room.status === "ROUND_END") {
        setNote(t("toast.roundEnd"));
        if (snap.room.sound) playCue("correct", bundle.sounds.correct);
      }
      if (before.room.status !== "FINISHED" && snap.room.status === "FINISHED" && snap.room.sound) {
        playCue("victory", bundle.sounds.victory);
      }
    }
    prev.current = snap;
    if (snap.room.music && snap.room.status === "WAITING") lobbyPulse(true, bundle.sounds.lobby);
  }, [bundle.sounds, snap, t]);

  useEffect(() => {
    setFields({ boy: "", girl: "", animal: "", object: "", country: "" });
    setText("");
    setLocalErr(null);
    setSent(false);
  }, [snap?.room.round, snap?.room.status, snap?.room.gameId]);

  async function act(action: string, extra?: Record<string, unknown>) {
    unlockAudio();
    const res = await hostAction({ data: { code, hostToken: tokens.host, action, extra } });
    if (res && "ok" in res && res.ok === false) setNote(t(`err.${res.error}`));
  }

  async function send(payload: Record<string, unknown>) {
    if (!snap || busy || snap.yourAnswered || sent || !tokens.player) return;
    setBusy(true);
    unlockAudio();
    const res = await submitAnswer({
      data: { code, playerToken: tokens.player, round: snap.room.round, payload },
    });
    setBusy(false);
    if (!res.ok) setLocalErr(res.error);
    else setSent(true);
  }

  if (!snap) {
    return <main className="grid min-h-screen place-items-center bg-forest-deep text-ivory">{error ? t(`err.${error}`) : t("common.loading")}</main>;
  }

  const name = lang === "en" ? snap.room.nameEn : snap.room.nameAr;
  const answered = snap.players.filter((p) => p.answered).length;

  return (
    <main className="stage relative min-h-screen text-ivory" onPointerDown={unlockAudio}>
      <CheerRain cheers={snap.cheers ?? []} />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-bronze">{name}</p>
            <h1 className="font-display text-5xl tracking-wide sm:text-7xl">{code}</h1>
          </div>
          <div className="text-end">
            <p className="text-sm text-ivory/70">{t("host.round", { n: Math.max(snap.room.round, 1) })} / {snap.room.rounds}</p>
            <p className="text-lg">{t("host.answered")} {answered}/{snap.players.length}</p>
          </div>
        </header>

        {note ? <p className="rise rounded-full bg-ivory/10 px-4 py-2 text-sm">{note}</p> : null}
        {!snap.youAreHost ? <p className="text-sm text-ivory/70">{t("host.spectator")}</p> : null}
        {snap.youAreHost && snap.room.hostMode === "narrator" ? (
          <p className="rounded-2xl border border-neon/40 bg-neon/10 px-3 py-2 text-sm">وضع الراوي: اللاعبون لا يرون الإجابة. {snap.room.hostAnswer ? `الإجابة: ${snap.room.hostAnswer}` : "ابدأ الجولة لرؤية الإجابة."}</p>
        ) : null}

        {snap.room.status === "WAITING" ? (
          <section className="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
            <div className="rounded-3xl bg-ivory p-4 text-ink">
              <p className="text-xs text-muted">{t("host.ready")}</p>
              <p className="mt-1 font-display text-4xl tracking-widest text-forest">{code}</p>
              <p className="mt-2 text-sm">{t("host.count", { n: snap.players.length, max: snap.room.maxPlayers })}</p>
              <div className="mt-3 w-fit rounded-xl bg-sand p-2">
                <QrCode text={link} />
              </div>
            </div>
            <div className="space-y-4">
              <p className="max-w-xl text-lg text-ivory/80">{t("host.need")}</p>
              <GamePicker
                games={games}
                currentId={snap.room.gameId}
                disabled={!snap.youAreHost}
                onPick={(gameId) => void act("switchGame", { gameId })}
              />
              <div className="flex flex-wrap gap-2">
                <Button type="button" tone="light" onClick={() => void act("start")} disabled={!snap.youAreHost || snap.players.length < snap.room.minPlayers}>{t("host.start")}</Button>
                <Button type="button" tone="bronze" onClick={() => void act("bots")} disabled={!snap.youAreHost}>{t("host.bots")}</Button>
                <Button type="button" tone="bronze" onClick={() => void copy(link, setCopied)}>{copied ? t("host.copied") : t("host.copy")}</Button>
                <a className="inline-flex min-h-11 items-center rounded-full border border-ivory/30 px-5" href={`https://wa.me/?text=${encodeURIComponent(link)}`}>{t("host.whatsapp")}</a>
              </div>
              {snap.players.length < snap.room.minPlayers ? <p className="text-sm text-gold">{t("host.needMin", { n: snap.room.minPlayers })}</p> : null}
            </div>
          </section>
        ) : null}

        {snap.room.status === "PLAYING" ? (
          <section className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
            <div className="grid content-center gap-6 py-6 text-center">
              {snap.room.engine === "letter" ? (
                <p className="text-sm uppercase tracking-widest text-bronze">{t("host.letter")}</p>
              ) : null}
              <h2 className="font-display text-5xl sm:text-7xl">
                {snap.room.engine === "letter" ? snap.room.letter : promptOf(snap, lang)}
              </h2>
              {snap.room.question ? <PictureIcons names={snap.room.question.icons} /> : null}
              <div className="flex justify-center">
                <Countdown endsAt={snap.room.endsAt} total={snap.room.seconds} />
              </div>
            </div>
            {snap.youAreHost ? (
              <HostDock
                snap={snap}
                lang={lang}
                busy={busy}
                sent={sent}
                localErr={localErr}
                fields={fields}
                setFields={setFields}
                text={text}
                setText={setText}
                onSend={send}
                onAct={act}
              />
            ) : null}
          </section>
        ) : null}

        {snap.room.status === "ROUND_END" ? (
          <RevealBoard snap={snap} lang={lang} host={snap.youAreHost} onAct={act} />
        ) : null}

        {snap.room.status === "FINISHED" ? (
          <div className="space-y-6">
            <Podium players={snap.players} again={snap.youAreHost ? () => void act("start") : undefined} />
            {snap.youAreHost ? (
              <section className="space-y-3">
                <h3 className="text-xl">{t("host.switch")}</h3>
                <p className="text-sm text-ivory/70">{t("host.switchLead")}</p>
                <GamePicker
                  games={games}
                  currentId={snap.room.gameId}
                  onPick={(gameId) => void act("switchGame", { gameId, start: true })}
                />
              </section>
            ) : null}
          </div>
        ) : null}
        {snap.room.status === "CLOSED" ? <p className="text-2xl">{t("err.ROOM_NOT_FOUND")}</p> : null}

        <PlayerRail snap={snap} host={snap.youAreHost} onKick={(playerId) => void act("kick", { playerId })} />
      </div>
    </main>
  );
}

function RevealBoard({
  snap,
  lang,
  host,
  onAct,
}: {
  snap: Snapshot;
  lang: "ar" | "en";
  host: boolean;
  onAct: (action: string, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  const reveal: Reveal | null = snap.room.reveal;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {host ? <Button type="button" tone="light" onClick={() => void onAct("next")}>{snap.room.round >= snap.room.rounds ? t("host.finish") : t("host.next")}</Button> : null}
        {snap.room.auto ? <p className="text-sm text-ivory/70">{t("host.autoNext")}</p> : null}
      </div>
      {reveal?.correctAr ? (
        <p className="text-3xl">{lang === "en" ? reveal.correctEn || reveal.correctAr : reveal.correctAr}</p>
      ) : null}
      {reveal?.letterRows ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-start text-sm">
            <thead className="text-bronze">
              <tr>
                <th className="px-2 py-2">{t("host.players")}</th>
                {LETTER_CATS.map((cat) => (
                  <th key={cat} className="px-2 py-2">{t(`letter.${cat}`)}</th>
                ))}
                <th className="px-2 py-2">+</th>
              </tr>
            </thead>
            <tbody>
              {reveal.letterRows.map((row) => (
                <tr key={row.playerId} className="border-t border-ivory/15">
                  <td className="px-2 py-3">{row.name}</td>
                  {LETTER_CATS.map((cat) => {
                    const cell = row.fields[cat];
                    return (
                      <td key={cat} className="px-2 py-3">
                        <div>{cell.text || "—"}</div>
                        <div className="text-bronze tabular-nums">{cell.points}</div>
                        {host && cell.verdict === "bad" && cell.text ? (
                          <button type="button" className="text-xs underline" onClick={() => void onAct("accept", { playerId: row.playerId, category: cat })}>
                            {t("host.accept")}
                          </button>
                        ) : null}
                      </td>
                    );
                  })}
                  <td className="px-2 py-3 tabular-nums">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {reveal?.percents ? (
        <ul className="space-y-2 text-xl">
          {reveal.percents.map((item) => (
            <li key={item.id} className="flex justify-between border-b border-ivory/15 py-2">
              <span>{lang === "en" ? item.en : item.ar}</span>
              <span className="tabular-nums">{item.n}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {reveal?.votes ? (
        <ul className="space-y-2 text-xl">
          {reveal.votes.map((item) => (
            <li key={item.playerId} className="flex justify-between border-b border-ivory/15 py-2">
              <span>{item.name}</span>
              <span className="tabular-nums">{item.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {reveal?.truth ? (
        <ul className="space-y-3">
          {reveal.truth.map((item) => (
            <li key={item.playerId} className="rounded-2xl bg-ivory/10 p-4">
              <p className="text-bronze">{item.name}</p>
              <p className="text-xl">{lang === "en" ? item.promptEn : item.promptAr}</p>
              {host ? <Button type="button" tone="bronze" className="mt-3" onClick={() => void onAct("bonus", { playerId: item.playerId })}>{t("host.bonus")}</Button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {reveal?.answers ? (
        <ul className="space-y-2">
          {reveal.answers.map((item) => (
            <li key={item.playerId} className="flex justify-between gap-3 border-b border-ivory/15 py-2">
              <span>{item.name}</span>
              <span className="text-ivory/80">{item.text}</span>
              <span className="tabular-nums text-bronze">+{item.points}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {reveal?.feudHits ? (
        <ul className="space-y-2">
          {reveal.feudHits.map((item) => (
            <li key={item.playerId} className="flex justify-between border-b border-ivory/15 py-2">
              <span>{item.name}: {item.text}</span>
              <span className="tabular-nums">+{item.points}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const CHEER_ICON: Record<CheerKind, LucideIcon> = {
  spark: Sparkles,
  laugh: Laugh,
  heart: Heart,
  flame: Flame,
};

function cheerLane(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  return { left: 8 + (hash % 76), drift: `${(hash % 48) - 24}px` };
}

function CheerRain({ cheers }: { cheers: Cheer[] }) {
  const [live, setLive] = useState<Array<Cheer & { left: number; drift: string }>>([]);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    const fresh = cheers.filter((cheer) => !seen.current.has(cheer.id));
    if (!fresh.length) return;
    fresh.forEach((cheer, index) => {
      seen.current.add(cheer.id);
      const lane = cheerLane(cheer.id);
      window.setTimeout(() => {
        setLive((prev) => [...prev, { ...cheer, ...lane }].slice(-16));
        window.setTimeout(() => {
          setLive((prev) => prev.filter((item) => item.id !== cheer.id));
        }, 3400);
      }, index * 160);
    });
  }, [cheers]);

  if (!live.length) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-20 overflow-hidden" data-cheer-rain={live.length} aria-hidden="true">
      {live.map((item) => {
        const Icon = CHEER_ICON[item.kind];
        return (
          <div
            key={item.id}
            className="cheer-rise absolute bottom-28 flex flex-col items-center gap-1"
            style={{ left: `${item.left}%`, ["--cheer-drift" as string]: item.drift }}
          >
            <Icon className="size-14 text-bronze" strokeWidth={1.5} />
            <span className="rounded-full bg-forest-deep/85 px-3 py-1 text-sm text-ivory">{item.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function CheerBar({ onSend }: { onSend: (kind: CheerKind) => void }) {
  const { t } = useI18n();
  const [cooling, setCooling] = useState(false);

  function tap(kind: CheerKind) {
    if (cooling) return;
    setCooling(true);
    window.setTimeout(() => setCooling(false), 900);
    onSend(kind);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-ink/10 bg-ivory px-4 pt-3 pb-4">
      <p className="mb-2 text-center text-xs text-muted">{t("cheer.hint")}</p>
      <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
        {CHEER_KINDS.map((kind) => {
          const Icon = CHEER_ICON[kind];
          return (
            <button
              key={kind}
              type="button"
              data-cheer={kind}
              disabled={cooling}
              onClick={() => tap(kind)}
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border border-ink/10 bg-sand text-forest active:scale-95"
            >
              <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-xs">{t(`cheer.${kind}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GamePicker({
  games,
  currentId,
  disabled,
  onPick,
}: {
  games: GameCard[];
  currentId: string;
  disabled?: boolean;
  onPick: (gameId: string) => void;
}) {
  const { lang } = useI18n();
  return (
    <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
      {games.map((game) => {
        const active = game.id === currentId;
        return (
          <button
            key={game.id}
            type="button"
            disabled={disabled || active}
            onClick={() => onPick(game.id)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-start ${active ? "bg-ivory text-ink" : "text-ivory hover:bg-ivory/10"}`}
          >
            <GameIcon name={game.icon} className={`size-4 shrink-0 ${active ? "text-forest" : "text-bronze"}`} />
            <span className="truncate text-sm">{lang === "en" ? game.nameEn : game.nameAr}</span>
          </button>
        );
      })}
    </div>
  );
}

function AnswerPanel({
  snap,
  lang,
  busy,
  fields,
  setFields,
  text,
  setText,
  onSend,
  compact,
}: {
  snap: Snapshot;
  lang: "ar" | "en";
  busy: boolean;
  fields: Record<LetterCat, string>;
  setFields: (value: Record<LetterCat, string>) => void;
  text: string;
  setText: (value: string) => void;
  onSend: (payload: Record<string, unknown>) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {snap.room.engine === "letter" ? (
        <>
          {compact ? null : <p className="font-display text-6xl text-forest">{snap.room.letter}</p>}
          {LETTER_CATS.map((cat) => (
            <label key={cat} className="block space-y-1">
              <span className="text-sm text-muted">{t(`letter.${cat}`)}</span>
              <input className={inputClass} value={fields[cat]} onChange={(e) => setFields({ ...fields, [cat]: e.target.value })} />
            </label>
          ))}
          <Button type="button" disabled={busy} onClick={() => onSend({ fields })}>{t("pad.send")}</Button>
        </>
      ) : null}
      {snap.room.engine === "text" || snap.room.engine === "feud" ? (
        <>
          {compact ? null : <h2 className="text-2xl">{promptOf(snap, lang)}</h2>}
          <input className={inputClass} value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="button" disabled={busy || !text.trim()} onClick={() => onSend({ text })}>{t("pad.send")}</Button>
        </>
      ) : null}
      {snap.room.engine === "vote" ? (
        <div className="grid gap-2">
          {snap.players.filter((p) => p.id !== snap.yourId).map((p) => (
            <Button key={p.id} type="button" tone="ghost" disabled={busy} onClick={() => onSend({ playerId: p.id })}>{p.name}</Button>
          ))}
        </div>
      ) : null}
      {snap.room.question && snap.room.engine !== "letter" && snap.room.engine !== "text" && snap.room.engine !== "feud" && snap.room.engine !== "vote" ? (
        <>
          {compact ? null : <h2 className="text-2xl">{promptOf(snap, lang)}</h2>}
          {snap.yourId && snap.room.subjectId === snap.yourId ? <p className="text-sm text-muted">{t("pad.subject")}</p> : null}
          <div className="grid gap-2">
            {snap.room.question.choices.map((choice) => (
              <Button key={choice.id} type="button" tone="ghost" disabled={busy} onClick={() => onSend(snap.room.engine === "truth" ? { side: choice.id } : { choiceId: choice.id })}>
                {lang === "en" ? choice.en : choice.ar}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function HostDock({
  snap,
  lang,
  busy,
  sent,
  localErr,
  fields,
  setFields,
  text,
  setText,
  onSend,
  onAct,
}: {
  snap: Snapshot;
  lang: "ar" | "en";
  busy: boolean;
  sent: boolean;
  localErr: string | null;
  fields: Record<LetterCat, string>;
  setFields: (value: Record<LetterCat, string>) => void;
  text: string;
  setText: (value: string) => void;
  onSend: (payload: Record<string, unknown>) => void;
  onAct: (action: string, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const { t } = useI18n();
  if (snap.room.status !== "PLAYING") return null;
  const locked = snap.yourAnswered || sent;
  return (
    <section className="rounded-3xl bg-ivory p-4 text-ink">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{t("host.dock")}</p>
          <p className="text-sm">{t("host.playAs")}</p>
        </div>
        {snap.room.status === "PLAYING" ? (
          <Button type="button" tone="bronze" onClick={() => void onAct("endRound")}>{t("host.end")}</Button>
        ) : null}
      </div>
      {localErr ? <p className="mb-2 text-sm">{t(`err.${localErr}`)}</p> : null}
      {snap.room.status === "PLAYING" && locked ? <p className="font-display text-3xl">{t("pad.locked")}</p> : null}
      {snap.room.status === "PLAYING" && !locked && snap.yourId ? (
        <AnswerPanel snap={snap} lang={lang} busy={busy} fields={fields} setFields={setFields} text={text} setText={setText} onSend={onSend} compact />
      ) : null}
    </section>
  );
}

function Podium({
  players,
  again,
}: {
  players: Snapshot["players"];
  again?: () => void;
}) {
  const { t } = useI18n();
  const ranked = [...players].sort((a, b) => b.score - a.score);
  return (
    <section className="space-y-4 text-center">
      <h2 className="font-display text-5xl">{t("podium.title")}</h2>
      <ol className="mx-auto grid max-w-3xl gap-3 sm:grid-cols-3">
        {ranked.slice(0, 3).map((player, index) => (
          <li key={player.id} className="rounded-2xl bg-ivory/10 p-4">
            <p className="font-display text-4xl text-bronze">{index + 1}</p>
            <p className="text-2xl">{player.name}</p>
            <p className="tabular-nums text-ivory/70">{player.score}</p>
            <p className="text-sm">{t(`podium.${index + 1}`)}</p>
          </li>
        ))}
      </ol>
      {again ? <Button type="button" tone="light" onClick={again}>{t("host.again")}</Button> : null}
    </section>
  );
}

function PlayerRail({
  snap,
  host,
  onKick,
}: {
  snap: Snapshot;
  host: boolean;
  onKick: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <ul className="mt-auto flex flex-wrap gap-2">
      {snap.players.map((player) => (
        <li key={player.id} className="flex items-center gap-2 rounded-full bg-ivory/10 px-3 py-2">
          <span className={player.answered ? "text-bronze" : ""}>{player.name}</span>
          <span className="tabular-nums text-sm text-ivory/70">{player.score}</span>
          {player.isBot ? <span className="text-xs text-ivory/50">•</span> : null}
          {host && player.id !== snap.yourId && (snap.room.status === "WAITING" || snap.room.status === "PLAYING" || snap.room.status === "ROUND_END") ? (
            <button type="button" className="text-xs underline" onClick={() => onKick(player.id)}>{t("host.kick")}</button>
          ) : null}
          {player.id === snap.yourId ? <span className="text-xs text-bronze">{t("host.you")}</span> : null}
        </li>
      ))}
    </ul>
  );
}

async function copy(link: string, setCopied: (v: boolean) => void) {
  try {
    await navigator.clipboard.writeText(link);
    setCopied(true);
  } catch {
    setCopied(false);
  }
}

export function PadScreen({ code }: { code: string }) {
  const { t, lang } = useI18n();
  const { snap, error, tokens } = useRoom(code);
  const [fields, setFields] = useState<Record<LetterCat, string>>({ boy: "", girl: "", animal: "", object: "", country: "" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setFields({ boy: "", girl: "", animal: "", object: "", country: "" });
    setText("");
    setLocalErr(null);
    setSent(false);
  }, [snap?.room.round, snap?.room.status]);

  if (!tokens.player && snap) {
    return <Gate code={code} />;
  }
  if (!snap) {
    return <main className="grid min-h-screen place-items-center bg-sand px-6 text-center">{error ? t(`err.${error}`) : t("common.loading")}</main>;
  }

  const me = snap.players.find((p) => p.id === snap.yourId);
  const showCheer =
    snap.room.status === "WAITING" ||
    snap.room.status === "ROUND_END" ||
    snap.room.status === "FINISHED" ||
    (snap.room.status === "PLAYING" && (snap.yourAnswered || sent));

  function throwCheer(kind: CheerKind) {
    unlockAudio();
    void sendCheer({ data: { code, playerToken: tokens.player, kind } });
  }

  async function send(payload: Record<string, unknown>) {
    if (!snap || busy || snap.yourAnswered || sent) return;
    setBusy(true);
    unlockAudio();
    const res = await submitAnswer({
      data: { code, playerToken: tokens.player, round: snap.room.round, payload },
    });
    setBusy(false);
    if (!res.ok) setLocalErr(res.error);
    else setSent(true);
  }

  return (
    <main className={`min-h-screen bg-sand px-4 py-5 text-ink ${showCheer ? "pb-32" : ""}`} onPointerDown={unlockAudio}>
      <header className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">{me?.name}</p>
          <p className="font-display text-3xl tabular-nums">{me?.score ?? 0}</p>
          <p className="text-xs text-muted">{t("pad.score")}</p>
        </div>
        <p className="text-sm text-muted">{t("host.round", { n: Math.max(snap.room.round, 1) })}</p>
      </header>
      {localErr ? <p className="mb-3 text-sm">{t(`err.${localErr}`)}</p> : null}

      {snap.room.status === "WAITING" ? (
        <section className="space-y-3">
          <p className="text-sm text-bronze">{lang === "en" ? snap.room.nameEn : snap.room.nameAr}</p>
          <h1 className="font-display text-4xl">{t("join.waiting")}</h1>
          <p className="text-muted">{t("join.hint")}</p>
          <ul className="space-y-2">
            {snap.players.map((p) => (
              <li key={p.id} className="rounded-2xl bg-ivory px-4 py-3">{p.name}{p.id === snap.yourId ? ` · ${t("pad.you")}` : ""}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {snap.room.status === "PLAYING" && (snap.yourAnswered || sent) ? (
        <h1 className="font-display text-4xl">{t("pad.locked")}</h1>
      ) : null}

      {snap.room.status === "PLAYING" && !snap.yourAnswered && !sent ? (
        <AnswerPanel snap={snap} lang={lang} busy={busy} fields={fields} setFields={setFields} text={text} setText={setText} onSend={(payload) => void send(payload)} />
      ) : null}

      {snap.room.status === "ROUND_END" ? (
        <section className="space-y-2">
          <h1 className="font-display text-4xl">{t("pad.roundEnd")}</h1>
          <p className="font-display text-6xl text-forest tabular-nums">{t("pad.points", { n: snap.yourRoundScore })}</p>
        </section>
      ) : null}
      {snap.room.status === "FINISHED" ? (
        <div className="rounded-3xl bg-forest-deep p-4 text-ivory">
          <Podium players={snap.players} />
        </div>
      ) : null}
      {showCheer ? <CheerBar onSend={throwCheer} /> : null}
    </main>
  );
}

function Gate({ code }: { code: string }) {
  const { t } = useI18n();
  return (
    <main className="grid min-h-screen place-items-center bg-sand px-6 text-center">
      <div className="space-y-3">
        <p>{t("join.title")}</p>
        <a className="inline-flex min-h-11 items-center rounded-full bg-forest px-5 text-ivory" href={`/join/${code}`}>{code}</a>
      </div>
    </main>
  );
}

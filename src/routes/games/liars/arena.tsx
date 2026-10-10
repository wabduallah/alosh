import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Monitor, Smartphone, Tv } from "lucide-react";
import { Shell } from "@/components/shell";
import { cx, inputClass } from "@/components/ui";
import {
  AnswerPad,
  Board,
  Finished,
  Leaderboard,
  Lobby,
  QuestionStage,
  RevealList,
} from "@/components/liars/arena-parts";
import { joinLiarsRoom, liarsAction, liarsAnswer, liarsHelper } from "@/lib/liars/rpc";
import { saveToken } from "@/lib/liars/tokens";
import { ERROR_TEXT, type LiarsError, type LiarsSnapshot, type ViewMode } from "@/lib/liars/types";
import { useLiarsRoom } from "@/lib/liars/use-liars-room";

const VIEWS: ViewMode[] = ["host", "tv", "pad"];

export const Route = createFileRoute("/games/liars/arena")({
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search.code === "string" ? search.code.trim().toUpperCase().slice(0, 8) : "",
    view: (VIEWS as string[]).includes(search.view as string) ? (search.view as ViewMode) : ("pad" as ViewMode),
  }),
  head: () => ({ meta: [{ title: "الكذابون — العش" }] }),
  component: ArenaPage,
});

type Act = (action: "start" | "pick" | "reveal" | "next" | "end", extra?: { categoryId?: string; level?: number }) => Promise<void>;

function errorText(error: LiarsError | "SERVER" | null): string | null {
  if (!error) return null;
  return error === "SERVER" ? "تعذّر الاتصال بالخادم. نحاول مجددًا." : ERROR_TEXT[error];
}

function ArenaPage() {
  const { code, view } = Route.useSearch();
  const room = useLiarsRoom(code);
  const { snap, tokens, skew } = room;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!code) {
    return (
      <Shell>
        <EmptyState title="لا يوجد رمز عش" body="افتح الرابط الذي شاركه المضيف، أو انضم برمز العش من الصفحة الرئيسية." />
      </Shell>
    );
  }

  const act: Act = async (action, extra) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await liarsAction({
        data: { code, action, hostToken: tokens.host || undefined, playerToken: tokens.player || undefined, ...extra },
      });
      if (!res.ok) setNotice(ERROR_TEXT[res.error]);
    } catch {
      setNotice(errorText("SERVER"));
    } finally {
      setBusy(false);
      room.refresh();
    }
  };

  const answer = async (choice: number) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await liarsAnswer({ data: { code, playerToken: tokens.player, choice } });
      if (!res.ok) setNotice(ERROR_TEXT[res.error]);
    } catch {
      setNotice(errorText("SERVER"));
    } finally {
      setBusy(false);
      room.refresh();
    }
  };

  const helper = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await liarsHelper({ data: { code, playerToken: tokens.player } });
      if (!res.ok) setNotice(ERROR_TEXT[res.error]);
    } catch {
      setNotice(errorText("SERVER"));
    } finally {
      setBusy(false);
      room.refresh();
    }
  };

  const loadError = !snap ? errorText(room.error) : null;

  return (
    <Shell>
      <div className="space-y-4">
        <ArenaHeader code={code} view={view} snap={snap} />
        {notice ? (
          <p role="alert" className="rounded-xl border border-crimson/40 bg-crimson/10 px-4 py-2 text-sm text-ivory">
            {notice}
          </p>
        ) : null}
        {room.error && snap ? <p className="text-xs text-muted">{errorText(room.error)}</p> : null}
        {!snap ? (
          loadError ? <EmptyState title="تعذّر فتح العش" body={loadError} /> : <p className="py-16 text-center text-muted">جارٍ التحميل…</p>
        ) : view === "pad" ? (
          <PadView snap={snap} skew={skew} busy={busy} act={act} onAnswer={answer} onHelper={helper} code={code} onJoined={room.reloadTokens} />
        ) : (
          <ScreenView snap={snap} skew={skew} busy={busy} act={act} controls={view === "host" && snap.you.isHost} onAnswer={answer} onHelper={helper} />
        )}
      </div>
    </Shell>
  );
}

function ArenaHeader({ code, view, snap }: { code: string; view: ViewMode; snap: LiarsSnapshot | null }) {
  const links: { view: ViewMode; label: string; icon: ReactNode }[] = [
    { view: "host", label: "المضيف", icon: <Monitor className="size-4" aria-hidden="true" /> },
    { view: "tv", label: "الشاشة الكبيرة", icon: <Tv className="size-4" aria-hidden="true" /> },
    { view: "pad", label: "جوال اللاعب", icon: <Smartphone className="size-4" aria-hidden="true" /> },
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-extrabold text-ivory sm:text-3xl">الكذابون</h1>
        <span className="text-lg font-extrabold tracking-widest text-neon tabular-nums" dir="ltr">
          {code}
        </span>
      </div>
      <nav className="flex gap-1.5" aria-label="طريقة العرض">
        {links
          .filter((l) => l.view !== "host" || snap?.you.isHost)
          .map((l) => (
            <Link
              key={l.view}
              to="/games/liars/arena"
              search={{ code, view: l.view }}
              aria-current={view === l.view ? "page" : undefined}
              className={cx(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition",
                view === l.view ? "border-neon bg-neon/15 text-ivory" : "border-white/10 text-muted hover:border-neon/50",
              )}
            >
              {l.icon}
              {l.label}
            </Link>
          ))}
      </nav>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <section className="glass-card mx-auto mt-8 max-w-lg rounded-3xl p-6 text-center">
      <h2 className="text-xl font-extrabold text-ivory">{title}</h2>
      <p className="mt-2 text-muted">{body}</p>
      <Link to="/" className="mt-5 inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 text-sm font-bold text-ivory">
        العودة للرئيسية
      </Link>
    </section>
  );
}

function pickerName(snap: LiarsSnapshot): string {
  return snap.players.find((p) => p.id === snap.room.pickerId)?.name ?? "";
}

// ---------------------------------------------------------------------------
// Host and TV: the big screen
// ---------------------------------------------------------------------------

function ScreenView({
  snap,
  skew,
  busy,
  act,
  controls,
  onAnswer,
  onHelper,
}: {
  snap: LiarsSnapshot;
  skew: number;
  busy: boolean;
  act: Act;
  controls: boolean;
  onAnswer: (choice: number) => void;
  onHelper: () => void;
}) {
  const { state } = snap.room;
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (state === "lobby") {
    return (
      <div className="glass-card rounded-3xl p-5 sm:p-8">
        <Lobby
          snap={snap}
          controls={
            controls ? (
              <button
                type="button"
                disabled={busy || !snap.players.length}
                onClick={() => void act("start")}
                className="min-h-12 w-full rounded-full bg-neon px-6 text-lg font-extrabold text-night shadow-[0_0_24px_rgb(6_182_212/0.4)] disabled:opacity-50 sm:w-auto"
              >
                {snap.players.length ? "ابدأ اللعب" : "بانتظار أول لاعب"}
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  if (state === "finished") {
    return (
      <div className="glass-card rounded-3xl p-5 sm:p-8">
        <Finished
          snap={snap}
          action={
            controls ? (
              <Link to="/games/liars/setup" className="inline-flex min-h-12 items-center rounded-full bg-neon px-6 font-extrabold text-night">
                لعبة جديدة
              </Link>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="glass-card min-w-0 rounded-3xl p-4 sm:p-6">
        {state === "board" ? (
          <div className="space-y-4">
            <p className="text-lg font-bold text-ivory">
              {snap.you.canPick && controls ? "اختر خانة" : `دور ${pickerName(snap)} لاختيار خانة`}
            </p>
            <Board snap={snap} size="lg" busy={busy} onPick={controls ? (categoryId, level) => void act("pick", { categoryId, level }) : undefined} />
          </div>
        ) : (
          <div className="space-y-6">
            <QuestionStage snap={snap} skew={skew} />
            {state === "reveal" ? <RevealList snap={snap} /> : null}
          </div>
        )}
      </div>
      <aside className="space-y-4">
        <div className="glass-card rounded-3xl p-4">
          <h2 className="mb-3 font-extrabold text-ivory">الترتيب</h2>
          <Leaderboard snap={snap} compact />
        </div>
        {controls ? (
          <div className="glass-card space-y-2 rounded-3xl p-4">
            {state === "question" ? (
              <HostButton disabled={busy} onClick={() => void act("reveal")}>
                اكشف الإجابة الآن
              </HostButton>
            ) : null}
            {state === "reveal" ? (
              <HostButton primary disabled={busy} onClick={() => void act("next")}>
                السؤال التالي
              </HostButton>
            ) : null}
            {confirmEnd ? (
              <div className="flex gap-2">
                <HostButton danger disabled={busy} onClick={() => void act("end")}>
                  نعم، أنهِ اللعبة
                </HostButton>
                <HostButton disabled={busy} onClick={() => setConfirmEnd(false)}>
                  تراجع
                </HostButton>
              </div>
            ) : (
              <HostButton disabled={busy} onClick={() => setConfirmEnd(true)}>
                إنهاء اللعبة
              </HostButton>
            )}
          </div>
        ) : null}
        {snap.you.playerId && state !== "board" ? (
          <div className="glass-card rounded-3xl p-4">
            <h2 className="mb-3 font-extrabold text-ivory">إجابتك</h2>
            <AnswerPad snap={snap} skew={skew} busy={busy} onAnswer={onAnswer} onHelper={onHelper} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function HostButton({
  children,
  onClick,
  disabled,
  primary,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "min-h-11 w-full rounded-full px-4 text-sm font-extrabold transition disabled:opacity-50",
        primary && "bg-neon text-night shadow-[0_0_18px_rgb(6_182_212/0.35)]",
        danger && "border border-crimson/60 bg-crimson/15 text-ivory",
        !primary && !danger && "border border-white/15 text-ivory hover:border-neon/60",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pad: the player's phone
// ---------------------------------------------------------------------------

function PadView({
  snap,
  skew,
  busy,
  act,
  onAnswer,
  onHelper,
  code,
  onJoined,
}: {
  snap: LiarsSnapshot;
  skew: number;
  busy: boolean;
  act: Act;
  onAnswer: (choice: number) => void;
  onHelper: () => void;
  code: string;
  onJoined: () => void;
}) {
  if (!snap.you.playerId) {
    return snap.room.state === "finished" ? (
      <div className="glass-card rounded-3xl p-5">
        <Finished snap={snap} />
      </div>
    ) : (
      <JoinGate code={code} onJoined={onJoined} />
    );
  }

  const me = snap.players.find((p) => p.id === snap.you.playerId);
  const rank = snap.players.findIndex((p) => p.id === snap.you.playerId) + 1;
  const { state } = snap.room;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="glass-card flex items-center justify-between rounded-2xl px-4 py-3">
        <span className="min-w-0 truncate font-extrabold text-ivory">{me?.name}</span>
        <span className="text-sm text-muted">المركز {rank}</span>
        <span className="text-xl font-extrabold tabular-nums text-neon">{me?.score ?? 0}</span>
      </div>
      <div className="glass-card rounded-3xl p-4">
        {state === "lobby" ? (
          <p className="py-8 text-center text-lg font-bold text-ivory">أنت في العش. بانتظار المضيف ليبدأ.</p>
        ) : null}
        {state === "board" ? (
          snap.you.canPick ? (
            <div className="space-y-3">
              <p className="text-center text-lg font-extrabold text-neon">دورك: اختر خانة</p>
              <Board snap={snap} size="sm" busy={busy} onPick={(categoryId, level) => void act("pick", { categoryId, level })} />
            </div>
          ) : (
            <p className="py-8 text-center text-lg font-bold text-ivory">دور {pickerName(snap)} لاختيار خانة.</p>
          )
        ) : null}
        {state === "question" || state === "reveal" ? (
          <AnswerPad snap={snap} skew={skew} busy={busy} onAnswer={onAnswer} onHelper={onHelper} />
        ) : null}
        {state === "reveal" && snap.room.pickerId === snap.you.playerId ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act("next")}
            className="mt-4 min-h-12 w-full rounded-full bg-neon font-extrabold text-night disabled:opacity-50"
          >
            السؤال التالي
          </button>
        ) : null}
        {state === "finished" ? <Finished snap={snap} /> : null}
      </div>
    </div>
  );
}

function JoinGate({ code, onJoined }: { code: string; onJoined: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await joinLiarsRoom({ data: { code, name } });
      if (!res.ok) {
        setError(ERROR_TEXT[res.error]);
        return;
      }
      saveToken(res.code, "player", res.playerToken);
      onJoined();
      void navigate({ to: "/games/liars/arena", search: { code: res.code, view: "pad" }, replace: true });
    } catch {
      setError("تعذّر الاتصال بالخادم. حاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="glass-card mx-auto max-w-md space-y-4 rounded-3xl p-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-xl font-extrabold text-ivory">انضم إلى العش {code}</h2>
      <label className="block space-y-2 text-sm">
        <span className="text-muted">اسمك في اللعبة</span>
        <input
          id="liars-join-name"
          className={inputClass}
          value={name}
          maxLength={16}
          autoComplete="nickname"
          onChange={(e) => setName(e.target.value)}
          placeholder="مثال: نورة"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-crimson">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || name.trim().length < 2}
        className="min-h-12 w-full rounded-full bg-neon font-extrabold text-night disabled:opacity-50"
      >
        {busy ? "جارٍ الانضمام…" : "ادخل العش"}
      </button>
    </form>
  );
}

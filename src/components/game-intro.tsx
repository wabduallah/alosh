import { useEffect, useState } from "react";
import { Button, cx } from "@/components/ui";

/**
 * A first-time intro: three short screens about the player's role, shown once per device for
 * each game and role. For secret roles (the mafia) each screen shows only while it is held.
 */

export type IntroStep = { icon: string; title: string; text: string };

const KEY = (game: string, role: string) => `al3sh.intro.${game}.${role}`;

function seen(game: string, role: string) {
  try {
    return window.localStorage.getItem(KEY(game, role)) === "1";
  } catch {
    return true;
  }
}

export function GameIntro({ game, role, steps, secret = false }: { game: string; role: string; steps: IntroStep[]; secret?: boolean }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    if (!role || !steps.length) return;
    setI(0);
    setOpen(!seen(game, role));
  }, [game, role, steps.length]);

  useEffect(() => {
    const hide = () => setHolding(false);
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  if (!open) return null;
  const close = () => {
    try {
      window.localStorage.setItem(KEY(game, role), "1");
    } catch {
      // Private mode: it shows again next time, which is harmless.
    }
    setOpen(false);
  };
  const step = steps[i];
  const last = i === steps.length - 1;
  const visible = !secret || holding;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/80 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="تعرّف على دورك">
      <div className="surface w-full max-w-md rounded-[28px] p-5 text-center shadow-lift">
        <p className="text-[12px] font-bold text-violet-text">
          أول مرة بهذا الدور · {i + 1} من {steps.length}
        </p>
        <div
          className={cx("mt-3 grid min-h-48 place-items-center rounded-[22px] border p-4", secret ? "touch-none select-none border-dashed border-violet-text/50" : "border-line", visible && "border-gold/60 bg-night/60")}
          onPointerDown={secret ? () => setHolding(true) : undefined}
          onPointerUp={secret ? () => setHolding(false) : undefined}
          onPointerLeave={secret ? () => setHolding(false) : undefined}
          onPointerCancel={secret ? () => setHolding(false) : undefined}
          onContextMenu={secret ? (e) => e.preventDefault() : undefined}
          role={secret ? "button" : undefined}
          tabIndex={secret ? 0 : undefined}
          onKeyDown={secret ? (e) => (e.key === " " || e.key === "Enter") && setHolding(true) : undefined}
          onKeyUp={secret ? () => setHolding(false) : undefined}
        >
          {visible ? (
            <div className="grid gap-2">
              <span aria-hidden="true" className="text-[42px] leading-none">
                {step.icon}
              </span>
              <p className="text-[19px] font-extrabold text-ivory">{step.title}</p>
              <p className="text-[15px] leading-7 text-mist">{step.text}</p>
            </div>
          ) : (
            <div className="grid gap-1">
              <span aria-hidden="true" className="text-[34px] leading-none">
                🂠
              </span>
              <p className="text-[15px] font-bold text-ivory">المس مطوّلًا لقراءة هذه الشاشة</p>
              <p className="text-[13px] text-muted">تأكد أن لا أحد يرى جوالك.</p>
            </div>
          )}
        </div>
        <div className="mt-3 flex justify-center gap-1.5" aria-hidden="true">
          {steps.map((_, k) => (
            <span key={k} className={cx("h-2 rounded-full transition-all", k === i ? "w-6 bg-gold" : "w-2 bg-line-strong")} />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
          <Button tone="quiet" className="min-h-12" onClick={close}>
            تخطَّ
          </Button>
          <Button tone="primary" className="min-h-12" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? "فهمت، لنلعب" : "التالي"}
          </Button>
        </div>
      </div>
    </div>
  );
}

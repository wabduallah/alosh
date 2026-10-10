import { useEffect, useRef, useState } from "react";
import { Flame, Heart, Laugh, Sparkles, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Cheer, CheerKind } from "@/lib/lamma/types";
import { CHEER_KINDS } from "@/lib/lamma/types";

const CHEER_ICON: Record<CheerKind, LucideIcon> = {
  spark: Sparkles,
  laugh: Laugh,
  heart: Heart,
  flame: Flame,
};

/** Stable horizontal lane for a cheer, so the same cheer always drifts the same way. */
function cheerLane(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 33 + id.charCodeAt(i)) >>> 0;
  return { left: 8 + (hash % 76), drift: `${(hash % 48) - 24}px` };
}

/** Floating cheers over the screen. Each new cheer is shown once, then removed after its animation. */
export function CheerRain({ cheers }: { cheers: Cheer[] }) {
  const [live, setLive] = useState<Array<Cheer & { left: number; drift: string }>>([]);
  const seen = useRef(new Set<string>());
  const timers = useRef<number[]>([]);

  // Timers are only cleared on unmount. Clearing them when `cheers` changes would drop cheers
  // that were already marked as seen, so they would never show.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  useEffect(() => {
    const fresh = cheers.filter((cheer) => !seen.current.has(cheer.id));
    fresh.forEach((cheer, index) => {
      seen.current.add(cheer.id);
      const lane = cheerLane(cheer.id);
      timers.current.push(
        window.setTimeout(() => {
          setLive((prev) => [...prev, { ...cheer, ...lane }].slice(-16));
          timers.current.push(
            window.setTimeout(() => {
              setLive((prev) => prev.filter((item) => item.id !== cheer.id));
            }, 3400),
          );
        }, index * 160),
      );
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
            <Icon className="size-14 text-neon drop-shadow-[0_0_12px_rgb(6_182_212/0.7)]" strokeWidth={1.5} />
            <span className="rounded-full border border-white/10 bg-night/85 px-3 py-1 text-sm text-ivory">{item.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Bottom bar of cheer buttons. A short cooldown stops spamming; timers are cleared on unmount. */
export function CheerBar({ onSend }: { onSend: (kind: CheerKind) => void }) {
  const { t } = useI18n();
  const [cooling, setCooling] = useState(false);
  const cooldown = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (cooldown.current !== null) window.clearTimeout(cooldown.current);
    };
  }, []);

  function tap(kind: CheerKind) {
    if (cooling) return;
    setCooling(true);
    cooldown.current = window.setTimeout(() => setCooling(false), 900);
    onSend(kind);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-night/85 px-4 pt-3 pb-4 backdrop-blur-xl">
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
              className="flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] text-ivory transition hover:border-neon/50 active:scale-95 disabled:opacity-50"
            >
              <Icon className="size-5 text-neon" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-xs">{t(`cheer.${kind}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { allPhases, PHASE_LABELS, phaseIndex, type CourtPhaseKey } from "@/lib/court-phase-guide";
import { cx } from "@/components/ui";

/** شريط مراحل المحكمة — للعرض على المضيف والتلفزيون والجوال */
export function CourtPhaseBar({
  phase,
  leftSeconds,
  standName,
  compact = false,
}: {
  phase?: string | null;
  leftSeconds?: number | null;
  standName?: string | null;
  compact?: boolean;
}) {
  const current = (phase ?? "intro") as CourtPhaseKey;
  const idx = phaseIndex(current);
  const phases = allPhases();

  return (
    <div className={cx("w-full rounded-2xl border border-white/10 bg-white/[0.03] p-3", compact && "p-2")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-extrabold text-cyan-300">{PHASE_LABELS[current] ?? current}</p>
        {typeof leftSeconds === "number" && leftSeconds >= 0 ? (
          <p className="font-display text-sm tabular-nums text-white/80">
            {Math.floor(leftSeconds / 60)}:{String(leftSeconds % 60).padStart(2, "0")}
          </p>
        ) : null}
      </div>
      <div className="flex gap-1">
        {phases.map((p, i) => {
          const done = i < idx;
          const active = i === idx;
          return (
            <div
              key={p}
              title={PHASE_LABELS[p]}
              className={cx(
                "h-1.5 flex-1 rounded-full transition-colors",
                active && "bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.45)]",
                done && !active && "bg-violet-500/70",
                !done && !active && "bg-white/10",
              )}
            />
          );
        })}
      </div>
      {standName ? (
        <p className="mt-2 text-center text-sm font-bold text-amber-200">
          الآن على المنصة: {standName}
        </p>
      ) : null}
    </div>
  );
}

/** بطاقة تعليمات المرحلة للاعب */
export function CourtPhaseHint({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm leading-relaxed text-cyan-50">
      <span className="font-extrabold text-cyan-300">دورك الآن: </span>
      {text}
    </div>
  );
}

/** قائمة أسئلة مقترحة */
export function CourtQuestionSuggestions({
  items,
  onPick,
}: {
  items: string[];
  onPick?: (q: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-white/50">اقتراحات أسئلة</p>
      <div className="flex flex-col gap-2">
        {items.map((q) => (
          <button
            key={q}
            type="button"
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-start text-sm text-white/90 transition hover:border-cyan-400/40 hover:bg-cyan-400/10"
            onClick={() => onPick?.(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

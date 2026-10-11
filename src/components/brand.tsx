import { useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "@/components/ui";

/*
 * Brand pieces of the «هوية العش» identity: logo, cradle (the hilal), player eggs,
 * game icons and a small icon set drawn in the lucide style (24 grid, 2px stroke).
 */

/* ---------------- Logo ---------------- */

type LogoTone = "color" | "light";

/** The lockup: the hilal mark on the right, the wordmark on the left. Outlined SVG, no font needed. */
export function Lockup({ height = 34, tone = "color", className }: { height?: number; tone?: LogoTone; className?: string }) {
  const src = tone === "light" ? "/brand/al3sh-lockup-light.svg" : "/brand/al3sh-lockup.svg";
  return <img src={src} alt="العش" height={height} style={{ height, width: "auto" }} className={cx("block", className)} />;
}

/** The mark alone: a hilal holding three eggs. */
export function Mark({ height = 32, className }: { height?: number; className?: string }) {
  return (
    <img src="/brand/al3sh-mark.svg" alt="" aria-hidden="true" height={height} style={{ height, width: "auto" }} className={cx("block", className)} />
  );
}

/* ---------------- Cradle ---------------- */

const MOON = "M2 2 A98 36 0 0 0 198 2 A98 20 0 0 1 2 2 Z";

/**
 * The hilal under the single most important thing on a screen.
 * `hold` for solid shapes (an egg, the buzzer) so they sit inside it; without it the hilal sits under text.
 */
export function Cradle({
  children,
  hold = false,
  tone = "neon",
  className,
  style,
}: {
  children: ReactNode;
  hold?: boolean;
  tone?: "neon" | "violet" | "soft";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cx("relative inline-grid justify-items-center", hold && "cradle-hold", tone !== "neon" && `cradle-${tone}`, className)}
      style={style}
    >
      <div className="relative z-[1]">{children}</div>
      <svg className="cradle-moon" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
        <path d={MOON} />
      </svg>
    </div>
  );
}

/** The wide hilal used in the hero figure and under rows of eggs. */
export function MoonArc({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={MOON} />
    </svg>
  );
}

/* ---------------- Eggs ---------------- */

const EGG_SIZES = { sm: "w-8 text-[13px]", md: "w-11 text-lg", lg: "w-16 text-[26px]", xl: "w-[132px] text-[54px]" } as const;

/** First letter of a name, dropping a leading «ال». */
export function initialOf(name: string) {
  const s = name.trim().replace(/^ال(?=\S{2,})/, "");
  return s.charAt(0);
}

/**
 * A player is an egg in the nest: the colour follows join order (egg-1 … egg-8),
 * players 9–14 reuse the colours with speckles.
 */
export function Egg({
  name = "",
  index = 1,
  size = "md",
  me = false,
  buzz = false,
  host = false,
  empty = false,
  className,
}: {
  name?: string;
  index?: number;
  size?: keyof typeof EGG_SIZES;
  me?: boolean;
  buzz?: boolean;
  host?: boolean;
  empty?: boolean;
  className?: string;
}) {
  const n = ((Math.max(1, index) - 1) % 8) + 1;
  const label = empty ? "مكان فارغ" : `${name}${host ? " (المضيف)" : ""}${me ? " (أنت)" : ""}`;
  return (
    <span
      role="img"
      aria-label={label}
      className={cx(
        "egg relative",
        EGG_SIZES[size],
        empty ? "border-2 border-dashed border-line-strong bg-transparent" : index > 8 && "egg-speckled",
        me && "shadow-[0_0_0_3px_var(--color-night),0_0_0_5px_var(--color-neon)]",
        buzz && "shadow-[0_0_0_3px_var(--color-night),0_0_0_5px_var(--color-violet-text),0_0_28px_#8b5cf64d]",
        className,
      )}
      style={empty ? undefined : { backgroundColor: `var(--color-egg-${n})` }}
    >
      {empty ? "" : initialOf(name)}
      {host ? (
        <span aria-hidden="true" className="absolute -top-1.5 -end-2 grid size-[22px] place-items-center rounded-full border border-line-strong bg-night text-neon">
          <Glyph name="tv" className="size-[13px]" />
        </span>
      ) : null}
    </span>
  );
}

/* ---------------- Game icons ---------------- */

type GameIconDef = { color: string; paths: string };

/** Game marks drawn for Al3sh. Each sits inside an egg in the game's colour. */
const GAME_ICONS: Record<string, GameIconDef> = {
  "tactical-grid": {
    color: "var(--color-neon)",
    paths:
      '<rect x="3" y="3" width="5" height="5" rx="1.2"/><rect x="9.5" y="3" width="5" height="5" rx="1.2"/><rect x="16" y="3" width="5" height="5" rx="1.2"/><rect x="3" y="9.5" width="5" height="5" rx="1.2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2" fill="currentColor"/><rect x="16" y="9.5" width="5" height="5" rx="1.2"/><rect x="3" y="16" width="5" height="5" rx="1.2"/><rect x="9.5" y="16" width="5" height="5" rx="1.2"/><rect x="16" y="16" width="5" height="5" rx="1.2"/>',
  },
  "bluff-master": {
    color: "var(--color-egg-7)",
    paths:
      '<path d="M3 8.2C3 7 4 6 5.2 6h13.6C20 6 21 7 21 8.2v2.3c0 4-2.9 7.5-6.3 7.5-1.4 0-2.2-1.5-2.7-2.6-.5 1.1-1.3 2.6-2.7 2.6C5.9 18 3 14.5 3 10.5Z"/><path d="M6.8 10.6c.6-.6 2.4-.6 3 0"/><path d="M14.2 10.6c.6-.6 2.4-.6 3 0"/>',
  },
  "heads-up": {
    color: "var(--color-team-blue)",
    paths: '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M10.2 9.4a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.3v.5"/><path d="M12 15.8h.01"/>',
  },
  outsider: {
    color: "var(--color-egg-6)",
    paths: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 4l16 16"/>',
  },
  "social-mafia": {
    color: "var(--color-egg-4)",
    paths:
      '<path d="M2.5 16.4c2.6 1.6 6 2.4 9.5 2.4s6.9-.8 9.5-2.4"/><path d="M5.8 16 7.3 8a2 2 0 0 1 2.6-1.5c.8.3 1.4.7 2.1.7s1.3-.4 2.1-.7A2 2 0 0 1 16.7 8l1.5 8"/><path d="M6.5 13h11"/>',
  },
  "word-guess": {
    color: "var(--color-egg-8)",
    paths:
      '<rect x="2" y="9.5" width="4.4" height="5" rx="1"/><rect x="7.2" y="9.5" width="4.4" height="5" rx="1" fill="currentColor"/><rect x="12.4" y="9.5" width="4.4" height="5" rx="1"/><rect x="17.6" y="9.5" width="4.4" height="5" rx="1"/>',
  },
  "secret-code": {
    color: "var(--color-violet-text)",
    paths: '<circle cx="8" cy="15.5" r="4.2"/><path d="M11 12.5 20.5 3"/><path d="M16.8 6.7l2.4 2.4"/><path d="M14.4 9.1l1.8 1.8"/>',
  },
  "one-word": {
    color: "var(--color-ivory)",
    paths:
      '<path d="M4.5 4.5h15a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5H10l-5.5 4v-4h0A1.5 1.5 0 0 1 3 15.5V6a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M8 10.8h8"/>',
  },
};

const GAME_ICON_SIZES = { sm: "w-9", md: "w-12", lg: "w-[72px]" } as const;

export function GameIcon({ id, size = "md", soon = false, className }: { id: string; size?: keyof typeof GAME_ICON_SIZES; soon?: boolean; className?: string }) {
  const def = GAME_ICONS[id] ?? GAME_ICONS["tactical-grid"];
  return (
    <span
      aria-hidden="true"
      className={cx("egg", GAME_ICON_SIZES[size], soon ? "border-2 border-dashed border-line-strong text-mist" : "text-night", className)}
      style={soon ? undefined : { backgroundColor: def.color }}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-auto w-[54%]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: def.paths }}
      />
    </span>
  );
}

/* ---------------- Glyphs (UI icons) ---------------- */

const GLYPHS: Record<string, string> = {
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  back: '<path d="M9 6l6 6-6 6"/>',
  chevron: '<path d="M15 6l-6 6 6 6"/>',
  users:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.6c1.6.6 2.7 2.1 3 4.4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.6 2H4.4Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5 4 8.5S8 16.5 8 20.5M16 3.5c0 4-4 5-4 8.5s4 4.5 4 8.5"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M9 20.5h6M12 17v3.5"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V13M12 16.2h.01"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  whatsapp:
    '<path d="M4.5 19.5l1.2-3.6A8 8 0 1 1 8.3 18.4Z"/><path d="M9.2 8.6c.3 2.9 2.3 5 5.2 5.6l1-1.2-1.8-.9-.9.8c-.9-.4-1.6-1.1-2-2l.8-.9-.9-1.8Z"/>',
  triangle: '<path d="M12 4.5 20.5 19h-17Z" fill="currentColor"/>',
  circle: '<circle cx="12" cy="12" r="7.5" fill="currentColor"/>',
};

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, className, label }: { name: string; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("shrink-0", className ?? "size-5")}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: GLYPHS[name] ?? "" }}
    />
  );
}

/* ---------------- Room code cells ---------------- */

/**
 * Five cells for the room code. One real <input> stretched over the cells,
 * so paste, autofill and delete all work; the cells only draw the value.
 */
export function CodeCells({
  id,
  value,
  onChange,
  invalid = false,
  describedBy,
  label = "رمز الغرفة",
  autoFocus = false,
  compact = false,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  describedBy?: string;
  label?: string;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const cells = Array.from({ length: 5 }, (_, i) => value[i] ?? "");
  return (
    <div className="relative inline-flex gap-2" dir="ltr">
      {cells.map((ch, i) => {
        const caret = focused && i === value.length && value.length < 5;
        return (
          <span
            key={i}
            aria-hidden="true"
            className={cx(
              "room-code grid place-items-center rounded-[14px] border bg-glass tracking-normal transition",
              compact ? "h-[46px] w-10 text-[21px]" : "h-[60px] w-[52px] text-[28px]",
              invalid ? "border-wrong text-ivory" : ch ? "border-neon text-neon" : "border-line-strong text-ivory",
              caret && "code-caret border-neon shadow-[0_0_0_3px_#22d3ee26]",
            )}
          >
            {ch}
          </span>
        );
      })}
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={5}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="one-time-code"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
    </div>
  );
}

/** Players text in words, so the range never flips inside Arabic text. */
export function playersText(min: number, max: number) {
  return `من ${min} إلى ${max} ${max > 10 ? "لاعبًا" : "لاعبين"}`;
}

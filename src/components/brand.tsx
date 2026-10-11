import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { cx } from "@/components/ui";

/*
 * Brand pieces of the Al3sh identity: the chick-in-nest logo, the nest cradle,
 * player eggs, colourful game tiles and a small icon set (24 grid, 2px stroke).
 * Logo and illustration files live in public/brand/.
 */

/* ---------------- Logo ---------------- */

type LogoTone = "color" | "light";

/** Horizontal logo: the chick in its nest on the right, «العش» and al3sh.app on the left. */
export function Lockup({ height = 40, tone = "color", className }: { height?: number; tone?: LogoTone; className?: string }) {
  const src = tone === "light" ? "/brand/al3sh-lockup-light.svg" : "/brand/al3sh-lockup.svg";
  return <img src={src} alt="العش al3sh.app" height={height} style={{ height, width: "auto" }} className={cx("block", className)} />;
}

/** The wordmark alone: «العش» with al3sh.app under it. */
export function Wordmark({ height = 120, tone = "color", className }: { height?: number; tone?: LogoTone; className?: string }) {
  const src = tone === "light" ? "/brand/al3sh-wordmark-light.svg" : "/brand/al3sh-wordmark.svg";
  return <img src={src} alt="العش al3sh.app" height={height} style={{ height, width: "auto" }} className={cx("block", className)} />;
}

/** The mascot alone: a blue chick in a woven nest. */
export function Mark({ height = 32, className, alt = "" }: { height?: number; className?: string; alt?: string }) {
  return (
    <img
      src="/brand/al3sh-mark.svg"
      alt={alt}
      aria-hidden={alt ? undefined : true}
      height={height}
      style={{ height, width: "auto" }}
      className={cx("block", className)}
    />
  );
}

/** Hero illustration: the chick in its nest with game pieces around it. */
export function HeroArt({ className }: { className?: string }) {
  return <img src="/brand/al3sh-hero.svg" alt="عصفور العش في عشه وحوله أدوات اللعب" className={cx("block h-auto w-full", className)} />;
}

/* ---------------- Nest cradle ---------------- */

const BOWL = "M2 2 A98 36 0 0 0 198 2 A98 20 0 0 1 2 2 Z";

/**
 * A woven nest under the single most important thing on a screen.
 * `hold` for solid shapes (an egg, the buzzer) so they sit inside it; without it the nest sits under text.
 */
export function Cradle({
  children,
  hold = false,
  tone = "nest",
  className,
  style,
}: {
  children: ReactNode;
  hold?: boolean;
  tone?: "nest" | "soft";
  className?: string;
  style?: CSSProperties;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <div className={cx("relative inline-grid justify-items-center", hold && "cradle-hold", tone === "soft" && "cradle-soft", className)} style={style}>
      <div className="relative z-[1]">{children}</div>
      <svg className="cradle-moon" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`n${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e2873a" />
            <stop offset="1" stopColor="#7a3712" />
          </linearGradient>
        </defs>
        <path d={BOWL} fill={`url(#n${id})`} />
        <path d="M14 8 Q100 40 186 8 M30 16 Q100 38 170 16" fill="none" stroke="#f3a85a" strokeWidth="2" strokeLinecap="round" opacity=".7" />
      </svg>
    </div>
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
        me && "shadow-[0_0_0_3px_var(--color-night),0_0_0_5px_var(--color-gold)]",
        buzz && "shadow-[0_0_0_3px_var(--color-night),0_0_0_5px_var(--color-violet-text),0_0_28px_#663ade88]",
        className,
      )}
      style={empty ? undefined : { backgroundColor: `var(--color-egg-${n})` }}
    >
      {empty ? "" : initialOf(name)}
      {host ? (
        <span aria-hidden="true" className="absolute -top-1.5 -end-2 grid size-[22px] place-items-center rounded-full border border-line-strong bg-night text-gold">
          <Glyph name="tv" className="size-[13px]" />
        </span>
      ) : null}
    </span>
  );
}

/* ---------------- Game tiles ---------------- */

/** Each game has its own card colours and a drawn icon (public/brand/games). */
export const GAME_STYLE: Record<string, { c1: string; c2: string; ink: "light" | "dark" }> = {
  "tactical-grid": { c1: "#7b3fe4", c2: "#3b1f9a", ink: "light" },
  "bluff-master": { c1: "#c23b78", c2: "#6d1f6a", ink: "light" },
  "heads-up": { c1: "#ffb13b", c2: "#e8741a", ink: "dark" },
  outsider: { c1: "#1f9a74", c2: "#0e5244", ink: "light" },
  "social-mafia": { c1: "#2b63e0", c2: "#163a9a", ink: "light" },
  "word-guess": { c1: "#1e3f9c", c2: "#0e2667", ink: "light" },
  "secret-code": { c1: "#5b3fd0", c2: "#2a1d7a", ink: "light" },
  "one-word": { c1: "#0f7f8a", c2: "#0b4352", ink: "light" },
};

export function gameStyle(id: string) {
  return GAME_STYLE[id] ?? GAME_STYLE["tactical-grid"];
}

export function gameVars(id: string): CSSProperties {
  const s = gameStyle(id);
  return { ["--c1" as string]: s.c1, ["--c2" as string]: s.c2 } as CSSProperties;
}

const GAME_ICON_SIZES = { sm: "size-12 rounded-[14px]", md: "size-14 rounded-[16px]", lg: "size-[72px] rounded-[20px]" } as const;

/** A small coloured tile with the game's icon, for lists and pickers. */
export function GameIcon({ id, size = "md", soon = false, className }: { id: string; size?: keyof typeof GAME_ICON_SIZES; soon?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("gcard grid shrink-0 place-items-center", GAME_ICON_SIZES[size], soon && "opacity-60 saturate-50", className)}
      style={gameVars(id)}
    >
      <img src={`/brand/games/game-${id}.svg`} alt="" className="h-auto w-[72%]" />
    </span>
  );
}

/* ---------------- Glyphs (UI icons) ---------------- */

const GLYPHS: Record<string, string> = {
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  back: '<path d="M9 6l6 6-6 6"/>',
  chevron: '<path d="M15 6l-6 6 6 6"/>',
  forward: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  users:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.6c1.6.6 2.7 2.1 3 4.4"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6"/>',
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
  home: '<path d="M4 11 12 4l8 7v8.5a1 1 0 0 1-1 1h-4.5V15h-5v5.5H5a1 1 0 0 1-1-1Z"/>',
  gamepad:
    '<path d="M7 7h10a5 5 0 0 1 4.8 6.3l-1 3.6a2.6 2.6 0 0 1-4.4 1.1L14 16h-4l-2.4 2a2.6 2.6 0 0 1-4.4-1.1l-1-3.6A5 5 0 0 1 7 7Z"/><path d="M7.5 10.5v3M6 12h3"/><path d="M15.5 11h.01M17.5 13h.01"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.2.9-1.2 1.7v.3"/><path d="M12 16.8h.01"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1"/><circle cx="12" cy="12" r="6.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  more: '<circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/>',
  fire: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.8.3 1.6 1 2.6 2 3 0-3 .3-5.6.8-8.2Z" fill="currentColor"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6Z"/><path d="M9 12l2 2 4-4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>',
  logout: '<path d="M14 4.5h4.5v15H14"/><path d="M10 16l-4-4 4-4M6 12h9"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
};

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

/** A round icon badge, as in the feature bar and the arrows on game cards. */
export function GlyphBadge({ name, className, tone = "violet" }: { name: string; className?: string; tone?: "violet" | "gold" | "glass" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid shrink-0 place-items-center rounded-full",
        tone === "violet" && "bg-[radial-gradient(circle_at_35%_30%,#7f8cff,#3a2ea8)] text-ivory shadow-[0_0_18px_#4b5bff66]",
        tone === "gold" && "btn-gold",
        tone === "glass" && "border border-white/25 bg-black/20 text-ivory",
        className ?? "size-12",
      )}
    >
      <Glyph name={name} className="size-[55%]" />
    </span>
  );
}

/* ---------------- Room code cells ---------------- */

/**
 * Five cells for the room code. One real <input> stretched over the cells,
 * so paste, autofill and delete all work; the cells only draw the value.
 * The value is passed up in capitals; each caller keeps its own cleaning rules.
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
  placeholder = "",
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  describedBy?: string;
  label?: string;
  autoFocus?: boolean;
  compact?: boolean;
  /** Shown faintly in the empty cells, like an input placeholder. */
  placeholder?: string;
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
              "room-code grid place-items-center rounded-[14px] border bg-deep-2/70 tracking-normal transition",
              compact ? "h-[46px] w-10 text-[21px]" : "h-[60px] w-[52px] text-[28px]",
              invalid ? "border-wrong text-ivory" : ch ? "border-gold text-gold" : "border-line-strong text-ivory",
              caret && "code-caret border-gold shadow-[0_0_0_3px_#ffa53a33]",
            )}
          >
            {ch || (value ? "" : <span className="text-faint/50">{placeholder[i] ?? ""}</span>)}
          </span>
        );
      })}
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={5}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={placeholder || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
    </div>
  );
}

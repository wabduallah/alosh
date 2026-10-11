import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Join class names, skipping falsy parts. */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Button tones of the identity:
 *  - primary   neon fill: the one action the screen exists for (once per screen)
 *  - secondary violet fill: a repeated start action next to an item
 *  - quiet     glass: secondary actions, sharing, closing
 *  - outline   a second choice next to a primary
 *  - danger    ends or deducts something
 *  - correct   judging a correct answer only
 * Older names stay as aliases: violet = secondary, glass = quiet, ghost = outline.
 */
export type ButtonTone = "primary" | "secondary" | "quiet" | "outline" | "danger" | "correct" | "violet" | "light" | "glass" | "ghost";

export const buttonBase =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-[22px] text-[15px] font-semibold leading-[22px] whitespace-nowrap transition-[transform,background-color,border-color,filter] duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:scale-100";

export function buttonTone(tone: ButtonTone) {
  switch (tone) {
    case "primary":
      return "bg-neon text-on-neon shadow-glow-neon hover:brightness-110 active:bg-neon-deep";
    case "secondary":
    case "violet":
      return "bg-violet-fill text-ivory hover:brightness-110";
    case "light":
      return "bg-ivory text-night hover:brightness-95";
    case "quiet":
    case "glass":
      return "border border-line bg-glass text-ivory hover:border-line-strong hover:bg-glass-strong";
    case "outline":
    case "ghost":
      return "border border-line-strong bg-transparent text-ivory hover:border-neon hover:text-neon";
    case "danger":
      return "border border-wrong bg-wrong-fill/15 text-ivory hover:bg-wrong-fill/25";
    case "correct":
      return "bg-correct-fill text-night hover:brightness-110";
  }
}

/**
 * Shared button. Defaults to `type="button"` so a button inside a form never
 * submits it by accident; pass `type="submit"` explicitly to submit.
 */
export function Button({
  tone = "primary",
  type = "button",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return <button {...props} type={type} className={cx(buttonBase, buttonTone(tone), className)} />;
}

/** Labelled form field. The label wraps the control, so the control is named by it. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="block text-[15px] font-semibold text-ivory">{label}</span>
      {children}
      {hint ? <span className="block text-[13px] leading-[22px] text-mist">{hint}</span> : null}
    </label>
  );
}

/** Text input styling. 48px tall, 16px text (no iOS zoom), a 3:1 border, neon on focus. */
export const inputClass =
  "min-h-12 w-full rounded-[14px] border border-line-strong bg-glass px-3.5 text-base text-ivory placeholder:text-faint outline-none transition focus:border-neon focus:shadow-[0_0_0_3px_#22d3ee26] aria-[invalid=true]:border-wrong disabled:opacity-60";

/** Absolute join link for a room code. Relative during server render. */
export function joinLink(code: string) {
  if (typeof window === "undefined") return `/join/${code}`;
  return `${window.location.origin}/join/${code}`;
}

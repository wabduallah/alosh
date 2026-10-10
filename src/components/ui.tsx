import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Join class names, skipping falsy parts. */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type ButtonTone = "primary" | "violet" | "light" | "glass" | "ghost" | "danger";

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
  return (
    <button
      {...props}
      type={type}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-bold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "bg-neon text-night shadow-[0_0_22px_rgb(6_182_212/0.35)] hover:brightness-110",
        tone === "violet" && "bg-violet text-ivory shadow-[0_0_22px_rgb(139_92_246/0.35)] hover:brightness-110",
        tone === "light" && "bg-ivory text-night hover:brightness-95",
        tone === "glass" && "border border-white/10 bg-white/[0.03] text-ivory hover:border-neon/60",
        tone === "ghost" && "border border-white/15 bg-transparent text-ivory hover:border-neon/60",
        tone === "danger" && "border border-crimson/50 bg-crimson/10 text-ivory hover:bg-crimson/20",
        className,
      )}
    />
  );
}

/** Labelled form field. The label wraps the control, so the control is named by it. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Text input styling. Focus is shown by a cyan border and glow, not an outline. */
export const inputClass =
  "min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-ivory placeholder:text-muted outline-none transition focus:border-neon/70 focus:shadow-[0_0_0_3px_rgb(6_182_212/0.15)] disabled:opacity-60";

/** Absolute join link for a room code. Relative during server render. */
export function joinLink(code: string) {
  if (typeof window === "undefined") return `/join/${code}`;
  return `${window.location.origin}/join/${code}`;
}

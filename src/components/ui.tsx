import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  tone = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "ghost" | "bronze" | "light" | "glass" }) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "bg-neon text-night shadow-[0_0_22px_color-mix(in_srgb,var(--color-neon)_35%,transparent)] hover:brightness-110",
        tone === "light" && "bg-ivory text-night hover:bg-sand",
        tone === "bronze" && "bg-gold text-night",
        tone === "glass" && "border border-neon/30 bg-white/5 text-ivory hover:border-neon/70",
        tone === "ghost" && "border border-ink/15 bg-ivory text-ink",
        className,
      )}
    />
  );
}

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

export const inputClass =
  "min-h-11 w-full rounded-xl border border-ink/15 bg-ivory px-3 text-ink outline-none";

export function joinLink(code: string) {
  if (typeof window === "undefined") return `/join/${code}`;
  return `${window.location.origin}/join/${code}`;
}

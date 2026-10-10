import { NestMark } from "@/components/shell";

/**
 * Brand lockup: the nest mark on a solid neon badge, with the wordmark beside it.
 * Solid colours only (no background-clip text), so it renders the same on every browser.
 */
export function Logo({ size = "lg" }: { size?: "md" | "lg" }) {
  const large = size === "lg";
  return (
    <div className="inline-flex flex-col items-center gap-3">
      <span
        className={
          large
            ? "grid size-24 place-items-center rounded-[1.75rem] bg-neon text-night shadow-[0_0_40px_rgb(6_182_212/0.45)]"
            : "grid size-11 place-items-center rounded-2xl bg-neon text-night shadow-[0_0_22px_rgb(6_182_212/0.45)]"
        }
      >
        <NestMark className={large ? "size-16" : "size-8"} />
      </span>
      <span className={large ? "text-5xl font-extrabold text-ivory sm:text-6xl" : "text-lg font-extrabold text-ivory"}>
        العش
      </span>
    </div>
  );
}

import type { ReactNode } from "react";
import { Mark } from "@/components/brand";

/** A page-level empty or "coming back" state: the chick in its nest, what happened, and one next step. */
export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <section className="surface relative mx-auto mt-4 grid max-w-xl justify-items-center gap-3 overflow-hidden rounded-[28px] px-6 py-10 text-center lg:mt-8">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-28 mx-auto size-72 rounded-full bg-violet/25 blur-3xl" />
      <Mark height={120} className="bob relative" />
      <h1 className="relative mt-1 text-[28px] leading-10 lg:text-[34px]">{title}</h1>
      <p className="relative text-[16px] leading-[29px] text-mist">{text}</p>
      {action ? <div className="relative mt-2">{action}</div> : null}
    </section>
  );
}

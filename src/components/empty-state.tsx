import type { ReactNode } from "react";
import { Cradle, Egg } from "@/components/brand";

/** A page-level empty or error state: an empty egg in a quiet hilal, what happened, and one next step. */
export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <section className="mx-auto grid max-w-[680px] justify-items-center gap-3 px-4 py-12 text-center lg:py-16">
      <Cradle hold tone="soft" style={{ padding: "0 22px" }}>
        <Egg empty size="xl" />
      </Cradle>
      <h1 className="mt-2 text-[30px] leading-10">{title}</h1>
      <p className="text-[17px] leading-[31px] text-mist">{text}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}

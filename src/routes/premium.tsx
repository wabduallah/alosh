import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Glyph, Mark } from "@/components/brand";
import { buttonBase, buttonTone, cx } from "@/components/ui";

export const Route = createFileRoute("/premium")({
  head: () => ({ meta: [{ title: "مجاني — العش" }] }),
  component: FreePage,
});

function FreePage() {
  return (
    <Shell>
      <section className="forest-bg relative mx-auto grid max-w-3xl justify-items-center gap-3 overflow-hidden rounded-[28px] border border-glow/30 px-6 py-10 text-center shadow-glow-line">
        <Mark height={120} className="bob" />
        <h1 className="text-[30px] leading-10 lg:text-[40px] lg:leading-[54px]">الألعاب مجانية بالكامل</h1>
        <p className="max-w-xl text-[17px] leading-[30px] text-mist">أُلغيت الباقات والاشتراكات. كل الألعاب متاحة بدون دفع.</p>
        <Link to="/play" search={{ game: "" }} className={cx(buttonBase, buttonTone("primary"), "mt-3 min-h-14 px-8 text-[17px]")}>
          <Glyph name="gamepad" />
          إلى الألعاب
        </Link>
      </section>
    </Shell>
  );
}

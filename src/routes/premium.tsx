import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/premium")({
  head: () => ({ meta: [{ title: "مجاني — العش" }] }),
  component: FreePage,
});

function FreePage() {
  return (
    <Shell>
      <h1 className="text-4xl font-extrabold">الألعاب مجانية بالكامل</h1>
      <p className="mt-3 max-w-xl text-ivory/70">أُلغيت الباقات والاشتراكات. كل الألعاب متاحة بدون دفع.</p>
      <Link to="/games" search={{ cat: "" }} className="mt-6 inline-flex min-h-12 items-center rounded-full bg-neon px-5 font-extrabold text-night">إلى الألعاب</Link>
    </Shell>
  );
}

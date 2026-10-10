import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "العش — ألعاب جماعية للعائلة والأصدقاء" },
      { name: "description", content: "ألعاب جماعية تُلعب على شاشة واحدة وجوال لكل لاعب." },
    ],
  }),
  component: Home,
});

/** No game is published right now. This page keeps the "/" route alive until the next one is ready. */
function Home() {
  return (
    <Shell>
      <section className="mx-auto max-w-2xl pt-6 text-center sm:pt-10">
        <h1 className="sr-only">العش</h1>
        <Logo size="lg" />
        <p className="mt-4 text-sm font-bold text-violet">حيث تلتقي التحديات بالمتعة الجماعية</p>
      </section>
      <section className="glass-card mx-auto mt-10 max-w-xl rounded-3xl p-6 text-center">
        <h2 className="text-xl font-extrabold text-ivory">الألعاب قيد البناء</h2>
        <p className="mt-2 text-sm text-muted">نجهّز ألعابًا جديدة. عد قريبًا.</p>
      </section>
    </Shell>
  );
}

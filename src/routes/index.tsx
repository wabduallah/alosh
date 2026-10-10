import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "العش — ألعاب جماعية للعائلة والأصدقاء" },
      { name: "description", content: "اختاروا لعبتكم، اقرأوا القوانين، وافتحوا غرفة." },
    ],
  }),
  component: Home,
});

/** The game list is being rebuilt. This page keeps the "/" route alive until it is ready. */
function Home() {
  return (
    <Shell>
      <section className="mx-auto max-w-2xl pt-6 text-center sm:pt-10">
        <h1 className="sr-only">العش</h1>
        <Logo size="lg" />
        <p className="mt-4 text-sm font-bold text-violet">حيث تلتقي التحديات بالمتعة الجماعية</p>
      </section>
      <section className="glass-card mx-auto mt-10 max-w-xl rounded-3xl p-6 text-center">
        <h2 className="text-xl font-extrabold text-ivory">قائمة الألعاب قيد البناء</h2>
        <p className="mt-2 text-sm text-muted">ستظهر الألعاب هنا قريبًا. إن كان لديك رمز غرفة يمكنك الانضمام الآن.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link to="/join" className="inline-flex min-h-11 items-center rounded-full bg-neon px-5 text-sm font-bold text-night">
            انضم بالرمز
          </Link>
        </div>
      </section>
    </Shell>
  );
}

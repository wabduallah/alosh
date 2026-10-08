import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — العش" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { lang, setLang } = useI18n();
  return (
    <Shell>
      <h1 className="text-4xl font-extrabold">الإعدادات</h1>
      <div className="mt-6 grid gap-3">
        <section className="neon-card rounded-3xl p-5">
          <h2 className="font-extrabold">اللغة</h2>
          <div className="mt-3 flex gap-2">
            <button type="button" className={`min-h-11 rounded-full px-4 font-extrabold ${lang === "ar" ? "bg-neon text-night" : "border border-white/15"}`} onClick={() => setLang("ar")}>العربية</button>
            <button type="button" className={`min-h-11 rounded-full px-4 font-extrabold ${lang === "en" ? "bg-neon text-night" : "border border-white/15"}`} onClick={() => setLang("en")}>English</button>
          </div>
        </section>
        <section className="neon-card rounded-3xl p-5">
          <h2 className="font-extrabold">الإدارة</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/admin" className="min-h-11 rounded-full bg-neon px-4 py-2 font-extrabold text-night">لوحة التحكم</Link>
          </div>
        </section>
      </div>
    </Shell>
  );
}

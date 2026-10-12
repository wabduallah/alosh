import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { Shell } from "@/components/shell";
import { Glyph, Mark } from "@/components/brand";
import { Button, Field, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { Loading, Notice } from "@/components/admin/common";
import { GamesTab } from "@/components/admin/games";
import { QuestionsTab } from "@/components/admin/questions";
import { WordsTab } from "@/components/admin/words";
import { RoomsTab } from "@/components/admin/rooms";
import { StatsTab } from "@/components/admin/stats";
import { ContentTab } from "@/components/admin/content";
import { SiteTab } from "@/components/admin/site";

/**
 * Admin panel. Sign-in is a Supabase email/password account whose
 * app_metadata.role is "admin" (set from the SQL Editor, see supabase/admin_panel.sql).
 * The database policies check the same role, so the page only shows what the
 * account is already allowed to change.
 */
export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "الإدارة — العش" }, { name: "robots", content: "noindex" }] }),
  component: AdminPage,
});

type Tab = "stats" | "games" | "questions" | "words" | "content" | "rooms" | "site";
const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "stats", label: "الإحصاءات", icon: "fire" },
  { key: "rooms", label: "الغرف", icon: "tv" },
  { key: "games", label: "الألعاب", icon: "gamepad" },
  { key: "questions", label: "بنك الأسئلة", icon: "question" },
  { key: "words", label: "الكلمات والمواضيع", icon: "edit" },
  { key: "content", label: "الاستيراد والجودة", icon: "copy" },
  { key: "site", label: "الموقع", icon: "gear" },
];

function isAdmin(session: Session | null) {
  const user = session?.user;
  return !!user && !user.is_anonymous && user.app_metadata?.role === "admin";
}

function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase?.auth.signOut();
    setSession(null);
  }

  return (
    <Shell>
      {!supabase ? (
        <Notice tone="error">الاتصال بقاعدة البيانات غير مضبوط بعد.</Notice>
      ) : checking ? (
        <Loading />
      ) : isAdmin(session) ? (
        <AdminPanel email={session?.user.email ?? ""} onSignOut={signOut} />
      ) : (
        <SignIn session={session} onSignOut={signOut} />
      )}
    </Shell>
  );
}

function SignIn({ session, onSignOut }: { session: Session | null; onSignOut: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedInNotAdmin = !!session?.user && !session.user.is_anonymous;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    if (!email.trim() || !password) return setError("اكتب البريد وكلمة المرور.");
    setBusy(true);
    setError(null);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (signInError) {
      setError(/invalid/i.test(signInError.message) ? "البريد أو كلمة المرور غير صحيحة." : "تعذّر تسجيل الدخول، حاول مرة أخرى.");
      return;
    }
    if (data.session && !isAdmin(data.session)) setError("هذا الحساب ليس حساب مدير.");
  }

  return (
    <section className="surface mx-auto mt-2 max-w-md rounded-[28px] p-6 sm:p-8">
      <div className="grid justify-items-center text-center">
        <Mark height={88} />
        <h1 className="mt-2 text-[30px] leading-10">لوحة الإدارة</h1>
        <p className="mt-1 text-[15px] leading-[26px] text-mist">هذه الصفحة للمدير فقط. سجّل الدخول بحساب المدير.</p>
      </div>

      {signedInNotAdmin ? (
        <div className="mt-6 grid gap-3">
          <Notice tone="error">
            أنت مسجّل بـ <span dir="ltr">{session?.user.email}</span>، وهذا الحساب ليس حساب مدير.
          </Notice>
          <Button tone="quiet" onClick={onSignOut}>
            <Glyph name="logout" className="size-[18px]" />
            تسجيل الخروج
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <Field label="البريد الإلكتروني">
            <input
              dir="ltr"
              type="email"
              autoComplete="username"
              className={cx(inputClass, "text-start")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="كلمة المرور">
            <input
              dir="ltr"
              type="password"
              autoComplete="current-password"
              className={cx(inputClass, "text-start")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" tone="primary" className="min-h-14 text-[17px]" disabled={busy}>
            <Glyph name="lock" className="size-[18px]" />
            {busy ? "جارٍ الدخول…" : "دخول"}
          </Button>
        </form>
      )}
    </section>
  );
}

function AdminPanel({ email, onSignOut }: { email: string; onSignOut: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = sessionStorage.getItem("alosh-admin-tab");
      return TABS.some((t) => t.key === saved) ? (saved as Tab) : "stats";
    } catch {
      return "stats";
    }
  });

  function pick(next: Tab) {
    setTab(next);
    try {
      sessionStorage.setItem("alosh-admin-tab", next);
    } catch {
      // Storage blocked: the tab is kept for this visit only.
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2.5 text-[26px] leading-9 sm:text-[30px] sm:leading-10 lg:text-[38px] lg:leading-[50px]">
            <Glyph name="shield" className="size-8 text-gold" />
            لوحة الإدارة
          </h1>
          <p className="text-[13px] text-mist">
            <bdi>{email}</bdi>
          </p>
        </div>
        <Button tone="quiet" onClick={onSignOut}>
          <Glyph name="logout" className="size-[18px]" />
          تسجيل الخروج
        </Button>
      </div>

      <div role="tablist" aria-label="أقسام الإدارة" className="surface grid grid-cols-2 gap-1 rounded-[24px] p-1.5 sm:grid-cols-3 xl:flex xl:rounded-full">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => pick(t.key)}
            className={cx(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-3 text-[14px] font-semibold whitespace-nowrap transition sm:px-4 sm:text-[15px]",
              tab === t.key ? "btn-gold" : "text-mist hover:text-ivory",
            )}
          >
            <Glyph name={t.icon} className="size-[18px]" />
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "stats" ? <StatsTab /> : null}
        {tab === "games" ? <GamesTab /> : null}
        {tab === "questions" ? <QuestionsTab /> : null}
        {tab === "words" ? <WordsTab /> : null}
        {tab === "rooms" ? <RoomsTab /> : null}
        {tab === "content" ? <ContentTab /> : null}
        {tab === "site" ? <SiteTab /> : null}
      </div>
    </div>
  );
}

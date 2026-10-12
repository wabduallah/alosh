import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Shell } from "@/components/shell";
import { Egg, Glyph } from "@/components/brand";
import { Toggle } from "@/components/admin/common";
import { Button, cx } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import {
  AVATAR_EMOJIS,
  getAvatar,
  reduceMotionOn,
  setAvatar,
  setReduceMotion,
  setSoundOn,
  setVibrationOn,
  soundOn,
  vibrate,
  vibrationOn,
  type Avatar,
} from "@/lib/prefs";
import { playCue, unlockAudio } from "@/lib/sfx";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "الإعدادات — العش" }] }),
  component: SettingsPage,
});

const choice = (on: boolean) =>
  cx(
    "inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-bold transition",
    on ? "btn-gold" : "text-mist hover:text-ivory",
  );

function Section({ title, icon, note, children }: { title: string; icon: string; note?: string; children: ReactNode }) {
  return (
    <section className="surface grid gap-4 rounded-[24px] p-5 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-[20px]">
          <Glyph name={icon} className="size-5 text-gold" />
          {title}
        </h2>
        {note ? <p className="mt-1 text-[13px] leading-6 text-mist">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SettingsPage() {
  const { lang, setLang } = useI18n();
  // Preferences live on this device; read them after the page loads.
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);
  const [vibration, setVibration] = useState(true);
  const [motion, setMotion] = useState(false);
  const [systemMotion, setSystemMotion] = useState(false);
  const [avatar, setAvatarState] = useState<Avatar | null>(null);
  const [saved, setSaved] = useState(false);
  const [canVibrate, setCanVibrate] = useState(true);

  useEffect(() => {
    setSound(soundOn());
    setVibration(vibrationOn());
    setMotion(reduceMotionOn());
    setAvatarState(getAvatar());
    setCanVibrate("vibrate" in navigator);
    try {
      setSystemMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      // Older browsers: no system setting to show.
    }
    setReady(true);
  }, []);

  function pickAvatar(next: Avatar | null) {
    setAvatarState(next);
    setAvatar(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Shell>
      <h1 className="flex items-center gap-3 text-[30px] leading-10 lg:text-[40px] lg:leading-[52px]">
        <Glyph name="gear" className="size-8 text-gold" />
        الإعدادات
      </h1>
      <p className="mt-1 text-[14px] text-mist">تُحفظ على هذا الجهاز فقط.</p>
      <div className="mt-6 grid max-w-[680px] gap-4">
        <Section title="اللغة" icon="info">
          <div className="inline-flex w-fit gap-1 rounded-full border border-line-strong/70 bg-deep-2/60 p-1">
            <button type="button" className={choice(lang === "ar")} onClick={() => setLang("ar")}>
              العربية
            </button>
            <button type="button" className={choice(lang === "en")} onClick={() => setLang("en")}>
              English
            </button>
          </div>
        </Section>

        <Section title="صورتك في الغرف" icon="user" note="لون بيضتك ورمزها، يظهران لكل من في الغرفة وعلى التلفزيون في الغرف التي تدخلها من الآن.">
          <div className="flex items-center gap-4">
            <Egg name="أنت" index={1} avatar={avatar} size="xl" />
            <div className="min-w-0 text-[14px] text-mist">
              {avatar ? (avatar.e ? "لونك ورمزك" : "لونك، مع أول حرف من اسمك") : "تلقائي: لون حسب ترتيب دخولك، وأول حرف من اسمك"}
              {saved ? <span className="block font-semibold text-correct">حُفظت ✓</span> : null}
            </div>
          </div>
          <div className="grid gap-2">
            <span className="text-[14px] font-semibold text-ivory">اللون</span>
            <div role="radiogroup" aria-label="لون البيضة" className="flex flex-wrap gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={!avatar}
                onClick={() => pickAvatar(null)}
                className={cx("min-h-11 rounded-full border px-4 text-[14px] font-semibold", !avatar ? "border-gold text-gold" : "border-line-strong/70 text-mist hover:text-ivory")}
              >
                تلقائي
              </button>
              {Array.from({ length: 8 }, (_, i) => i + 1).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={avatar?.c === c}
                  aria-label={`اللون ${c}`}
                  onClick={() => pickAvatar({ c, e: avatar?.e ?? null })}
                  className={cx("size-11 rounded-full border-2 transition", avatar?.c === c ? "border-ivory shadow-[0_0_0_3px_var(--color-gold)]" : "border-transparent")}
                  style={{ backgroundColor: `var(--color-egg-${c})` }}
                />
              ))}
            </div>
          </div>
          <div className={cx("grid gap-2", !avatar && "opacity-50")}>
            <span className="text-[14px] font-semibold text-ivory">
              الرمز {!avatar ? <span className="font-normal text-mist">(اختر لونًا أولًا)</span> : null}
            </span>
            <div role="radiogroup" aria-label="رمز البيضة" className="flex flex-wrap gap-1.5">
              <button
                type="button"
                role="radio"
                aria-checked={!!avatar && !avatar.e}
                aria-label="أول حرف من اسمي"
                disabled={!avatar}
                onClick={() => avatar && pickAvatar({ c: avatar.c, e: null })}
                className={cx("grid size-11 place-items-center rounded-full border text-[15px] font-bold", avatar && !avatar.e ? "border-gold text-gold" : "border-line-strong/70 text-mist")}
              >
                أ
              </button>
              {AVATAR_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={avatar?.e === e}
                  disabled={!avatar}
                  onClick={() => avatar && pickAvatar({ c: avatar.c, e })}
                  className={cx("grid size-11 place-items-center rounded-full border text-[22px] transition", avatar?.e === e ? "border-gold bg-gold/15" : "border-line-strong/70 hover:border-glow")}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="الصوت والاهتزاز" icon="volume">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Toggle
              checked={ready ? sound : true}
              onChange={(v) => {
                setSound(v);
                setSoundOn(v);
              }}
              label="أصوات اللعب"
            />
            <Button
              tone="quiet"
              className="min-h-10 px-4"
              disabled={!sound}
              onClick={() => {
                unlockAudio();
                playCue("correct");
              }}
            >
              <Glyph name="volume" className="size-[18px]" />
              جرّب الصوت
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Toggle
              checked={ready ? vibration : true}
              onChange={(v) => {
                setVibration(v);
                setVibrationOn(v);
              }}
              label="الاهتزاز عند دورك"
            />
            <Button tone="quiet" className="min-h-10 px-4" disabled={!vibration || !canVibrate} onClick={() => vibrate([200, 80, 200])}>
              جرّب الاهتزاز
            </Button>
          </div>
          {!canVibrate ? <p className="text-[13px] text-mist">هذا الجهاز أو المتصفح لا يدعم الاهتزاز (مثل آيفون).</p> : null}
        </Section>

        <Section title="الحركة" icon="refresh" note="يوقف الحركات والنبض والانتقالات في كل الصفحات.">
          <Toggle
            checked={motion}
            onChange={(v) => {
              setMotion(v);
              setReduceMotion(v);
            }}
            label="تقليل الحركة"
          />
          {systemMotion ? <p className="text-[13px] text-mist">جهازك يطلب تقليل الحركة أصلًا، والموقع يتبعه.</p> : null}
        </Section>
      </div>
    </Shell>
  );
}

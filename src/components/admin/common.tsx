import { useEffect, useState, type ReactNode } from "react";
import { Glyph } from "@/components/brand";
import { Button, cx, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { loadSiteSettings } from "@/lib/site-settings";

/** Multi-line text field, same look as inputClass. */
export const textareaClass = cx(inputClass, "min-h-24 py-3 leading-7");

/** Small select, same look as inputClass. */
export const selectClass = cx(inputClass, "appearance-none pe-9");

type DbError = { code?: string; message?: string } | null | undefined;

/**
 * True when the database still lacks the admin permissions in
 * supabase/admin_panel.sql (missing function or permission denied).
 */
export function needsSetup(error: DbError) {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || error.code === "42501" || /permission denied/i.test(error.message ?? "");
}

/** A short Arabic message for a database error. */
export function dbMessage(error: DbError, fallback = "تعذّر الحفظ، حاول مرة أخرى.") {
  if (!error) return fallback;
  if (error.code === "23505") return "هذا العنصر موجود من قبل.";
  if (error.code === "23514") return "قيمة غير مقبولة. راجع الحقول وحاول مرة أخرى.";
  if (error.code === "23503") return "لا يمكن الحذف لأن عناصر أخرى مرتبطة به.";
  if (needsSetup(error)) return "صلاحيات المدير غير مفعّلة في قاعدة البيانات بعد.";
  return fallback;
}

/** Shown when supabase/admin_panel.sql has not been run yet. */
export function SetupNotice() {
  return (
    <Notice tone="info">
      هذا القسم يحتاج صلاحيات المدير في قاعدة البيانات. شغّل الملف <code dir="ltr" className="rounded bg-night/60 px-1.5 py-0.5 text-[13px]">supabase/admin_panel.sql</code> مرة
      واحدة من SQL Editor في Supabase، ثم حدّث الصفحة.
    </Notice>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "ok"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={cx(
        "flex items-start gap-2 rounded-[16px] border p-3.5 text-[14px] leading-6",
        tone === "error" && "border-wrong/50 bg-wrong-fill/15 text-ivory",
        tone === "ok" && "border-correct/50 bg-correct-fill/15 text-ivory",
        tone === "info" && "border-glow/40 bg-deep-2/60 text-mist",
      )}
    >
      <Glyph
        name={tone === "error" ? "alert" : tone === "ok" ? "check" : "info"}
        className={cx("mt-0.5 size-[18px]", tone === "error" ? "text-wrong" : tone === "ok" ? "text-correct" : "text-gold")}
      />
      <span>{children}</span>
    </p>
  );
}

/** On / off switch with a visible label. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-11 items-center gap-2.5 text-[14px] font-semibold text-ivory"
    >
      <span className={cx("relative h-7 w-12 rounded-full border transition", checked ? "border-gold bg-gold/80" : "border-line-strong bg-deep-2")}>
        <span
          aria-hidden="true"
          className={cx("absolute top-[3px] size-5 rounded-full bg-ivory shadow transition-all", checked ? "start-[23px]" : "start-[3px]")}
        />
      </span>
      {label}
    </button>
  );
}

/** Editing window: a bottom sheet on phones, centred from 640px. Closes on Escape or a tap outside. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-night/75 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="surface sheet-up max-h-[90vh] w-full overflow-y-auto rounded-t-[28px] px-5 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] shadow-lift sm:max-w-xl sm:rounded-[28px] sm:p-6"
      >
        <div aria-hidden="true" className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-line-strong sm:hidden" />
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-[22px] leading-8">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="ms-auto grid size-11 shrink-0 place-items-center rounded-full border border-line-strong/70 bg-deep-2/60 text-ivory hover:border-glow"
          >
            <Glyph name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Splits a text box into a clean list: one item per line (commas also split). */
export function toList(text: string) {
  return text
    .split(/[\n،,]+/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

export function Loading({ label = "جارٍ التحميل…" }: { label?: string }) {
  return (
    <p className="flex items-center gap-3 py-6 text-[15px] text-mist">
      <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-gold border-t-transparent motion-reduce:animate-none" />
      {label}
    </p>
  );
}

/**
 * Bar for acting on selected items. Sticks to the bottom of the screen while
 * something is selected. Moving to a category and deleting are built in; pass
 * other actions as children.
 */
export function BulkBar({
  count,
  visible,
  onSelectAll,
  onClear,
  categories,
  onMove,
  onDelete,
  children,
}: {
  count: number;
  visible: number;
  onSelectAll: () => void;
  onClear: () => void;
  categories?: string[];
  onMove?: (category: string) => Promise<void>;
  onDelete: () => Promise<void>;
  children?: ReactNode;
}) {
  const [category, setCategory] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setConfirm(false), [count]);
  if (count === 0) return null;
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    await fn();
    setBusy(false);
    setConfirm(false);
  }
  return (
    <div role="region" aria-label="إجراءات المحدد" className="sticky bottom-[calc(92px+env(safe-area-inset-bottom))] z-40 grid gap-2 rounded-[20px] border border-gold/50 bg-night/95 p-3 shadow-lift backdrop-blur-md lg:bottom-3">
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <b className="text-ivory">محدد {count}</b>
        {count < visible ? (
          <button type="button" className="min-h-9 rounded-full px-2 text-gold underline-offset-4 hover:underline" onClick={onSelectAll}>
            حدد كل الظاهر ({visible})
          </button>
        ) : null}
        <button type="button" className="min-h-9 rounded-full px-2 text-mist hover:text-ivory" onClick={onClear}>
          ألغِ التحديد
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onMove ? (
          <div className="flex min-w-0 flex-1 basis-56 gap-2">
            <input
              className={cx(inputClass, "min-h-10 py-1")}
              list="bulk-categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="انقل إلى فئة…"
              aria-label="الفئة الجديدة"
            />
            <datalist id="bulk-categories">
              {(categories ?? []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Button tone="quiet" className="min-h-10 shrink-0 px-4" disabled={busy || !category.trim()} onClick={() => run(() => onMove(category.trim()))}>
              انقل
            </Button>
          </div>
        ) : null}
        {children}
        {confirm ? (
          <>
            <Button tone="danger" className="min-h-10 px-4" disabled={busy} onClick={() => run(onDelete)}>
              {busy ? "جارٍ الحذف…" : `احذف ${count} نهائيًا`}
            </Button>
            <Button tone="quiet" className="min-h-10 px-4" onClick={() => setConfirm(false)}>
              إلغاء
            </Button>
          </>
        ) : (
          <Button tone="quiet" className="min-h-10 px-4" onClick={() => setConfirm(true)}>
            <Glyph name="trash" className="size-[18px]" />
            حذف
          </Button>
        )}
      </div>
    </div>
  );
}

/** A square checkbox that matches the panel. */
export function Check({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cx(
        "grid size-7 shrink-0 place-items-center rounded-[8px] border transition",
        checked ? "border-gold bg-gold text-night" : "border-line-strong bg-deep-2/60 text-transparent hover:border-glow",
      )}
    >
      <Glyph name="check" className="size-4" />
    </button>
  );
}

/** Selected ids, with toggle / set-all / clear. */
export function useSelection() {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  return {
    ids,
    has: (id: string) => ids.has(id),
    toggle: (id: string) =>
      setIds((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    setAll: (list: string[]) => setIds(new Set(list)),
    clear: () => setIds(new Set()),
  };
}

/* Shared by the «الموقع» and «المظهر» tabs. */

export function Card({ title, icon, note, children }: { title: string; icon: string; note?: string; children: ReactNode }) {
  return (
    <section className="surface grid min-w-0 grid-cols-1 gap-4 rounded-[22px] p-4 sm:p-5">
      <div>
        <h2 className="flex items-center gap-2 text-[20px] leading-8">
          <Glyph name={icon} className="size-5 text-gold" />
          {title}
        </h2>
        {note ? <p className="text-[13px] leading-6 text-mist">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Chips<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[14px] font-semibold text-ivory">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx("min-h-10 rounded-full border px-4 text-[14px] font-semibold transition", value === o.value ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/60 text-mist hover:text-ivory")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export type SettingKey = "announcement" | "game_defaults" | "test_guests" | "home" | "theme" | "info" | "pages";

export async function saveSetting(key: SettingKey, value: unknown) {
  if (!supabase) return "الاتصال بقاعدة البيانات غير مضبوط بعد.";
  const { error } = await supabase.from("site_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) return dbMessage(error);
  await loadSiteSettings(true);
  return null;
}

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Glyph } from "@/components/brand";
import { buttonBase, buttonTone, cx } from "@/components/ui";

/**
 * The big-screen view, either on a TV / laptop (a new tab to cast or mirror), or right here
 * on the host's own device for groups without a TV: a full-screen overlay that the host
 * turns towards the room, then closes to get back to the controls.
 */
export function DisplayChoice({ code, className }: { code: string; className?: string }) {
  const [here, setHere] = useState(false);
  return (
    <div className={cx("-mt-1 mb-4 grid justify-items-center gap-2", className)}>
      <div className="flex flex-wrap justify-center gap-2">
        <Link to="/tv/$code" params={{ code }} target="_blank" className={cx(buttonBase, buttonTone("outline"))}>
          <Glyph name="tv" />
          افتح شاشة التلفزيون
        </Link>
        <button type="button" onClick={() => setHere(true)} className={cx(buttonBase, buttonTone("quiet"))}>
          <Glyph name="phone" />
          بدون تلفزيون؟ اعرض هنا
        </button>
      </div>
      {here ? <DisplayHere code={code} onClose={() => setHere(false)} /> : null}
    </div>
  );
}

function DisplayHere({ code, onClose }: { code: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="شاشة العرض" className="fixed inset-0 z-[60] flex flex-col bg-night">
      <div className="flex items-center gap-2 px-3 pt-[max(8px,env(safe-area-inset-top))] pb-2">
        <p className="min-w-0 flex-1 text-[13px] text-mist">
          <span className="portrait:inline landscape:hidden">اقلب الجوال بالعرض لعرض أوضح. </span>
          اعرض الشاشة للجميع، ثم ارجع للتحكم.
        </p>
        <button type="button" onClick={onClose} className={cx(buttonBase, buttonTone("primary"), "min-h-10 px-4")}>
          <Glyph name="back" className="size-[18px]" />
          رجوع للتحكم
        </button>
      </div>
      <iframe title="شاشة العرض" src={`/tv/${code}`} className="w-full flex-1 border-0" allow="autoplay; fullscreen" />
    </div>
  );
}

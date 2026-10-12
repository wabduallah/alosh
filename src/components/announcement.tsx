import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Glyph } from "@/components/brand";
import { cx } from "@/components/ui";
import { announcementLive, useSiteSettings, type Announcement } from "@/lib/site-settings";

const TONES: Record<NonNullable<Announcement["tone"]>, string> = {
  gold: "border-gold/50 bg-gold/10",
  violet: "border-violet-text/40 bg-violet-fill/15",
  green: "border-correct/50 bg-correct-fill/15",
};
const KEY = "alosh-announcement-closed";

/** The banner itself. Also used as the preview in the admin panel. */
export function AnnouncementView({ a, onClose }: { a: Announcement; onClose?: () => void }) {
  const link = a.link?.trim();
  const external = !!link && /^https:\/\//i.test(link);
  return (
    <div role="status" className={cx("rise mb-4 flex items-center gap-3 rounded-[18px] border px-4 py-3", TONES[a.tone ?? "gold"])}>
      <Glyph name="bell" className="size-5 shrink-0 text-gold" />
      <p className="min-w-0 flex-1 text-[15px] leading-6 text-ivory">
        {a.text}
        {link ? (
          <>
            {" "}
            <a href={link} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="font-bold whitespace-nowrap text-gold underline-offset-4 hover:underline">
              {a.link_label?.trim() || "التفاصيل"}
            </a>
          </>
        ) : null}
      </p>
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="إخفاء الإعلان" className="grid size-9 shrink-0 place-items-center rounded-full text-mist hover:bg-deep-2/60 hover:text-ivory">
          <Glyph name="x" className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

/** The admin's announcement, on the home page (or every page). A visitor can hide it until it changes. */
export function AnnouncementBar() {
  const settings = useSiteSettings();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [closed, setClosed] = useState<string | null>(null);
  useEffect(() => {
    try {
      setClosed(localStorage.getItem(KEY));
    } catch {
      // Storage blocked: the banner just shows.
    }
  }, []);
  const a = settings?.announcement;
  if (!a || !announcementLive(a)) return null;
  if ((a.where ?? "home") === "home" && path !== "/") return null;
  if (path.startsWith("/admin")) return null;
  const version = String(a.version ?? a.text);
  if (closed === version) return null;
  return (
    <AnnouncementView
      a={a}
      onClose={() => {
        setClosed(version);
        try {
          localStorage.setItem(KEY, version);
        } catch {
          // Storage blocked: hidden for this visit only.
        }
      }}
    />
  );
}

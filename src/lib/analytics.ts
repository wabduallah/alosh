import { supabase } from "@/lib/supabase";

/**
 * Anonymous usage count: one row with an event name and an optional short detail.
 * No user id, no IP, and nothing is sent when the browser asks not to be tracked.
 * Failures are ignored so tracking never affects the page.
 */
export function trackEvent(name: string, detail?: string) {
  if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") return;
  if (!supabase) return;
  supabase
    .from("events")
    .insert({ name, detail: detail ?? null })
    .then(
      () => undefined,
      () => undefined,
    );
}

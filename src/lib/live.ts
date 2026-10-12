import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

/** How often to re-read while realtime is connected (a safety net) and while it is not. */
export const POLL_HEALTHY_MS = 8000;
export const POLL_FALLBACK_MS = 2000;

/**
 * Keeps a screen live: realtime changes on the given tables trigger `load`, and a poll
 * covers missed events. The poll is slow while the realtime channel is connected and fast
 * when it is not (phones in the background, flaky networks), so the database is read
 * far less often during normal play. Also re-reads when the tab comes back.
 */
export function useLivePoll(name: string, tables: Array<{ table: string; filter?: string }>, load: () => unknown) {
  const loadRef = useRef(load);
  loadRef.current = load;
  const key = `${name}|${tables.map((t) => `${t.table}:${t.filter ?? ""}`).join(",")}`;

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let healthy = false;
    let timer = 0;
    const run = () => void loadRef.current();
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.visibilityState === "visible") run();
        schedule();
      }, healthy ? POLL_HEALTHY_MS : POLL_FALLBACK_MS);
    };

    run();
    let channel = client.channel(`live-${name}`);
    for (const t of tables) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: t.table, ...(t.filter ? { filter: t.filter } : {}) }, run);
    }
    channel.subscribe((status) => {
      const was = healthy;
      healthy = status === "SUBSCRIBED";
      // Coming back online: catch up at once.
      if (healthy && !was) run();
      schedule();
    });
    schedule();
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      client.removeChannel(channel);
    };
    // The table list is folded into `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

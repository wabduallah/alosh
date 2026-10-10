import { useCallback, useEffect, useRef, useState } from "react";
import { getSnapshot } from "@/lib/lamma/rpc";
import { watchRoom } from "@/lib/lamma/live";
import type { Snapshot } from "@/lib/lamma/types";

/** Per-device session token for a room, stored in sessionStorage (empty when unavailable). */
function readToken(code: string, role: "host" | "player") {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(`lamma:${role}:${code}`) ?? "";
  } catch {
    return "";
  }
}

/**
 * Single-flight room poller.
 * - One chain only. Realtime pushes call `refresh()`, which cancels the pending timer and runs now;
 *   if a request is already in flight the refresh is queued, never duplicated (no poll-chain pile-up).
 * - Identical snapshots are not re-stored, so idle polls don't re-render the whole screen.
 */
export function useRoom(code: string) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState({ host: "", player: "" });
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    setTokens({ host: readToken(code, "host"), player: readToken(code, "player") });
  }, [code]);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    let inFlight = false;
    let queued = false;
    let lastJson = "";

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      if (!stop) timer = window.setTimeout(run, ms);
    };

    async function run() {
      window.clearTimeout(timer);
      if (stop) return;
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      let delay = 2500;
      try {
        const res = await getSnapshot({
          data: {
            code,
            hostToken: tokens.host || undefined,
            playerToken: tokens.player || undefined,
          },
        });
        if (stop) return;
        if (!res.ok) {
          setError(res.error);
        } else {
          setError(null);
          const json = JSON.stringify(res);
          if (json !== lastJson) {
            lastJson = json;
            setSnap(res);
          }
          const live = res.room.status !== "CLOSED" && res.room.status !== "FINISHED";
          delay = live ? 1200 : 2500;
        }
      } catch {
        if (!stop) setError("SERVER");
        delay = 3000;
      } finally {
        inFlight = false;
      }
      if (stop) return;
      const again = queued;
      queued = false;
      schedule(again ? 0 : document.hidden ? Math.max(delay, 4000) : delay);
    }

    refreshRef.current = () => {
      void run();
    };
    void run();
    const unwatch = watchRoom(code, () => {
      void run();
    });
    return () => {
      stop = true;
      window.clearTimeout(timer);
      unwatch();
    };
  }, [code, tokens.host, tokens.player]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { snap, error, tokens, setTokens, refresh };
}

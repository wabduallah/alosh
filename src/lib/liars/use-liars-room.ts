import { useCallback, useEffect, useRef, useState } from "react";
import { getLiarsSnapshot } from "./rpc";
import { readToken } from "./tokens";
import type { LiarsError, LiarsSnapshot } from "./types";

/**
 * Polls one room. A single request chain: never two polls in flight, and an action can
 * ask for an immediate refresh. The server answers "unchanged" when the revision is the
 * same, so idle polls are tiny. Every 10th poll fetches in full to refresh presence.
 */
export function useLiarsRoom(code: string) {
  const [snap, setSnap] = useState<LiarsSnapshot | null>(null);
  const [error, setError] = useState<LiarsError | "SERVER" | null>(null);
  const [tokens, setTokens] = useState({ host: "", player: "" });
  /** Server clock minus local clock, for the countdown. */
  const [skew, setSkew] = useState(0);
  const refreshRef = useRef<() => void>(() => undefined);

  const reloadTokens = useCallback(() => {
    setTokens({ host: readToken(code, "host"), player: readToken(code, "player") });
  }, [code]);

  useEffect(() => {
    reloadTokens();
  }, [reloadTokens]);

  useEffect(() => {
    if (!code) return;
    let stop = false;
    let timer = 0;
    let inFlight = false;
    let queued = false;
    let revision: number | undefined;
    let polls = 0;

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), ms);
    };

    async function run() {
      if (inFlight) {
        queued = true;
        return;
      }
      inFlight = true;
      let delay = 1500;
      try {
        polls += 1;
        const since = polls % 10 === 0 ? undefined : revision;
        const res = await getLiarsSnapshot({
          data: { code, hostToken: tokens.host || undefined, playerToken: tokens.player || undefined, since },
        });
        if (stop) return;
        if (!res.ok) {
          setError(res.error);
          delay = res.error === "NOT_FOUND" || res.error === "EXPIRED" ? 10_000 : 3000;
        } else {
          setError(null);
          setSkew(res.serverNow - Date.now());
          if (!("unchanged" in res && res.unchanged)) {
            revision = res.revision;
            setSnap(res as LiarsSnapshot);
            delay = (res as LiarsSnapshot).room.state === "question" ? 800 : 1500;
          } else {
            delay = 1200;
          }
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
      schedule(again ? 0 : document.hidden ? Math.max(delay, 5000) : delay);
    }

    refreshRef.current = () => {
      revision = undefined;
      window.clearTimeout(timer);
      void run();
    };
    void run();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [code, tokens.host, tokens.player]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { snap, error, tokens, reloadTokens, refresh, skew };
}

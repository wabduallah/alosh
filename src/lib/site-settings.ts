import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Site settings the admin edits (supabase/admin_v3.sql). Public: anyone can read them.
 * Read once per page load and shared between components.
 */

export type Announcement = {
  active?: boolean;
  text?: string;
  link?: string;
  link_label?: string;
  tone?: "gold" | "violet" | "green";
  where?: "home" | "all";
  starts_at?: string | null;
  ends_at?: string | null;
  version?: number;
};

export type GameDefaults = {
  alhalba?: {
    mode?: "ffa" | "duel" | "teams";
    rounds?: number;
    lives?: number;
    host_plays?: boolean;
    bid_seconds?: number;
    judge?: "auto" | "manual" | "both";
    pace?: number;
    win_rule?: "score" | "last";
    auto_next?: boolean;
    group_every?: number;
    levels?: number[];
  };
  "heads-up"?: { turn_seconds?: number };
  /** Used when the narrator has no settings saved from an earlier match in the room. */
  "social-mafia"?: {
    random_narrator?: boolean;
    mafia_count?: number;
    reveal?: boolean;
    day_seconds?: number;
    vote_seconds?: number;
    night_seconds?: number;
    roles?: Partial<Record<"jester" | "mayor" | "bodyguard" | "sniper" | "seer" | "spy" | "lovers" | "disguised", boolean>>;
    dead_see_roles?: boolean;
  };
  "tactical-grid"?: { seconds?: number };
  court?: { host_plays?: boolean; auto?: boolean; quick?: boolean; judge?: "host" | "random"; question_seconds?: number; closing_seconds?: number; vote_seconds?: number; escalate?: boolean; objections?: number; turn_seconds?: number; read_seconds?: number; golden?: "jurors" | "all" | "off" };
};

type Settings = { announcement?: Announcement; game_defaults?: GameDefaults };

let cache: Promise<Settings> | null = null;

export function loadSiteSettings(fresh = false): Promise<Settings> {
  if (!supabase) return Promise.resolve({});
  if (!cache || fresh) {
    const client = supabase;
    cache = Promise.resolve(client.from("site_settings").select("key, value")).then(({ data, error }) => {
      // Before admin_v3.sql the table does not exist: no settings, nothing breaks.
      if (error || !Array.isArray(data)) return {};
      return Object.fromEntries((data as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value])) as Settings;
    });
  }
  return cache;
}

export function useSiteSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSiteSettings().then((s) => alive && setSettings(s));
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}

/** True when the announcement should show now. */
export function announcementLive(a: Announcement | undefined, now = Date.now()) {
  if (!a?.active || !a.text?.trim()) return false;
  if (a.starts_at && Date.parse(a.starts_at) > now) return false;
  if (a.ends_at && Date.parse(a.ends_at) < now) return false;
  return true;
}

import { useCallback, useEffect, useRef, useState } from "react";
import { adaptivePoll } from "@/lib/live";
import { insertPlayer } from "@/lib/players";
import { rememberRoom } from "@/lib/prefs";
import { ensureSession, supabase } from "@/lib/supabase";

/*
 * «منافسة العش» online (supabase/duel_online_v1.sql): two players, each on their own phone.
 * The server owns the clock, the challenges, the points and the winner; this file only reads
 * them, sends answers, and passes the opponent's progress along for the live bar.
 */

export const DUEL_SLUG = "nest-duel";
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;
export const cleanCode = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, "");
export const validCode = (code: string) => CODE_PATTERN.test(code);

export type DuelRoomRow = { id: string; room_code: string; status: string; host_id: string; game_id: string };
export type DuelPlayerRow = { id: string; player_name: string; is_host: boolean; user_id: string | null; joined_at: string };
export type DuelMatch = {
  id: string;
  room_id: string;
  round_no: number;
  status: "live" | "over";
  target: number;
  starts_at: string;
  ends_at: string;
  winner_id: string | null;
  end_reason: "target" | "time" | null;
  rematch_votes: string[];
};
export type DuelScore = { match_id: string; player_id: string; points: number; idx: number; tries: number; last_at: string | null };

/** What the server sends for one challenge (never its answer). */
export type Challenge =
  | { kind: "memory"; show: string; show_ms: number }
  | { kind: "ink"; word: number; ink: number }
  | { kind: "math"; a: number; b: number; op: string; options: number[] }
  | { kind: "odd"; cells: string[] };

export type AnswerResult = {
  ok: boolean;
  reason?: "NO_MATCH" | "NOT_IN_ROOM" | "OVER" | "NOT_STARTED" | "TIME_UP" | "NOT_PLAYING" | "STALE" | "TOO_FAST";
  correct?: boolean;
  points?: number;
  idx?: number;
  over?: boolean;
  next?: Challenge | null;
  wait_ms?: number;
};

export type Progress = { points: number; idx: number; at: number };

export function friendlyDuelError(err: unknown): string {
  const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
  if (message.includes("SUPABASE_NOT_CONFIGURED")) return "الاتصال بقاعدة البيانات غير مضبوط بعد.";
  if (message.includes("ANON_SIGNIN_FAILED") || message.toLowerCase().includes("anonymous")) return "تعذّر تسجيل الدخول المؤقت. حاول مرة أخرى.";
  if (message.includes("ROOM_FULL")) return "الغرفة فيها لاعبان. المواجهة 1 ضد 1 فقط.";
  if (message.includes("NAME_NOT_ALLOWED")) return "هذا الاسم غير مسموح. اختر اسمًا آخر.";
  if (message.includes("ROOM_FINISHED")) return "انتهت هذه الغرفة.";
  if (message.includes("KICKED")) return "لا تستطيع الرجوع لهذه الغرفة.";
  if (message.includes("room_players_room_name_key") || message.toLowerCase().includes("duplicate")) return "خصمك يستخدم هذا الاسم. اختر اسمًا آخر.";
  if (message.includes("NO_GAME")) return "اللعب الأونلاين يحتاج تشغيل الملف supabase/duel_online_v1.sql أولًا.";
  return "تعذّر الاتصال، حاول مرة أخرى.";
}

/** A new room for the online duel, with the creator in it. Returns the room code. */
export async function createDuelRoom(name: string): Promise<string> {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const session = await ensureSession();
  const { data: game } = await supabase.from("games").select("id").eq("slug", DUEL_SLUG).maybeSingle();
  if (!game) throw new Error("NO_GAME");
  const { data: created, error } = await supabase
    .from("game_rooms")
    .insert({ game_id: (game as { id: string }).id, settings: {} })
    .select("id, room_code")
    .single();
  if (error || !created) throw error ?? new Error("ROOM_CREATE_FAILED");
  const room = created as { id: string; room_code: string };
  const { error: playerError } = await insertPlayer({ room_id: room.id, user_id: session.user.id, player_name: name, is_host: true }, "id");
  if (playerError) {
    await supabase.from("game_rooms").delete().eq("id", room.id);
    throw playerError;
  }
  rememberRoom(room.room_code, true);
  return room.room_code;
}

/** Joins as the second player. The database rejects a third (ROOM_FULL). */
export async function joinDuelRoom(roomId: string, code: string, name: string) {
  const session = await ensureSession();
  const { error } = await insertPlayer({ room_id: roomId, user_id: session.user.id, player_name: name });
  if (error) throw error;
  rememberRoom(code, false);
}

export async function sendAnswer(matchId: string, idx: number, answer: string): Promise<AnswerResult> {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await supabase.rpc("duel_answer", { p_match: matchId, p_idx: idx, p_answer: answer });
  if (error) throw error;
  return data as AnswerResult;
}

export async function currentChallenge(matchId: string): Promise<AnswerResult> {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await supabase.rpc("duel_current", { p_match: matchId });
  if (error) throw error;
  return data as AnswerResult;
}

export async function settleMatch(matchId: string) {
  if (!supabase) return;
  await supabase.rpc("duel_settle", { p_match: matchId });
}

export async function voteRematch(roomId: string): Promise<{ ok: boolean; reason?: string; started?: boolean; waiting?: boolean }> {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await supabase.rpc("duel_rematch", { p_room: roomId });
  if (error) throw error;
  return data as { ok: boolean; reason?: string };
}

/**
 * The server's clock on this device. Three readings; the one with the shortest round trip
 * is the most exact (the server read its clock about half way through it).
 */
export function useServerClock() {
  const offset = useRef(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let alive = true;
    (async () => {
      let best = { rtt: Infinity, off: 0 };
      for (let i = 0; i < 3; i++) {
        const t0 = Date.now();
        const { data, error } = await client.rpc("duel_server_time");
        const t1 = Date.now();
        if (error || !data) continue;
        const rtt = t1 - t0;
        const server = Date.parse(String(data));
        if (Number.isFinite(server) && rtt < best.rtt) best = { rtt, off: server - (t0 + rtt / 2) };
      }
      if (!alive) return;
      if (Number.isFinite(best.rtt)) offset.current = best.off;
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);
  const serverNow = useCallback(() => Date.now() + offset.current, []);
  return { serverNow, ready };
}

type RoomState = {
  loading: boolean;
  error: string | null;
  room: DuelRoomRow | null;
  players: DuelPlayerRow[];
  me: DuelPlayerRow | null;
  matches: DuelMatch[];
  scores: DuelScore[];
};

/**
 * Everything one phone needs about a duel room, kept live:
 *  - table changes (players, matches, scores) through Realtime, with a slower poll as a fallback;
 *  - the opponent's progress through a broadcast (faster than a table change, only for display);
 *  - who is connected (presence).
 */
export function useDuelRoom(code: string) {
  const [state, setState] = useState<RoomState>({ loading: true, error: null, room: null, players: [], me: null, matches: [], scores: [] });
  const [opponentLive, setOpponentLive] = useState<Progress | null>(null);
  const [online, setOnline] = useState<string[]>([]);
  const [subscribed, setSubscribed] = useState(false);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const loading = useRef(false);
  const again = useRef(false);

  const load = useCallback(async () => {
    if (!supabase) {
      setState((s) => ({ ...s, loading: false, error: "الاتصال بقاعدة البيانات غير مضبوط بعد." }));
      return;
    }
    // One read at a time; a change during a read asks for one more read after it.
    if (loading.current) {
      again.current = true;
      return;
    }
    loading.current = true;
    const client = supabase;
    try {
      const session = await ensureSession();
      const { data: found, error } = await client.from("game_rooms").select("id, room_code, status, host_id, game_id").eq("room_code", code).maybeSingle();
      if (error) throw error;
      if (!found) {
        setState((s) => ({ ...s, loading: false, error: "لم نجد غرفة بهذا الرمز." }));
        return;
      }
      const room = found as DuelRoomRow;
      const { data: players } = await client.from("room_players").select("id, player_name, is_host, user_id, joined_at").eq("room_id", room.id).order("joined_at");
      const list = (players ?? []) as DuelPlayerRow[];
      const me = list.find((p) => p.user_id === session.user.id) ?? null;
      let matches: DuelMatch[] = [];
      let scores: DuelScore[] = [];
      if (me) {
        const { data: ms } = await client.from("duel_matches").select("*").eq("room_id", room.id).order("round_no", { ascending: false });
        matches = (ms ?? []) as DuelMatch[];
        if (matches[0]) {
          const { data: sc } = await client.from("duel_scores").select("match_id, player_id, points, idx, tries, last_at").eq("match_id", matches[0].id);
          scores = (sc ?? []) as DuelScore[];
        }
      }
      setState({ loading: false, error: null, room, players: list, me, matches, scores });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: s.room ? s.error : friendlyDuelError(err) }));
    } finally {
      loading.current = false;
      if (again.current) {
        again.current = false;
        void load();
      }
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const roomId = state.room?.id ?? null;
  const meId = state.me?.id ?? null;
  const matchId = state.matches[0]?.id ?? null;

  // A new match: the old broadcast belongs to the old one.
  useEffect(() => {
    setOpponentLive(null);
  }, [matchId]);

  useEffect(() => {
    if (!supabase || !roomId) return;
    const client = supabase;
    const poll = adaptivePoll(load, 2000);
    const ch = client
      .channel(`duel-${roomId}`, { config: { broadcast: { self: false }, presence: { key: meId ?? `viewer-${Math.random().toString(36).slice(2)}` } } })
      .on("broadcast", { event: "progress" }, ({ payload }) => setOpponentLive(payload as Progress))
      .on("presence", { event: "sync" }, () => setOnline(Object.keys(ch.presenceState())))
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${roomId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "duel_matches", filter: `room_id=eq.${roomId}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "duel_scores" }, () => void load());
    ch.subscribe(async (status) => {
      poll.onStatus(status);
      setSubscribed(status === "SUBSCRIBED");
      if (status === "SUBSCRIBED" && meId) await ch.track({ since: Date.now() });
    });
    channelRef.current = ch;
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      poll.stop();
      document.removeEventListener("visibilitychange", onVisible);
      channelRef.current = null;
      void client.removeChannel(ch);
    };
  }, [roomId, meId, load]);

  /** After each answer: my points for the opponent's bar. Display only; the server keeps the real score. */
  const sendProgress = useCallback((p: Omit<Progress, "at">) => {
    void channelRef.current?.send({ type: "broadcast", event: "progress", payload: { ...p, at: Date.now() } });
  }, []);

  return { ...state, reload: load, opponentLive, online, subscribed, sendProgress };
}

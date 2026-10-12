import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Egg, GameIcon, Glyph } from "@/components/brand";
import { Button, buttonBase, buttonTone, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { loadGames, type AdminGame } from "./games";
import { Loading, Notice, Sheet, Toggle, dbMessage } from "./common";

type Room = { id: string; room_code: string; status: string; game_id: string; created_at: string; current_round: number };
type Player = { id: string; room_id: string; player_name: string; is_host: boolean; score: number; joined_at: string };
type State = { room_id: string; updated_at: string | null; state_data: { phase?: string; round?: number; max_rounds?: number } | null };

/** Game phases in words (what the TV shows), across games. */
const PHASES: Record<string, string> = {
  bid: "مزايدة",
  prove: "يذكر الإجابات",
  steal_offer: "عرض سرقة",
  steal: "سرقة",
  result: "نتيجة الجولة",
  over: "انتهت المباراة",
  turn: "دور لاعب",
  night: "الليل",
  day: "النهار",
  vote: "تصويت",
  reveal: "كشف",
  question: "سؤال",
  board: "اللوحة",
  fakes: "كتابة الإجابات المزيفة",
  guess: "تخمين",
  discuss: "نقاش",
  turn_over: "انتهى الدور",
  between: "بين الأدوار",
  done: "انتهت",
};

const ago = new Intl.RelativeTimeFormat("ar-u-nu-latn", { numeric: "auto" });
function since(iso: string | null | undefined, now: number) {
  if (!iso) return null;
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (s > -60) return ago.format(Math.min(0, s), "second");
  if (s > -3600) return ago.format(Math.round(s / 60), "minute");
  if (s > -86400) return ago.format(Math.round(s / 3600), "hour");
  return ago.format(Math.round(s / 86400), "day");
}
type Filter = "all" | "lobby" | "playing" | "finished";

const STATUS: Record<string, { label: string; className: string }> = {
  lobby: { label: "بانتظار البدء", className: "bg-blue/25 text-blue-text" },
  playing: { label: "جارية", className: "bg-gold/20 text-gold" },
  finished: { label: "منتهية", className: "bg-deep-2 text-mist" },
};

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "الكل" },
  { key: "playing", label: "جارية" },
  { key: "lobby", label: "بانتظار البدء" },
  { key: "finished", label: "منتهية" },
];

const when = new Intl.DateTimeFormat("ar-u-nu-latn", { dateStyle: "medium", timeStyle: "short" });

/** Latest rooms with their players. The admin can open the TV screen or close a room. */
export function RoomsTab() {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<AdminGame[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [states, setStates] = useState<State[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [openId, setOpenId] = useState<string | null>(null);
  const busy = useRef(false);

  async function refresh(quiet = false) {
    if (!supabase || busy.current) return;
    busy.current = true;
    if (!quiet) setLoading(true);
    const [{ data: roomRows, error: roomError }, { data: gameRows }] = await Promise.all([
      supabase.from("game_rooms").select("id, room_code, status, game_id, created_at, current_round").order("created_at", { ascending: false }).limit(60),
      loadGames(),
    ]);
    if (roomError) {
      setError(dbMessage(roomError, "تعذّر تحميل الغرف."));
      setRooms([]);
      setLoading(false);
      busy.current = false;
      return;
    }
    const list = (roomRows ?? []) as Room[];
    const ids = list.map((r) => r.id);
    const [{ data: playerRows }, { data: stateRows }] = ids.length
      ? await Promise.all([
          supabase.from("room_players").select("id, room_id, player_name, is_host, score, joined_at").in("room_id", ids).order("joined_at"),
          supabase.from("room_game_state").select("room_id, updated_at, state_data").in("room_id", ids),
        ])
      : [{ data: [] }, { data: [] }];
    setGames(gameRows);
    setPlayers((playerRows ?? []) as Player[]);
    setStates((stateRows ?? []) as State[]);
    setRooms(list);
    setError(null);
    setLoading(false);
    setNow(Date.now());
    busy.current = false;
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Live: refresh every 5 seconds while the page is visible.
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 5000);
    return () => window.clearInterval(t);
    // refresh is stable enough for a timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rooms?.length ?? 0, lobby: 0, playing: 0, finished: 0 };
    for (const r of rooms ?? []) if (r.status in c) c[r.status as Filter] += 1;
    return c;
  }, [rooms]);

  const visible = (rooms ?? []).filter((r) => filter === "all" || r.status === filter);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="تصفية الغرف" className="no-scrollbar flex min-w-0 flex-1 basis-full gap-2 overflow-x-auto pb-1 sm:basis-0">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cx(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold transition",
                filter === f.key ? "btn-gold border-transparent" : "border-line-strong/70 bg-deep-2/50 text-mist hover:text-ivory",
              )}
            >
              {f.label}
              <span className="rounded-full bg-black/20 px-2 text-[13px] tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <Toggle checked={live} onChange={setLive} label="تحديث مباشر" />
        <Button tone="quiet" onClick={() => refresh()} disabled={loading}>
          <Glyph name="refresh" className={cx("size-[18px]", loading && "animate-spin motion-reduce:animate-none")} />
          تحديث
        </Button>
      </div>
      <p className="text-[13px] text-mist">آخر 60 غرفة، الأحدث أولًا.{live ? " تتحدث كل 5 ثوانٍ." : ""}</p>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {rooms === null ? (
        <Loading />
      ) : visible.length === 0 ? (
        <Notice tone="info">لا توجد غرف هنا.</Notice>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visible.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              game={games.find((g) => g.id === room.game_id) ?? null}
              players={players.filter((p) => p.room_id === room.id)}
              state={states.find((st) => st.room_id === room.id) ?? null}
              now={now}
              onOpen={() => setOpenId(room.id)}
              onChanged={() => refresh(true)}
            />
          ))}
        </div>
      )}

      {openId && rooms?.some((r) => r.id === openId) ? (
        <RoomSheet
          room={rooms.find((r) => r.id === openId)!}
          game={games.find((g) => g.id === rooms.find((r) => r.id === openId)!.game_id) ?? null}
          players={players.filter((p) => p.room_id === openId)}
          state={states.find((st) => st.room_id === openId) ?? null}
          now={now}
          onClose={() => setOpenId(null)}
          onChanged={() => refresh(true)}
        />
      ) : null}
    </div>
  );
}

function phaseLine(state: State | null) {
  const sd = state?.state_data ?? {};
  const parts: string[] = [];
  if (sd.round) parts.push(`الجولة ${sd.round}${sd.max_rounds ? ` من ${sd.max_rounds}` : ""}`);
  if (sd.phase && PHASES[sd.phase]) parts.push(PHASES[sd.phase]);
  return parts.join(" · ");
}

/** Room details: players (remove one), state, and closing the room. */
function RoomSheet({
  room,
  game,
  players,
  state,
  now,
  onClose,
  onChanged,
}: {
  room: Room;
  game: AdminGame | null;
  players: Player[];
  state: State | null;
  now: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [kicking, setKicking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = STATUS[room.status] ?? { label: room.status, className: "bg-deep-2 text-mist" };
  const ranked = [...players].sort((a, b) => Number(b.is_host) - Number(a.is_host) || b.score - a.score);

  async function kick(p: Player) {
    if (!supabase) return;
    setBusy(true);
    const { error: deleteError } = await supabase.from("room_players").delete().eq("id", p.id);
    setBusy(false);
    setKicking(null);
    if (deleteError) return setError(dbMessage(deleteError, "تعذّر إخراج اللاعب."));
    setError(null);
    await onChanged();
  }

  const facts: Array<[string, string]> = [
    ["اللعبة", game?.title_ar ?? "غير معروفة"],
    ["الحالة", status.label],
    ["أُنشئت", `${when.format(new Date(room.created_at))} (${since(room.created_at, now) ?? ""})`],
    ["آخر نشاط", since(state?.updated_at, now) ?? "—"],
  ];
  const line = phaseLine(state);
  if (line) facts.push(["الآن", line]);

  return (
    <Sheet title={`الغرفة ${room.room_code}`} onClose={onClose}>
      <div className="grid gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
          {facts.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-mist">{k}</dt>
              <dd className="text-ivory">{v}</dd>
            </div>
          ))}
        </dl>

        <div>
          <h3 className="mb-2 text-[16px]">الأشخاص ({players.length})</h3>
          {ranked.length === 0 ? (
            <p className="text-[14px] text-mist">لا أحد في الغرفة.</p>
          ) : (
            <ul className="grid gap-1.5">
              {ranked.map((p, i) => (
                <li key={p.id} className="flex min-h-12 items-center gap-2 rounded-[14px] border border-line bg-deep-2/50 px-3 py-1.5">
                  <Egg name={p.player_name} index={i + 1} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-ivory">
                    {p.player_name}
                    {p.is_host ? <span className="ms-1.5 text-[12px] text-mist">(المضيف)</span> : null}
                    <span className="block text-[12px] text-mist">دخل {since(p.joined_at, now)}</span>
                  </span>
                  <span className="tabular-nums font-bold text-gold">{p.score}</span>
                  {!p.is_host && room.status !== "finished" ? (
                    kicking === p.id ? (
                      <>
                        <Button tone="danger" className="min-h-9 px-3 text-[13px]" onClick={() => kick(p)} disabled={busy}>
                          أخرجه
                        </Button>
                        <Button tone="quiet" className="min-h-9 px-3 text-[13px]" onClick={() => setKicking(null)}>
                          لا
                        </Button>
                      </>
                    ) : (
                      <Button tone="quiet" className="min-h-9 px-3" onClick={() => setKicking(p.id)} aria-label={`إخراج ${p.player_name}`}>
                        <Glyph name="logout" className="size-4" />
                      </Button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] text-mist">إخراج لاعب يحذفه من الغرفة ونقاطه معه، ويقدر يرجع برمز الغرفة إذا كانت مفتوحة.</p>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <div className="flex flex-wrap gap-2">
          <Link to="/tv/$code" params={{ code: room.room_code }} target="_blank" className={cx(buttonBase, buttonTone("quiet"), "min-h-11 px-4")}>
            <Glyph name="tv" className="size-[18px]" />
            شاشة التلفزيون
          </Link>
        </div>
      </div>
    </Sheet>
  );
}

function RoomCard({
  room,
  game,
  players,
  state,
  now,
  onOpen,
  onChanged,
}: {
  room: Room;
  game: AdminGame | null;
  players: Player[];
  state: State | null;
  now: number;
  onOpen: () => void;
  onChanged: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = STATUS[room.status] ?? { label: room.status, className: "bg-deep-2 text-mist" };
  const guests = players.filter((p) => !p.is_host);
  const host = players.find((p) => p.is_host);

  async function close() {
    if (!supabase) return;
    setBusy(true);
    const { error: updateError } = await supabase.from("game_rooms").update({ status: "finished" }).eq("id", room.id);
    setBusy(false);
    if (updateError) return setError(dbMessage(updateError, "تعذّر إنهاء الغرفة."));
    setConfirming(false);
    await onChanged();
  }

  return (
    <article className="surface grid min-w-0 gap-3 rounded-[22px] p-4">
      <div className="flex items-center gap-3">
        {game ? <GameIcon id={game.slug} size="sm" /> : null}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <span className="room-code text-[20px] text-gold">{room.room_code}</span>
            <span className={cx("rounded-full px-2.5 py-0.5 text-[13px] font-semibold", status.className)}>{status.label}</span>
          </p>
          <p className="truncate text-[13px] text-mist">
            {game?.title_ar ?? "لعبة غير معروفة"} · {when.format(new Date(room.created_at))}
          </p>
          {room.status !== "finished" && (phaseLine(state) || state?.updated_at) ? (
            <p className="text-[13px] leading-5 text-ivory">
              {phaseLine(state)}
              {state?.updated_at ? <span className="text-mist">{phaseLine(state) ? " · " : ""}آخر نشاط {since(state.updated_at, now)}</span> : null}
            </p>
          ) : null}
        </div>
      </div>

      <div className="text-[14px] text-mist">
        {host ? (
          <p className="mb-2">
            المضيف: <span className="font-semibold text-ivory">{host.player_name}</span>
          </p>
        ) : null}
        {guests.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {guests.map((p, i) => (
              <li key={p.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-deep-2/60 py-0.5 ps-1 pe-3 text-[13px] text-ivory">
                <Egg name={p.player_name} index={i + 1} size="sm" className="w-6! text-[11px]!" />
                {p.player_name}
                <span className="tabular-nums text-gold">{p.score}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>لا يوجد لاعبون بعد.</p>
        )}
      </div>

      {error ? <p className="text-[13px] text-wrong">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button tone="quiet" className="min-h-10 px-4" onClick={onOpen}>
          <Glyph name="users" className="size-[18px]" />
          التفاصيل
        </Button>
        <Link to="/tv/$code" params={{ code: room.room_code }} target="_blank" className={cx(buttonBase, buttonTone("quiet"), "min-h-10 px-4")}>
          <Glyph name="tv" className="size-[18px]" />
          شاشة التلفزيون
        </Link>
        {room.status !== "finished" ? (
          confirming ? (
            <>
              <Button tone="danger" className="min-h-10 px-4" onClick={close} disabled={busy}>
                {busy ? "جارٍ الإنهاء…" : "تأكيد الإنهاء"}
              </Button>
              <Button tone="quiet" className="min-h-10 px-4" onClick={() => setConfirming(false)} disabled={busy}>
                إلغاء
              </Button>
            </>
          ) : (
            <Button tone="quiet" className="min-h-10 px-4" onClick={() => setConfirming(true)}>
              <Glyph name="x" className="size-[18px]" />
              إنهاء الغرفة
            </Button>
          )
        ) : null}
      </div>
    </article>
  );
}

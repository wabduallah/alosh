import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Egg, GameIcon, Glyph } from "@/components/brand";
import { Button, buttonBase, buttonTone, cx } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { loadGames, type AdminGame } from "./games";
import { Loading, Notice, dbMessage } from "./common";

type Room = { id: string; room_code: string; status: string; game_id: string; created_at: string; current_round: number };
type Player = { id: string; room_id: string; player_name: string; is_host: boolean; score: number };
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    if (!supabase) return;
    setLoading(true);
    const [{ data: roomRows, error: roomError }, { data: gameRows }] = await Promise.all([
      supabase.from("game_rooms").select("id, room_code, status, game_id, created_at, current_round").order("created_at", { ascending: false }).limit(60),
      loadGames(),
    ]);
    if (roomError) {
      setError(dbMessage(roomError, "تعذّر تحميل الغرف."));
      setRooms([]);
      setLoading(false);
      return;
    }
    const list = (roomRows ?? []) as Room[];
    const ids = list.map((r) => r.id);
    const { data: playerRows } = ids.length
      ? await supabase.from("room_players").select("id, room_id, player_name, is_host, score").in("room_id", ids).order("joined_at")
      : { data: [] };
    setGames(gameRows);
    setPlayers((playerRows ?? []) as Player[]);
    setRooms(list);
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

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
        <Button tone="quiet" onClick={refresh} disabled={loading}>
          <Glyph name="refresh" className={cx("size-[18px]", loading && "animate-spin motion-reduce:animate-none")} />
          تحديث
        </Button>
      </div>
      <p className="text-[13px] text-mist">آخر 60 غرفة، الأحدث أولًا.</p>

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
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoomCard({ room, game, players, onChanged }: { room: Room; game: AdminGame | null; players: Player[]; onChanged: () => Promise<void> }) {
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
    <article className="surface grid gap-3 rounded-[22px] p-4">
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

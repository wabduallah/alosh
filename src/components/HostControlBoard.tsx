import useSWR from "swr";
import React, { useEffect, useState } from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function HostControlBoard({ roomId, gameKind, gameId, initialPlayers, initialStatus, onRefresh } : { roomId: string; gameKind: string; gameId: string; initialPlayers: any[]; initialStatus?: string; onRefresh?: () => void }) {
  const [players, setPlayers] = useState<any[]>(initialPlayers || []);
  const [gameStatus, setGameStatus] = useState(initialStatus || "lobby");
  const [loadingKickId, setLoadingKickId] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<"start" | "end" | "restart" | null>(null);

  useEffect(() => {
    setPlayers(initialPlayers || []);
  }, [initialPlayers]);

  useEffect(() => {
    setGameStatus(initialStatus || "lobby");
  }, [initialStatus]);

  const refresh = async () => {
    if (onRefresh) onRefresh();
  };

  const kickPlayer = async (player: any) => {
    const confirmed = window.confirm(`هل تريد طرد ${player.name} من هذه اللعبة؟`);
    if (!confirmed) return;

    setLoadingKickId(player.id);

    try {
      const endpoint = gameKind === "mafia" ? `/api/mafia/${gameId}/kick-player` : gameKind === "court" ? `/api/court/${gameId}/kick-player` : `/api/games/${gameId}/kick-player`;
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetPlayerId: player.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'فشل في الطرد');
      await refresh();
    } catch (err: any) {
      alert(err.message || 'حدث خطأ');
    } finally {
      setLoadingKickId(null);
    }
  };

  const triggerAction = async (action: 'start' | 'restart' | 'end') => {
    setLoadingAction(action);
    try {
      const endpoint = gameKind === 'mafia' ? `/api/mafia/${gameId}/${action}` : gameKind === 'court' ? `/api/court/${gameId}/${action}` : `/api/games/${gameId}/${action}`;
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'فشل');
      await refresh();
    } catch (err: any) {
      alert(err.message || 'حدث خطأ');
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Host Panel</p>
          <h2 className="text-2xl font-bold text-slate-900">{gameKind === 'mafia' ? 'لعبة المافيا' : gameKind === 'court' ? 'لعبة المحكمة' : 'لعبة عامة'}</h2>
        </div>

        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">{gameStatus}</span>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <button onClick={() => triggerAction('start')} disabled={loadingAction !== null} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white">{loadingAction === 'start' ? 'جارٍ...' : 'بدء اللعبة'}</button>
        <button onClick={() => triggerAction('restart')} disabled={loadingAction !== null} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-800">{loadingAction === 'restart' ? 'جارٍ...' : 'إعادة الجولة'}</button>
        <button onClick={() => triggerAction('end')} disabled={loadingAction !== null} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{loadingAction === 'end' ? 'جارٍ...' : 'إنهاء اللعبة'}</button>
      </div>

      <div className="space-y-3">
        {players.map((player) => (
          <div key={player.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">{(player.name||'U').slice(0,1).toUpperCase()}</div>
              <div>
                <div className="font-medium text-slate-900">{player.name}</div>
                <div className="text-xs text-slate-500">{player.isHost ? 'المضيف' : player.role ? `الدور: ${player.role}` : player.status || 'مشارك'}</div>
              </div>
            </div>

            {!player.isHost && (
              <button type="button" onClick={() => kickPlayer(player)} disabled={loadingKickId === player.id} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60">{loadingKickId === player.id ? 'جارٍ...' : 'طرد'}</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

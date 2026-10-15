import useSWR from "swr";
import React from "react";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function MafiaNarrator({ gameId }: { gameId: string }) {
  const { data, error } = useSWR(`/api/mafia/${gameId}/narrator`, fetcher, { refreshInterval: 3000 });

  if (error) return <div>Error loading narrator view</div>;
  if (!data) return <div>Loading...</div>;

  const view = data.view;

  return (
    <section>
      <h2>Narrator / Night summary</h2>

      <div>
        <h3>Mafia votes</h3>
        {view.mafiaVotes ? (
          <ul>
            {Object.entries(view.mafiaVotes).map(([target, voters]) => (
              <li key={target}>
                Target: {target} — Votes: {Array.isArray(voters) ? voters.join(", ") : String(voters)}
              </li>
            ))}
          </ul>
        ) : (
          <div>No mafia votes</div>
        )}
      </div>

      <div>
        <h3>Doctor</h3>
        {view.doctorSave ? <div>Doctor {view.doctorSave.by} saved {view.doctorSave.target}</div> : <div>No doctor action</div>}
      </div>

      <div>
        <h3>Detective</h3>
        {view.detectiveCheck ? <div>Detective {view.detectiveCheck.by} checked {view.detectiveCheck.target} — result: {view.detectiveCheck.result?.role ?? "unknown"}</div> : <div>No detective action</div>}
      </div>

      <div>
        <h3>Resolved</h3>
        {view.resolved ? (
          <pre>{JSON.stringify(view.resolved, null, 2)}</pre>
        ) : (
          <div>Night not finalized yet</div>
        )}
      </div>
    </section>
  );
}

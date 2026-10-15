import { Pool } from "pg";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function insertAuditLog(entry: {
  gameKind?: string | null;
  gameId?: string | null;
  roomId?: string | null;
  actorId?: string | null;
  targetId?: string | null;
  action: string;
  reason?: string | null;
  meta?: any;
}) {
  const { gameKind, gameId, roomId, actorId, targetId, action, reason, meta } = entry;
  await pool.query(
    `INSERT INTO public.audit_logs (game_kind, game_id, room_id, actor_id, target_id, action, reason, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [gameKind, gameId, roomId, actorId, targetId, action, reason || null, meta || null]
  );
}

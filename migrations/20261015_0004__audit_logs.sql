-- =============================================================================
-- Audit logs migration
-- =============================================================================

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  game_kind text,
  game_id uuid,
  room_id uuid,
  actor_id uuid,
  target_id uuid,
  action text not null,
  reason text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_game_idx on public.audit_logs (game_kind, game_id);
create index if not exists audit_logs_room_idx on public.audit_logs (room_id);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);

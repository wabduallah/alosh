// In-memory socket token store (short-lived). For production use Redis or another shared store.
const tokenMap = new Map<string, { playerId: string; expiresAt: number }>();

export function storeSocketToken(token: string, playerId: string, ttlSeconds = 30) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  tokenMap.set(token, { playerId, expiresAt });
}

export function consumeSocketToken(token: string) {
  const rec = tokenMap.get(token);
  if (!rec) return null;
  if (rec.expiresAt < Date.now()) {
    tokenMap.delete(token);
    return null;
  }
  // consume (single-use)
  tokenMap.delete(token);
  return rec.playerId;
}

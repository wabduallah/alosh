const KEY = "al3sh-last-game";

/** Remembers the last game the visitor picked. Stored only in this browser. */
export function rememberGame(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private mode or blocked storage: the feature simply stays off.
  }
}

export function readLastGame(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

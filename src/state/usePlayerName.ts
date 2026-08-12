import { useCallback, useState } from 'react';

const KEY = 'draftcall:username';
const DEFAULT_NAME = 'Summoner';

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? DEFAULT_NAME;
  } catch {
    return DEFAULT_NAME;
  }
}

/** Persisted display name used for leaderboard entries. */
export function usePlayerName(): [string, (name: string) => void] {
  const [name, setName] = useState<string>(read);

  const update = useCallback((next: string) => {
    const trimmed = next.trim().slice(0, 24) || DEFAULT_NAME;
    setName(trimmed);
    try {
      localStorage.setItem(KEY, trimmed);
    } catch {
      // Non-fatal: the name just won't survive a reload.
    }
  }, []);

  return [name, update];
}

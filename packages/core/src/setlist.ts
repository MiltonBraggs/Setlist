import type { Song } from './songs.ts';

export interface SetlistEntry {
  songId: string;
  removed?: boolean;
  /** Per-setlist override of the song description. */
  description?: string;
  /** Printed/announced above the song (`-- description --`). */
  stopDescription?: string;
}

export interface Setlist {
  id: string;
  name: string;
  entries: SetlistEntry[];
  /**
   * New songs in Live are added (active) automatically. True for the default "All songs" setlist;
   * setlists built by picking songs get new songs as removed, ready in "Add songs".
   */
  autoAdd?: boolean;
  /** Creation time (ms), for a stable order in the setlist switcher. */
  created?: number;
}

/** "All songs" first, then in the order they were created. */
export function compareSetlists(a: Setlist, b: Setlist): number {
  return Number(!!b.autoAdd) - Number(!!a.autoAdd) || (a.created ?? 0) - (b.created ?? 0) || a.name.localeCompare(b.name);
}

export interface SetlistSummary {
  id: string;
  name: string;
  songCount: number;
  /** seconds */
  duration: number;
}

export const ALL_SONGS_NAME = 'All songs';

/** Keep a stored setlist in sync with the songs currently in Live. */
export function reconcileSetlist(setlist: Setlist, songs: Song[]): Setlist {
  const ids = new Set(songs.map((s) => s.id));
  const present = new Set<string>();
  const entries: SetlistEntry[] = [];
  for (const e of setlist.entries) {
    // Drop songs that no longer exist and any duplicate entries.
    if (!ids.has(e.songId) || present.has(e.songId)) continue;
    present.add(e.songId);
    entries.push(e);
  }
  for (const song of songs) {
    if (!present.has(song.id)) entries.push(setlist.autoAdd ? { songId: song.id } : { songId: song.id, removed: true });
  }
  return { ...setlist, entries };
}

/** A setlist made by picking songs: the picks in order, every other song available but removed. */
export function createSetlist(id: string, name: string, songIds: string[], songs: Song[], created = Date.now()): Setlist {
  const known = new Set(songs.map((s) => s.id));
  const picked = [...new Set(songIds)].filter((sid) => known.has(sid));
  const pickedSet = new Set(picked);
  return {
    id,
    name,
    autoAdd: false,
    created,
    entries: [...picked.map((songId) => ({ songId })), ...songs.filter((s) => !pickedSet.has(s.id)).map((s) => ({ songId: s.id, removed: true }))],
  };
}

export function summarizeSetlist(setlist: Setlist, songs: Song[]): SetlistSummary {
  const byId = new Map(songs.map((s) => [s.id, s]));
  let songCount = 0;
  let duration = 0;
  for (const e of setlist.entries) {
    const song = byId.get(e.songId);
    if (e.removed || !song) continue;
    if (!song.noSong) songCount++;
    duration += song.duration;
  }
  return { id: setlist.id, name: setlist.name, songCount, duration };
}

/** Song ids that will be played, in order. */
export function activeOrder(setlist: Setlist): string[] {
  return setlist.entries.filter((e) => !e.removed).map((e) => e.songId);
}

// ---------------------------------------------------------------------------
// Fuzzy matching for text import / paste

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toLowerCase())
    .join('');
}

export function matchSong(query: string, songs: Song[]): Song | undefined {
  const q = normalizeTitle(query);
  if (!q) return undefined;
  const exact = songs.find((s) => normalizeTitle(s.title) === q);
  if (exact) return exact;
  const prefix = songs.find((s) => normalizeTitle(s.title).startsWith(q) || q.startsWith(normalizeTitle(s.title)));
  if (prefix) return prefix;
  let best: { song: Song; score: number } | undefined;
  for (const song of songs) {
    const t = normalizeTitle(song.title);
    const score = 1 - levenshtein(q, t) / Math.max(q.length, t.length);
    if (!best || score > best.score) best = { song, score };
  }
  return best && best.score >= 0.7 ? best.song : undefined;
}

/** Search used by the "add song" dialog: title, description, tags, initials. */
export function searchSongs(query: string, songs: Song[]): Song[] {
  const q = query.trim().toLowerCase();
  if (!q) return songs;
  return songs.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      (s.description ?? '').toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q.replace(/^#/, ''))) ||
      initials(s.title).startsWith(q),
  );
}

// ---------------------------------------------------------------------------
// Text format: one title per line, `{description}`, stop descriptions as `-- text --`

export function setlistToText(setlist: Setlist, songs: Song[]): string {
  const byId = new Map(songs.map((s) => [s.id, s]));
  const lines: string[] = [];
  for (const entry of setlist.entries) {
    if (entry.removed) continue;
    const song = byId.get(entry.songId);
    if (!song) continue;
    if (entry.stopDescription) lines.push(`-- ${entry.stopDescription} --`);
    const desc = entry.description ?? song.description;
    lines.push(desc ? `${song.title} {${desc}}` : song.title);
  }
  return lines.join('\n');
}

export interface TextImportResult {
  entries: SetlistEntry[];
  unmatched: string[];
}

export function setlistFromText(text: string, songs: Song[]): TextImportResult {
  const entries: SetlistEntry[] = [];
  const unmatched: string[] = [];
  let pendingStop: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^\d+[.)]\s*/, '');
    if (!line) continue;
    const stop = /^--\s*(.*?)\s*--$/.exec(line);
    if (stop) {
      pendingStop = stop[1];
      continue;
    }
    const descMatch = /\{([^}]*)\}/.exec(line);
    const title = line.replace(/\{[^}]*\}/g, '').trim();
    const song = matchSong(title, songs);
    if (!song) {
      unmatched.push(line);
      continue;
    }
    if (entries.some((e) => e.songId === song.id)) continue; // each song once
    const entry: SetlistEntry = { songId: song.id };
    if (descMatch && descMatch[1].trim() !== (song.description ?? '')) entry.description = descMatch[1].trim();
    if (pendingStop) entry.stopDescription = pendingStop;
    pendingStop = undefined;
    entries.push(entry);
  }
  // Songs not mentioned are kept but removed, so they stay available in the editor.
  const listed = new Set(entries.map((e) => e.songId));
  for (const song of songs) if (!listed.has(song.id)) entries.push({ songId: song.id, removed: true });
  return { entries, unmatched };
}

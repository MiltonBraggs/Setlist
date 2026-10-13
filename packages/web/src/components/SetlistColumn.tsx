import { useEffect, useMemo, useRef } from 'react';
import { formatDuration, type Song } from '@setlist/core';
import { act, useStore } from '../store.ts';
import { colorOf } from './ui.tsx';

/**
 * Compact setlist for the Performance page: current song highlighted, next song tagged,
 * tap a song to queue it. Scrolls inside itself and keeps the current song in view.
 */
export function SetlistColumn({ currentId, nextId, queuedId, canJump }: { currentId?: string; nextId?: string; queuedId?: string; canJump: boolean }) {
  const songs = useStore((s) => s.state!.songs);
  const setlist = useStore((s) => s.state!.setlist);
  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const entries = setlist.entries.filter((e) => !e.removed && byId.has(e.songId));
  const currentRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Scroll only the list, never the page: scrollIntoView would drag a phone's whole Performance
  // page down to the setlist at every song change.
  useEffect(() => {
    const list = listRef.current;
    const row = currentRef.current;
    if (!list || !row) return;
    const l = list.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < l.top) list.scrollBy({ top: r.top - l.top, behavior: 'smooth' });
    else if (r.bottom > l.bottom) list.scrollBy({ top: r.bottom - l.bottom, behavior: 'smooth' });
  }, [currentId]);

  let number = 0;
  return (
    <nav aria-label="Setlist" className="flex min-h-0 flex-col overflow-hidden rounded-[28px] bg-panel">
      <p className="m-0 shrink-0 truncate px-5 pt-4 pb-2 text-sm font-semibold text-muted">{setlist.name}</p>
      <ol ref={listRef} className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0 pb-2">
        {entries.map((e) => {
          const song = byId.get(e.songId) as Song;
          if (!song.noSong) number++;
          const current = song.id === currentId;
          const queued = song.id === queuedId;
          const next = !current && !queued && song.id === nextId;
          return (
            <li key={song.id}>
              <button
                type="button"
                ref={current ? currentRef : undefined}
                disabled={!canJump}
                aria-current={current ? 'true' : undefined}
                onClick={() => act('jumpToSong', song.id)}
                className={`flex min-h-12 w-full items-center gap-2.5 px-4 text-left transition ${
                  current ? 'bg-accent text-onaccent' : queued ? 'bg-accent/15' : canJump ? 'hover:bg-panel2' : ''
                }`}
              >
                <span className={`w-5 shrink-0 text-right text-xs tabular ${current ? 'opacity-80' : 'text-muted'}`}>{song.noSong ? '' : number}</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(song.color, 'var(--line-2)') }} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-medium">{song.title}</span>
                  {(e.description ?? song.description) && (
                    <span className={`truncate text-xs ${current ? 'opacity-80' : 'text-muted'}`}>{e.description ?? song.description}</span>
                  )}
                </span>
                {queued && <span className="shrink-0 text-xs font-semibold text-link">Queued</span>}
                {next && <span className="shrink-0 text-xs font-semibold text-link">Next</span>}
                {!queued && !next && <span className={`shrink-0 text-xs tabular ${current ? 'opacity-80' : 'text-muted'}`}>{formatDuration(song.duration)}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

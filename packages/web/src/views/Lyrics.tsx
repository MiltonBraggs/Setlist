import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  activeLineIndex,
  activeOrder,
  linesForSong,
  locate,
  lyricsTracks,
  parseInline,
  transposeChord,
  type LyricLine,
  type LyricPart,
  type LyricsTrack,
  type Section,
  type Song,
} from '@setlist/core';
import { act, usePlayhead, usePref, useStore } from '../store.ts';
import { Button, Select, colorOf } from '../components/ui.tsx';

const SIZE: Record<string, string> = { large: '1.35em', small: '0.8em', tiny: '0.65em' };

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((t, i) =>
        t.bold ? <strong key={i}>{t.text}</strong> : t.italic ? <em key={i}>{t.text}</em> : <Fragment key={i}>{t.text}</Fragment>,
      )}
    </>
  );
}

function Row({ parts, track, transpose }: { parts: LyricPart[]; track: LyricsTrack; transpose: { semitones: number; flats: boolean } | null }) {
  const chords = track.options.chords;
  const hasChords = parts.some((p) => p.chord) && chords !== 'hide';
  if (chords === 'only') {
    const list = parts.filter((p) => p.chord).map((p) => transposeChord(p.chord!, transpose?.semitones ?? 0, transpose?.flats));
    return list.length ? <div style={{ color: colorOf(track.options.chordColor, 'var(--accent)') }}>{list.join('  ')}</div> : null;
  }
  return (
    <div className="flex flex-wrap items-end">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex flex-col whitespace-pre">
          {hasChords && (
            <span className="text-[0.6em] font-semibold" style={{ color: colorOf(track.options.chordColor, 'var(--accent)') }}>
              {p.chord ? transposeChord(p.chord, transpose?.semitones ?? 0, transpose?.flats) : ' '}
            </span>
          )}
          <span>
            <Inline text={p.text} />
          </span>
        </span>
      ))}
    </div>
  );
}

type Item = { kind: 'header'; section: Section; song: Song } | { kind: 'songTitle'; song: Song } | { kind: 'line'; line: LyricLine; index: number; song: Song };

export function Lyrics() {
  const state = useStore((s) => s.state)!;
  const time = usePlayhead();
  const tracks = useMemo(() => lyricsTracks(state.live.tracks), [state.live.tracks]);
  const [trackId, setTrackId] = usePref<string | null>('lyricsTrack', null);
  const [scale, setScale] = usePref('lyricsScale', 1);
  const [pinned, setPinned] = useState<number | null>(null);
  const track = tracks.find((t) => t.id === trackId) ?? tracks[0];
  const loc = locate(state.songs, time);
  const song = state.songs[loc.songIndex];

  const songsToShow = useMemo(() => {
    if (!track) return [];
    if (track.options.allSongs) {
      const byId = new Map(state.songs.map((s) => [s.id, s]));
      return activeOrder(state.setlist).map((id) => byId.get(id)!).filter(Boolean);
    }
    return song ? [song] : [];
  }, [track, song, state.songs, state.setlist]);

  const items: Item[] = [];
  const lines: LyricLine[] = [];
  if (track) {
    for (const s of songsToShow) {
      if (track.options.allSongs) items.push({ kind: 'songTitle', song: s });
      const songLines = linesForSong(track, s);
      const headers = track.options.noSections ? [] : [...s.sections];
      for (const line of songLines) {
        while (headers.length && headers[0].start <= line.start + 1e-6 && !(line.position === 'before' && Math.abs(headers[0].start - line.start) < 1e-6)) {
          items.push({ kind: 'header', section: headers.shift()!, song: s });
        }
        items.push({ kind: 'line', line, index: lines.length, song: s });
        lines.push(line);
      }
    }
  }
  const latencyBeats = track ? (track.options.latency / 1000) * (state.live.tempo / 60) : 0;
  const playingIdx = activeLineIndex(lines, time + latencyBeats);
  const active = pinned ?? playingIdx;

  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: track?.options.top !== null && track?.options.top !== undefined ? 'start' : 'center' });
  }, [active, track?.options.top]);
  useEffect(() => setPinned(null), [song?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const clamp = (i: number) => Math.max(0, Math.min(lines.length - 1, i));
      if (e.key === '.') setPinned(clamp((pinned ?? playingIdx) + 1));
      else if (e.key === ',') setPinned(clamp((pinned ?? playingIdx) - 1));
      else if (e.key.toLowerCase() === 'b' && !e.shiftKey) setPinned(null);
      else if (e.key === 'M' && e.shiftKey) setPinned(pinned === null ? Math.max(0, playingIdx) : null);
      else if (e.key === 'm' || e.key === 'n') {
        const target = clamp(playingIdx + (e.key === 'm' ? 1 : -1));
        if (lines[target]) act('jumpToTime', lines[target].start);
        setPinned(target);
      } else return;
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!track) {
    return (
      <div className="p-8 text-center text-muted">
        No lyrics track found. Add a MIDI track with <code>+LYRICS</code> in its name, one clip per line.
      </div>
    );
  }

  const o = track.options;
  const transposeFor = (s: Song) => {
    const semis = (s.transpose?.semitones ?? 0) + (o.transpose?.semitones ?? 0);
    return semis || s.transpose?.flats || o.transpose?.flats ? { semitones: semis, flats: !!(s.transpose?.flats || o.transpose?.flats) } : null;
  };
  const topPad = o.top !== null ? `${o.top * 2.2}em` : '40vh';

  return (
    <div className="flex h-full flex-col">
      <div className="no-print flex items-center gap-2 border-b border-line p-2">
        {tracks.length > 1 && <Select value={track.id} options={tracks.map((t) => ({ value: t.id, label: t.title }))} onChange={setTrackId} />}
        <span className="mr-auto truncate text-sm text-muted">{song?.title}</span>
        {pinned !== null && <Button onClick={() => setPinned(null)}>Back to current (B)</Button>}
        <Button onClick={() => setScale(Math.max(0.5, scale - 0.1))} title="Smaller">A−</Button>
        <Button onClick={() => setScale(Math.min(3, scale + 0.1))} title="Larger">A+</Button>
      </div>
      <div className="flex-1 overflow-auto px-6" style={{ fontSize: `${2 * scale}rem` }}>
        <div style={{ height: topPad }} />
        {items.map((item) => {
          if (item.kind === 'songTitle') {
            return <div key={`t-${item.song.id}`} className="mt-10 border-b border-line pb-2 text-[0.7em] font-bold" style={{ color: colorOf(item.song.color, 'var(--fg)') }}>{item.song.title}</div>;
          }
          if (item.kind === 'header') {
            return <div key={`h-${item.section.id}`} className="mt-6 mb-1 text-[0.5em] font-semibold uppercase tracking-wider" style={{ color: colorOf(item.section.color, 'var(--muted)') }}>{item.section.title}</div>;
          }
          const { line, index } = item;
          const isActive = index === active;
          const color = colorOf(line.color ?? o.color, 'var(--fg)');
          const progress = isActive && o.progress ? Math.max(0, Math.min(1, (time + latencyBeats - line.start) / (line.end - line.start || 1))) : 0;
          return (
            <div
              key={line.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => !state.locked && act('jumpToTime', line.start)}
              className={`relative origin-left cursor-pointer py-1.5 leading-snug transition-all duration-200 ${o.lineMarker && isActive ? 'border-l-4 border-accent pl-3' : ''}`}
              style={{
                color,
                opacity: isActive || o.noFade ? 1 : 0.35,
                transform: isActive || o.noZoom ? 'none' : 'scale(0.92)',
                fontSize: SIZE[line.size ?? o.size ?? ''] ?? '1em',
                textAlign: line.align ?? o.align ?? 'left',
                fontFamily: line.mono || o.mono ? 'ui-monospace, monospace' : undefined,
              }}
            >
              {line.image ? (
                <img src={`/lyrics-images/${line.image.src}`} alt="" className={line.image.full ? 'max-h-[80vh] w-full object-contain' : 'max-h-[50vh]'} />
              ) : (
                line.rows.map((parts, i) => <Row key={i} parts={parts} track={track} transpose={transposeFor(item.song)} />)
              )}
              {o.progress && isActive && <div className="absolute bottom-0 left-0 h-0.5 bg-accent" style={{ width: `${progress * 100}%` }} />}
            </div>
          );
        })}
        <div style={{ height: '60vh' }} />
      </div>
    </div>
  );
}

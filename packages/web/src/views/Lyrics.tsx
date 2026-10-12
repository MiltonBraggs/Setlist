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

function Row({
  parts,
  track,
  transpose,
  align,
}: {
  parts: LyricPart[];
  track: LyricsTrack;
  transpose: { semitones: number; flats: boolean } | null;
  align: 'left' | 'center';
}) {
  const chords = track.options.chords;
  const hasChords = parts.some((p) => p.chord) && chords !== 'hide';
  if (chords === 'only') {
    const list = parts.filter((p) => p.chord).map((p) => transposeChord(p.chord!, transpose?.semitones ?? 0, transpose?.flats));
    return list.length ? <div style={{ color: colorOf(track.options.chordColor, 'var(--accent)') }}>{list.join('   ')}</div> : null;
  }
  return (
    <div className={`flex flex-wrap items-end ${align === 'center' ? 'justify-center' : 'justify-start'}`}>
      {parts.map((p, i) => (
        <span key={i} className="inline-flex flex-col whitespace-pre">
          {hasChords && (
            <span className="text-[0.45em] font-semibold tracking-normal" style={{ color: colorOf(track.options.chordColor, 'var(--accent)') }}>
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

  const activeRef = useRef<HTMLButtonElement>(null);
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
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="flex max-w-md flex-col gap-3">
          <h1 className="headline m-0 text-5xl">No lyrics yet.</h1>
          <p className="m-0 text-[17px] text-muted">
            Add a MIDI track with <code>+LYRICS</code> in its name to your Live set, with one clip per line.
          </p>
        </div>
      </div>
    );
  }

  const o = track.options;
  const transposeFor = (s: Song) => {
    const semis = (s.transpose?.semitones ?? 0) + (o.transpose?.semitones ?? 0);
    return semis || s.transpose?.flats || o.transpose?.flats ? { semitones: semis, flats: !!(s.transpose?.flats || o.transpose?.flats) } : null;
  };
  const topPad = o.top !== null ? `${o.top * 2.2}em` : '35vh';
  const defaultAlign = o.align ?? 'center';

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="no-print mx-auto flex w-full max-w-[980px] flex-wrap items-center gap-3 px-6 pt-5">
        {tracks.length > 1 && <Select label="Lyrics track" value={track.id} options={tracks.map((t) => ({ value: t.id, label: t.title }))} onChange={setTrackId} />}
        <p className="m-0 flex-1 truncate text-[15px] text-muted">
          {song?.title ?? 'Not in a song'} · {track.title}
        </p>
        {pinned !== null && (
          <Button variant="ghost" onClick={() => setPinned(null)}>
            Back to current
          </Button>
        )}
        <Button variant="outline" className="!px-0 w-11" onClick={() => setScale(Math.max(0.5, scale - 0.1))} title="Smaller text">
          A−
        </Button>
        <Button variant="outline" className="!px-0 w-11 text-lg" onClick={() => setScale(Math.min(3, scale + 0.1))} title="Larger text">
          A+
        </Button>
      </div>
      <div className="flex-1 overflow-auto px-6" style={{ fontSize: `${2.5 * scale}rem` }}>
        <div className="mx-auto max-w-[980px]">
          <div style={{ height: topPad }} />
          {items.map((item) => {
            if (item.kind === 'songTitle') {
              return (
                <h2 key={`t-${item.song.id}`} className="headline mt-16 mb-4 text-[0.8em]" style={{ textAlign: defaultAlign, color: item.song.color ? colorOf(item.song.color) : undefined }}>
                  {item.song.title}
                </h2>
              );
            }
            if (item.kind === 'header') {
              return (
                <p
                  key={`h-${item.section.id}`}
                  className="mt-10 mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted"
                  style={{ textAlign: defaultAlign, color: item.section.color ? colorOf(item.section.color) : undefined }}
                >
                  {item.section.title}
                </p>
              );
            }
            const { line, index } = item;
            const isActive = index === active;
            const ownColor = line.color ?? o.color;
            const color = isActive || o.noFade ? (ownColor ? colorOf(ownColor) : 'var(--fg)') : ownColor ? colorOf(ownColor) : 'var(--faint)';
            const align = line.align ?? defaultAlign;
            const progress = isActive && o.progress ? Math.max(0, Math.min(1, (time + latencyBeats - line.start) / (line.end - line.start || 1))) : 0;
            return (
              <button
                type="button"
                key={line.id}
                ref={isActive ? activeRef : undefined}
                disabled={state.locked}
                onClick={() => act('jumpToTime', line.start)}
                aria-current={isActive ? 'true' : undefined}
                className={`relative block w-full py-2 leading-[1.15] tracking-[-0.02em] transition-all duration-300 ${isActive ? 'font-bold' : 'font-semibold'} ${
                  o.lineMarker && isActive ? 'border-l-4 border-accent pl-4' : ''
                }`}
                style={{
                  color,
                  opacity: !isActive && ownColor && !o.noFade ? 0.45 : 1,
                  transform: isActive || o.noZoom ? 'none' : 'scale(0.86)',
                  transformOrigin: align === 'center' ? 'center' : 'left',
                  fontSize: SIZE[line.size ?? o.size ?? ''] ?? '1em',
                  textAlign: align,
                  fontFamily: line.mono || o.mono ? 'ui-monospace, monospace' : undefined,
                }}
              >
                {line.image ? (
                  <img src={`/lyrics-images/${line.image.src}`} alt="" className={`mx-auto rounded-2xl ${line.image.full ? 'max-h-[80vh] w-full object-contain' : 'max-h-[50vh]'}`} />
                ) : (
                  line.rows.map((parts, i) => <Row key={i} parts={parts} track={track} transpose={transposeFor(item.song)} align={align} />)
                )}
                {o.progress && isActive && (
                  <span className="mx-auto mt-3 block h-1 w-32 overflow-hidden rounded-full bg-line">
                    <span className="block h-full bg-accent" style={{ width: `${progress * 100}%` }} />
                  </span>
                )}
              </button>
            );
          })}
          <div style={{ height: '60vh' }} />
        </div>
      </div>
    </div>
  );
}

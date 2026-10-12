import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  activeLineIndex,
  activeOrder,
  linesForSong,
  locate,
  lyricsTracks,
  parseInline,
  transposeChord,
  type InlineToken,
  type LyricLine,
  type LyricPart,
  type LyricsTrack,
  type Section,
  type Song,
} from '@setlist/core';
import { act, useAccess, usePlayhead, usePref, useStore } from '../store.ts';
import { InlinePieces } from '../components/InlineText.tsx';
import { NotesBanner } from '../components/Notes.tsx';
import { Button, Segmented, colorOf } from '../components/ui.tsx';

type ChordMode = 'show' | 'hide' | 'only';

const CHORD_MODES: { value: ChordMode; label: string }[] = [
  { value: 'hide', label: 'Lyrics' },
  { value: 'show', label: 'Lyrics + Chords' },
  { value: 'only', label: 'Chords' },
];

const SIZE: Record<string, string> = { large: '1.35em', small: '0.8em', tiny: '0.65em' };

interface Block {
  chord?: string;
  pieces: InlineToken[];
  /** A space follows this block in the text. */
  spaceAfter: boolean;
}

/**
 * Split a row into word blocks, each optionally carrying the chord that starts on it.
 * Blocks wrap independently, so long lines never run off a phone screen.
 */
function toBlocks(parts: LyricPart[]): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const part of parts) {
    let chord = part.chord;
    for (const tok of parseInline(part.text)) {
      for (const piece of tok.text.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) {
          if (cur) cur.spaceAfter = true;
          cur = null;
          continue;
        }
        if (!cur || chord !== undefined) {
          cur = { chord, pieces: [], spaceAfter: false };
          blocks.push(cur);
          chord = undefined;
        }
        cur.pieces.push({ ...tok, text: piece });
      }
    }
    if (chord !== undefined) {
      // A chord with no word under it ("[G] [Am]").
      blocks.push({ chord, pieces: [], spaceAfter: true });
      cur = null;
    }
  }
  return blocks;
}

/** Blocks with no space between them ("Ne[G]on") form one word that must not wrap apart. */
function toWords(blocks: Block[]): Block[][] {
  const words: Block[][] = [];
  let word: Block[] = [];
  for (const b of blocks) {
    word.push(b);
    if (b.spaceAfter) {
      words.push(word);
      word = [];
    }
  }
  if (word.length) words.push(word);
  return words;
}

function Row({
  parts,
  chordColor,
  semitones,
  flats,
  align,
  chords,
}: {
  parts: LyricPart[];
  chordColor?: string;
  semitones: number;
  flats: boolean;
  align: 'left' | 'center';
  chords: ChordMode;
}) {
  const color = colorOf(chordColor, 'var(--accent)');
  if (chords === 'only') {
    const list = parts.filter((p) => p.chord).map((p) => transposeChord(p.chord!, semitones, flats));
    return list.length ? <div style={{ color }}>{list.join('   ')}</div> : null;
  }
  const showChords = chords !== 'hide' && parts.some((p) => p.chord);
  const words = toWords(toBlocks(parts));
  return (
    <div className={`flex flex-wrap items-end ${align === 'center' ? 'justify-center' : 'justify-start'}`}>
      {words.map((word, w) => (
        <span key={w} className="inline-flex max-w-full items-end" style={word[word.length - 1].spaceAfter ? { marginRight: '0.28em' } : undefined}>
          {word.map((b, i) => (
            <span key={i} className="inline-flex min-w-0 flex-col [overflow-wrap:anywhere]">
              {showChords && (
                <span className="text-[0.45em] font-semibold tracking-normal" style={{ color }}>
                  {b.chord ? transposeChord(b.chord, semitones, flats) : '\u00a0'}
                </span>
              )}
              <span>{b.pieces.length ? <InlinePieces pieces={b.pieces} /> : '\u00a0'}</span>
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

/** One lyric line. Memoised: only the active line re-renders while playing. */
const LineView = memo(function LineView({
  line,
  isActive,
  progress,
  options: o,
  chords,
  semitones,
  flats,
  defaultAlign,
  canJump,
  activeRef,
}: {
  line: LyricLine;
  isActive: boolean;
  progress: number;
  options: LyricsTrack['options'];
  chords: ChordMode;
  semitones: number;
  flats: boolean;
  defaultAlign: 'left' | 'center';
  canJump: boolean;
  activeRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const ownColor = line.color ?? o.color;
  const color = isActive || o.noFade ? (ownColor ? colorOf(ownColor) : 'var(--fg)') : ownColor ? colorOf(ownColor) : 'var(--faint)';
  const align = line.align ?? defaultAlign;
  return (
    <button
      type="button"
      ref={isActive ? activeRef : undefined}
      disabled={!canJump}
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
        <img
          src={`/lyrics-images/${line.image.src}`}
          alt=""
          className={`mx-auto max-w-full rounded-2xl ${line.image.full ? 'max-h-[80vh] w-full object-contain' : 'max-h-[50vh]'}`}
        />
      ) : (
        line.rows.map((parts, i) => <Row key={i} parts={parts} chordColor={o.chordColor} semitones={semitones} flats={flats} align={align} chords={chords} />)
      )}
      {o.progress && isActive && (
        <span className="mx-auto mt-3 block h-1 w-32 overflow-hidden rounded-full bg-line">
          <span className="block h-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </span>
      )}
    </button>
  );
});

type Item = { kind: 'header'; section: Section; song: Song } | { kind: 'songTitle'; song: Song } | { kind: 'line'; line: LyricLine; index: number; song: Song };

export function Lyrics() {
  const state = useStore((s) => s.state)!;
  const time = usePlayhead();
  const access = useAccess();
  const allTracks = useMemo(() => lyricsTracks(state.tracks), [state.tracks]);
  const tracks = allTracks.filter((t) => access.canSeeLyrics(t.title));
  const canJump = access.can('navigate') && !state.locked;
  // Remembered by title so it survives track reordering in Live.
  const [trackTitle, setTrackTitle] = usePref<string | null>('lyricsTrackTitle', null);
  const [modes, setModes] = usePref<Record<string, ChordMode>>('lyricsChordModes', {});
  const [scale, setScale] = usePref('lyricsScale', 1);
  const [pinned, setPinned] = useState<number | null>(null);
  const track = tracks.find((t) => t.title === trackTitle) ?? tracks[0];
  const hasChords = !!track?.lines.some((l) => l.rows.some((r) => r.some((part) => part.chord)));
  const chordMode: ChordMode = track ? (modes[track.title] ?? track.options.chords) : 'show';
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

  // Built once per song / track change, not on every animation frame.
  const { items, lines } = useMemo(() => {
    const items: Item[] = [];
    const lines: LyricLine[] = [];
    if (!track) return { items, lines };
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
    return { items, lines };
  }, [track, songsToShow]);
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
      else if ((e.key === 'm' || e.key === 'n') && canJump) {
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
            {allTracks.length > 0 ? (
              'The owner hasn’t shared a lyrics track with viewers.'
            ) : (
              <>
                Add a MIDI track with <code>+LYRICS</code> in its name to your Live set, with one clip per line.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  const o = track.options;
  const semitonesFor = (s: Song) => (s.transpose?.semitones ?? 0) + (o.transpose?.semitones ?? 0);
  const flatsFor = (s: Song) => !!(s.transpose?.flats || o.transpose?.flats);
  const topPad = o.top !== null ? `${o.top * 2.2}em` : '35vh';
  const defaultAlign = o.align ?? 'center';

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* One row; scrolls sideways on narrow phones instead of eating the lyrics' height. */}
      <div className="no-print mx-auto flex w-full max-w-[980px] items-center gap-2 overflow-x-auto px-4 pt-3 [scrollbar-width:none] sm:gap-3 sm:px-6 sm:pt-4">
        {tracks.length > 1 && (
          <Segmented
            label="Lyrics track"
            value={track.title}
            options={tracks.map((t) => ({ value: t.title, label: t.title }))}
            onChange={setTrackTitle}
            className="shrink-0 flex-nowrap"
          />
        )}
        {hasChords && <Segmented label="Show" value={chordMode} options={CHORD_MODES} onChange={(m) => setModes({ ...modes, [track.title]: m })} className="shrink-0 flex-nowrap" />}
        <p className="m-0 min-w-[96px] flex-1 truncate text-[15px] text-muted">{song?.title ?? 'Not in a song'}</p>
        {pinned !== null && (
          <Button variant="ghost" onClick={() => setPinned(null)}>
            Back to current
          </Button>
        )}
        <Button variant="outline" className="!px-0 w-11 shrink-0" onClick={() => setScale(Math.max(0.5, scale - 0.1))} title="Smaller text">
          A−
        </Button>
        <Button variant="outline" className="!px-0 w-11 shrink-0 text-lg" onClick={() => setScale(Math.min(3, scale + 0.1))} title="Larger text">
          A+
        </Button>
      </div>
      <NotesBanner time={time} song={song} section={song?.sections[loc.sectionIndex]} />
      {/* Smaller base size on narrow screens so lines fit; A- / A+ scale it. */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto px-4 sm:px-6" style={{ fontSize: `calc(clamp(1.5rem, 6.5vw, 2.5rem) * ${scale})` }}>
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
            const progress = isActive && o.progress ? Math.max(0, Math.min(1, (time + latencyBeats - line.start) / (line.end - line.start || 1))) : 0;
            return (
              <LineView
                key={line.id}
                line={line}
                isActive={isActive}
                progress={progress}
                options={o}
                chords={chordMode}
                semitones={semitonesFor(item.song)}
                flats={flatsFor(item.song)}
                defaultAlign={defaultAlign}
                canJump={canJump}
                activeRef={activeRef}
              />
            );
          })}
          <div style={{ height: '60vh' }} />
        </div>
      </div>
    </div>
  );
}

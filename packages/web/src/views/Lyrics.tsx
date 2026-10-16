import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  activeLineIndex,
  activeOrder,
  chordAt,
  chordBars,
  chordTracks,
  chordsBetween,
  linesForSong,
  beatsPerBar,
  locate,
  lyricsFollow,
  lyricsTracks,
  sectionBars,
  parseInline,
  parseLyricsOptions,
  parseTrackName,
  placeChords,
  transposeChord,
  type ChordBar,
  type ChordEvent,
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

const CHORD_MODES: { value: ChordMode; label: React.ReactNode }[] = [
  { value: 'hide', label: 'Lyrics' },
  {
    value: 'show',
    label: (
      <>
        <span className="sm:hidden">Both</span>
        <span className="max-sm:hidden">Lyrics + Chords</span>
      </>
    ),
  },
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
  words,
  chordColor,
  semitones,
  flats,
  align,
  chords,
}: {
  parts: LyricPart[];
  words: Block[][];
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
  const showChords = chords !== 'hide' && words.some((w) => w.some((b) => b.chord));
  return (
    <div className={`flex flex-wrap items-end ${align === 'center' ? 'justify-center' : 'justify-start'}`}>
      {words.map((word, w) => (
        <span key={w} className="inline-flex max-w-full items-end" style={word[word.length - 1].spaceAfter ? { marginRight: '0.28em' } : undefined}>
          {word.map((b, i) => (
            <span key={i} className="inline-flex min-w-0 flex-col [overflow-wrap:anywhere]">
              {showChords && (
                <span className="mb-[0.05em] text-[0.7em] leading-[1.1] font-bold tracking-normal" style={{ color }}>
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
  trackChords,
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
  /** Chords from a +CHORDS track that fall in this line, placed over its words by time. */
  trackChords?: ChordEvent[];
}) {
  const rowWords = useMemo(() => {
    const rows = line.rows.map((parts) => toWords(toBlocks(parts)));
    if (!trackChords?.length || chords === 'hide') return rows;
    const all = rows.flat();
    const at = placeChords(
      trackChords.map((c) => c.start),
      line.start,
      line.end,
      all.length,
    );
    at.forEach((i, n) => {
      if (all[i]) all[i][0].chord = trackChords[n].chord;
      else rows[rows.length - 1].push([{ chord: trackChords[n].chord, pieces: [], spaceAfter: true }]);
    });
    return rows;
  }, [line, trackChords, chords]);
  const ownColor = line.color ?? o.color;
  // Every line keeps the same size and stays readable: lyric clips are often placed a little before or
  // after the beat, so the current line is only marked by a stronger color and a soft background.
  const current = isActive && !o.noFade;
  const color = ownColor ? colorOf(ownColor) : current || o.noFade ? 'var(--fg)' : 'var(--muted)';
  const align = line.align ?? defaultAlign;
  return (
    <button
      type="button"
      ref={isActive ? activeRef : undefined}
      disabled={!canJump}
      onClick={() => act('jumpToTime', line.start)}
      aria-current={isActive ? 'true' : undefined}
      className={`relative block w-full rounded-2xl px-3 py-2 leading-[1.15] font-semibold tracking-[-0.02em] transition-colors duration-300 ${
        current ? 'bg-accent/10' : ''
      } ${o.lineMarker && isActive ? 'border-l-4 border-accent pl-4' : ''}`}
      style={{
        color,
        opacity: ownColor && !current && !o.noFade ? 0.7 : 1,
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
        line.rows.map((parts, i) => <Row key={i} parts={parts} words={rowWords[i]} chordColor={o.chordColor} semitones={semitones} flats={flats} align={align} chords={chords} />)
      )}
      {o.progress && isActive && (
        <span className="mx-auto mt-3 block h-1 w-32 overflow-hidden rounded-full bg-line">
          <span className="block h-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </span>
      )}
    </button>
  );
});

/**
 * Bars of chords from a +CHORDS track, four to a row (two on phones). The chord playing now is
 * highlighted; a bar where no chord starts shows the held chord, dimmed. Tap a chord to jump to it.
 */
const ChordBars = memo(function ChordBars({
  bars,
  offset,
  activeId,
  nowBar,
  color,
  semitones,
  flats,
  canJump,
}: {
  bars: ChordBar[];
  /** Bars from the section start, so bar 3 sits in the third column. */
  offset: number;
  activeId?: string;
  /** Start of the bar playing now, when it is in this row: tinted and kept in view like the current lyric line. */
  nowBar?: number;
  color?: string;
  semitones: number;
  flats: boolean;
  canJump: boolean;
}) {
  const chordColor = colorOf(color, 'var(--accent)');
  return (
    <div role="list" aria-label="Chords" className="my-3 grid grid-cols-2 gap-y-2 text-[0.75em] font-semibold sm:grid-cols-4">
      {bars.map((bar, i) => (
        <div
          key={bar.start}
          role="listitem"
          data-now-bar={bar.start === nowBar ? '' : undefined}
          style={i === 0 ? ({ '--c2': (offset % 2) + 1, '--c4': (offset % 4) + 1 } as React.CSSProperties) : undefined}
          className={`flex min-h-[1.6em] min-w-0 flex-wrap items-center gap-x-1 border-l-2 border-line2 px-2 transition-colors first:[grid-column-start:var(--c2)] sm:first:[grid-column-start:var(--c4)] ${
            bar.start === nowBar ? 'rounded-r-lg bg-accent/10' : ''
          }`}
        >
          {bar.held && bar.chords.length === 0 && (
            <span className={`rounded-lg px-1.5 text-faint ${bar.start === nowBar && bar.held.id === activeId ? 'ring-2 ring-accent/40' : ''}`}>
              {transposeChord(bar.held.chord, semitones, flats)}
            </span>
          )}
          {bar.chords.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={!canJump}
              onClick={() => act('jumpToTime', c.start)}
              className={`rounded-lg px-1.5 transition [overflow-wrap:anywhere] ${c.id === activeId ? 'bg-accent text-onaccent' : ''}`}
              style={c.id === activeId ? undefined : { color: chordColor }}
            >
              {transposeChord(c.chord, semitones, flats)}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
});

/** Dots per bar: sections longer than 32 bars use one dot per 2, 4 or 8 bars so the row fits. */
function barsPerDot(bars: number): number {
  return bars <= 32 ? 1 : bars <= 64 ? 2 : bars <= 128 ? 4 : 8;
}

/**
 * A section heading in the lyrics: name, its {description} as an orange cue, and one dot per bar.
 * `dot` is the index of the bar being played (-1 = upcoming, >= dots = finished). Memoised, so only
 * the current section re-renders, once per bar.
 */
const SectionHeader = memo(function SectionHeader({
  section,
  bars,
  dot,
  align,
  lead,
}: {
  section: Section;
  bars: number;
  dot: number;
  align: 'left' | 'center';
  /** The page is following this section (nothing else is playing in it): tinted like a current line. */
  lead: boolean;
}) {
  const per = barsPerDot(bars);
  const dots = Math.ceil(bars / per);
  const current = dot >= 0 && dot < dots;
  const justify = align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <div
      data-now-section={current ? '' : undefined}
      className={`mt-[1.1em] mb-2 flex flex-col gap-2 rounded-2xl px-3 py-2 transition-colors duration-300 ${lead ? 'bg-accent/10' : ''}`}
      style={{ textAlign: align }}
    >
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${justify}`}>
        {/* Same size as the lyrics; told apart by its color (the section's, or blue) and the dots under it. */}
        <span
          className={`text-[1em] leading-[1.15] font-bold tracking-[-0.02em] [overflow-wrap:anywhere] text-accent`}
          style={section.color ? { color: colorOf(section.color) } : undefined}
        >
          {section.title}
        </span>
        {section.description && (
          <span className="rounded-full bg-[#ff9f0a] px-[0.6em] py-[0.1em] text-[0.6em] font-semibold tracking-normal text-black [overflow-wrap:anywhere]">
            {section.description}
          </span>
        )}
      </div>
      <div className={`flex flex-wrap gap-1.5 ${justify}`} aria-label={`${bars} bars${current ? `, bar ${dot * per + 1}` : ''}`} role="img">
        {Array.from({ length: dots }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 w-2.5 rounded-full ${i < dot ? 'bg-accent' : i === dot ? 'animate-pulse bg-accent ring-2 ring-accent/30' : 'bg-line2'}`}
          />
        ))}
      </div>
    </div>
  );
});

type Item =
  | { kind: 'header'; section: Section; song: Song }
  | { kind: 'songTitle'; song: Song }
  | { kind: 'line'; line: LyricLine; index: number; song: Song; chords?: ChordEvent[] }
  | { kind: 'bars'; id: string; bars: ChordBar[]; offset: number; song: Song };

/** A Lyrics tab: a +LYRICS track, or a +CHORDS track shown as a chord chart. */
type Tab = LyricsTrack & { chart: boolean };

/** Item start time, for slotting chord rows between lyric lines. */
function itemTime(item: Item): number {
  if (item.kind === 'header') return item.section.start;
  if (item.kind === 'line') return item.line.start;
  if (item.kind === 'bars') return item.bars[0].start;
  return item.song.start;
}

function hasInlineChords(line: LyricLine): boolean {
  return line.rows.some((r) => r.some((part) => part.chord));
}

/** A pickup chord up to a beat before a lyric line still sits over its first word. */
const PICKUP = 1;

export function Lyrics() {
  const state = useStore((s) => s.state)!;
  const time = usePlayhead();
  const access = useAccess();
  const chordTrackList = useMemo(() => chordTracks(state.tracks), [state.tracks]);
  // With lyrics tracks, the +CHORDS track feeds their Lyrics / Lyrics + Chords / Chords toggle.
  // Without any, it is shown on its own as a chord chart.
  const allTracks = useMemo<Tab[]>(() => {
    const lyrics = lyricsTracks(state.tracks).map((t) => ({ ...t, chart: false }));
    if (lyrics.length) return lyrics;
    return chordTrackList.map((c) => ({ id: c.id, title: c.title, options: parseLyricsOptions(c.attrs, c), lines: [], chart: true }));
  }, [state.tracks, chordTrackList]);
  // The first +CHORDS track supplies chords to lyric lines that have no inline [C]hords.
  // Its own [+2] transposes them; the song's and the lyrics track's transpose apply on top.
  const chordEvents = useMemo(() => {
    const source = chordTrackList[0];
    if (!source) return [];
    const t = parseTrackName(state.tracks.find((x) => x.id === source.id)?.name ?? '').transpose;
    return t ? source.events.map((e) => ({ ...e, chord: transposeChord(e.chord, t.semitones, t.flats) })) : source.events;
  }, [chordTrackList, state.tracks]);
  const tracks = allTracks.filter((t) => access.canSeeLyrics(t.title));
  const canJump = access.can('navigate') && !state.locked;
  // Remembered by title so it survives track reordering in Live.
  const [trackTitle, setTrackTitle] = usePref<string | null>('lyricsTrackTitle', null);
  const [modes, setModes] = usePref<Record<string, ChordMode>>('lyricsChordModes', {});
  const [scale, setScale] = usePref('lyricsScale', 1);
  const [pinned, setPinned] = useState<number | null>(null);
  const track = tracks.find((t) => t.title === trackTitle) ?? tracks[0];
  const inlineChords = !!track?.lines.some(hasInlineChords);
  const events = track ? chordEvents : [];
  // The toggle shows whenever the set has chords, even while a +CHORDS track is still empty.
  const hasChords = !!track && !track.chart && (inlineChords || chordTrackList.length > 0);
  const chordMode: ChordMode = !track ? 'show' : track.chart ? 'only' : hasChords ? (modes[track.title] ?? track.options.chords) : 'hide';
  const { sigNum, sigDen } = state.live;
  const loc = locate(state.songs, time);
  // The song's {description} (usually its key), or this setlist's override of it.
  const songNote = (s: Song) => state.setlist.entries.find((e) => e.songId === s.id)?.description ?? s.description;
  const song = state.songs[loc.songIndex];
  // Why a song shows no chords: the owner gets the likely cause, viewers a plain note.
  const songHasChords = !!song && !!track && (chordsBetween(events, song.start, song.end).length > 0 || linesForSong(track, song).some(hasInlineChords));
  const chordHint =
    !track || !song || chordMode === 'hide' || songHasChords
      ? null
      : !access.isOwner
        ? 'No chords for this song yet.'
        : state.scriptOutdated
          ? 'Live is running an old copy of the Setlist Remote Script, so chords can’t come through. Run npm run install-script, then restart Live.'
          : chordTrackList.length > 0 && chordEvents.length === 0
            ? `The “${chordTrackList[0].title}” +CHORDS track has no clips in Live’s Arrangement. Clips in Session View aren’t read.`
            : 'No chords for this song yet. Add clips named like C-G-Am-F to the +CHORDS track.';

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
    const bpb = beatsPerBar(sigNum, sigDen);
    for (const s of songsToShow) {
      if (track.options.allSongs) items.push({ kind: 'songTitle', song: s });
      const songItems: Item[] = [];
      const allLines = linesForSong(track, s);
      const songChords = chordMode === 'hide' ? [] : chordsBetween(events, s.start, s.end);
      // "Chords" with track chords is a chord chart: the lyric lines are left out.
      const songLines = chordMode === 'only' && songChords.length > 0 ? [] : allLines;
      // The metronome section (emergency click) has no place among the lyrics.
      const headers = track.options.noSections ? [] : s.sections.filter((x) => !x.metronome);
      // Track chords: each sits over the first lyric line it falls in; the rest become bar rows.
      const free: ChordEvent[] = [];
      const byLine = new Map<string, ChordEvent[]>();
      for (const c of songChords) {
        const line = songLines.find((l) => c.start >= l.start - PICKUP - 1e-6 && c.start < l.end - 1e-6);
        // A line with its own inline [C]hords keeps them.
        if (line) {
          if (!hasInlineChords(line)) byLine.set(line.id, [...(byLine.get(line.id) ?? []), c]);
        } else free.push(c);
      }
      for (const line of songLines) {
        while (headers.length && headers[0].start <= line.start + 1e-6 && !(line.position === 'before' && Math.abs(headers[0].start - line.start) < 1e-6)) {
          songItems.push({ kind: 'header', section: headers.shift()!, song: s });
        }
        songItems.push({ kind: 'line', line, index: lines.length, song: s, chords: byLine.get(line.id) });
        lines.push(line);
      }
      // Sections after the last lyric line (instrumental endings, songs without lyrics) still show.
      for (const section of headers) songItems.push({ kind: 'header', section, song: s });
      // Free chords: one row of bars per run between lyric lines, within a section, bars aligned to it.
      const ranges = s.sections.length ? s.sections.map((x) => ({ id: x.id, start: x.start, end: x.end })) : [{ id: s.id, start: s.start, end: s.end }];
      for (const r of ranges) {
        const runs: ChordEvent[][] = [];
        for (const c of free) {
          if (c.start < r.start - 1e-6 || c.start >= r.end - 1e-6) continue;
          const run = runs[runs.length - 1];
          const lineBetween = run && songLines.some((l) => l.start > run[run.length - 1].start && l.start <= c.start);
          if (!run || lineBetween) runs.push([c]);
          else run.push(c);
        }
        for (const run of runs) {
          const from = r.start + Math.floor((run[0].start - r.start) / bpb + 1e-6) * bpb;
          const end = Math.min(r.end, Math.max(...run.map((c) => c.end)));
          const to = Math.max(from + bpb, Math.min(r.end, r.start + Math.ceil((end - r.start) / bpb - 1e-6) * bpb));
          const offset = Math.round((from - r.start) / bpb);
          const item: Item = { kind: 'bars', id: `${r.id}:${run[0].id}`, bars: chordBars(run, from, to, sigNum, sigDen), offset, song: s };
          const idx = songItems.findIndex((it) => itemTime(it) > run[0].start + 1e-6);
          songItems.splice(idx < 0 ? songItems.length : idx, 0, item);
        }
      }
      items.push(...songItems);
    }
    return { items, lines };
  }, [track, songsToShow, events, chordMode, sigNum, sigDen]);
  // The chord row and bar playing now: highlighted and kept in view, bar by bar, like lyric lines.
  const nowChord = chordAt(events, time);
  const activeBars = items.find(
    (it): it is Extract<Item, { kind: 'bars' }> => it.kind === 'bars' && time >= it.bars[0].start - 1e-6 && time < it.bars[it.bars.length - 1].end - 1e-6,
  );
  const nowBar = activeBars?.bars.find((b) => time >= b.start - 1e-6 && time < b.end - 1e-6)?.start;
  const nowBarKey = activeBars && nowBar !== undefined ? `${activeBars.id}@${nowBar}` : null;
  const latencyBeats = track ? (track.options.latency / 1000) * (state.live.tempo / 60) : 0;
  const playingIdx = activeLineIndex(lines, time + latencyBeats);
  const active = pinned ?? playingIdx;
  // Keep in view (and highlight) whichever started last: the lyric line, the chord row (instrumental
  // bars), or the section itself, so a section with no lyrics or chords is followed too instead of
  // the page jumping a long way when the next section starts.
  const playingSection = song?.sections[loc.sectionIndex];
  const nowSection = track?.options.noSections || playingSection?.metronome ? undefined : playingSection;
  const lead = lyricsFollow({
    time: time + latencyBeats,
    line: lines[active],
    barsStart: activeBars ? itemTime(activeBars) : undefined,
    section: nowSection,
    pinned: pinned !== null,
    songStart: song?.start,
  });
  const leadKey =
    lead === 'bars' ? `b:${nowBarKey}` : lead === 'header' ? `h:${nowSection!.id}` : lead === 'songStart' ? `s:${song?.id}` : `l:${active}`;

  // The first scroll after opening the page is instant: a smooth one can be lost while the page lays out.
  const scrolled = useRef(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const lineBlock: ScrollLogicalPosition = track?.options.top !== null && track?.options.top !== undefined ? 'start' : 'center';
  const target = useRef({ lead, lineBlock, songId: song?.id });
  target.current = { lead, lineBlock, songId: song?.id };
  const scrollToLead = (behavior: ScrollBehavior) => {
    const { lead: kind, lineBlock: block, songId } = target.current;
    const scroller = scrollerRef.current;
    if (kind === 'songStart') {
      // The song's title when all songs are listed, otherwise simply the top of the page.
      const title = songId ? scroller?.querySelector<HTMLElement>(`[data-song-title="${CSS.escape(songId)}"]`) : null;
      if (title) title.scrollIntoView({ behavior, block: 'start' });
      else scroller?.scrollTo({ top: 0, behavior });
      if (scroller) scrolled.current = true;
      return;
    }
    const el =
      kind === 'line' ? activeRef.current : scrollerRef.current?.querySelector<HTMLElement>(kind === 'bars' ? '[data-now-bar]' : '[data-now-section]');
    el?.scrollIntoView({ behavior, block: kind === 'line' ? block : 'center' });
    if (el) scrolled.current = true;
  };
  useEffect(() => {
    scrollToLead(scrolled.current ? 'smooth' : 'auto');
  }, [leadKey, lineBlock]);
  // When the lyrics area changes height (a notes banner appears, the phone rotates), re-center at once.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => scrollToLead('auto'));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!track]);
  useEffect(() => setPinned(null), [song?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const clamp = (i: number) => Math.max(0, Math.min(lines.length - 1, i));
      if (e.key === '.') setPinned(clamp((pinned ?? playingIdx) + 1));
      else if (e.key === ',') setPinned(clamp((pinned ?? playingIdx) - 1));
      else if (e.key === 'Escape') setPinned(null);
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
                Add a MIDI track with <code>+LYRICS</code> in its name to your Live set, with one clip per line, or a{' '}
                <code>+CHORDS</code> track with one chord per clip.
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
  const bpb = beatsPerBar(sigNum, sigDen);

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* One row; scrolls sideways on narrow phones instead of eating the lyrics' height. */}
      {/* Wraps on phones so every option stays visible: tabs and A−/A+ first, then the chord toggle and song. */}
      <div className="no-print mx-auto flex w-full max-w-[980px] flex-wrap items-center gap-2 px-4 pt-3 sm:gap-3 sm:px-6 sm:pt-4">
        {tracks.length > 1 && (
          <Segmented
            label="Lyrics track"
            value={track.title}
            options={tracks.map((t) => ({ value: t.title, label: t.title }))}
            onChange={setTrackTitle}
            className="shrink-0 flex-nowrap"
          />
        )}
        {hasChords && (
          <Segmented
            label="Show"
            value={chordMode}
            options={CHORD_MODES}
            onChange={(m) => setModes({ ...modes, [track.title]: m })}
            className="shrink-0 flex-nowrap max-sm:order-2"
          />
        )}
        {/* The song and its key, big enough to read from the stage; a full row of its own on phones. */}
        <p
          className={`m-0 flex min-w-[96px] flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[22px] leading-tight font-bold tracking-[-0.01em] max-sm:order-3 max-sm:basis-full sm:text-[26px] ${
            song ? 'text-fg' : 'text-muted'
          }`}
        >
          <span className="[overflow-wrap:anywhere]">{song?.title ?? 'Not in a song'}</span>
          {song && songNote(song) && (
            <span className="rounded-full bg-accent/10 px-3 py-0.5 text-[0.85em] whitespace-nowrap text-accent">{songNote(song)}</span>
          )}
        </p>
        {pinned !== null && (
          <Button variant="ghost" className="max-sm:order-4" onClick={() => setPinned(null)}>
            Back to current
          </Button>
        )}
        <Button variant="outline" className="!px-0 w-11 shrink-0 max-sm:order-1" onClick={() => setScale(Math.max(0.5, scale - 0.1))} title="Smaller text">
          A−
        </Button>
        <Button variant="outline" className="!px-0 w-11 shrink-0 text-lg max-sm:order-1" onClick={() => setScale(Math.min(3, scale + 0.1))} title="Larger text">
          A+
        </Button>
      </div>
      <NotesBanner time={time} song={song} section={song?.sections[loc.sectionIndex]} />
      {chordHint && <p className="no-print mx-auto m-0 w-full max-w-[980px] px-4 pt-2 text-center text-[15px] text-muted sm:px-6">{chordHint}</p>}
      {/* Smaller base size on narrow screens so lines fit; A- / A+ scale it. */}
      <div ref={scrollerRef} className="flex-1 overflow-x-hidden overflow-y-auto px-4 sm:px-6" style={{ fontSize: `calc(clamp(1.5rem, 6.5vw, 2.5rem) * ${scale})` }}>
        <div className="mx-auto max-w-[980px]">
          <div style={{ height: topPad }} />
          {items.map((item) => {
            if (item.kind === 'songTitle') {
              return (
                <h2 key={`t-${item.song.id}`} data-song-title={item.song.id} className="headline mt-16 mb-4 text-[0.8em]" style={{ textAlign: defaultAlign, color: item.song.color ? colorOf(item.song.color) : undefined }}>
                  {item.song.title}
                  {songNote(item.song) && <span className="text-muted"> · {songNote(item.song)}</span>}
                </h2>
              );
            }
            if (item.kind === 'header') {
              const sec = item.section;
              const bars = sectionBars(sec, sigNum, sigDen);
              const dots = Math.ceil(bars / barsPerDot(bars));
              const dot =
                time >= sec.end - 1e-6 ? dots : time < sec.start - 1e-6 ? -1 : Math.min(dots - 1, Math.floor(Math.floor((time - sec.start) / bpb + 1e-6) / barsPerDot(bars)));
              return (
                <SectionHeader
                  key={`h-${sec.id}`}
                  section={sec}
                  bars={bars}
                  dot={dot}
                  align={defaultAlign}
                  lead={lead === 'header' && sec.id === nowSection?.id}
                />
              );
            }
            if (item.kind === 'bars') {
              return (
                <ChordBars
                  key={`b-${item.id}`}
                  bars={item.bars}
                  offset={item.offset}
                  activeId={item === activeBars ? nowChord?.id : undefined}
                  nowBar={item === activeBars ? nowBar : undefined}
                  color={o.chordColor}
                  semitones={semitonesFor(item.song)}
                  flats={flatsFor(item.song)}
                  canJump={canJump}
                />
              );
            }
            const { line, index } = item;
            const isActive = index === active && lead === 'line';
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
                trackChords={item.chords}
              />
            );
          })}
          <div style={{ height: '60vh' }} />
        </div>
      </div>
    </div>
  );
}

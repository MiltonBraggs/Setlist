import { COLOR_NAMES, parseTrackName } from './notation.ts';
import type { Song } from './songs.ts';
import type { Beats, LiveTrack } from './types.ts';

export interface LyricPart {
  chord?: string;
  text: string;
}

export interface LyricLine {
  id: string;
  start: Beats;
  end: Beats;
  /** Rows split by `\`; highlighted together. */
  rows: LyricPart[][];
  color?: string;
  size?: 'large' | 'small' | 'tiny';
  align?: 'left' | 'center';
  mono: boolean;
  /** `[<]` before / `[>]` after the section header at the same position. */
  position?: 'before' | 'after';
  image?: { src: string; full: boolean; scroll: boolean };
}

export interface LyricsDisplayOptions {
  color?: string;
  size?: 'large' | 'small' | 'tiny';
  align?: 'left' | 'center';
  mono: boolean;
  noFade: boolean;
  noZoom: boolean;
  noSections: boolean;
  lineMarker: boolean;
  /** `[top]` / `[top+2]`: pin current line near the top with N lines of context. */
  top: number | null;
  progress: boolean;
  allSongs: boolean;
  clipColors: boolean;
  /** ms, positive = show lines earlier */
  latency: number;
  chordColor?: string;
  chords: 'show' | 'hide' | 'only';
  transpose: { semitones: number; flats: boolean } | null;
}

export interface LyricsTrack {
  id: string;
  title: string;
  options: LyricsDisplayOptions;
  lines: LyricLine[];
}

const CHORD_RE = /^[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add|M)?\d{0,2}(?:(?:add|sus|maj|b|#)\d{1,2})*(?:\/[A-G](?:#|b)?)?$/;

export function isChord(text: string): boolean {
  return CHORD_RE.test(text.trim());
}

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function transposeNote(note: string, semitones: number, flats: boolean): string {
  let idx = SHARPS.indexOf(note);
  if (idx < 0) idx = FLATS.indexOf(note);
  if (idx < 0) return note;
  const n = (((idx + semitones) % 12) + 12) % 12;
  return (flats ? FLATS : SHARPS)[n];
}

export function transposeChord(chord: string, semitones: number, flats = false): string {
  if (!semitones && !flats) return chord;
  return chord.replace(/([A-G](?:#|b)?)/g, (m) => transposeNote(m, semitones, flats));
}

function parseRow(text: string): LyricPart[] {
  const parts: LyricPart[] = [];
  let chord: string | undefined;
  let last = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]/g)) {
    if (!isChord(m[1])) continue;
    const before = text.slice(last, m.index);
    if (before || chord !== undefined) parts.push({ chord, text: before });
    chord = m[1].trim();
    last = m.index! + m[0].length;
  }
  const rest = text.slice(last);
  if (rest || chord !== undefined || parts.length === 0) parts.push({ chord, text: rest });
  return parts;
}

export function parseLyricLine(raw: string, id: string, start: Beats, end: Beats): LyricLine {
  const line: LyricLine = { id, start, end, rows: [], mono: false };
  // Leading / anywhere attributes that aren't chords.
  const text = raw.replace(/\[([^\]]+)\]/g, (whole, inner: string) => {
    const attr = inner.trim();
    const lower = attr.toLowerCase();
    if (isChord(attr)) return whole;
    if ((COLOR_NAMES as readonly string[]).includes(lower) || /^#[0-9a-f]{6}$/i.test(attr)) line.color = lower;
    else if (lower === 'large' || lower === 'small' || lower === 'tiny') line.size = lower;
    else if (lower === 'left' || lower === 'center') line.align = lower;
    else if (lower === 'mono') line.mono = true;
    else if (attr === '<') line.position = 'before';
    else if (attr === '>') line.position = 'after';
    else if (lower.startsWith('img:')) line.image = { src: attr.slice(4).trim(), full: false, scroll: false };
    else if (lower === 'full') line.image && (line.image.full = true);
    else if (lower === 'scroll') line.image && (line.image.scroll = true);
    else return whole;
    return '';
  });
  if (line.image) {
    if (/\[full\]/i.test(raw)) line.image.full = true;
    if (/\[scroll\]/i.test(raw)) line.image.scroll = true;
  }
  line.rows = text
    .split('\\')
    .map((r) => r.trim())
    .filter((r, i, all) => r || all.length === 1)
    .map(parseRow);
  return line;
}

export function parseLyricsOptions(attrs: string[], track: { color?: string; transpose?: { semitones: number; flats: boolean } }): LyricsDisplayOptions {
  const o: LyricsDisplayOptions = {
    color: track.color,
    mono: false,
    noFade: false,
    noZoom: false,
    noSections: false,
    lineMarker: false,
    top: null,
    progress: false,
    allSongs: false,
    clipColors: false,
    latency: 0,
    chords: 'show',
    transpose: track.transpose ?? null,
  };
  for (const a of attrs) {
    const lower = a.toLowerCase();
    const top = /^top(?:\+(\d+))?$/.exec(lower);
    const latency = /^([+-]\d+)ms$/.exec(lower);
    const chordColor = /^chords:(.+)$/.exec(lower);
    if (lower === 'large' || lower === 'small' || lower === 'tiny') o.size = lower;
    else if (lower === 'left' || lower === 'center') o.align = lower;
    else if (lower === 'mono') o.mono = true;
    else if (lower === 'nofade') o.noFade = true;
    else if (lower === 'nozoom') o.noZoom = true;
    else if (lower === 'nosections') o.noSections = true;
    else if (lower === 'linemarker') o.lineMarker = true;
    else if (lower === 'progress') o.progress = true;
    else if (lower === 'allsongs') o.allSongs = true;
    else if (lower === 'nochords') o.chords = 'hide';
    else if (lower === 'onlychords') o.chords = 'only';
    else if (top) o.top = top[1] ? Number(top[1]) : 0;
    else if (latency) o.latency = Number(latency[1]);
    else if (chordColor) o.chordColor = chordColor[1];
  }
  return o;
}

function hexColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function lyricsTracks(tracks: LiveTrack[]): LyricsTrack[] {
  return tracks
    .map((t) => ({ t, p: parseTrackName(t.name) }))
    .filter(({ p }) => p.isLyrics)
    .map(({ t, p }) => {
      const flagAttrs = /\+(CLIPCOLORS|CC)\b/i.test(t.name) ? ['clipcolors'] : [];
      const options = parseLyricsOptions([...p.attrs, ...flagAttrs], p);
      if (flagAttrs.length) options.clipColors = true;
      const lines = [...(t.clips ?? [])]
        .sort((a, b) => a.start - b.start)
        .map((c) => {
          const line = parseLyricLine(c.name, c.id, c.start, c.end);
          if (options.clipColors && !line.color) line.color = hexColor(c.color);
          return line;
        });
      return { id: t.id, title: p.title, options, lines };
    });
}

/** Lines of a song (by arrangement range). */
export function linesForSong(track: LyricsTrack, song: Song): LyricLine[] {
  return track.lines.filter((l) => l.start >= song.start - 1e-6 && l.start < song.end - 1e-6);
}

/** Index of the active line: last line that has started (within its song). */
export function activeLineIndex(lines: LyricLine[], time: Beats): number {
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start <= time + 1e-6) idx = i;
    else break;
  }
  return idx;
}

export interface InlineToken {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** `**bold**` and `*italic*` */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) tokens.push({ text: text.slice(last, m.index), bold: false, italic: false });
    if (m[2] !== undefined) tokens.push({ text: m[2], bold: true, italic: false });
    else tokens.push({ text: m[3], bold: false, italic: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), bold: false, italic: false });
  return tokens;
}

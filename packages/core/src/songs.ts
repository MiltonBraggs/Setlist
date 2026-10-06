import { parseLocator, parseTrackName, type CountInOptions, type LocatorFlags, type ParsedLocator } from './notation.ts';
import type { Beats, LiveSnapshot } from './types.ts';

export interface Section {
  id: string;
  title: string;
  /** Original locator / clip name. */
  raw: string;
  start: Beats;
  /** Effective end: next section start or song end. */
  end: Beats;
  color?: string;
  quickAccess: boolean;
  description?: string;
  flags: LocatorFlags;
  jumpTarget?: string;
  countIn?: CountInOptions;
  classes: string[];
  /** Has a real Live locator, so it can be jumped to (quantized) while playing. */
  hasCue: boolean;
  /** Part of the optional `+END` tail. */
  optional: boolean;
  duration?: number;
}

export type SongEndKind = 'songEnd' | 'stop' | 'implicit';

export interface Song {
  id: string;
  title: string;
  /** Position in the arrangement (0-based). */
  index: number;
  start: Beats;
  /** Position of the end locator, or the next song start. */
  end: Beats;
  /** End used for playback/duration: first `+END` section start, else `end`. */
  playEnd: Beats;
  endKind: SongEndKind;
  /** For `stop` ends: +JUMP / +STAY override. */
  stopThen: 'jump' | 'stay' | 'default';
  stopBefore: boolean;
  description?: string;
  color?: string;
  classes: string[];
  tags: string[];
  noSong: boolean;
  transpose?: { semitones: number; flats: boolean };
  /** Seconds; manual `[m:ss]` override or computed from tempo. */
  duration: number;
  durationIsManual: boolean;
  sections: Section[];
  locator: ParsedLocator;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'song';
}

export function beatsToSeconds(beats: Beats, tempo: number): number {
  return (beats * 60) / tempo;
}

export function beatsPerBar(sigNum: number, sigDen: number): number {
  return (sigNum * 4) / sigDen;
}

const EPS = 1e-6;

interface RawSection {
  parsed: ParsedLocator;
  time: Beats;
  hasCue: boolean;
}

interface BuildInput {
  cues: LiveSnapshot['cues'];
  tracks: LiveSnapshot['tracks'];
  tempo: number;
  songLength: Beats;
}

/** Turn Live's locators (+ section clips) into songs and sections. */
export function buildSongs(input: BuildInput): Song[] {
  const cues = [...input.cues].sort((a, b) => a.time - b.time);
  const sectionClips = input.tracks
    .filter((t) => parseTrackName(t.name).isSections)
    .flatMap((t) => t.clips ?? [])
    .sort((a, b) => a.start - b.start);

  const songs: Song[] = [];
  const usedIds = new Map<string, number>();
  let current: { parsed: ParsedLocator; start: Beats; sections: RawSection[] } | null = null;
  let pendingEnd: { time: Beats; kind: SongEndKind; then: Song['stopThen'] } | null = null;

  const close = (endTime: Beats) => {
    if (!current) return;
    const end = pendingEnd ? pendingEnd.time : endTime;
    songs.push(finishSong(current.parsed, current.start, end, pendingEnd, current.sections, sectionClips, songs.length, usedIds, input.tempo));
    current = null;
    pendingEnd = null;
  };

  for (const cue of cues) {
    const parsed = parseLocator(cue.name);
    switch (parsed.kind) {
      case 'ignore':
      case 'jump':
        break;
      case 'song':
        close(cue.time);
        current = { parsed, start: cue.time, sections: [] };
        break;
      case 'section':
        if (current && !pendingEnd) current.sections.push({ parsed, time: cue.time, hasCue: true });
        break;
      case 'songEnd':
      case 'stop':
        if (current && !pendingEnd) {
          pendingEnd = {
            time: cue.time,
            kind: parsed.kind,
            then: parsed.flags.stop?.then ?? 'default',
          };
        }
        break;
    }
  }
  close(Math.max(input.songLength, cues.length ? cues[cues.length - 1].time : 0));
  return songs;
}

function finishSong(
  parsed: ParsedLocator,
  start: Beats,
  end: Beats,
  endInfo: { kind: SongEndKind; then: Song['stopThen'] } | null,
  cueSections: RawSection[],
  sectionClips: { name: string; start: Beats }[],
  index: number,
  usedIds: Map<string, number>,
  tempo: number,
): Song {
  const baseId = slugify(parsed.title);
  const n = (usedIds.get(baseId) ?? 0) + 1;
  usedIds.set(baseId, n);
  const id = n === 1 ? baseId : `${baseId}-${n}`;

  // Merge clip-based sections; a locator at the same time wins.
  const raw: RawSection[] = [...cueSections];
  for (const clip of sectionClips) {
    if (clip.start < start - EPS || clip.start >= end - EPS) continue;
    if (raw.some((s) => Math.abs(s.time - clip.start) < EPS)) continue;
    const p = parseLocator(clip.name.trim().startsWith('>') ? clip.name : `> ${clip.name}`);
    if (p.kind !== 'section') continue;
    raw.push({ parsed: p, time: clip.start, hasCue: false });
  }
  raw.sort((a, b) => a.time - b.time);

  let optional = false;
  const sections: Section[] = raw.map((s, i) => {
    if (s.parsed.flags.end) optional = true;
    const secEnd = i + 1 < raw.length ? raw[i + 1].time : end;
    return {
      id: `${id}#${i}`,
      title: s.parsed.title,
      raw: s.parsed.raw,
      start: s.time,
      end: secEnd,
      color: s.parsed.color,
      quickAccess: s.parsed.quickAccess,
      description: s.parsed.description,
      flags: s.parsed.flags,
      jumpTarget: s.parsed.jumpTarget,
      countIn: s.parsed.countIn,
      classes: s.parsed.classes,
      hasCue: s.hasCue,
      optional,
      duration: s.parsed.duration,
    };
  });

  const firstOptional = sections.find((s) => s.optional);
  const playEnd = firstOptional ? firstOptional.start : end;
  const computed = beatsToSeconds(playEnd - start, tempo);

  return {
    id,
    title: parsed.title,
    index,
    start,
    end,
    playEnd,
    endKind: endInfo?.kind ?? 'implicit',
    stopThen: endInfo?.then ?? 'default',
    stopBefore: parsed.stopBefore,
    description: parsed.description,
    color: parsed.color,
    classes: parsed.classes,
    tags: parsed.tags,
    noSong: parsed.noSong,
    transpose: parsed.transpose,
    duration: parsed.duration ?? computed,
    durationIsManual: parsed.duration !== undefined,
    sections,
    locator: parsed,
  };
}

export interface Location {
  /** Index into songs (arrangement order), -1 if outside any song. */
  songIndex: number;
  sectionIndex: number;
  /** 0..1 */
  songProgress: number;
  sectionProgress: number;
  /** Arrangement index of the next song after the playhead when outside a song. */
  nextSongIndex: number;
}

export function locate(songs: Song[], time: Beats): Location {
  const songIndex = songs.findIndex((s) => time >= s.start - EPS && time < s.end - EPS);
  if (songIndex < 0) {
    const nextSongIndex = songs.findIndex((s) => s.start > time);
    return { songIndex: -1, sectionIndex: -1, songProgress: 0, sectionProgress: 0, nextSongIndex };
  }
  const song = songs[songIndex];
  const sectionIndex = findLastIndex(song.sections, (s) => time >= s.start - EPS);
  const section = song.sections[sectionIndex];
  const span = song.playEnd - song.start;
  return {
    songIndex,
    sectionIndex,
    songProgress: span > 0 ? clamp01((time - song.start) / span) : 0,
    sectionProgress: section && section.end > section.start ? clamp01((time - section.start) / (section.end - section.start)) : 0,
    nextSongIndex: songIndex + 1 < songs.length ? songIndex + 1 : -1,
  };
}

/** Find a section in a song by title (case-insensitive), for `>>> Target`. */
export function findSectionByTitle(song: Song, title: string): Section | undefined {
  const t = title.trim().toLowerCase();
  return song.sections.find((s) => s.title.toLowerCase() === t);
}

function findLastIndex<T>(arr: T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

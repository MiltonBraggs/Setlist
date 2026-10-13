/**
 * Chord tracks: a MIDI track flagged `+CHORDS` whose clip names are chords.
 *
 *   clip "Am"            one chord for the whole clip
 *   clip "C-G-Am-F"      the clip is split evenly: a 1-bar 4/4 clip gives one chord per beat
 *   clip "C--G-"         an empty slot holds the previous chord (C for 2 beats, G for 2 beats)
 *
 * The chords show on the Lyrics page: above the words of lyric lines, as bar rows between lines,
 * and as a full chord chart.
 */
import { parseTrackName } from './notation.ts';
import { beatsPerBar } from './songs.ts';
import type { Beats, LiveClip, LiveTrack } from './types.ts';

export interface ChordEvent {
  id: string;
  chord: string;
  start: Beats;
  end: Beats;
}

export interface ChordTrack {
  id: string;
  title: string;
  attrs: string[];
  color?: string;
  events: ChordEvent[];
}

const EPS = 1e-6;

/** One clip's chords. Slots split the clip evenly; an empty slot extends the chord before it. */
export function parseChordClip(clip: Pick<LiveClip, 'id' | 'name' | 'start' | 'end'>): ChordEvent[] {
  const slots = clip.name.split('-').map((s) => s.trim());
  const len = (clip.end - clip.start) / slots.length;
  const events: ChordEvent[] = [];
  slots.forEach((chord, i) => {
    const start = clip.start + i * len;
    const end = clip.start + (i + 1) * len;
    const prev = events[events.length - 1];
    if (!chord) {
      if (prev) prev.end = end;
      return;
    }
    events.push({ id: `${clip.id}:${i}`, chord, start, end });
  });
  return events;
}

export function chordTracks(tracks: LiveTrack[]): ChordTrack[] {
  return tracks
    .map((t) => ({ t, p: parseTrackName(t.name) }))
    .filter(({ p }) => p.isChords)
    .map(({ t, p }) => ({
      id: t.id,
      title: p.title,
      attrs: p.attrs,
      color: p.color,
      events: [...(t.clips ?? [])].sort((a, b) => a.start - b.start).flatMap(parseChordClip),
    }));
}

/** Chords starting in [from, to). */
export function chordsBetween(events: ChordEvent[], from: Beats, to: Beats): ChordEvent[] {
  return events.filter((e) => e.start >= from - EPS && e.start < to - EPS);
}

/** The chord sounding at `time`, if any. */
export function chordAt(events: ChordEvent[], time: Beats): ChordEvent | undefined {
  let found: ChordEvent | undefined;
  for (const e of events) {
    if (e.start > time + EPS) break;
    if (time < e.end - EPS) found = e;
  }
  return found;
}

/**
 * Which word each chord sits over in a lyric line spanning [start, end) with `words` words.
 * Chords are placed by time; two chords never share a word while there are words left, and
 * chords that don't fit get an index past the last word (shown after the line).
 */
export function placeChords(times: Beats[], start: Beats, end: Beats, words: number): number[] {
  const span = end - start || 1;
  let next = 0;
  return times.map((t) => {
    const f = Math.max(0, Math.min(1, (t - start) / span));
    const want = Math.min(Math.max(0, words - 1), Math.floor(f * words + EPS));
    const at = Math.max(want, next);
    next = at + 1;
    return at;
  });
}

export interface ChordBar {
  start: Beats;
  end: Beats;
  /** Chords that start in this bar. */
  chords: ChordEvent[];
  /** The chord carried over from before the bar, when none starts on its downbeat. */
  held?: ChordEvent;
}

/** Bars from `from` to `to` (aligned to `from`) with the chords that start in each. */
export function chordBars(events: ChordEvent[], from: Beats, to: Beats, sigNum: number, sigDen: number): ChordBar[] {
  const bpb = beatsPerBar(sigNum, sigDen);
  const bars: ChordBar[] = [];
  for (let s = from; s < to - EPS; s += bpb) {
    const end = Math.min(to, s + bpb);
    const chords = chordsBetween(events, s, end);
    const startsOnDownbeat = chords.length > 0 && Math.abs(chords[0].start - s) < EPS;
    const held = startsOnDownbeat ? undefined : chordAt(events, s);
    bars.push({ start: s, end, chords, held });
  }
  return bars;
}

/** Title of a chord track's chart tab on the Lyrics page; " chart" is added if a lyrics track has the same title. */
export function chartTitle(chordTrack: ChordTrack, lyricsTitles: string[]): string {
  return lyricsTitles.includes(chordTrack.title) ? `${chordTrack.title} chart` : chordTrack.title;
}

/**
 * Part notes: instructions shown while the playhead is inside a clip.
 *
 *   Drums +NOTES       clips "Kick only", "Full beat"…   followed per device
 *   Band +NOTES:ALL    clips "STOP – only piano"…        shown on every device
 *
 * A section locator's `{description}` is also shown to everyone.
 */
import { parseLyricLine, type LyricLine } from './lyrics.ts';
import { parseTrackName } from './notation.ts';
import type { Section } from './songs.ts';
import type { Beats, LiveTrack } from './types.ts';

export interface NoteTrack {
  id: string;
  title: string;
  /** `+NOTES:ALL`: shown on every device. */
  everyone: boolean;
  color?: string;
  notes: LyricLine[];
}

export interface ActiveNote {
  trackTitle: string;
  everyone: boolean;
  color?: string;
  current?: LyricLine;
  next?: LyricLine;
  /** Whole bars until `next` starts, when it is close (≤ NEXT_NOTE_BARS); otherwise null. */
  barsToNext: number | null;
}

/** How far ahead an upcoming note is announced. */
export const NEXT_NOTE_BARS = 8;

const EPS = 1e-6;

export function noteTracks(tracks: LiveTrack[]): NoteTrack[] {
  const out: NoteTrack[] = [];
  for (const t of tracks) {
    const p = parseTrackName(t.name);
    if (!p.notes) continue;
    out.push({
      id: t.id,
      title: p.title,
      everyone: p.notes === 'all',
      color: p.color,
      notes: [...(t.clips ?? [])].sort((a, b) => a.start - b.start).map((c) => parseLyricLine(c.name, c.id, c.start, c.end)),
    });
  }
  return out;
}

/**
 * The current and upcoming note of each track at `time`.
 * `until` bounds the look-ahead (e.g. the current song's end) so the next song's notes aren't announced.
 */
export function activeNotes(tracks: NoteTrack[], time: Beats, beatsPerBar: number, until = Infinity): ActiveNote[] {
  return tracks.map((track) => {
    let current: LyricLine | undefined;
    let next: LyricLine | undefined;
    for (const note of track.notes) {
      if (note.start <= time + EPS && time < note.end - EPS) current = note;
      else if (note.start > time + EPS) {
        next = note;
        break;
      }
    }
    if (next && next.start >= until - EPS) next = undefined;
    const beats = next ? next.start - time : Infinity;
    const bars = Math.ceil(beats / beatsPerBar - EPS);
    return {
      trackTitle: track.title,
      everyone: track.everyone,
      color: track.color,
      current,
      next,
      barsToNext: next && bars <= NEXT_NOTE_BARS ? Math.max(1, bars) : null,
    };
  });
}

/** Section descriptions are notes for everyone. */
export function sectionNote(section: Section | undefined): string | undefined {
  return section?.description?.trim() || undefined;
}

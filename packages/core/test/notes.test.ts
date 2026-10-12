import { describe, expect, it } from 'vitest';
import { parseTrackName } from '../src/notation.ts';
import { activeNotes, noteTracks, sectionNote } from '../src/notes.ts';
import { buildSongs } from '../src/songs.ts';
import { DEMO, track } from './fixtures.ts';

const drums = track(1, 'Drums +NOTES [orange]', {
  clips: [
    { id: 'b', name: 'Full beat', start: 16, end: 32, color: 0 },
    { id: 'a', name: '**Kick** only', start: 0, end: 8, color: 0 },
  ],
});
const band = track(2, 'Band +NOTES:ALL', { clips: [{ id: 'c', name: 'STOP – only piano', start: 48, end: 56, color: 0 }] });

describe('notes', () => {
  it('parses the flags', () => {
    expect(parseTrackName('Drums +NOTES').notes).toBe('part');
    expect(parseTrackName('Band +NOTES:ALL').notes).toBe('all');
    expect(parseTrackName('Vocals +LYRICS').notes).toBe(false);
  });

  it('collects note tracks, sorted', () => {
    const tracks = noteTracks([drums, band, track(3, 'Bass')]);
    expect(tracks.map((t) => [t.title, t.everyone, t.color])).toEqual([
      ['Drums', false, 'orange'],
      ['Band', true, undefined],
    ]);
    expect(tracks[0].notes.map((n) => n.start)).toEqual([0, 16]);
  });

  it('finds the current and next note with a bar countdown', () => {
    const [d] = activeNotes(noteTracks([drums]), 2, 4);
    expect(d.current?.rows[0][0].text).toBe('**Kick** only');
    expect(d.next?.start).toBe(16);
    expect(d.barsToNext).toBe(4); // 14 beats -> 3.5 bars -> 4

    // Between notes: no current, next one bar away.
    const [gap] = activeNotes(noteTracks([drums]), 12, 4);
    expect(gap.current).toBeUndefined();
    expect(gap.barsToNext).toBe(1);

    // Far away: no countdown.
    const [far] = activeNotes(noteTracks([band]), 0, 4);
    expect(far.next?.start).toBe(48);
    expect(far.barsToNext).toBeNull();
  });

  it("doesn't announce notes past the song end", () => {
    const [d] = activeNotes(noteTracks([drums]), 9, 4, 12);
    expect(d.next).toBeUndefined();
    expect(d.barsToNext).toBeNull();
  });

  it('uses section descriptions as notes for everyone', () => {
    const songs = buildSongs(DEMO);
    expect(sectionNote(songs[0].sections[0])).toBeUndefined();
    expect(sectionNote({ ...songs[0].sections[0], description: ' STOP – only piano ' })).toBe('STOP – only piano');
  });
});

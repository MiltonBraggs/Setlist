import { describe, expect, it } from 'vitest';
import { chordAt, chordBars, chordTracks, parseChordClip, placeChords } from '../src/chords.ts';
import { parseTrackName } from '../src/notation.ts';
import { track } from './fixtures.ts';

const clip = (name: string, start: number, end: number, id = 'c') => ({ id, name, start, end, color: 0 });
const brief = (events: { chord: string; start: number; end: number }[]) => events.map((e) => [e.chord, e.start, e.end]);

describe('chord tracks', () => {
  it('recognises +CHORDS tracks', () => {
    expect(parseTrackName('Chords +CHORDS [+2]').isChords).toBe(true);
    expect(parseTrackName('Vocals +LYRICS').isChords).toBe(false);
  });

  it('one chord per clip', () => {
    expect(brief(parseChordClip(clip('Am', 8, 16)))).toEqual([['Am', 8, 16]]);
  });

  it('splits C-G-Am-F evenly: a 1-bar 4/4 clip gives one chord per beat', () => {
    expect(brief(parseChordClip(clip('C-G-Am-F', 0, 4)))).toEqual([
      ['C', 0, 1],
      ['G', 1, 2],
      ['Am', 2, 3],
      ['F', 3, 4],
    ]);
    // A 2-bar clip: two beats each, spaces allowed.
    expect(brief(parseChordClip(clip('C - G - Am - F', 0, 8)))).toEqual([
      ['C', 0, 2],
      ['G', 2, 4],
      ['Am', 4, 6],
      ['F', 6, 8],
    ]);
  });

  it('an empty slot holds the previous chord', () => {
    expect(brief(parseChordClip(clip('C--G-', 0, 4)))).toEqual([
      ['C', 0, 2],
      ['G', 2, 4],
    ]);
  });

  it('reads clips of +CHORDS tracks in time order', () => {
    const [t] = chordTracks([
      track(0, 'Vocals +LYRICS', { clips: [clip('Hello', 0, 4)] }),
      track(1, 'Chords +CHORDS', { clips: [clip('F', 4, 8, 'b'), clip('C-G', 0, 4, 'a')] }),
    ]);
    expect(t.title).toBe('Chords');
    expect(brief(t.events)).toEqual([
      ['C', 0, 2],
      ['G', 2, 4],
      ['F', 4, 8],
    ]);
    expect(new Set(t.events.map((e) => e.id)).size).toBe(3);
  });

  it('finds the chord sounding now', () => {
    const events = parseChordClip(clip('C-G', 0, 4));
    expect(chordAt(events, 0)?.chord).toBe('C');
    expect(chordAt(events, 2.5)?.chord).toBe('G');
    expect(chordAt(events, 4)).toBeUndefined();
  });

  it('places chords over words by time, never two on one word while words are left', () => {
    // Line of 4 words over beats 0-8.
    expect(placeChords([0, 4], 0, 8, 4)).toEqual([0, 2]);
    expect(placeChords([0, 0.5, 1], 0, 8, 4)).toEqual([0, 1, 2]);
    // More chords than words: the extras go after the line.
    expect(placeChords([0, 2, 4, 6], 0, 8, 2)).toEqual([0, 1, 2, 3]);
    // A pickup chord just before the line lands on the first word.
    expect(placeChords([-1], 0, 8, 4)).toEqual([0]);
  });

  it('groups chords into bars, marking held chords', () => {
    const events = [...parseChordClip(clip('C-G', 0, 4, 'a')), ...parseChordClip(clip('Am', 4, 12, 'b'))];
    const bars = chordBars(events, 0, 16, 4, 4);
    expect(bars.map((b) => b.chords.map((c) => c.chord))).toEqual([['C', 'G'], ['Am'], [], []]);
    expect(bars.map((b) => b.held?.chord)).toEqual([undefined, undefined, 'Am', undefined]);
  });
});

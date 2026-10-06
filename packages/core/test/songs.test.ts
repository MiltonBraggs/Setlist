import { describe, expect, it } from 'vitest';
import { buildSongs, formatDuration, locate } from '../src/songs.ts';
import { DEMO, snapshot, track } from './fixtures.ts';

describe('buildSongs', () => {
  const songs = buildSongs(DEMO);

  it('builds songs with ends and sections', () => {
    expect(songs.map((s) => s.title)).toEqual(['Opener', 'Ballad', 'Closer']);
    expect(songs.map((s) => s.id)).toEqual(['opener', 'ballad', 'closer']);
    expect(songs[0]).toMatchObject({ start: 0, end: 80, playEnd: 64, endKind: 'songEnd', color: 'red', description: 'Capo 2' });
    expect(songs[1]).toMatchObject({ start: 96, end: 160, endKind: 'stop', tags: ['slow'] });
    expect(songs[2]).toMatchObject({ start: 176, end: 240, stopBefore: true, duration: 300, durationIsManual: true });
  });

  it('computes durations from tempo and excludes +END sections', () => {
    // 64 beats at 120 bpm = 32 s
    expect(songs[0].duration).toBe(32);
    expect(songs[0].sections.map((s) => [s.title, s.start, s.end, s.optional])).toEqual([
      ['Intro', 0, 16, false],
      ['Verse', 16, 48, false],
      ['Chorus', 48, 64, false],
      ['Outro', 64, 80, true],
    ]);
  });

  it('creates unique ids for duplicate titles', () => {
    const s = buildSongs(snapshot([[0, 'Jam'], [32, 'Jam'], [64, 'Jam']]));
    expect(s.map((x) => x.id)).toEqual(['jam', 'jam-2', 'jam-3']);
  });

  it('uses the next song start as implicit end, and songLength for the last song', () => {
    const s = buildSongs(snapshot([[0, 'A'], [32, 'B']], [], { songLength: 100 }));
    expect(s[0]).toMatchObject({ end: 32, endKind: 'implicit' });
    expect(s[1]).toMatchObject({ end: 100, endKind: 'implicit' });
  });

  it('merges section clips, preferring locators', () => {
    const sectionsTrack = track(0, 'Sections', {
      clips: [
        { id: 'k0', name: 'Intro', start: 0, end: 4, color: 0 },
        { id: 'k1', name: 'Verse [c:1]', start: 16, end: 20, color: 0 },
        { id: 'k2', name: '>> Chorus', start: 32, end: 36, color: 0 },
      ],
    });
    const s = buildSongs(snapshot([[0, 'Song'], [16, '> Verse From Cue'], [64, 'SONG END']], [sectionsTrack]));
    expect(s[0].sections.map((x) => [x.title, x.hasCue, x.quickAccess])).toEqual([
      ['Intro', false, false],
      ['Verse From Cue', true, false],
      ['Chorus', false, true],
    ]);
  });

  it('ignores sections after an end locator and ignored locators', () => {
    const s = buildSongs(snapshot([[0, 'A'], [8, '* note to self'], [16, 'STOP'], [20, '> orphan']]));
    expect(s[0].sections).toEqual([]);
    expect(s[0].end).toBe(16);
  });
});

describe('locate', () => {
  const songs = buildSongs(DEMO);
  it('finds song and section', () => {
    expect(locate(songs, 20)).toMatchObject({ songIndex: 0, sectionIndex: 1 });
    expect(locate(songs, 20).songProgress).toBeCloseTo(20 / 64);
    expect(locate(songs, 20).sectionProgress).toBeCloseTo(4 / 32);
  });
  it('reports gaps between songs', () => {
    expect(locate(songs, 85)).toMatchObject({ songIndex: -1, nextSongIndex: 1 });
  });
});

describe('formatDuration', () => {
  it('formats', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3723)).toBe('1:02:03');
  });
});

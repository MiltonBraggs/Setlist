import { describe, expect, it } from 'vitest';
import { buildPlan, jumpTiming, silencePoints, songByOffset, sectionByOffset } from '../src/plan.ts';
import { buildSongs } from '../src/songs.ts';
import { DEMO, snapshot } from './fixtures.ts';

const songs = buildSongs(DEMO);
const order = ['opener', 'ballad', 'closer'];

describe('buildPlan', () => {
  it('builds events for the demo set', () => {
    const plan = buildPlan(songs, order, { autojumpNextSong: true });
    expect(plan.events).toEqual([
      // Opener: +END tail from 64, SONG END -> jump to Ballad
      { at: 64, type: 'jump', to: 96 },
      // Ballad: Intro >>> Chorus
      { at: 112, type: 'jump', to: 128 },
      // Ballad: STOP, and the next song has a '.' -> stop and relocate
      { at: 160, type: 'stop', relocate: 176 },
      // Closer: Solo +SKIP -> jump to End
      { at: 208, type: 'jump', to: 224 },
      // Closer: last song with SONG END -> stop
      { at: 240, type: 'stop', relocate: null },
    ]);
    expect(plan.loops).toEqual([{ start: 48, end: 64, count: 2, full: false }]);
  });

  it('respects autojump=false and setlist order', () => {
    const plan = buildPlan(songs, ['ballad', 'opener'], { autojumpNextSong: false });
    const at = (t: number) => plan.events.find((e) => e.at === t);
    // Opener is last in the setlist now -> SONG END stops.
    expect(at(64)).toEqual({ at: 64, type: 'stop', relocate: null });
    // Ballad STOP without autojump stays.
    expect(at(160)).toEqual({ at: 160, type: 'stop', relocate: null });
    // Closer is removed: its end goes to the next active song after it (none) -> stop.
    expect(at(240)).toEqual({ at: 240, type: 'stop', relocate: null });
  });

  it('jumps over removed songs', () => {
    const plan = buildPlan(songs, ['opener', 'closer'], { autojumpNextSong: true });
    // Closer has '.', so Opener's end stops and parks at Closer.
    expect(plan.events.find((e) => e.at === 64)).toEqual({ at: 64, type: 'stop', relocate: 176 });
  });
});

describe('navigation', () => {
  it('jumps by songs in setlist order', () => {
    expect(songByOffset({ songs, order, time: 20 }, 1)?.id).toBe('ballad');
    expect(songByOffset({ songs, order, time: 20 }, -1)?.id).toBe('opener');
    expect(songByOffset({ songs, order: ['closer', 'opener', 'ballad'], time: 20 }, -1)?.id).toBe('closer');
  });

  it('has no next song after the last one in the setlist', () => {
    expect(songByOffset({ songs, order, time: 200 }, 1)).toBeUndefined(); // in Closer, the last song
    expect(songByOffset({ songs, order: ['closer', 'opener'], time: 20 }, 1)).toBeUndefined();
    expect(songByOffset({ songs, order, time: 200 }, -1)?.id).toBe('ballad');
  });

  it('treats a parked playhead as after the finished song', () => {
    // Parked at Ballad's STOP locator (160), outside any song.
    expect(songByOffset({ songs, order, time: 160 }, 1)?.id).toBe('closer');
    expect(songByOffset({ songs, order, time: 160 }, -1)?.id).toBe('ballad');
  });

  it('jumps by sections', () => {
    expect(sectionByOffset({ songs, order, time: 20 }, 1)?.section.title).toBe('Chorus');
    expect(sectionByOffset({ songs, order, time: 20 }, -1)?.section.title).toBe('Intro');
    // Optional +END section is not a target from earlier sections
    expect(sectionByOffset({ songs, order, time: 50 }, 1)).toBeUndefined();
  });

  it('computes jump timing per mode', () => {
    const ctx = { songs, order, time: 20, isPlaying: true };
    const toSection = { kind: 'section' as const, songId: 'opener' };
    const toSong = { kind: 'song' as const, songId: 'ballad' };
    expect(jumpTiming({ ...ctx, isPlaying: false }, toSong, 'dynamic')).toEqual({ kind: 'instant' });
    expect(jumpTiming(ctx, toSong, 'quantized')).toEqual({ kind: 'quantized' });
    expect(jumpTiming(ctx, toSong, 'manual')).toEqual({ kind: 'hold' });
    expect(jumpTiming(ctx, toSong, 'endOfSection')).toEqual({ kind: 'at', at: 48 });
    expect(jumpTiming(ctx, toSection, 'endOfSong')).toEqual({ kind: 'at', at: 64 });
    expect(jumpTiming(ctx, toSection, 'dynamic')).toEqual({ kind: 'at', at: 48 });
    expect(jumpTiming(ctx, toSong, 'dynamic')).toEqual({ kind: 'at', at: 64 });
  });
});

describe('silencePoints', () => {
  const plan = buildPlan(songs, order, { autojumpNextSong: true });
  it('lists stop events', () => {
    expect(silencePoints(plan, null)).toEqual([160, 240]);
  });
  it('drops a stop overridden by a queued jump at the same boundary', () => {
    expect(silencePoints(plan, 160)).toEqual([240]);
    expect(silencePoints(plan, 64)).toEqual([160, 240]);
  });
});

describe('metronome sections (emergency click)', () => {
  // A: Intro 0, Chorus 16, Metronome 32..36 (last, before the STOP at 36). B: a mid-song metronome.
  const set = buildSongs(
    snapshot([
      [0, 'Alpha'],
      [0, '> Intro'],
      [16, '> Chorus'],
      [32, '> Metronome +METRONOME'],
      [36, 'STOP'],
      [40, 'Beta'],
      [40, '> Verse'],
      [56, '> Click +METRO'],
      [60, '> Outro'],
      [76, 'SONG END'],
    ]),
  );
  const [alpha, beta] = set;
  const ids = ['alpha', 'beta'];

  it('is recognised by +METRONOME / +METRO, and the song ends where a trailing one starts', () => {
    expect(alpha.sections.map((s) => [s.title, s.metronome])).toEqual([
      ['Intro', false],
      ['Chorus', false],
      ['Metronome', true],
    ]);
    expect(beta.sections[1]).toMatchObject({ title: 'Click', metronome: true });
    expect(alpha.playEnd).toBe(32);
    expect(beta.playEnd).toBe(76); // a mid-song metronome doesn't end the song
  });

  it('is never played in the normal flow, and loops once you are in it', () => {
    const plan = buildPlan(set, ids, { autojumpNextSong: true });
    // Alpha's STOP happens at the end of the Chorus and parks at Beta; Beta steps over its Click.
    expect(plan.events).toContainEqual({ at: 32, type: 'stop', relocate: 40 });
    expect(plan.events).toContainEqual({ at: 56, type: 'jump', to: 60 });
    expect(plan.loops).toEqual([
      { start: 32, end: 36, count: null, full: false },
      { start: 56, end: 60, count: null, full: false },
    ]);
  });

  it('stays inside its song when written without the > (as "Metronome +METRONOME")', () => {
    const [only, ...rest] = buildSongs(
      snapshot([
        [0, 'Alpha'],
        [0, '> Intro'],
        [16, '> Chorus'],
        [32, 'Metronome +METRONOME'],
        [36, 'STOP'],
      ]),
    );
    expect(rest).toEqual([]); // no extra song named "Metronome"
    expect(only.sections.map((s) => [s.title, s.metronome])).toEqual([
      ['Intro', false],
      ['Chorus', false],
      ['Metronome', true],
    ]);
    expect(only).toMatchObject({ end: 36, playEnd: 32, endKind: 'stop' });
  });

  it('is skipped by next / previous section', () => {
    expect(sectionByOffset({ songs: set, order: ids, time: 20 }, 1)).toBeUndefined(); // Chorus is Alpha's last
    expect(sectionByOffset({ songs: set, order: ids, time: 44 }, 1)?.section.title).toBe('Outro');
  });

  it('is left at the next bar, whatever the jump mode', () => {
    const ctx = { songs: set, order: ids, time: 33, isPlaying: true };
    expect(jumpTiming(ctx, { kind: 'section', songId: 'alpha' }, 'dynamic')).toEqual({ kind: 'quantized' });
    expect(jumpTiming(ctx, { kind: 'song', songId: 'beta' }, 'endOfSong')).toEqual({ kind: 'quantized' });
  });
});

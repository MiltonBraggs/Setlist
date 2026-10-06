import { describe, expect, it } from 'vitest';
import { buildPlan, jumpTiming, songByOffset, sectionByOffset } from '../src/plan.ts';
import { buildSongs } from '../src/songs.ts';
import { DEMO } from './fixtures.ts';

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

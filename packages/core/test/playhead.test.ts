import { describe, expect, it } from 'vitest';
import { PlayheadClock } from '../src/playhead.ts';

// 120 bpm: 2 beats per second, i.e. 0.002 beats per ms.
const TEMPO = 120;

describe('PlayheadClock', () => {
  it('shows the playhead ahead by the network delay', () => {
    const c = new PlayheadClock();
    c.latency = 0.1; // 100 ms one way
    c.receive(10, true, TEMPO, 0);
    expect(c.at(0, TEMPO)).toBeCloseTo(10.2); // the frame was already 100 ms old
    expect(c.at(250, TEMPO)).toBeCloseTo(10.7);
  });

  it('smooths a late frame instead of stepping back', () => {
    const c = new PlayheadClock();
    c.receive(10, true, TEMPO, 0);
    expect(c.at(100, TEMPO)).toBeCloseTo(10.2);
    // Wi-Fi held a frame back: it arrives at 150 ms carrying the time of 50 ms.
    c.receive(10.1, true, TEMPO, 150);
    const shown = [150, 160, 200, 300].map((ms) => c.at(ms, TEMPO));
    for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeGreaterThanOrEqual(shown[i - 1]);
    expect(shown[0]).toBeGreaterThanOrEqual(10.2); // never back to where it already was
  });

  it('settles on the right position after a few frames', () => {
    const c = new PlayheadClock();
    c.receive(10, true, TEMPO, 0);
    // Frames say the playhead is 0.2 beats further than extrapolated (e.g. tempo drift).
    for (let ms = 100; ms <= 1000; ms += 100) c.receive(10 + ms * 0.002 + 0.2, true, TEMPO, ms);
    expect(c.at(1000, TEMPO)).toBeCloseTo(12.2, 1);
  });

  it('shows jumps, starts and stops at once', () => {
    const c = new PlayheadClock();
    c.receive(10, true, TEMPO, 0);
    c.receive(64, true, TEMPO, 100); // jump to the next song
    expect(c.at(100, TEMPO)).toBeCloseTo(64);
    c.receive(8, true, TEMPO, 200); // jump back (loop wrap)
    expect(c.at(200, TEMPO)).toBeCloseTo(8);
    c.receive(8.5, false, TEMPO, 300); // stopped: exactly where Live stopped
    expect(c.at(900, TEMPO)).toBe(8.5);
  });

  it('stops moving after a second without frames', () => {
    const c = new PlayheadClock();
    c.receive(10, true, TEMPO, 0);
    expect(c.at(5000, TEMPO)).toBeCloseTo(12);
  });
});

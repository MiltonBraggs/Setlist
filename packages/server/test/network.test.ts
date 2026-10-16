import { describe, expect, it } from 'vitest';
import { deviceLabel, FrameThrottle, RttTracker } from '../src/network.ts';

describe('FrameThrottle (playhead frames to devices)', () => {
  // 120 bpm: 2 beats per second.
  it('thins steady playback to one frame per 100 ms', () => {
    const f = new FrameThrottle(100);
    const sent = [0, 33, 66, 100, 133, 166, 200].filter((ms) => f.shouldSend(10 + (ms / 1000) * 2, true, 120, ms));
    expect(sent).toEqual([0, 100, 200]);
  });

  it('sends jumps, loop wraps, start and stop at once', () => {
    const f = new FrameThrottle(100);
    expect(f.shouldSend(10, true, 120, 0)).toBe(true);
    expect(f.shouldSend(40, true, 120, 33)).toBe(true); // jump forward
    expect(f.shouldSend(8, true, 120, 66)).toBe(true); // loop wrap / jump back
    expect(f.shouldSend(8.1, false, 120, 80)).toBe(true); // stop
    expect(f.shouldSend(8.1, true, 120, 90)).toBe(true); // start
  });

  it('sends moves while stopped, but not the same position again', () => {
    const f = new FrameThrottle(100);
    expect(f.shouldSend(4, false, 120, 0)).toBe(true);
    expect(f.shouldSend(4, false, 120, 10)).toBe(false);
    expect(f.shouldSend(36, false, 120, 20)).toBe(true); // picked another song
  });
});

describe('RttTracker', () => {
  it('reports the median of recent checks and the worst one', () => {
    const r = new RttTracker();
    for (const [i, ms] of [20, 25, 400, 22, 24].entries()) r.add(ms, i * 2000);
    expect(r.current(8000)).toBe(24); // one slow check doesn't swing it
    expect(r.worst()).toBe(400);
  });

  it('reports nothing once the device stops answering', () => {
    const r = new RttTracker();
    r.add(30, 0);
    expect(r.current(5000)).toBe(30);
    expect(r.current(7000)).toBeNull();
  });
});

describe('deviceLabel', () => {
  it('names common devices', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe(
      'iPhone · Safari',
    );
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36')).toBe('Android phone · Chrome');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Windows · Edge');
    expect(deviceLabel(undefined)).toBe('Device · Browser');
  });
});

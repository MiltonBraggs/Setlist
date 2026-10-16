import type { Beats } from './types.ts';

/** A frame further than this from where the playhead should be is a real jump: show it at once. */
const SNAP_BEATS = 0.5;
/** Share of a small error corrected per frame: Wi-Fi jitter is smoothed out instead of shown. */
const BLEND = 0.3;
/** Keep moving for at most this long without frames (Wi-Fi stall), then wait for the next one. */
const MAX_EXTRAPOLATE_S = 1;

/**
 * Where Live's playhead is *now*, on a device whose playhead frames arrive late and unevenly over
 * Wi-Fi: frames are moved ahead by the device's measured network delay, small errors are blended in
 * over a few frames, and the shown position never steps back by a fraction of a beat (which would
 * make lyrics and section highlights flicker). Real jumps, starts and stops show at once.
 */
export class PlayheadClock {
  /** One-way network delay in seconds (half the measured round trip). */
  latency = 0;
  private anchorTime: Beats = 0;
  private anchorAt = 0;
  private playing = false;
  private lastShown = -Infinity;

  /** A playhead frame arrived (`now` in ms). */
  receive(time: Beats, playing: boolean, tempo: number, now: number) {
    const actual = playing ? time + (this.latency * tempo) / 60 : time;
    if (playing && this.playing) {
      const predicted = this.estimate(now, tempo);
      const error = actual - predicted;
      if (Math.abs(error) > SNAP_BEATS) {
        this.anchorTime = actual;
        this.lastShown = -Infinity;
      } else {
        this.anchorTime = predicted + error * BLEND;
      }
    } else {
      this.anchorTime = actual;
      this.lastShown = -Infinity;
    }
    this.anchorAt = now;
    this.playing = playing;
  }

  /** The playhead to show at `now` (ms). */
  at(now: number, tempo: number): Beats {
    if (!this.playing) return this.anchorTime;
    const t = this.estimate(now, tempo);
    if (t < this.lastShown && this.lastShown - t < SNAP_BEATS) return this.lastShown;
    this.lastShown = t;
    return t;
  }

  private estimate(now: number, tempo: number): Beats {
    if (!this.playing) return this.anchorTime;
    const elapsed = Math.min(Math.max(0, now - this.anchorAt) / 1000, MAX_EXTRAPOLATE_S);
    return this.anchorTime + (elapsed * tempo) / 60;
  }
}

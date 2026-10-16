/** Network health and traffic shaping for the devices on the band's Wi-Fi. */

/** Round-trip times of one device's delay checks (every 2 s): the median for display and compensation. */
export class RttTracker {
  private samples: number[] = [];
  private lastAnswer = 0;

  constructor(private readonly keep = 30) {}

  add(rtt: number, now = Date.now()) {
    if (!Number.isFinite(rtt) || rtt < 0) return;
    this.samples.push(rtt);
    if (this.samples.length > this.keep) this.samples.shift();
    this.lastAnswer = now;
  }

  /** Median of the last 5 checks; null when the device stopped answering (6 s). */
  current(now = Date.now()): number | null {
    if (!this.samples.length || now - this.lastAnswer > 6000) return null;
    const recent = [...this.samples.slice(-5)].sort((a, b) => a - b);
    return Math.round(recent[Math.floor(recent.length / 2)]);
  }

  /** Worst round trip of the kept checks (about the last minute). */
  worst(): number | null {
    return this.samples.length ? Math.round(Math.max(...this.samples)) : null;
  }
}

/**
 * Playhead frames to the devices: during steady playback at most one every `intervalMs` (devices
 * fill in the motion themselves), but anything else - start, stop, a jump, a loop wrap, a move while
 * stopped - goes out at once.
 */
export class FrameThrottle {
  private last: { time: number; playing: boolean; at: number } | null = null;

  constructor(
    private readonly intervalMs = 100,
    /** A frame further than this from where steady playback would be is a jump. */
    private readonly jumpBeats = 0.25,
  ) {}

  shouldSend(time: number, playing: boolean, tempo: number, now = Date.now()): boolean {
    const last = this.last;
    if (last && playing && last.playing) {
      const expected = last.time + ((now - last.at) / 1000) * (tempo / 60);
      const steady = Math.abs(time - expected) < this.jumpBeats;
      if (steady && now - last.at < this.intervalMs) return false;
    } else if (last && !playing && !last.playing && Math.abs(time - last.time) < 1e-6) {
      return false; // stopped and not moved
    }
    this.last = { time, playing, at: now };
    return true;
  }
}

/** A short device name from its browser's user agent, e.g. "iPad · Safari". */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const device = /iPad/.test(ua)
    ? 'iPad'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? 'Android phone'
          : 'Android tablet'
        : /Macintosh/.test(ua)
          ? // iPadOS asks for desktop pages and says "Macintosh"; touch support gives it away in the page, not here.
            'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /(CriOS|Chrome)\//.test(ua)
      ? 'Chrome'
      : /(FxiOS|Firefox)\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  return `${device} · ${browser}`;
}

import { findSectionByTitle, locate, type Section, type Song } from './songs.ts';
import type { Beats, JumpMode, Settings } from './types.ts';

/**
 * Events the Remote Script executes when the playhead *crosses* `at` during normal
 * forward playback. Executing them inside Live keeps them independent of network latency.
 */
export type PlanEvent =
  | { at: Beats; type: 'stop'; relocate: Beats | null }
  | { at: Beats; type: 'jump'; to: Beats };

export interface PlanLoop {
  start: Beats;
  end: Beats;
  /** null = loop until escaped */
  count: number | null;
  full: boolean;
}

export interface PlaybackPlan {
  events: PlanEvent[];
  loops: PlanLoop[];
}

const EPS = 1e-6;

/** Next active (non-removed) song after `song` in the setlist. */
export function nextActiveSong(song: Song, songs: Song[], order: string[]): Song | undefined {
  const byId = new Map(songs.map((s) => [s.id, s]));
  const pos = order.indexOf(song.id);
  if (pos >= 0) return pos + 1 < order.length ? byId.get(order[pos + 1]) : undefined;
  // Removed song: continue with the first active song after it in the arrangement.
  return songs.find((s) => s.index > song.index && order.includes(s.id));
}

export function buildPlan(songs: Song[], order: string[], settings: Pick<Settings, 'autojumpNextSong'>): PlaybackPlan {
  const events = new Map<number, PlanEvent>();
  const loops: PlanLoop[] = [];
  const add = (e: PlanEvent) => {
    const key = Math.round(e.at * 1000);
    if (!events.has(key)) events.set(key, e);
  };

  const songEndEvent = (song: Song, at: Beats, kind: Song['endKind'], then: Song['stopThen']) => {
    const next = nextActiveSong(song, songs, order);
    const autojump = then === 'jump' || (then === 'default' && settings.autojumpNextSong);
    if (kind === 'stop') {
      add({ at, type: 'stop', relocate: autojump && next ? next.start : null });
    } else if (next?.stopBefore) {
      add({ at, type: 'stop', relocate: settings.autojumpNextSong ? next.start : null });
    } else if (!next) {
      if (kind === 'songEnd') add({ at, type: 'stop', relocate: null });
    } else if (Math.abs(next.start - at) > EPS) {
      add({ at, type: 'jump', to: next.start });
    }
  };

  // Section-level events first so they win over song ends at the same time.
  for (const song of songs) {
    const playable = song.sections.filter((s) => !s.optional);
    playable.forEach((sec, i) => {
      if (sec.flags.skip) {
        const target = playable.slice(i + 1).find((s) => !s.flags.skip);
        if (target) add({ at: sec.start, type: 'jump', to: target.start });
        else songEndEvent(song, sec.start, song.endKind, song.stopThen);
      }
      if (sec.flags.pause) add({ at: sec.start, type: 'stop', relocate: null });
      if (sec.flags.stop) {
        const next = nextActiveSong(song, songs, order);
        const t = sec.flags.stop.then;
        const autojump = t === 'jump' || (t === 'default' && settings.autojumpNextSong);
        add({ at: sec.start, type: 'stop', relocate: autojump && next ? next.start : null });
      }
      if (sec.jumpTarget) {
        if (sec.jumpTarget.toUpperCase() === 'SONG END') {
          songEndEvent(song, sec.end, song.endKind === 'stop' ? 'stop' : 'songEnd', song.stopThen);
        } else {
          const target = findSectionByTitle(song, sec.jumpTarget);
          if (target) add({ at: Math.min(sec.end, song.playEnd), type: 'jump', to: target.start });
        }
      }
      if (sec.flags.loop) {
        loops.push({ start: sec.start, end: sec.end, count: sec.flags.loop.count, full: sec.flags.loop.full });
      }
    });
  }
  for (const song of songs) songEndEvent(song, song.playEnd, song.endKind, song.stopThen);

  // Resolve jump chains (e.g. a jump that lands on a +SKIP section start).
  const jumpAt = new Map<number, Beats>();
  for (const e of events.values()) if (e.type === 'jump') jumpAt.set(Math.round(e.at * 1000), e.to);
  const resolve = (to: Beats) => {
    for (let i = 0; i < 16; i++) {
      const next = jumpAt.get(Math.round(to * 1000));
      if (next === undefined) break;
      to = next;
    }
    return to;
  };
  const resolved = [...events.values()].map((e): PlanEvent =>
    e.type === 'jump' ? { ...e, to: resolve(e.to) } : e.relocate === null ? e : { ...e, relocate: resolve(e.relocate) },
  );

  return { events: resolved.sort((a, b) => a.at - b.at), loops };
}

// ---------------------------------------------------------------------------
// Navigation

export interface NavContext {
  songs: Song[];
  order: string[];
  time: Beats;
}

/** Song the playhead is in, or the song that just ended (when parked at a stop locator). */
export function referenceSong(ctx: NavContext): Song | undefined {
  const loc = locate(ctx.songs, ctx.time);
  if (loc.songIndex >= 0) return ctx.songs[loc.songIndex];
  let last: Song | undefined;
  for (const s of ctx.songs) if (s.end <= ctx.time + EPS) last = s;
  return last;
}

/** Target of "jump by N songs" in setlist order. */
export function songByOffset(ctx: NavContext, offset: number): Song | undefined {
  const byId = new Map(ctx.songs.map((s) => [s.id, s]));
  const loc = locate(ctx.songs, ctx.time);
  const ref = referenceSong(ctx);
  if (!ref) return byId.get(ctx.order[offset > 0 ? offset - 1 : 0]);

  let pos = ctx.order.indexOf(ref.id);
  if (pos < 0) {
    // Not in the setlist: position relative to the next active song in the arrangement.
    const after = ctx.songs.find((s) => s.index > ref.index && ctx.order.includes(s.id));
    pos = after ? ctx.order.indexOf(after.id) - (offset > 0 ? 1 : 0) : ctx.order.length;
  } else if (loc.songIndex < 0 && offset < 0) {
    // Parked after a song: "previous" means the song that just ended.
    pos += 1;
  }
  const target = Math.max(0, Math.min(ctx.order.length - 1, pos + offset));
  return byId.get(ctx.order[target]);
}

/** Target of "jump by N sections" within the current song (crossing into neighbours). */
export function sectionByOffset(ctx: NavContext, offset: number): { song: Song; section: Section } | undefined {
  const loc = locate(ctx.songs, ctx.time);
  if (loc.songIndex < 0) {
    const song = songByOffset(ctx, 1);
    return song?.sections[0] ? { song, section: song.sections[0] } : undefined;
  }
  const song = ctx.songs[loc.songIndex];
  const playable = song.sections.filter((s) => !s.optional || s.start <= ctx.time);
  const curIdx = playable.findIndex((s) => s.id === song.sections[loc.sectionIndex]?.id);
  const idx = curIdx + offset;
  if (idx >= 0 && idx < playable.length) return { song, section: playable[idx] };
  return undefined;
}

export type JumpTiming =
  | { kind: 'instant' }
  /** Let Live quantize with its global quantization. */
  | { kind: 'quantized' }
  /** Execute at an arrangement position (section/song boundary). */
  | { kind: 'at'; at: Beats }
  /** Manual mode while playing: wait until playback stops. */
  | { kind: 'hold' };

/** When should a queued jump to `target` happen, given the jump mode? */
export function jumpTiming(
  ctx: NavContext & { isPlaying: boolean },
  target: { kind: 'song' | 'section'; songId: string },
  mode: JumpMode,
): JumpTiming {
  if (!ctx.isPlaying) return { kind: 'instant' };
  const loc = locate(ctx.songs, ctx.time);
  const song = loc.songIndex >= 0 ? ctx.songs[loc.songIndex] : undefined;
  const section = song?.sections[loc.sectionIndex];
  const sectionEnd = section ? Math.min(section.end, song!.playEnd) : song?.sections.find((s) => s.start > ctx.time)?.start ?? song?.playEnd;

  switch (mode) {
    case 'quantized':
      return { kind: 'quantized' };
    case 'manual':
      return { kind: 'hold' };
    case 'endOfSection':
      return sectionEnd !== undefined ? { kind: 'at', at: sectionEnd } : { kind: 'quantized' };
    case 'endOfSong':
      return song ? { kind: 'at', at: song.playEnd } : { kind: 'quantized' };
    case 'dynamic':
      if (!song) return { kind: 'quantized' };
      if (target.kind === 'section' && target.songId === song.id && sectionEnd !== undefined) return { kind: 'at', at: sectionEnd };
      return { kind: 'at', at: song.playEnd };
  }
}

/** Which loop (if any) covers the section at `time`. */
export function loopAt(plan: PlaybackPlan, time: Beats): PlanLoop | undefined {
  return plan.loops.find((l) => time >= l.start - EPS && time < l.end - EPS);
}

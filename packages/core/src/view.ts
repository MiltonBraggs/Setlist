import { songByOffset, sectionByOffset } from './plan.ts';
import type { QueuedJump } from './protocol.ts';
import { activeOrder, type Setlist } from './setlist.ts';
import { beatsToSeconds, locate, type Location, type Section, type Song } from './songs.ts';
import type { Beats } from './types.ts';

export interface PlayView {
  loc: Location;
  song?: Song;
  section?: Section;
  nextSection?: Section;
  nextSong?: Song;
  /** 0-based index into the active setlist order, -1 if the song isn't in it. */
  setlistIndex: number;
  /** 1-based song number, ignoring [nosong] songs; 0 if none. */
  songNumber: number;
  songCount: number;
  /** seconds */
  songElapsed: number;
  songRemaining: number;
  setRemaining: number;
  queuedSong?: Song;
  queuedSection?: Section;
}

export function playView(songs: Song[], setlist: Setlist, time: Beats, tempo: number, queued: QueuedJump | null): PlayView {
  const order = activeOrder(setlist);
  const byId = new Map(songs.map((s) => [s.id, s]));
  const loc = locate(songs, time);
  const song = songs[loc.songIndex];
  const section = song?.sections[loc.sectionIndex];
  const ctx = { songs, order, time };
  const next = sectionByOffset(ctx, 1);
  const nextSection = next && next.song.id === song?.id ? next.section : undefined;
  const nextSong = song || songs.length ? songByOffset(ctx, 1) : undefined;
  const setlistIndex = song ? order.indexOf(song.id) : -1;

  const counted = order.map((id) => byId.get(id)).filter((s): s is Song => !!s && !s.noSong);
  const songNumber = song && !song.noSong ? counted.findIndex((s) => s.id === song.id) + 1 : 0;

  let songElapsed = 0;
  let songRemaining = 0;
  if (song) {
    songElapsed = beatsToSeconds(Math.max(0, time - song.start), tempo);
    const computedTotal = beatsToSeconds(song.playEnd - song.start, tempo);
    // With a manual duration, scale elapsed time onto it.
    songRemaining = song.durationIsManual
      ? Math.max(0, song.duration * (1 - songElapsed / Math.max(computedTotal, 1e-9)))
      : Math.max(0, beatsToSeconds(song.playEnd - time, tempo));
  }
  const fromIdx = song && setlistIndex >= 0 ? setlistIndex + 1 : nextSong ? order.indexOf(nextSong.id) : order.length;
  let setRemaining = songRemaining;
  for (const id of order.slice(Math.max(0, fromIdx))) setRemaining += byId.get(id)?.duration ?? 0;

  const queuedSong = queued ? byId.get(queued.songId) : undefined;
  const queuedSection = queued?.sectionId ? queuedSong?.sections.find((s) => s.id === queued.sectionId) : undefined;

  return {
    loc,
    song,
    section,
    nextSection,
    nextSong: nextSong && nextSong.id !== song?.id ? nextSong : undefined,
    setlistIndex,
    songNumber,
    songCount: counted.length,
    songElapsed,
    songRemaining,
    setRemaining,
    queuedSong,
    queuedSection,
  };
}

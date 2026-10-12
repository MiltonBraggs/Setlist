import { describe, expect, it } from 'vitest';
import {
  activeOrder,
  createSetlist,
  matchSong,
  reconcileSetlist,
  searchSongs,
  setlistFromText,
  setlistToText,
  summarizeSetlist,
  type Setlist,
} from '../src/setlist.ts';
import { buildSongs } from '../src/songs.ts';
import { DEMO } from './fixtures.ts';

const songs = buildSongs(DEMO);

describe('setlists', () => {
  it('adds new songs as active to an auto-add setlist', () => {
    const all: Setlist = { id: 'a', name: 'All songs', autoAdd: true, entries: [{ songId: 'closer' }, { songId: 'gone' }] };
    const s = reconcileSetlist(all, songs);
    expect(s.entries).toEqual([{ songId: 'closer' }, { songId: 'opener' }, { songId: 'ballad' }]);
    expect(activeOrder(s)).toEqual(['closer', 'opener', 'ballad']);
  });

  it('adds new songs as removed to a picked setlist', () => {
    const gig: Setlist = { id: 'g', name: 'Gig', entries: [{ songId: 'closer' }, { songId: 'opener', removed: true }] };
    const s = reconcileSetlist(gig, songs);
    expect(s.entries.map((e) => [e.songId, !!e.removed])).toEqual([
      ['closer', false],
      ['opener', true],
      ['ballad', true],
    ]);
    expect(activeOrder(s)).toEqual(['closer']);
    expect(s.id).toBe('g');
  });

  it('drops duplicate entries', () => {
    const s = reconcileSetlist({ id: 'x', name: 'x', entries: [{ songId: 'ballad' }, { songId: 'ballad', removed: true }] }, songs);
    expect(s.entries.filter((e) => e.songId === 'ballad')).toEqual([{ songId: 'ballad' }]);
  });

  it('creates a setlist from picked songs, in pick order', () => {
    const s = createSetlist('n1', 'Friday', ['closer', 'opener', 'closer', 'nope'], songs);
    expect(s).toMatchObject({ id: 'n1', name: 'Friday', autoAdd: false });
    expect(activeOrder(s)).toEqual(['closer', 'opener']);
    expect(s.entries).toContainEqual({ songId: 'ballad', removed: true });
  });

  it('summarizes setlists', () => {
    const s = createSetlist('n1', 'Friday', ['opener', 'ballad'], songs);
    const sum = summarizeSetlist(s, songs);
    expect(sum).toMatchObject({ id: 'n1', name: 'Friday', songCount: 2 });
    expect(sum.duration).toBeCloseTo(songs[0].duration + songs[1].duration);
  });

  it('fuzzy matches titles', () => {
    expect(matchSong('the ballad', songs)?.id).toBeUndefined();
    expect(matchSong('balad', songs)?.id).toBe('ballad');
    expect(matchSong('OPENER!', songs)?.id).toBe('opener');
    expect(matchSong('Clos', songs)?.id).toBe('closer');
  });

  it('round-trips the text format, listing each song once', () => {
    const { entries, unmatched } = setlistFromText('1. Closer\n-- Talk to crowd --\nOpener {Capo 3}\nNot A Song\nCloser', songs);
    expect(unmatched).toEqual(['Not A Song']);
    expect(entries).toEqual([
      { songId: 'closer' },
      { songId: 'opener', description: 'Capo 3', stopDescription: 'Talk to crowd' },
      { songId: 'ballad', removed: true },
    ]);
    expect(setlistToText({ id: 't', name: 'Tour', entries }, songs)).toBe('Closer\n-- Talk to crowd --\nOpener {Capo 3}');
  });

  it('searches by tag and initials', () => {
    expect(searchSongs('#slow', songs).map((s) => s.id)).toEqual(['ballad']);
    expect(searchSongs('cap', songs).map((s) => s.id)).toEqual(['opener']);
  });
});

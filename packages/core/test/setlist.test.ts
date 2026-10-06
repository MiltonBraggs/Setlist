import { describe, expect, it } from 'vitest';
import { activeOrder, matchSong, reconcileSetlist, searchSongs, setlistFromText, setlistToText } from '../src/setlist.ts';
import { buildSongs } from '../src/songs.ts';
import { DEMO } from './fixtures.ts';

const songs = buildSongs(DEMO);

describe('setlists', () => {
  it('reconciles with current songs', () => {
    const s = reconcileSetlist({ name: 'Gig', entries: [{ songId: 'closer' }, { songId: 'gone' }, { songId: 'opener', removed: true }] }, songs);
    expect(s.entries.map((e) => e.songId)).toEqual(['closer', 'opener', 'ballad']);
    expect(activeOrder(s)).toEqual(['closer', 'ballad']);
  });

  it('fuzzy matches titles', () => {
    expect(matchSong('the ballad', songs)?.id).toBeUndefined();
    expect(matchSong('balad', songs)?.id).toBe('ballad');
    expect(matchSong('OPENER!', songs)?.id).toBe('opener');
    expect(matchSong('Clos', songs)?.id).toBe('closer');
  });

  it('round-trips the text format', () => {
    const { setlist, unmatched } = setlistFromText('1. Closer\n-- Talk to crowd --\nOpener {Capo 3}\nNot A Song', songs, 'Tour');
    expect(unmatched).toEqual(['Not A Song']);
    expect(setlist.entries).toEqual([
      { songId: 'closer' },
      { songId: 'opener', description: 'Capo 3', stopDescription: 'Talk to crowd' },
      { songId: 'ballad', removed: true },
    ]);
    expect(setlistToText(setlist, songs)).toBe('Closer\n-- Talk to crowd --\nOpener {Capo 3}');
  });

  it('searches by tag and initials', () => {
    expect(searchSongs('#slow', songs).map((s) => s.id)).toEqual(['ballad']);
    expect(searchSongs('cap', songs).map((s) => s.id)).toEqual(['opener']);
  });
});

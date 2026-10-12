import { describe, expect, it } from 'vitest';
import {
  ACTION_CAPABILITY,
  DEFAULT_VIEWER_PERMISSIONS,
  canDispatch,
  canSeeLyricsTrack,
  canSeePage,
  normalizeViewerPermissions,
  type ViewerPermissions,
} from '../src/access.ts';

const viewer = DEFAULT_VIEWER_PERMISSIONS;
const drummer: ViewerPermissions = { ...viewer, transport: true };

describe('access', () => {
  it('lets the owner do everything', () => {
    for (const action of [...Object.keys(ACTION_CAPABILITY), 'updateSettings', 'setTrack', 'toggleLock', 'somethingNew']) {
      expect(canDispatch('owner', viewer, action), action).toBe(true);
    }
    expect(canSeePage('owner', viewer, 'settings')).toBe(true);
  });

  it('gives default viewers read-only access', () => {
    for (const action of ['play', 'go', 'nextSong', 'jumpToSong', 'setSetlist', 'mixerGroup']) {
      expect(canDispatch('viewer', viewer, action), action).toBe(false);
    }
    expect(canDispatch('viewer', viewer, 'clearNotification')).toBe(true);
  });

  it('keeps owner-only actions owner-only whatever the profile', () => {
    const everything: ViewerPermissions = { ...viewer, transport: true, navigate: true, editSetlist: true, mixer: true };
    for (const action of ['updateSettings', 'setTrack', 'toggleLock', 'midiLearn', 'notify', 'placeSectionLocators', 'unknownAction']) {
      expect(canDispatch('viewer', everything, action), action).toBe(false);
    }
  });

  it('grants capabilities individually', () => {
    expect(canDispatch('viewer', drummer, 'go')).toBe(true);
    expect(canDispatch('viewer', drummer, 'play')).toBe(true);
    expect(canDispatch('viewer', drummer, 'nextSong')).toBe(false);
    expect(canDispatch('viewer', { ...viewer, navigate: true }, 'jumpToSection')).toBe(true);
    expect(canDispatch('viewer', { ...viewer, editSetlist: true }, 'saveSetlist')).toBe(true);
    expect(canDispatch('viewer', { ...viewer, mixer: true }, 'mixerGroup')).toBe(true);
  });

  it('controls pages and lyrics tracks', () => {
    expect(canSeePage('viewer', viewer, 'lyrics')).toBe(true);
    expect(canSeePage('viewer', viewer, 'mixer')).toBe(false);
    expect(canSeePage('viewer', { ...viewer, pages: { ...viewer.pages, mixer: true } }, 'mixer')).toBe(true);
    expect(canSeePage('viewer', viewer, 'settings')).toBe(false);
    expect(canSeeLyricsTrack('viewer', viewer, 'Vocals')).toBe(true);
    const limited = { ...viewer, lyricsTracks: ['Chords'] };
    expect(canSeeLyricsTrack('viewer', limited, 'Vocals')).toBe(false);
    expect(canSeeLyricsTrack('viewer', limited, 'Chords')).toBe(true);
    expect(canSeeLyricsTrack('owner', limited, 'Vocals')).toBe(true);
  });

  it('normalizes stored profiles', () => {
    expect(normalizeViewerPermissions(undefined)).toEqual(DEFAULT_VIEWER_PERMISSIONS);
    expect(normalizeViewerPermissions({ transport: true, pages: { mixer: true } as never })).toEqual({
      ...DEFAULT_VIEWER_PERMISSIONS,
      transport: true,
      pages: { ...DEFAULT_VIEWER_PERMISSIONS.pages, mixer: true },
    });
  });
});

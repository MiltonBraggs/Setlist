import { describe, expect, it } from 'vitest';
import { groupDisplayName, parseCountIn, parseLocator, parseTrackName } from '../src/notation.ts';

describe('parseLocator', () => {
  it('parses a plain song with metadata', () => {
    const p = parseLocator('Follow Night {Capo 2, key of G} [3:20] [blue] [.big] #ballad #slow');
    expect(p.kind).toBe('song');
    expect(p.title).toBe('Follow Night');
    expect(p.description).toBe('Capo 2, key of G');
    expect(p.duration).toBe(200);
    expect(p.color).toBe('blue');
    expect(p.classes).toEqual(['big']);
    expect(p.tags).toEqual(['ballad', 'slow']);
  });

  it('handles prefixes', () => {
    expect(parseLocator('* hidden').kind).toBe('ignore');
    const dot = parseLocator('. Encore Song');
    expect(dot).toMatchObject({ kind: 'song', title: 'Encore Song', stopBefore: true });
    expect(parseLocator('> Verse 1')).toMatchObject({ kind: 'section', title: 'Verse 1', quickAccess: false });
    expect(parseLocator('>> Bridge')).toMatchObject({ kind: 'section', title: 'Bridge', quickAccess: true });
  });

  it('parses auto-jump targets', () => {
    expect(parseLocator('> Intro >>> Verse 1')).toMatchObject({ kind: 'section', title: 'Intro', jumpTarget: 'Verse 1' });
    expect(parseLocator('> Chorus 2 >>> SONG END').jumpTarget).toBe('SONG END');
  });

  it('parses end and stop locators', () => {
    expect(parseLocator('SONG END').kind).toBe('songEnd');
    expect(parseLocator('STOP')).toMatchObject({ kind: 'stop', flags: { stop: { then: 'default' } } });
    expect(parseLocator('AUTOSTOP').kind).toBe('stop');
    expect(parseLocator('STOP +JUMP').flags.stop?.then).toBe('jump');
    expect(parseLocator('STOP +STAY').flags.stop?.then).toBe('stay');
  });

  it('parses section flags', () => {
    expect(parseLocator('> Outro +STOP').flags.stop).toEqual({ then: 'default' });
    expect(parseLocator('> Break +PAUSE').flags.pause).toBe(true);
    expect(parseLocator('> Solo +SKIP').flags.skip).toBe(true);
    expect(parseLocator('> Tag +END').flags.end).toBe(true);
    expect(parseLocator('> Vamp +LOOP').flags.loop).toEqual({ full: false, count: null });
    expect(parseLocator('> Vamp +LOOP:4').flags.loop).toEqual({ full: false, count: 4 });
    expect(parseLocator('> Vamp +LOOPFULL').flags.loop).toEqual({ full: true, count: null });
  });

  it('does not treat +JUMP on a song as a stop', () => {
    expect(parseLocator('My Song +JUMP').flags.stop).toBeUndefined();
  });

  it('parses nosong, transpose, count-in and keeps unknown attrs', () => {
    const p = parseLocator('Walk-in Music [nosong] [+2b] [c:1.2:nl:hs] [whatever]');
    expect(p.noSong).toBe(true);
    expect(p.transpose).toEqual({ semitones: 2, flats: true });
    expect(p.countIn).toEqual({ bars: 1, announceBeat: 2, loop: false, halfspeed: true });
    expect(p.attrs).toEqual(['whatever']);
  });

  it('accepts hex colors and h:mm:ss durations', () => {
    const p = parseLocator('Long Jam [1:02:03] [#ff8800]');
    expect(p.duration).toBe(3723);
    expect(p.color).toBe('#ff8800');
  });

  it('keeps plus signs that are not flags in titles', () => {
    expect(parseLocator('C+C Music Factory').title).toBe('C+C Music Factory');
  });
});

describe('parseCountIn', () => {
  it('disables with 0', () => {
    expect(parseCountIn('0')).toEqual({ bars: 0 });
  });
  it('handles long aliases', () => {
    expect(parseCountIn('2:beats:backwards:finish')).toEqual({ bars: 2, beats: true, backwards: true, finish: true });
  });
});

describe('parseTrackName', () => {
  it('detects special tracks and groups', () => {
    expect(parseTrackName('Sections').isSections).toBe(true);
    expect(parseTrackName('Song Parts +SECTIONS').isSections).toBe(true);
    expect(parseTrackName('Vocals +LYRICS [blue] [top+2]')).toMatchObject({ isLyrics: true, color: 'blue', attrs: ['top+2'] });
    expect(parseTrackName('Click').isClick).toBe(true);
    expect(parseTrackName('Clave +CLICK').isClick).toBe(true);
    expect(parseTrackName('Measures').isMeasures).toBe(true);
    expect(parseTrackName('Cues +GUIDE +LOOPGUIDE')).toMatchObject({ guide: true, loopGuide: true, jumpGuide: false });
    expect(parseTrackName('LTC +NM').neverMute).toBe(true);
    expect(parseTrackName('Vox 1 +G:VOX +GROUP:BACKINGS').groups).toEqual(['VOX', 'BACKINGS']);
    expect(parseTrackName('Bad +G:lower').groups).toEqual([]);
  });

  it('formats group names', () => {
    expect(groupDisplayName('GIT_1')).toBe('Git 1');
    expect(groupDisplayName('BACKING_VOX')).toBe('Backing Vox');
  });
});

import { describe, expect, it } from 'vitest';
import { activeLineIndex, isChord, lyricsFollow, lyricsTracks, parseInline, parseLyricLine, transposeChord } from '../src/lyrics.ts';
import { track } from './fixtures.ts';

describe('lyrics', () => {
  it('recognizes chords', () => {
    for (const c of ['C', 'Am', 'F#m7', 'Bb', 'Gsus4', 'Cmaj7', 'D/F#', 'Eb/Bb', 'Cadd9']) expect(isChord(c), c).toBe(true);
    for (const c of ['large', 'blue', 'img:x.png', '<', 'H']) expect(isChord(c), c).toBe(false);
  });

  it('transposes chords', () => {
    expect(transposeChord('Am', 2)).toBe('Bm');
    expect(transposeChord('D/F#', 2)).toBe('E/G#');
    expect(transposeChord('C', 1, true)).toBe('Db');
    expect(transposeChord('B', 1)).toBe('C');
    expect(transposeChord('C', -1)).toBe('B');
  });

  it('parses chords, attributes and line breaks', () => {
    const line = parseLyricLine('[blue] [large] [C]Neon [G]lights \\ second row', 'x', 0, 4);
    expect(line.color).toBe('blue');
    expect(line.size).toBe('large');
    expect(line.rows).toEqual([
      [{ chord: 'C', text: 'Neon ' }, { chord: 'G', text: 'lights' }],
      [{ chord: undefined, text: 'second row' }],
    ]);
  });

  it('parses images and positions', () => {
    expect(parseLyricLine('[img:charts/a.png] [full]', 'x', 0, 4).image).toEqual({ src: 'charts/a.png', full: true, scroll: false });
    expect(parseLyricLine('[<] Count off', 'x', 0, 4).position).toBe('before');
  });

  it('builds lyrics tracks with options', () => {
    const t = track(1, 'Vocals +LYRICS [blue] [top+2] [nochords] [+150ms] [+2b]', {
      clips: [
        { id: 'a', name: 'two', start: 4, end: 8, color: 0xff0000 },
        { id: 'b', name: 'one', start: 0, end: 4, color: 0x00ff00 },
      ],
    });
    const [lt] = lyricsTracks([t, track(2, 'Drums')]);
    expect(lt.options).toMatchObject({ color: 'blue', top: 2, chords: 'hide', latency: 150, transpose: { semitones: 2, flats: true } });
    expect(lt.lines.map((l) => l.rows[0][0].text)).toEqual(['one', 'two']);
    expect(activeLineIndex(lt.lines, 5)).toBe(1);
    expect(activeLineIndex(lt.lines, -1)).toBe(-1);
  });

  it('parses inline formatting', () => {
    expect(parseInline('a **b** *c*')).toEqual([
      { text: 'a ', bold: false, italic: false },
      { text: 'b', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'c', bold: false, italic: true },
    ]);
  });
});

describe('lyricsFollow: what the Lyrics page keeps centred', () => {
  // Verse 1 20..36 (last line 32..36), Solo 36..52 and Bridge 52..68 with no lyrics or chords,
  // Chorus 68.. whose first line starts a beat early (67..72).
  const verse = { start: 20 };
  const solo = { start: 36 };
  const bridge = { start: 52 };
  const chorus = { start: 68 };
  const lastVerseLine = { start: 32, end: 36 };
  const pickup = { start: 67, end: 72 };

  it('follows lyric lines while they play, and through gaps inside their own section', () => {
    expect(lyricsFollow({ time: 34, line: lastVerseLine, section: verse })).toBe('line');
    expect(lyricsFollow({ time: 30, line: { start: 20, end: 24 }, section: verse })).toBe('line');
  });

  it('moves on to a section with no lyrics or chords instead of staying on the last line', () => {
    expect(lyricsFollow({ time: 40, line: lastVerseLine, section: solo })).toBe('header');
    expect(lyricsFollow({ time: 60, line: lastVerseLine, section: bridge })).toBe('header');
  });

  it('keeps a line placed a little before its section: while sung, and after', () => {
    expect(lyricsFollow({ time: 67.5, line: pickup, section: bridge })).toBe('line');
    expect(lyricsFollow({ time: 70, line: pickup, section: chorus })).toBe('line');
    expect(lyricsFollow({ time: 70, line: { start: 67, end: 68.5 }, section: chorus })).toBe('line');
  });

  it('follows a chord row that started after the last line', () => {
    expect(lyricsFollow({ time: 44, line: lastVerseLine, barsStart: 40, section: solo })).toBe('bars');
  });

  it('shows the start of a song picked while stopped, before its first section', () => {
    // Next song at 92, its first section ("> Intro") one bar later at 96.
    expect(lyricsFollow({ time: 92, songStart: 92 })).toBe('songStart');
    // Lyrics of every song listed: the previous song's last line is not "current" any more.
    expect(lyricsFollow({ time: 92, line: { start: 80, end: 84 }, songStart: 92 })).toBe('songStart');
    // A line already sung in the gap (a pickup) is followed as usual.
    expect(lyricsFollow({ time: 95, line: { start: 94, end: 98 }, songStart: 92 })).toBe('line');
    // Parked between songs: stay put.
    expect(lyricsFollow({ time: 88, line: { start: 80, end: 84 } })).toBe('line');
  });

  it('follows the line when the user pinned one, or when no section headers are shown', () => {
    expect(lyricsFollow({ time: 40, line: lastVerseLine, section: solo, pinned: true })).toBe('line');
    expect(lyricsFollow({ time: 40, line: lastVerseLine })).toBe('line');
  });
});

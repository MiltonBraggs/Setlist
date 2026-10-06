import { describe, expect, it } from 'vitest';
import { activeLineIndex, isChord, lyricsTracks, parseInline, parseLyricLine, transposeChord } from '../src/lyrics.ts';
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

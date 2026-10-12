import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppState, LiveSnapshot, ScriptCommand, ScriptToServer, ServerToScript } from '@setlist/core';
import { DEMO, track } from '../../core/test/fixtures.ts';
import { SetlistApp } from '../src/app.ts';
import type { LiveBridge } from '../src/bridge.ts';
import { Storage } from '../src/storage.ts';

class FakeBridge extends EventEmitter {
  commands: ScriptCommand[] = [];
  sent: ServerToScript[] = [];
  connected = true;
  command(cmd: ScriptCommand) {
    this.commands.push(cmd);
  }
  send(msg: ServerToScript) {
    this.sent.push(msg);
  }
  fromScript(msg: ScriptToServer) {
    this.emit('message', msg);
  }
  last() {
    return this.commands[this.commands.length - 1];
  }
}

let dir: string;
let bridge: FakeBridge;
let app: SetlistApp;
let patches: Partial<AppState>[];

function start(snapshot: LiveSnapshot = DEMO) {
  bridge = new FakeBridge();
  app = new SetlistApp(bridge as unknown as LiveBridge, new Storage(dir));
  patches = [];
  app.on('patch', (p) => patches.push(p));
  bridge.emit('connected', true);
  bridge.fromScript({ type: 'snapshot', state: snapshot });
}

const time = (t: number, playing: boolean) => bridge.fromScript({ type: 'time', time: t, playing });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setlist-app-'));
  start();
});
afterEach(() => {
  app.flush();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('songs and plan', () => {
  it('builds songs, an "All songs" setlist and sends the plan', () => {
    expect(app.state.songs.map((s) => s.id)).toEqual(['opener', 'ballad', 'closer']);
    expect(app.state.setlists).toHaveLength(1);
    expect(app.state.setlists[0]).toMatchObject({ name: 'All songs', songCount: 3 });
    expect(app.state.setlist.entries.map((e) => e.songId)).toEqual(['opener', 'ballad', 'closer']);
    expect(bridge.sent.some((m) => m.type === 'plan')).toBe(true);
  });

  it('applies mixer-only changes without rebuilding or re-sending songs', () => {
    const before = app.state.songs;
    const mixer: unknown[] = [];
    app.on('mixer', (m) => mixer.push(m));
    const withTracks = { ...DEMO, tracks: [track(0, 'Drums +G:DRUMS')] };
    bridge.fromScript({ type: 'patch', state: { tracks: withTracks.tracks } });
    patches = [];
    bridge.fromScript({ type: 'mixer', tracks: [['t0', true, false, 0.5]] });
    expect(app.state.tracks[0]).toMatchObject({ mute: true, volume: 0.5 });
    expect(mixer).toHaveLength(1);
    expect(patches).toEqual([]);
    expect(app.state.songs).toBe(before);
  });

  it("doesn't re-broadcast songs when an unrelated patch arrives", () => {
    patches = [];
    bridge.fromScript({ type: 'patch', state: { cues: DEMO.cues } });
    bridge.fromScript({ type: 'patch', state: { loop: { on: true, start: 0, length: 4 } } });
    expect(patches.some((p) => 'songs' in p)).toBe(false);
    expect(patches.some((p) => 'setlist' in p)).toBe(false);
    // The loop change is a small transport patch: no tracks or clips in it.
    expect(patches.at(-1)).toEqual({ live: expect.objectContaining({ loop: { on: true, start: 0, length: 4 } }) });
  });
});

describe('setlists', () => {
  it('creates, selects, renames, duplicates and deletes setlists', () => {
    app.dispatch('createSetlist', ['Friday', ['closer', 'opener']]);
    expect(app.state.setlist).toMatchObject({ name: 'Friday' });
    expect(app.state.setlist.entries.filter((e) => !e.removed).map((e) => e.songId)).toEqual(['closer', 'opener']);
    expect(app.state.setlists.map((s) => s.name)).toEqual(['All songs', 'Friday']);

    const friday = app.state.setlist.id;
    app.dispatch('renameSetlist', [friday, 'Friday Gig']);
    expect(app.state.setlist.name).toBe('Friday Gig');

    app.dispatch('duplicateSetlist', [friday]);
    expect(app.state.setlist.name).toBe('Friday Gig copy');
    expect(app.state.setlists).toHaveLength(3);

    app.dispatch('deleteSetlist', [app.state.setlist.id]);
    expect(app.state.setlists).toHaveLength(2);
    expect(app.state.setlists.map((s) => s.id)).toContain(app.state.setlist.id);

    app.dispatch('selectSetlist', [friday]);
    expect(app.state.setlist.id).toBe(friday);
  });

  it('cancels a queued jump when switching setlists', () => {
    const all = app.state.setlist.id;
    app.dispatch('createSetlist', ['Short', ['closer']]);
    app.dispatch('selectSetlist', [all]);
    time(20, true);
    app.dispatch('nextSong');
    expect(app.state.queued).not.toBeNull();
    app.dispatch('selectSetlist', [app.state.setlists[1].id]);
    expect(app.state.queued).toBeNull();
    expect(bridge.last()).toEqual({ name: 'cancelQueue' });
  });

  it('writes pending edits before switching to another Live set', () => {
    app.dispatch('setSetlist', [{ entries: [{ songId: 'closer' }, { songId: 'opener' }, { songId: 'ballad' }] }]);
    // Another Live set opens (completely different songs) before the debounced save ran.
    bridge.fromScript({ type: 'patch', state: { cues: [{ id: 'x', name: 'Other Song', time: 0 }], songLength: 32 } });
    app.flush();
    start(); // back to the demo set
    expect(app.state.setlist.entries.map((e) => e.songId)).toEqual(['closer', 'opener', 'ballad']);
  });

  it('never deletes the last setlist', () => {
    app.dispatch('deleteSetlist', [app.state.setlist.id]);
    expect(app.state.setlists).toHaveLength(1);
  });

  it('plays the active setlist (plan follows it)', () => {
    app.dispatch('createSetlist', ['Short', ['closer']]);
    const plan = [...bridge.sent].reverse().find((m) => m.type === 'plan');
    // Closer is the only (and last) song: its SONG END stops instead of jumping on.
    expect(plan && plan.type === 'plan' && plan.plan.events.at(-1)).toEqual({ at: 240, type: 'stop', relocate: null });
  });

  it('remembers setlists and the active one across restarts', () => {
    app.dispatch('createSetlist', ['Friday', ['ballad']]);
    const id = app.state.setlist.id;
    app.flush();
    start();
    expect(app.state.setlist.id).toBe(id);
    expect(app.state.setlists.map((s) => s.name)).toEqual(['All songs', 'Friday']);
  });

  it('adds new songs to "All songs" only', () => {
    app.dispatch('createSetlist', ['Friday', ['ballad']]);
    const cues = [...DEMO.cues, { id: 'new', name: 'New Song', time: 300 }];
    bridge.fromScript({ type: 'patch', state: { cues, songLength: 400 } });
    expect(app.state.setlist.entries.find((e) => e.songId === 'new-song')).toEqual({ songId: 'new-song', removed: true });
    app.dispatch('selectSetlist', [app.state.setlists[0].id]);
    expect(app.state.setlist.entries.find((e) => e.songId === 'new-song')).toEqual({ songId: 'new-song' });
  });

  it('sanitizes setlist edits from devices', () => {
    app.dispatch('setSetlist', [
      { entries: [{ songId: 'closer' }, { songId: 'closer' }, { songId: 'nope' }, null, 'x', { songId: 'opener', removed: 'yes', description: 42 }] },
    ]);
    expect(app.state.setlist.entries.slice(0, 2)).toEqual([{ songId: 'closer' }, { songId: 'opener' }]);
    app.dispatch('setSetlist', ['garbage']);
    expect(app.state.setlist.entries.filter((e) => !e.removed)).toHaveLength(3); // empty edit -> all re-added (auto-add)
  });
});

describe('transport', () => {
  it('GO: next song when parked, play when inside a song, escape loop, jump to queued', () => {
    time(160, false); // parked at Ballad's STOP
    app.dispatch('go');
    expect(bridge.last()).toEqual({ name: 'jump', to: 176, quantized: false });

    time(20, false);
    app.dispatch('go');
    expect(bridge.last()).toEqual({ name: 'play' });

    time(20, true);
    bridge.fromScript({ type: 'patch', state: { loop: { on: true, start: 16, length: 32 } } });
    app.dispatch('go');
    expect(bridge.last()).toEqual({ name: 'setLoop', on: false });

    bridge.fromScript({ type: 'patch', state: { loop: { on: false, start: 16, length: 32 } } });
    app.dispatch('nextSong');
    expect(app.state.queued).toMatchObject({ songId: 'ballad', at: 64 });
    app.dispatch('go');
    expect(bridge.last()).toEqual({ name: 'jump', to: 96, quantized: false });
    expect(app.state.queued).toBeNull();
  });

  it('queues per jump mode', () => {
    time(20, true);
    app.dispatch('updateSettings', [{ jumpMode: 'quantized' }]);
    app.dispatch('jumpToSong', ['ballad']);
    expect(bridge.last()).toEqual({ name: 'jump', to: 96, quantized: true });

    app.dispatch('updateSettings', [{ jumpMode: 'endOfSection' }]);
    app.dispatch('jumpToSong', ['ballad']);
    expect(bridge.last()).toEqual({ name: 'queue', at: 48, to: 96 });

    app.dispatch('cancelQueue');
    expect(bridge.last()).toEqual({ name: 'cancelQueue' });

    app.dispatch('updateSettings', [{ jumpMode: 'manual' }]);
    app.dispatch('jumpToSong', ['closer']);
    expect(app.state.queued).toMatchObject({ songId: 'closer', hold: true });
    time(30, false); // stopping executes the held jump
    expect(bridge.last()).toEqual({ name: 'jump', to: 176, quantized: false });
  });

  it('ignores bad settings', () => {
    app.dispatch('updateSettings', [{ jumpMode: 'warp', theme: 'pink', oscPort: 80, nonsense: true, fontScale: 99 }]);
    expect(app.state.settings.jumpMode).toBe('dynamic');
    expect(app.state.settings.theme).toBe('light');
    expect(app.state.settings.oscPort).toBe(39051);
    expect(app.state.settings.fontScale).toBe(2);
    expect('nonsense' in app.state.settings).toBe(false);
  });

  it('drops malformed MIDI mappings', () => {
    const good = { id: 'a', input: '*', kind: 'note', channel: 1, number: 60, action: 'go' };
    app.dispatch('updateSettings', [{ midiMappings: [null, 'x', { id: 'b' }, good] }]);
    expect(app.state.settings.midiMappings).toEqual([good]);
    expect(() => app.handleMidi({ input: 'pad', kind: 'note', channel: 1, number: 60, value: 100 })).not.toThrow();
  });

  it('ignores unknown and prototype actions', () => {
    expect(() => app.dispatch('constructor')).not.toThrow();
    expect(() => app.dispatch('__proto__')).not.toThrow();
  });
});

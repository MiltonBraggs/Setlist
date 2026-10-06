import { createRequire } from 'node:module';
import type { MidiEvent } from './app.ts';

// CommonJS bundles (Electron) have `require`; ESM (tsx) needs createRequire.
const load = typeof require === 'function' ? require : createRequire(import.meta.url);
const POLL_MS = 2000;

interface MidiInput {
  getPortCount(): number;
  getPortName(i: number): string;
  openPort(i: number): void;
  closePort(): void;
  on(event: 'message', cb: (delta: number, msg: number[]) => void): void;
  ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void;
}

/**
 * Listens on all MIDI inputs (hot-plug aware) and reports note / CC / program change events.
 * On Windows a port can only be opened by one app: disable the device in Live's MIDI preferences.
 */
export class MidiService {
  private midi: { Input: new () => MidiInput } | null = null;
  private open = new Map<string, MidiInput>();
  /** Kept open: creating an RtMidi input logs a warning each time when no devices exist. */
  private probe: MidiInput | null = null;
  private poll?: NodeJS.Timeout;

  constructor(
    private onEvent: (ev: MidiEvent) => void,
    private onInputs: (names: string[]) => void,
  ) {
    try {
      this.midi = load('@julusian/midi');
    } catch (err) {
      console.warn('[midi] MIDI support unavailable:', (err as Error).message);
    }
  }

  start() {
    if (!this.midi) return;
    this.scan();
    this.poll = setInterval(() => this.scan(), POLL_MS);
  }

  stop() {
    clearInterval(this.poll);
    for (const input of this.open.values()) input.closePort();
    this.open.clear();
    this.probe?.closePort();
    this.probe = null;
  }

  private scan() {
    if (!this.midi) return;
    this.probe ??= new this.midi.Input();
    const names: string[] = [];
    for (let i = 0; i < this.probe.getPortCount(); i++) names.push(this.probe.getPortName(i));

    for (const [name, input] of this.open) {
      if (!names.includes(name)) {
        input.closePort();
        this.open.delete(name);
      }
    }
    names.forEach((name, i) => {
      if (this.open.has(name)) return;
      try {
        const input = new this.midi!.Input();
        input.ignoreTypes(true, true, true);
        input.on('message', (_delta, msg) => this.onMessage(name, msg));
        input.openPort(i);
        this.open.set(name, input);
      } catch (err) {
        console.warn(`[midi] could not open "${name}":`, (err as Error).message);
      }
    });
    this.onInputs([...this.open.keys()]);
  }

  private onMessage(input: string, msg: number[]) {
    const [status, d1 = 0, d2 = 0] = msg;
    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    if (type === 0x90) this.onEvent({ input, kind: 'note', channel, number: d1, value: d2 });
    else if (type === 0x80) this.onEvent({ input, kind: 'note', channel, number: d1, value: 0 });
    else if (type === 0xb0) this.onEvent({ input, kind: 'cc', channel, number: d1, value: d2 });
    else if (type === 0xc0) this.onEvent({ input, kind: 'pc', channel, number: d1, value: 127 });
  }
}

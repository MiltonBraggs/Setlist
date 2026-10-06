import osc from 'osc';
import { resolveColor, playView, type AppState } from '@setlist/core';
import type { SetlistApp } from './app.ts';

type OscArg = { type: 'i' | 'f' | 's'; value: number | string };

interface Subscriber {
  host: string;
  port: number;
}

/** Parse `"quoted string" 12 0.5 word` into typed OSC args. */
export function parseOscArgs(text: string): OscArg[] {
  const args: OscArg[] = [];
  for (const m of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const quoted = m[1] ?? m[2];
    if (quoted !== undefined) {
      args.push({ type: 's', value: quoted });
      continue;
    }
    const word = m[3];
    if (/^-?\d+$/.test(word)) args.push({ type: 'i', value: Number(word) });
    else if (/^-?\d*\.\d+$/.test(word)) args.push({ type: 'f', value: Number(word) });
    else args.push({ type: 's', value: word });
  }
  return args;
}

export interface ParsedOscCommand {
  sleep?: number;
  host?: string;
  port?: number;
  address?: string;
  args: OscArg[];
}

/** `/global/stop; //sleep 500; 192.168.1.25:10023/ch/01/mix ON` */
export function parseOscCommands(text: string): ParsedOscCommand[] {
  const out: ParsedOscCommand[] = [];
  for (const raw of text.split(';').map((s) => s.trim()).filter(Boolean)) {
    const sleep = /^\/\/sleep\s+(\d+)$/i.exec(raw);
    if (sleep) {
      out.push({ sleep: Number(sleep[1]), args: [] });
      continue;
    }
    const m = /^(?:([\w.-]+):(\d+))?(\/\S*)\s*(.*)$/.exec(raw);
    if (!m) continue;
    out.push({ host: m[1], port: m[2] ? Number(m[2]) : undefined, address: m[3], args: parseOscArgs(m[4]) });
  }
  return out;
}

/** OSC control (AbleSet-compatible addresses) plus value subscriptions for Companion / Stream Deck. */
export class OscService {
  private port: any;
  private subscribers = new Map<string, Subscriber>();
  private lastValues = new Map<string, string>();

  constructor(
    private app: SetlistApp,
    private localPort: number,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      let ready = false;
      this.port = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: this.localPort, metadata: true });
      this.port.on('message', (msg: { address: string; args: { value: unknown }[] }, _t: unknown, info: { address: string; port: number }) => {
        this.handle(msg.address, msg.args.map((a) => a.value), info);
      });
      this.port.on('error', (err: Error) => {
        if (!ready) reject(err);
        else console.error('[osc]', err.message);
      });
      this.port.on('ready', () => {
        ready = true;
        resolve();
      });
      this.port.open();
    });
  }

  stop() {
    this.port?.close();
  }

  send(host: string, port: number, address: string, args: OscArg[] = []) {
    try {
      this.port.send({ address, args }, host, port);
    } catch (err) {
      console.error('[osc] send failed', err);
    }
  }

  /** Run a `;`-separated command string, e.g. from a MIDI mapping. */
  async exec(text: string) {
    for (const cmd of parseOscCommands(text)) {
      if (cmd.sleep) {
        await new Promise((r) => setTimeout(r, cmd.sleep));
      } else if (cmd.address && cmd.host && cmd.port) {
        this.send(cmd.host, cmd.port, cmd.address, cmd.args);
      } else if (cmd.address) {
        this.handle(cmd.address, cmd.args.map((a) => a.value));
      }
    }
  }

  handle(address: string, args: unknown[], from?: { address: string; port: number }) {
    const a = this.app;
    const d = (action: string, ...rest: unknown[]) => a.dispatch(action, rest, 'osc');
    switch (address) {
      case '/global/play': return d('play');
      case '/global/pause': return d('pause');
      case '/global/stop': return d('stop');
      case '/global/playPause': return d('playPause');
      case '/global/playStop': return d('playStop');
      case '/global/go': return d('go');
      case '/global/toggleRecording': return d('toggleRecord');
      case '/setlist/jumpBySongs': return d('jumpBySongs', Number(args[0] ?? 1));
      case '/setlist/jumpToSong': return d('jumpToSong', args[0]);
      case '/setlist/jumpBySections': return d('jumpBySections', Number(args[0] ?? 1));
      case '/setlist/jumpToSection': return args.length > 1 ? d('jumpToSection', args[0], args[1]) : d('jumpToSection', args[0]);
      case '/setlist/jumpByMeasures': return d('jumpByMeasures', Number(args[0] ?? 1));
      case '/setlist/jumpToQueued': return d('jumpQueued');
      case '/setlist/jumpToQueuedNow': return d('jumpQueuedNow');
      case '/setlist/cancelQueued': return d('cancelQueue');
      case '/setlist/load': return d('loadSetlist', args[0]);
      case '/sections/next': return d('nextSection');
      case '/sections/previous': return d('prevSection');
      case '/sections/toggleLoop':
      case '/setlist/toggleLoop':
      case '/loop/toggle': return d('toggleLoop');
      case '/loop/enable': return d('enableLoop');
      case '/loop/escape': return d('escapeLoop');
      case '/mixer/group': return d('mixerGroup', args[0], args[1], args[2] !== undefined ? Number(args[2]) : undefined);
      case '/notify/big': return d('notify', args.length > 1 ? args[1] : args[0], true);
      case '/notify': return d('notify', args.length > 1 ? args[1] : args[0], false);
      case '/device/toggleLock': return d('toggleLock');
      case '/subscribe':
      case '/unsubscribe': {
        // /subscribe [host] port
        const port = Number(args.length > 1 ? args[1] : args[0]);
        const host = args.length > 1 ? String(args[0]) : from?.address ?? '127.0.0.1';
        if (!port) return;
        const key = `${host}:${port}`;
        if (address === '/unsubscribe') {
          this.subscribers.delete(key);
        } else {
          this.subscribers.set(key, { host, port });
          for (const [addr, value] of this.lastValues) this.sendValue({ host, port }, addr, value);
        }
        return;
      }
      default:
        console.warn(`[osc] unknown address ${address}`);
    }
  }

  private values(state: AppState, time: number, playing: boolean): Record<string, string | number> {
    const v = playView(state.songs, state.setlist, time, state.live.tempo, state.queued);
    const color = resolveColor(v.section?.color ?? v.song?.color) ?? '';
    return {
      '/global/isPlaying': playing ? 1 : 0,
      '/global/tempo': state.live.tempo,
      '/global/timeSignature': `${state.live.sigNum}/${state.live.sigDen}`,
      '/global/loopEnabled': state.live.loop.on ? 1 : 0,
      '/setlist/name': state.setlist.name,
      '/setlist/activeSongName': v.song?.title ?? '',
      '/setlist/activeSongIndex': v.setlistIndex + 1,
      '/setlist/activeSongColor': color,
      '/setlist/activeSectionName': v.section?.title ?? '',
      '/setlist/nextSectionName': v.nextSection?.title ?? '',
      '/setlist/nextSongName': v.nextSong?.title ?? '',
      '/setlist/songCount': v.songCount,
      '/setlist/queuedName': v.queuedSection?.title ?? v.queuedSong?.title ?? '',
      '/setlist/songProgress': Math.round(v.loc.songProgress * 100) / 100,
      '/setlist/sectionProgress': Math.round(v.loc.sectionProgress * 100) / 100,
      '/setlist/songRemaining': Math.round(v.songRemaining),
      '/setlist/setRemaining': Math.round(v.setRemaining),
    };
  }

  /** Push changed values to subscribers. Call on state changes and playhead updates. */
  publish(state: AppState, time: number, playing: boolean) {
    const values = this.values(state, time, playing);
    for (const [addr, value] of Object.entries(values)) {
      const encoded = JSON.stringify(value);
      if (this.lastValues.get(addr) === encoded) continue;
      this.lastValues.set(addr, encoded);
      for (const sub of this.subscribers.values()) this.sendValue(sub, addr, encoded);
    }
  }

  private sendValue(sub: Subscriber, address: string, encoded: string) {
    const value = JSON.parse(encoded) as string | number;
    const arg: OscArg =
      typeof value === 'number' ? { type: Number.isInteger(value) ? 'i' : 'f', value } : { type: 's', value };
    this.send(sub.host, sub.port, address, [arg]);
  }
}

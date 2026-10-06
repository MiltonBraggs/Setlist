import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { PLUGIN_PORT, type Beats, type PluginInstance, type PluginToServer, type ServerToPlugin } from '@setlist/core';

const TIMEOUT_MS = 3500;

interface Instance extends PluginInstance {
  address: string;
  port: number;
  lastSeen: number;
}

interface HubEvents {
  instances: [PluginInstance[]];
  time: [id: string, time: Beats, playing: boolean, tempo: number];
  gated: [id: string, at: Beats];
}

/** Talks to "Setlist Sync" VST3 instances (one per output path the user inserted it on). */
export class PluginHub extends EventEmitter<HubEvents> {
  private socket = dgram.createSocket({ type: 'udp4' });
  private instances = new Map<string, Instance>();
  private gates: Beats[] = [];
  private prune?: NodeJS.Timeout;

  constructor(private port = PLUGIN_PORT) {
    super();
  }

  start(): Promise<void> {
    this.socket.on('message', (buf, rinfo) => this.onMessage(buf, rinfo));
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.port, '127.0.0.1', () => {
        this.socket.on('error', (err) => console.error('[plugins]', err.message));
        this.prune = setInterval(() => this.pruneStale(), 1000);
        resolve();
      });
    });
  }

  stop() {
    clearInterval(this.prune);
    this.socket.close();
  }

  list(): PluginInstance[] {
    return [...this.instances.values()].map(({ id, track, version }) => ({ id, track, version }));
  }

  /** Stop points to silence at; pushed to every instance when they change. */
  setGates(points: Beats[]) {
    if (points.length === this.gates.length && points.every((p, i) => Math.abs(p - this.gates[i]) < 1e-9)) return;
    this.gates = points;
    for (const inst of this.instances.values()) this.sendGates(inst);
  }

  private sendGates(inst: Instance) {
    const msg: ServerToPlugin = { type: 'gates', points: this.gates };
    this.socket.send(JSON.stringify(msg), inst.port, inst.address);
  }

  private onMessage(buf: Buffer, rinfo: dgram.RemoteInfo) {
    let msg: PluginToServer;
    try {
      msg = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    if (!msg || typeof msg.id !== 'string') return;
    let inst = this.instances.get(msg.id);
    const isNew = !inst;
    if (!inst) {
      inst = { id: msg.id, track: null, version: '', address: rinfo.address, port: rinfo.port, lastSeen: Date.now() };
      this.instances.set(msg.id, inst);
    }
    inst.lastSeen = Date.now();
    inst.address = rinfo.address;
    inst.port = rinfo.port;

    switch (msg.type) {
      case 'hello': {
        const changed = isNew || inst.track !== (msg.track ?? null) || inst.version !== msg.version;
        inst.track = msg.track ?? null;
        inst.version = msg.version;
        // Answering every hello doubles as the plugin's "connected" heartbeat.
        this.sendGates(inst);
        if (changed) this.emit('instances', this.list());
        break;
      }
      case 'time':
        if (isNew) this.emit('instances', this.list());
        this.emit('time', msg.id, msg.time, msg.playing, msg.tempo);
        break;
      case 'gated':
        this.emit('gated', msg.id, msg.at);
        break;
    }
  }

  private pruneStale() {
    const now = Date.now();
    let removed = false;
    for (const [id, inst] of this.instances) {
      if (now - inst.lastSeen > TIMEOUT_MS) {
        this.instances.delete(id);
        removed = true;
      }
    }
    if (removed) this.emit('instances', this.list());
  }
}

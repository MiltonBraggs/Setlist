import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { SCRIPT_PORT, SERVER_PORT, type ScriptCommand, type ScriptToServer, type ServerToScript } from '@setlist/core';

const HEARTBEAT_MS = 1000;
const TIMEOUT_MS = 3500;

interface Chunk {
  type: 'chunk';
  id: number;
  i: number;
  n: number;
  data: string;
}

export interface BridgeEvents {
  message: [ScriptToServer];
  connected: [boolean];
}

/** UDP link to the Remote Script running inside Live (or the simulator). */
export class LiveBridge extends EventEmitter<BridgeEvents> {
  private socket = dgram.createSocket({ type: 'udp4' });
  private chunks = new Map<number, string[]>();
  private lastSeen = 0;
  private heartbeat?: NodeJS.Timeout;
  connected = false;

  constructor(
    private listenPort = SERVER_PORT,
    private scriptPort = SCRIPT_PORT,
  ) {
    super();
  }

  start(): Promise<void> {
    this.socket.on('message', (buf) => this.onDatagram(buf));
    return new Promise((resolve, reject) => {
      this.socket.once('error', (err: NodeJS.ErrnoException) =>
        reject(err.code === 'EADDRINUSE' ? new Error('Another Setlist instance is already running (UDP port in use).') : err),
      );
      this.socket.bind(this.listenPort, '127.0.0.1', () => {
        this.socket.on('error', (err) => console.error('[bridge]', err.message));
        this.heartbeat = setInterval(() => this.checkAlive(), HEARTBEAT_MS);
        resolve();
      });
    });
  }

  stop() {
    clearInterval(this.heartbeat);
    this.socket.close();
  }

  send(message: ServerToScript) {
    const data = Buffer.from(JSON.stringify(message));
    this.socket.send(data, this.scriptPort, '127.0.0.1');
  }

  command(cmd: ScriptCommand) {
    this.send({ type: 'cmd', cmd });
  }

  private checkAlive() {
    this.send({ type: 'ping' });
    if (this.connected && Date.now() - this.lastSeen > TIMEOUT_MS) this.setConnected(false);
  }

  private setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value;
    this.emit('connected', value);
    if (value) this.send({ type: 'getSnapshot' });
  }

  private onDatagram(buf: Buffer) {
    let msg: ScriptToServer | Chunk;
    try {
      msg = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    this.lastSeen = Date.now();
    this.setConnected(true);
    if (msg.type === 'chunk') {
      const parts = this.chunks.get(msg.id) ?? new Array<string>(msg.n);
      parts[msg.i] = msg.data;
      this.chunks.set(msg.id, parts);
      if (parts.filter((p) => p !== undefined).length === msg.n) {
        this.chunks.delete(msg.id);
        try {
          this.emit('message', JSON.parse(parts.join('')));
        } catch (err) {
          console.error('[bridge] bad chunked message', err);
        }
      }
      if (this.chunks.size > 8) this.chunks.delete(this.chunks.keys().next().value!);
      return;
    }
    this.emit('message', msg);
  }
}

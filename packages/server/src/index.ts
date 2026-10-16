import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { Bonjour } from 'bonjour-service';
import Fastify from 'fastify';
import {
  canDispatch,
  setlistToText,
  stateForRole,
  VIEWER_DEPENDS_ON_SETTINGS,
  type AppState,
  type ClientToServer,
  type DeviceInfo,
  type Role,
  type ServerToClient,
  type Session,
} from '@setlist/core';
import { AccessControl, isLocalAddress } from './access.ts';
import { SetlistApp } from './app.ts';
import { LiveBridge } from './bridge.ts';
import { MidiService } from './midi.ts';
import { deviceLabel, FrameThrottle, RttTracker } from './network.ts';
import { OscService } from './osc.ts';
import { PluginHub } from './plugins.ts';
import { scriptBuild } from './scriptBuild.ts';
import { Storage } from './storage.ts';

export { SetlistApp } from './app.ts';
export { LiveBridge } from './bridge.ts';
export { Storage, defaultDataDir } from './storage.ts';

export interface ServerOptions {
  /** Ports to try in order (default: 80, then 3000-3010). */
  ports?: number[];
  dataDir?: string;
  /** Built web UI to serve (packages/web/dist). */
  webDist?: string | null;
  mdns?: boolean;
  /** remote-script/Setlist in this checkout: Live's copy is compared with it. */
  remoteScriptDir?: string;
}

export interface RunningServer {
  app: SetlistApp;
  port: number;
  urls: string[];
  close(): Promise<void>;
}

function lanUrls(port: number): string[] {
  const suffix = port === 80 ? '' : `:${port}`;
  // The address phones should use comes first: the real Wi-Fi / Ethernet adapter, not virtual ones
  // (WSL, Hyper-V, VirtualBox, VMware, Docker), which phones can't reach.
  const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|vboxnet|vmnet|utun|bridge/i;
  const found: { url: string; rank: number }[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const rank = virtual.test(name) ? 2 : /^(192\.168|10)\./.test(a.address) ? 0 : 1;
      found.push({ url: `http://${a.address}${suffix}`, rank });
    }
  }
  return [`http://localhost${suffix}`, ...found.sort((a, b) => a.rank - b.rank).map((f) => f.url)];
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const storage = new Storage(options.dataDir);
  const bridge = new LiveBridge();
  const app = new SetlistApp(bridge, storage);
  app.expectedScriptBuild = options.remoteScriptDir ? scriptBuild(options.remoteScriptDir) : null;
  const oscService = new OscService(app, app.state.settings.oscPort);
  app.oscExec = (text) => void oscService.exec(text);
  const midi = new MidiService(
    (ev) => app.handleMidi(ev),
    (names) => app.setMidiInputs(names),
  );

  const fastify = Fastify({ logger: false });
  // Client messages are small; refuse anything big.
  await fastify.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });

  const access = new AccessControl(storage);

  interface Client {
    send: (data: string) => void;
    /** For playhead frames: skipped while the device is behind (slow Wi-Fi), the next one supersedes it. */
    sendDroppable: (data: string) => void;
    /** The host computer is always owner, so you can't lock yourself out. */
    local: boolean;
    address: string;
    token?: string;
    role: Role;
    /** Sent by the device in its hello; reconnects of the same device are counted against it. */
    deviceId?: string;
    label: string;
    since: number;
    rtt: RttTracker;
  }
  const clients = new Set<Client>();
  /** Connections per device since the server started (Settings → Network shows reconnects). */
  const connects = new Map<string, number>();

  const roleOf = (c: Client): Role => (c.local || !access.pinSet || access.isOwnerToken(c.token) ? 'owner' : 'viewer');
  /** The page's entry script (assets/index-<hash>.js), read each time: `npm start` may have rebuilt it. */
  const webBuild = (): string | undefined => {
    if (!options.webDist) return undefined;
    try {
      return /assets\/(index-[\w-]+\.js)/.exec(fs.readFileSync(path.join(options.webDist, 'index.html'), 'utf8'))?.[1];
    } catch {
      return undefined;
    }
  };
  /** The whole state this device may see: everything for owners, only what their pages use for viewers. */
  const sendState = (c: Client) => c.send(JSON.stringify({ type: 'state', state: stateForRole(app.state, c.role) } satisfies ServerToClient));
  const sendSession = (c: Client, extra: Omit<Session, 'role'> = {}) => {
    const before = c.role;
    c.role = roleOf(c);
    c.send(JSON.stringify({ type: 'session', session: { role: c.role, webBuild: webBuild(), ...extra } } satisfies ServerToClient));
    if (c.role !== before) sendState(c); // signed in or out: a different view of the state
  };
  const refreshAccess = () => {
    let owners = 0;
    for (const c of clients) if (c.role === 'owner') owners++;
    app.setAccess({ pinSet: access.pinSet, owners, viewers: clients.size - owners });
  };
  refreshAccess();

  /**
   * State changes: owners get the patch as is. Viewers get their own view of the changed keys, and
   * only keys whose viewer view really changed (e.g. a MIDI setting or an error isn't sent at all).
   */
  const viewerSent = new Map<string, string>();
  const sendPatch = (partial: Partial<AppState>) => {
    const owners = [...clients].filter((c) => c.role === 'owner');
    const viewers = [...clients].filter((c) => c.role !== 'owner');
    if (owners.length) {
      const data = JSON.stringify({ type: 'patch', state: partial } satisfies ServerToClient);
      for (const c of owners) c.send(data);
    }
    const keys = new Set(Object.keys(partial) as (keyof AppState)[]);
    if (keys.has('settings')) for (const k of VIEWER_DEPENDS_ON_SETTINGS) keys.add(k);
    const view = stateForRole(app.state, 'viewer');
    const changed: Partial<Record<keyof AppState, unknown>> = {};
    for (const k of keys) {
      const json = JSON.stringify(view[k]);
      if (viewerSent.get(k) === json) continue;
      viewerSent.set(k, json);
      changed[k] = view[k];
    }
    if (viewers.length && Object.keys(changed).length) {
      const data = JSON.stringify({ type: 'patch', state: changed as Partial<AppState> } satisfies ServerToClient);
      for (const c of viewers) c.send(data);
    }
  };

  // OSC subscribers get playhead-driven values (progress, remaining) at most ~15 times a second.
  let lastOscPublish = 0;
  const publishOsc = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastOscPublish < 66) return;
    lastOscPublish = now;
    try {
      oscService.publish(app.state, app.time, app.playing);
    } catch (err) {
      console.error('[osc] publish failed', err);
    }
  };

  // Coalesce state patches per event-loop turn.
  let pending: Record<string, unknown> | null = null;
  app.on('patch', (partial) => {
    if (!pending) {
      pending = {};
      setImmediate(() => {
        const state = pending!;
        pending = null;
        sendPatch(state as Partial<AppState>);
        publishOsc(true);
      });
    }
    Object.assign(pending, partial);
  });
  // Playhead frames: thinned to ~10 a second during steady playback (devices fill in the motion);
  // jumps, starts and stops go out at once. Less traffic on a busy Wi-Fi.
  const frames = new FrameThrottle(100);
  app.on('time', (time, playing) => {
    publishOsc(false);
    if (!frames.shouldSend(time, playing, app.state.live.tempo)) return;
    const data = JSON.stringify({ type: 'time', time, playing } satisfies ServerToClient);
    for (const c of clients) c.sendDroppable(data);
  });

  // Delay check every 2 s: each device learns its own delay (it shows the playhead that far ahead),
  // owners see every device's health in Settings → Network.
  const deviceInfo = (c: Client): DeviceInfo => ({
    id: c.deviceId ?? '',
    label: c.local ? `${c.label} (this computer)` : c.label,
    address: c.address.replace(/^::ffff:/, ''),
    role: c.role,
    local: c.local,
    rtt: c.rtt.current(),
    worstRtt: c.rtt.worst(),
    connects: c.deviceId ? (connects.get(c.deviceId) ?? 1) : 1,
    since: c.since,
  });
  const pingTimer = setInterval(() => {
    const ping = JSON.stringify({ type: 'ping', t: Date.now() } satisfies ServerToClient);
    for (const c of clients) c.send(ping);
    const owners = [...clients].filter((c) => c.role === 'owner');
    if (!owners.length) return;
    const data = JSON.stringify({ type: 'devices', devices: [...clients].map(deviceInfo) } satisfies ServerToClient);
    for (const c of owners) c.send(data);
  }, 2000);

  fastify.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket, req) => {
      const address = req.socket.remoteAddress ?? '';
      const client: Client = {
        send: (d: string) => socket.readyState === 1 && socket.send(d),
        sendDroppable: (d: string) => socket.readyState === 1 && socket.bufferedAmount < 64 * 1024 && socket.send(d),
        local: isLocalAddress(address),
        address,
        role: 'viewer',
        label: deviceLabel(req.headers['user-agent']),
        since: Date.now(),
        rtt: new RttTracker(),
      };
      clients.add(client);
      // The device's role is sent in reply to its 'hello', which carries its saved owner token.
      client.role = roleOf(client);
      refreshAccess();
      sendState(client);
      client.send(JSON.stringify({ type: 'time', time: app.time, playing: app.playing } satisfies ServerToClient));
      socket.on('message', (raw: Buffer) => {
        try {
          handleMessage(raw);
        } catch (err) {
          // One malformed message must never take the server down.
          console.error('[ws] message failed', err);
        }
      });
      const handleMessage = (raw: Buffer) => {
        let msg: ClientToServer;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        switch (msg.type) {
          case 'hello':
            client.token = typeof msg.token === 'string' ? msg.token : undefined;
            if (!client.deviceId && typeof msg.device === 'string' && msg.device.length <= 64) {
              client.deviceId = msg.device;
              connects.set(msg.device, (connects.get(msg.device) ?? 0) + 1);
            }
            sendSession(client);
            refreshAccess();
            break;
          case 'pong': {
            const rtt = Date.now() - Number(msg.t);
            client.rtt.add(rtt);
            const current = client.rtt.current();
            if (current !== null) client.send(JSON.stringify({ type: 'latency', rtt: current } satisfies ServerToClient));
            break;
          }
          case 'action':
            if (typeof msg.action !== 'string') return;
            // Enforced here, not just hidden in the UI.
            if (!canDispatch(client.role, app.state.settings.viewer, msg.action)) return;
            app.dispatch(msg.action, Array.isArray(msg.args) ? msg.args : [], 'ui');
            break;
          case 'signIn': {
            const result = access.signIn(String(msg.pin ?? ''), address);
            if ('token' in result) client.token = result.token;
            sendSession(client, result);
            refreshAccess();
            break;
          }
          case 'signOut':
            access.signOut(client.token);
            client.token = undefined;
            sendSession(client, { token: '' });
            refreshAccess();
            break;
          case 'setPin': {
            if (client.role !== 'owner') return;
            const result = access.setPin(msg.pin === null ? null : String(msg.pin));
            if ('error' in result) {
              sendSession(client, result);
              break;
            }
            // Every other remembered owner device is signed out by a PIN change.
            for (const c of clients) {
              if (c === client) continue;
              c.token = undefined;
              sendSession(c, { token: '' });
            }
            client.token = result.token;
            sendSession(client, { token: result.token ?? '' });
            refreshAccess();
            break;
          }
        }
      };
      socket.on('error', (err: Error) => console.warn('[ws] socket error', err.message));
      socket.on('close', () => {
        clients.delete(client);
        refreshAccess();
      });
    });
  });

  // The full state only for the host computer; anyone else gets what a viewer sees.
  fastify.get('/api/state', async (req) => {
    const snap = app.snapshot();
    return isLocalAddress(req.socket.remoteAddress ?? '') ? snap : { ...snap, ...stateForRole(app.state, 'viewer') };
  });
  fastify.get('/api/setlist.json', async (_req, reply) => {
    reply.header('Content-Disposition', `attachment; filename="${app.state.setlist.name}.json"`);
    return app.state.setlist;
  });
  fastify.get('/api/setlist.txt', async (_req, reply) => {
    reply.type('text/plain; charset=utf-8');
    return setlistToText(app.state.setlist, app.state.songs);
  });

  // Lyrics images: [img:path] relative to <projectFolder>/Lyrics
  fastify.get('/lyrics-images/*', async (req, reply) => {
    const folder = app.state.settings.projectFolder;
    if (!folder) return reply.code(404).send();
    const base = path.resolve(folder, 'Lyrics');
    const file = path.resolve(base, (req.params as { '*': string })['*']);
    // `base + sep` so a sibling folder like "Lyrics2" can't be reached.
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return reply.code(404).send();
    return reply.send(fs.createReadStream(file));
  });

  if (options.webDist && fs.existsSync(options.webDist)) {
    await fastify.register(fastifyStatic, {
      root: options.webDist,
      cacheControl: false,
      // The page itself is never reused from a cache, so after an update every phone gets the new app.
      // Build files have a content hash in their name, so they can be kept.
      setHeaders: (res, filePath) => {
        res.header('Cache-Control', /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-store');
      },
    });
    // SPA fallback
    fastify.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) return reply.sendFile('index.html');
      reply.code(404).send();
    });
  }

  const ports = options.ports ?? [80, ...Array.from({ length: 11 }, (_, i) => 3000 + i)];
  let port = 0;
  for (const p of ports) {
    try {
      await fastify.listen({ port: p, host: '0.0.0.0' });
      port = p;
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw err;
    }
  }
  if (!port) throw new Error(`No free port among ${ports.join(', ')}`);

  try {
    await bridge.start();
  } catch (err) {
    await fastify.close();
    throw err;
  }
  // The "Setlist Sync" VST3 plugin is on hold; its hub only starts when explicitly enabled.
  const pluginHub = process.env.SETLIST_PLUGINS === '1' ? new PluginHub() : null;
  if (pluginHub) {
    try {
      await pluginHub.start();
      app.attachPlugins(pluginHub);
    } catch (err) {
      console.warn(`[plugins] Setlist Sync support disabled: ${(err as Error).message}`);
    }
  }
  try {
    await oscService.start();
  } catch (err) {
    console.warn(`[osc] OSC disabled: ${(err as Error).message}`);
  }
  midi.start();

  const urls = lanUrls(port);
  app.setUrls(urls);

  let bonjour: Bonjour | null = null;
  if (options.mdns !== false) {
    try {
      bonjour = new Bonjour();
      // Unique per computer: two Setlist hosts on one network would otherwise clash and stop advertising.
      bonjour.publish({ name: `Setlist (${os.hostname()})`, type: 'http', port, txt: { path: '/' } });
    } catch (err) {
      console.warn('[mdns] failed', err);
    }
  }

  return {
    app,
    port,
    urls,
    async close() {
      clearInterval(pingTimer);
      app.flush();
      midi.stop();
      oscService.stop();
      pluginHub?.stop();
      bridge.stop();
      bonjour?.unpublishAll();
      bonjour?.destroy();
      await fastify.close();
    },
  };
}

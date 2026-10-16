import { useEffect, useState } from 'react';
import { create } from 'zustand';
import {
  can,
  canSeeLyricsTrack,
  canSeePage,
  PlayheadClock,
  type AppState,
  type Capability,
  type ClientToServer,
  type DeviceInfo,
  type PageId,
  type Role,
  type ServerToClient,
} from '@setlist/core';

interface Store {
  connected: boolean;
  state: AppState | null;
  /** Last playhead report from Live */
  time: number;
  playing: boolean;
  /** This device's round trip to the server in ms (delay check every 2 s). */
  rtt: number | null;
  /** Owners: every connected device and its network health. */
  devices: DeviceInfo[] | null;
  /** null until the server has answered this device's hello. */
  role: Role | null;
  /** Last sign-in / PIN error, shown in the dialog. */
  authError: string | null;
}

export const useStore = create<Store>(() => ({
  connected: false,
  state: null,
  time: 0,
  playing: false,
  rtt: null,
  devices: null,
  role: null,
  authError: null,
}));

const TOKEN_KEY = 'setlist:ownerToken';

function readToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeToken(token: string | undefined) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: owner status lasts until reload */
  }
}

let socket: WebSocket | null = null;
/** Turns late, uneven playhead frames into a smooth playhead (see PlayheadClock). */
const clock = new PlayheadClock();

/** A random id this device keeps, so the owner can see when the same device reconnects. */
function deviceId(): string {
  const key = 'setlist:deviceId';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

function send(msg: ClientToServer) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function act(action: string, ...args: unknown[]) {
  send({ type: 'action', action, args });
}

const throttles = new Map<string, { last: number; timer?: ReturnType<typeof setTimeout>; args: unknown[] }>();

/**
 * Like act(), but at most every `ms` per key, always delivering the latest value (faders, sliders).
 */
export function actThrottled(key: string, ms: number, action: string, ...args: unknown[]) {
  const t = throttles.get(key) ?? { last: 0, args };
  t.args = args;
  throttles.set(key, t);
  const wait = t.last + ms - Date.now();
  if (wait <= 0) {
    t.last = Date.now();
    act(action, ...args);
  } else if (!t.timer) {
    t.timer = setTimeout(() => {
      t.timer = undefined;
      t.last = Date.now();
      act(action, ...t.args);
    }, wait);
  }
}

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => {
    useStore.setState({ connected: true });
    send({ type: 'hello', token: readToken(), device: deviceId() });
  };
  socket.onclose = () => {
    useStore.setState({ connected: false });
    setTimeout(connect, 1000);
  };
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data) as ServerToClient;
    switch (msg.type) {
      case 'state':
        useStore.setState({ state: msg.state });
        break;
      case 'patch':
        useStore.setState((s) => (s.state ? { state: { ...s.state, ...msg.state } } : {}));
        break;
      case 'time':
        clock.receive(msg.time, msg.playing, useStore.getState().state?.live.tempo ?? 120, performance.now());
        useStore.setState({ time: msg.time, playing: msg.playing });
        break;
      case 'ping':
        send({ type: 'pong', t: msg.t });
        break;
      case 'latency':
        clock.latency = Math.min(Math.max(msg.rtt, 0), 2000) / 2000; // half the round trip, in seconds
        useStore.setState({ rtt: msg.rtt });
        break;
      case 'devices':
        useStore.setState({ devices: msg.devices });
        break;
      case 'session':
        if (msg.session.token !== undefined) writeToken(msg.session.token || undefined);
        useStore.setState({ role: msg.session.role, authError: msg.session.error ?? null });
        reloadIfOutdated(msg.session.webBuild);
        break;
    }
  };
}

/**
 * After an update the server serves a new build of the page. A device still running an older one
 * (left open, or restored from memory) reloads itself, at most once per build.
 */
function reloadIfOutdated(build?: string) {
  if (!build || !import.meta.env.PROD) return;
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? '';
  if (entry.endsWith(`/${build}`)) return;
  try {
    if (sessionStorage.getItem('setlistReloadedFor') === build) return;
    sessionStorage.setItem('setlistReloadedFor', build);
  } catch {
    return; // without storage a reload could repeat: stay on this version
  }
  location.reload();
}

export function signIn(pin: string) {
  useStore.setState({ authError: null });
  send({ type: 'signIn', pin });
}

export function signOut() {
  writeToken(undefined);
  send({ type: 'signOut' });
}

/** Owner only: set or change (string) or remove (null) the owner PIN. */
export function setOwnerPin(pin: string | null) {
  useStore.setState({ authError: null });
  send({ type: 'setPin', pin });
}

/** This device's role and what it may do. */
export function useAccess() {
  const role = useStore((s) => s.role) ?? 'viewer';
  const perms = useStore((s) => s.state?.settings.viewer);
  const pinSet = useStore((s) => s.state?.access.pinSet ?? false);
  const p = perms!;
  return {
    role,
    isOwner: role === 'owner',
    pinSet,
    can: (capability: Capability) => !!perms && can(role, p, capability),
    canSee: (page: PageId) => !!perms && canSeePage(role, p, page),
    canSeeLyrics: (title: string) => !!perms && canSeeLyricsTrack(role, p, title),
  };
}

/**
 * The playhead now: between frames (about 10 a second) it moves on at the tempo, shifted ahead by
 * this device's network delay and smoothed against Wi-Fi jitter.
 */
export function currentTime(): number {
  const { time, playing, state } = useStore.getState();
  if (!playing || !state) return time;
  return clock.at(performance.now(), state.live.tempo);
}

/** Re-renders every animation frame while playing; returns the extrapolated playhead. */
export function usePlayhead(): number {
  const playing = useStore((s) => s.playing);
  const time = useStore((s) => s.time);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return playing ? currentTime() : time;
}

// ---------------------------------------------------------------------------
// Per-device preferences (localStorage, best effort)

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`setlist:${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem(`setlist:${key}`, JSON.stringify(value));
  } catch {
    /* private mode etc. */
  }
}

export function usePref<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => loadPref(key, fallback));
  return [
    value,
    (v: T) => {
      setValue(v);
      savePref(key, v);
    },
  ];
}

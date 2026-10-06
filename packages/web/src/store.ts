import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { AppState, ClientToServer, ServerToClient } from '@setlist/core';

interface Store {
  connected: boolean;
  state: AppState | null;
  /** Last playhead report from Live */
  time: number;
  playing: boolean;
  receivedAt: number;
  meters: Map<string, [number, number]>;
}

export const useStore = create<Store>(() => ({
  connected: false,
  state: null,
  time: 0,
  playing: false,
  receivedAt: performance.now(),
  meters: new Map(),
}));

let socket: WebSocket | null = null;
let metersWanted = 0;

function send(msg: ClientToServer) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

export function act(action: string, ...args: unknown[]) {
  send({ type: 'action', action, args });
}

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => {
    useStore.setState({ connected: true });
    if (metersWanted > 0) send({ type: 'meters', enabled: true });
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
        useStore.setState({ time: msg.time, playing: msg.playing, receivedAt: performance.now() });
        break;
      case 'meters':
        useStore.setState({ meters: new Map(msg.levels.map(([id, l, r]) => [id, [l, r]])) });
        break;
    }
  };
}

/** Subscribe to meter updates while a component is mounted. */
export function useMeters() {
  useEffect(() => {
    if (metersWanted++ === 0) send({ type: 'meters', enabled: true });
    return () => {
      if (--metersWanted === 0) send({ type: 'meters', enabled: false });
    };
  }, []);
  return useStore((s) => s.meters);
}

/** Playhead extrapolated between reports (Live sends ~10-30/s). */
export function currentTime(): number {
  const { time, playing, receivedAt, state } = useStore.getState();
  if (!playing || !state) return time;
  const elapsed = Math.min((performance.now() - receivedAt) / 1000, 0.5);
  return time + (elapsed * state.live.tempo) / 60;
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

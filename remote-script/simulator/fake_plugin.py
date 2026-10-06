"""Simulates the "Setlist Sync" VST3 plugin: same UDP protocol as plugin/Source/Link.cpp.

Reports the playhead, receives stop points, and logs when it would silence the output
compared with when the Remote Script actually stops (simulated) Live.
"""

import json
import socket
import time
import uuid

PLUGIN_PORT = 39102


class FakePlugin(object):
    def __init__(self, song, track="Master"):
        self.song = song
        self.track = track
        self.id = str(uuid.uuid4())
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.setblocking(False)
        self.points = []
        self.last_hello = 0.0
        self.last_t = None
        self.was_playing = False
        self.silenced_at = None  # (beat, wall clock)

    def _send(self, msg):
        msg["id"] = self.id
        try:
            self.sock.sendto(json.dumps(msg).encode("utf-8"), ("127.0.0.1", PLUGIN_PORT))
        except OSError:
            pass

    def _receive(self):
        while True:
            try:
                data, _ = self.sock.recvfrom(65536)
            except (BlockingIOError, OSError):
                return
            try:
                msg = json.loads(data.decode("utf-8"))
            except ValueError:
                continue
            if msg.get("type") == "gates":
                if msg["points"] != self.points:
                    print("[plugin] stop points:", msg["points"])
                self.points = msg["points"]

    def frame(self, frame_start, frame_end):
        """Called once per simulated audio frame (after the song advanced)."""
        self._receive()
        now = frame_end
        if now - self.last_hello >= 1.0:
            self.last_hello = now
            self._send({"type": "hello", "version": "sim", "track": self.track})

        t = self.song.current_song_time
        playing = self.song.is_playing
        last = self.last_t
        # Crossing within this frame (continuous forward playback only), interpolated to exact time.
        if playing and self.was_playing and last is not None and 0 < t - last < 1.0 and self.silenced_at is None:
            for p in self.points:
                if last < p <= t:
                    exact = frame_start + (p - last) / (t - last) * (frame_end - frame_start)
                    self.silenced_at = (p, exact)
                    print("[plugin] silenced output at beat %.3f (sample-accurate)" % p)
                    self._send({"type": "gated", "at": p})
                    break
        if self.was_playing and not playing and self.silenced_at is not None:
            beat, at = self.silenced_at
            print("[plugin] Live stopped %.0f ms after the stop point at beat %.3f; output was already silent"
                  % ((now - at) * 1000, beat))
            self.silenced_at = None
        if playing and not self.was_playing:
            self.silenced_at = None

        self._send({"type": "time", "time": t, "playing": playing, "tempo": self.song.tempo})
        self.last_t = t
        self.was_playing = playing

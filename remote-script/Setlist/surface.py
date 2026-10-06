"""Control surface: exposes Live's state to the Setlist app and executes its commands.

Live does not allow changing the song from inside listener callbacks, so listeners
only record what changed (or stream the playhead). All commands and the jump engine
run from update_display(), which Live calls roughly every 100 ms.
"""

import time
import traceback

import Live

try:
    from _Framework.ControlSurface import ControlSurface
except ImportError:  # pragma: no cover - future Live versions
    from ableton.v2.control_surface import ControlSurface

from .engine import JumpEngine
from .net import UdpLink

VERSION = "0.1.0"
TIME_INTERVAL = 1.0 / 30  # max rate of playhead messages
CUE_EPS = 1e-3


def is_clip_track(name):
    """Tracks whose arrangement clips we report: sections, lyrics, measures."""
    upper = name.upper()
    if "+SECTIONS" in upper or "+LYRICS" in upper or "+MEASURES" in upper:
        return True
    base = name.split("+")[0].split("[")[0].strip().lower()
    return base in ("sections", "measures")


class LiveAdapter(object):
    """Thin wrapper so the engine can be tested with a fake song."""

    def __init__(self, song):
        self.song = song

    def time(self):
        return self.song.current_song_time

    def set_time(self, t):
        self.song.current_song_time = max(0.0, t)

    def is_playing(self):
        return self.song.is_playing

    def start_playing(self):
        self.song.start_playing()

    def continue_playing(self):
        self.song.continue_playing()

    def stop_playing(self):
        self.song.stop_playing()

    def jump_by(self, beats):
        self.song.jump_by(beats)

    def cue_at(self, t):
        for cue in self.song.cue_points:
            if abs(cue.time - t) < CUE_EPS:
                return cue
        return None

    def signature(self):
        return self.song.signature_numerator, self.song.signature_denominator

    def quantization(self):
        return int(self.song.clip_trigger_quantization)

    def set_quantization(self, q):
        self.song.clip_trigger_quantization = Live.Song.Quantization.values[q]

    def loop_on(self):
        return self.song.loop

    def set_loop(self, on, start=None, length=None):
        if start is not None:
            self.song.loop_start = start
            self.song.loop_length = length
        self.song.loop = on


class Listeners(object):
    def __init__(self):
        self._items = []

    def add(self, obj, prop, fn):
        getattr(obj, "add_%s_listener" % prop)(fn)
        self._items.append((obj, prop, fn))

    def clear(self):
        for obj, prop, fn in self._items:
            try:
                if getattr(obj, "%s_has_listener" % prop)(fn):
                    getattr(obj, "remove_%s_listener" % prop)(fn)
            except Exception:
                pass  # object already deleted
        self._items = []


class SetlistSurface(ControlSurface):
    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._song = Live.Application.get_application().get_document()
        self._live = LiveAdapter(self._song)
        self._link = UdpLink(self.log_message)
        self._engine = JumpEngine(self._live, self._send, self.log_message)
        self._song_listeners = Listeners()
        self._cue_listeners = Listeners()
        self._track_listeners = Listeners()
        self._dirty = set()
        self._last_time_sent = 0.0
        self._last_time_value = None
        self._was_playing = self._song.is_playing
        self._meters = False
        self._click_solo_restore = None
        self._last_server_contact = 0.0

        self._add_song_listeners()
        self._rebuild_cue_listeners()
        self._rebuild_track_listeners()
        self._send({"type": "hello", "version": VERSION})
        self._send({"type": "snapshot", "state": self._snapshot()})
        self.log_message("Setlist remote script %s loaded" % VERSION)

    def disconnect(self):
        self._song_listeners.clear()
        self._cue_listeners.clear()
        self._track_listeners.clear()
        self._link.close()
        ControlSurface.disconnect(self)

    # ------------------------------------------------------------- messaging

    def _send(self, message):
        self._link.send(message)

    def _error(self, where):
        text = "%s: %s" % (where, traceback.format_exc())
        self.log_message(text)
        self._send({"type": "log", "level": "error", "message": text})

    # ------------------------------------------------------------- listeners

    def _add_song_listeners(self):
        s = self._song
        add = self._song_listeners.add
        add(s, "current_song_time", self._on_time)
        add(s, "is_playing", lambda: self._dirty.add("transport"))
        add(s, "record_mode", lambda: self._dirty.add("transport"))
        add(s, "tempo", lambda: self._dirty.add("transport"))
        add(s, "signature_numerator", lambda: self._dirty.add("transport"))
        add(s, "signature_denominator", lambda: self._dirty.add("transport"))
        add(s, "loop", lambda: self._dirty.add("transport"))
        add(s, "loop_start", lambda: self._dirty.add("transport"))
        add(s, "loop_length", lambda: self._dirty.add("transport"))
        add(s, "clip_trigger_quantization", lambda: self._dirty.add("transport"))
        add(s, "cue_points", self._on_cues_changed)
        add(s, "tracks", self._on_tracks_changed)

    def _on_cues_changed(self):
        self._dirty.add("cues")
        self._dirty.add("rebuild_cues")

    def _on_tracks_changed(self):
        self._dirty.add("tracks")
        self._dirty.add("rebuild_tracks")

    def _rebuild_cue_listeners(self):
        self._cue_listeners.clear()
        mark = lambda: self._dirty.add("cues")
        for cue in self._song.cue_points:
            self._cue_listeners.add(cue, "name", mark)
            self._cue_listeners.add(cue, "time", mark)

    def _rebuild_track_listeners(self):
        self._track_listeners.clear()
        add = self._track_listeners.add

        def mark():
            self._dirty.add("tracks")

        def mark_rebuild():
            self._dirty.add("tracks")
            self._dirty.add("rebuild_tracks")

        for track in self._song.tracks:
            add(track, "name", mark_rebuild)
            add(track, "color", mark)
            add(track, "mute", mark)
            add(track, "solo", mark)
            add(track.mixer_device.volume, "value", mark)
            if is_clip_track(track.name) and hasattr(track, "arrangement_clips"):
                add(track, "arrangement_clips", mark_rebuild)
                for clip in track.arrangement_clips:
                    add(clip, "name", mark)
                    add(clip, "start_time", mark)

    def _on_time(self):
        # Streaming only; actions happen in update_display().
        if time.time() - self._last_time_sent >= TIME_INTERVAL:
            self._send_time()

    def _send_time(self):
        self._last_time_sent = time.time()
        self._last_time_value = (self._song.current_song_time, self._song.is_playing)
        self._send({"type": "time", "time": self._last_time_value[0], "playing": self._last_time_value[1]})

    # --------------------------------------------------------------- snapshot

    def _transport(self):
        s = self._song
        return {
            "isPlaying": s.is_playing,
            "recordMode": s.record_mode,
            "tempo": s.tempo,
            "sigNum": s.signature_numerator,
            "sigDen": s.signature_denominator,
            "loop": {"on": s.loop, "start": s.loop_start, "length": s.loop_length},
            "quantization": int(s.clip_trigger_quantization),
            "songLength": getattr(s, "last_event_time", s.song_length),
        }

    def _cues(self):
        return [
            {"id": "c%d" % i, "name": cue.name, "time": cue.time}
            for i, cue in enumerate(self._song.cue_points)
        ]

    def _tracks(self):
        result = []
        for i, track in enumerate(self._song.tracks):
            entry = {
                "id": "t%d" % i,
                "index": i,
                "name": track.name,
                "color": track.color,
                "mute": track.mute,
                "solo": track.solo,
                "volume": track.mixer_device.volume.value,
                "isGroup": track.is_foldable,
            }
            if is_clip_track(track.name) and hasattr(track, "arrangement_clips"):
                try:
                    entry["clips"] = [
                        {
                            "id": "t%dk%d" % (i, j),
                            "name": clip.name,
                            "start": clip.start_time,
                            "end": clip.end_time,
                            "color": clip.color,
                        }
                        for j, clip in enumerate(track.arrangement_clips)
                    ]
                except Exception:
                    entry["clips"] = []
            result.append(entry)
        return result

    def _snapshot(self):
        state = self._transport()
        state["time"] = self._song.current_song_time
        state["cues"] = self._cues()
        state["tracks"] = self._tracks()
        return state

    # ------------------------------------------------------------------ tick

    def update_display(self):
        ControlSurface.update_display(self)
        try:
            self._tick()
        except Exception:
            self._error("tick")

    def _tick(self):
        for message in self._link.receive():
            try:
                self._handle(message)
            except Exception:
                self._error("handle %s" % message.get("type"))

        playing = self._song.is_playing
        if playing != self._was_playing:
            self._was_playing = playing
            self._engine.on_playing_changed(playing)
        self._engine.on_time(self._song.current_song_time)
        self._engine.tick()
        # Trailing update: changes that fell inside the listener throttle window.
        if self._last_time_value != (self._song.current_song_time, self._song.is_playing):
            self._send_time()

        if "rebuild_cues" in self._dirty:
            self._rebuild_cue_listeners()
        if "rebuild_tracks" in self._dirty:
            self._rebuild_track_listeners()
        patch = {}
        if "transport" in self._dirty:
            patch.update(self._transport())
        if "cues" in self._dirty:
            patch["cues"] = self._cues()
        if "tracks" in self._dirty:
            patch["tracks"] = self._tracks()
        self._dirty.clear()
        if patch:
            self._send({"type": "patch", "state": patch})
        if self._meters:
            self._send({"type": "meters", "levels": self._meter_levels()})

    def _meter_levels(self):
        levels = []
        for i, track in enumerate(self._song.tracks):
            try:
                levels.append(["t%d" % i, round(track.output_meter_left, 3), round(track.output_meter_right, 3)])
            except Exception:
                pass
        return levels

    # -------------------------------------------------------------- commands

    def _handle(self, message):
        kind = message.get("type")
        if kind == "ping":
            self._send({"type": "pong"})
        elif kind == "getSnapshot":
            self._send({"type": "hello", "version": VERSION})
            self._send({"type": "snapshot", "state": self._snapshot()})
        elif kind == "plan":
            self._engine.set_plan(message["plan"])
        elif kind == "cmd":
            self._command(message["cmd"])

    def _track(self, track_id):
        index = int(track_id[1:])
        tracks = self._song.tracks
        return tracks[index] if 0 <= index < len(tracks) else None

    def _command(self, cmd):
        name = cmd["name"]
        engine = self._engine
        if name == "play":
            engine.play()
        elif name == "continue":
            engine.resume()
        elif name == "stop":
            engine.stop()
        elif name == "pause":
            engine.pause()
        elif name == "toggleRecord":
            self._song.record_mode = not self._song.record_mode
        elif name == "jump":
            engine.jump(cmd["to"], cmd.get("quantized", False))
        elif name == "queue":
            engine.queue(cmd["at"], cmd["to"])
        elif name == "cancelQueue":
            engine.cancel_queue()
        elif name == "setLoop":
            engine.set_loop(cmd["on"], cmd.get("start"), cmd.get("length"), cmd.get("count"))
        elif name == "setTrack":
            track = self._track(cmd["id"])
            if track is not None:
                if "mute" in cmd:
                    track.mute = cmd["mute"]
                if "solo" in cmd:
                    track.solo = cmd["solo"]
                if "volume" in cmd:
                    track.mixer_device.volume.value = max(0.0, min(1.0, cmd["volume"]))
        elif name == "setMeters":
            self._meters = bool(cmd["enabled"])
        elif name == "countIn":
            self._count_in(cmd["from"], cmd["bars"], cmd.get("clickTrackIds", []))
        elif name == "placeLocators":
            self._place_locators(cmd["items"])
        elif name == "removeLocators":
            self._remove_locators(cmd["times"])

    def _count_in(self, target, bars, click_ids):
        clicks = [t for t in (self._track(i) for i in click_ids) if t is not None]
        restore = [(t, t.solo) for t in clicks]
        for t in clicks:
            t.solo = True

        def done():
            for t, solo in restore:
                try:
                    t.solo = solo
                except Exception:
                    pass

        self._engine.start_count_in(target, bars, done)

    def _place_locators(self, items):
        if self._song.is_playing:
            return
        original = self._song.current_song_time
        for item in items:
            if self._live.cue_at(item["time"]) is not None:
                continue
            self._song.current_song_time = item["time"]
            self._song.set_or_delete_cue()
            cue = self._live.cue_at(item["time"])
            if cue is not None:
                cue.name = item["name"]
        self._song.current_song_time = original

    def _remove_locators(self, times):
        if self._song.is_playing:
            return
        original = self._song.current_song_time
        for t in times:
            if self._live.cue_at(t) is not None:
                self._song.current_song_time = t
                self._song.set_or_delete_cue()
        self._song.current_song_time = original

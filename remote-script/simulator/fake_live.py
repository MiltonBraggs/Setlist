"""A small fake of Ableton Live's Python API, enough to run the real Setlist
Remote Script (surface.py + engine.py) outside of Live."""

import math
import sys
import types


class Observable(object):
    """Attributes listed in OBSERVED get add_x_listener / remove_x_listener / x_has_listener."""

    OBSERVED = ()

    def __init__(self):
        object.__setattr__(self, "_listeners", {})

    def __setattr__(self, name, value):
        old = self.__dict__.get(name, object())
        object.__setattr__(self, name, value)
        if name in self.OBSERVED and old != value:
            self._notify(name)

    def _notify(self, name):
        for fn in list(self._listeners.get(name, [])):
            fn()

    def __getattr__(self, name):
        for prefix, action in (("add_", "add"), ("remove_", "remove")):
            if name.startswith(prefix) and name.endswith("_listener"):
                prop = name[len(prefix):-len("_listener")]
                return lambda fn, p=prop, a=action: self._listen(a, p, fn)
        if name.endswith("_has_listener"):
            prop = name[: -len("_has_listener")]
            return lambda fn, p=prop: fn in self._listeners.get(p, [])
        raise AttributeError(name)

    def _listen(self, action, prop, fn):
        lst = self._listeners.setdefault(prop, [])
        if action == "add":
            lst.append(fn)
        elif fn in lst:
            lst.remove(fn)


class Param(Observable):
    OBSERVED = ("value",)

    def __init__(self, value):
        Observable.__init__(self)
        self.value = value


class Mixer(object):
    def __init__(self, volume):
        self.volume = Param(volume)


class Clip(Observable):
    OBSERVED = ("name", "start_time")

    def __init__(self, name, start, end, color=0x888888):
        Observable.__init__(self)
        self.name = name
        self.start_time = float(start)
        self.end_time = float(end)
        self.color = color


class Track(Observable):
    OBSERVED = ("name", "color", "mute", "solo", "arrangement_clips")

    def __init__(self, name, color=0x5a5a5a, clips=(), is_foldable=False):
        Observable.__init__(self)
        self.name = name
        self.color = color
        self.mute = False
        self.solo = False
        self.is_foldable = is_foldable
        self.mixer_device = Mixer(0.85)
        self.arrangement_clips = [Clip(*c) for c in clips]
        self.output_meter_left = 0.0
        self.output_meter_right = 0.0


class Cue(Observable):
    OBSERVED = ("name", "time")

    def __init__(self, song, name, time):
        Observable.__init__(self)
        self._song = song
        self.name = name
        self.time = float(time)

    def jump(self):
        self._song.schedule_jump(self.time)


# Live.Song.Quantization lengths in beats (None = bar).
QUANT_BEATS = {0: 0.0, 1: "8bar", 2: "4bar", 3: "2bar", 4: "bar", 5: 2.0, 6: 4.0 / 3, 7: 1.0, 8: 2.0 / 3,
               9: 0.5, 10: 1.0 / 3, 11: 0.25, 12: 1.0 / 6, 13: 0.125}


class Song(Observable):
    OBSERVED = ("current_song_time", "is_playing", "record_mode", "tempo", "signature_numerator",
                "signature_denominator", "loop", "loop_start", "loop_length", "clip_trigger_quantization",
                "cue_points", "tracks")

    def __init__(self, data):
        Observable.__init__(self)
        self.current_song_time = 0.0
        self.is_playing = False
        self.record_mode = False
        self.tempo = float(data.get("tempo", 120))
        self.signature_numerator = data.get("sig", [4, 4])[0]
        self.signature_denominator = data.get("sig", [4, 4])[1]
        self.loop = False
        self.loop_start = 0.0
        self.loop_length = 16.0
        self.clip_trigger_quantization = 4
        self.cue_points = sorted((Cue(self, n, t) for t, n in data["cues"]), key=lambda c: c.time)
        self.tracks = [Track(t["name"], t.get("color", 0x5a5a5a), t.get("clips", ())) for t in data.get("tracks", [])]
        self.last_event_time = float(data.get("length", 0) or (self.cue_points[-1].time + 32 if self.cue_points else 0))
        self.song_length = self.last_event_time + 16
        self._start_marker = 0.0
        self._scheduled = None

    # --- transport -----------------------------------------------------------
    def start_playing(self):
        self.current_song_time = self._start_marker if not self.is_playing else self.current_song_time
        self.is_playing = True

    def continue_playing(self):
        self.is_playing = True

    def stop_playing(self):
        self.is_playing = False
        self._scheduled = None
        # Like Live: the playhead returns to the start marker.
        self.current_song_time = self._start_marker

    def jump_by(self, beats):
        self.current_song_time = max(0.0, self.current_song_time + beats)

    def __setattr__(self, name, value):
        if name == "current_song_time" and not self.__dict__.get("is_playing", False):
            object.__setattr__(self, "_start_marker", value)
        Observable.__setattr__(self, name, value)

    def set_or_delete_cue(self):
        t = self.current_song_time
        existing = [c for c in self.cue_points if abs(c.time - t) < 1e-3]
        if existing:
            self.cue_points = [c for c in self.cue_points if c not in existing]
        else:
            self.cue_points = sorted(self.cue_points + [Cue(self, "", t)], key=lambda c: c.time)

    def _grid(self):
        q = int(self.clip_trigger_quantization)
        bar = self.signature_numerator * 4.0 / self.signature_denominator
        g = QUANT_BEATS[q]
        if isinstance(g, str):
            return bar * {"8bar": 8, "4bar": 4, "2bar": 2, "bar": 1}[g]
        return g

    def schedule_jump(self, to):
        if not self.is_playing:
            self.current_song_time = to
            return
        grid = self._grid()
        if grid <= 0:
            self.current_song_time = to
            return
        at = math.floor(self.current_song_time / grid + 1e-9) * grid + grid
        self._scheduled = (at, to)

    def advance(self, seconds):
        if not self.is_playing:
            return
        t = self.current_song_time
        new = t + seconds * self.tempo / 60.0
        if self._scheduled and new >= self._scheduled[0] - 1e-9:
            at, to = self._scheduled
            self._scheduled = None
            new = to + (new - at)
        else:
            end = self.loop_start + self.loop_length
            if self.loop and t < end <= new + 1e-9:
                new = self.loop_start + (new - end)
        self.current_song_time = new
        for i, track in enumerate(self.tracks):
            level = 0.0 if track.mute else 0.35 + 0.3 * abs(math.sin(new * 3.1 + i))
            track.output_meter_left = level
            track.output_meter_right = level * 0.95


class Application(object):
    def __init__(self, song):
        self._song = song

    def get_document(self):
        return self._song


class FakeControlSurface(object):
    def __init__(self, c_instance):
        self._c_instance = c_instance

    def log_message(self, *args):
        print("[script]", " ".join(str(a) for a in args))

    def update_display(self):
        pass

    def disconnect(self):
        pass


def install(song):
    """Register fake `Live` and `_Framework.ControlSurface` modules."""
    live = types.ModuleType("Live")
    app = Application(song)
    live.Application = types.SimpleNamespace(get_application=lambda: app)
    live.Song = types.SimpleNamespace(Quantization=types.SimpleNamespace(values={i: i for i in range(14)}))
    sys.modules["Live"] = live
    framework = types.ModuleType("_Framework")
    cs = types.ModuleType("_Framework.ControlSurface")
    cs.ControlSurface = FakeControlSurface
    framework.ControlSurface = cs
    sys.modules["_Framework"] = framework
    sys.modules["_Framework.ControlSurface"] = cs

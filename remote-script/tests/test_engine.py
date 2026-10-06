"""Engine tests against a simulated Live song. Run: python -m unittest discover remote-script/tests"""

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "Setlist"))
from engine import JumpEngine  # noqa: E402

QUANT_BEATS = {4: None, 5: 2.0, 7: 1.0, 9: 0.5, 11: 0.25, 13: 0.125}


class FakeCue(object):
    def __init__(self, live, time):
        self.live = live
        self.time = time

    def jump(self):
        self.live.schedule_jump(self.time)


class FakeLive(object):
    """Advances `step` beats per tick and executes quantized cue jumps like Live."""

    def __init__(self, cue_times, step=0.2):
        self.t = 0.0
        self.playing = False
        self.step = step
        self.cues = [FakeCue(self, t) for t in cue_times]
        self.quant = 4
        self.sig = (4, 4)
        self.loop = False
        self.loop_start = 0.0
        self.loop_length = 4.0
        self.scheduled = None  # (at, to)
        self.log = []  # (kind, time)

    # adapter API
    def time(self): return self.t
    def set_time(self, t): self.t = t
    def is_playing(self): return self.playing
    def start_playing(self): self.playing = True
    def continue_playing(self): self.playing = True
    def stop_playing(self):
        self.playing = False
        self.log.append(("stop", round(self.t, 3)))
    def jump_by(self, d):
        self.log.append(("jump_by", round(self.t, 3), round(self.t + d, 3)))
        self.t += d
    def cue_at(self, t):
        for c in self.cues:
            if abs(c.time - t) < 1e-3:
                return c
        return None
    def signature(self): return self.sig
    def quantization(self): return self.quant
    def set_quantization(self, q): self.quant = q
    def loop_on(self): return self.loop
    def set_loop(self, on, start=None, length=None):
        if start is not None:
            self.loop_start, self.loop_length = start, length
        self.loop = on

    def schedule_jump(self, to):
        if not self.playing:
            self.t = to
            return
        grid = QUANT_BEATS[self.quant] or self.sig[0] * 4.0 / self.sig[1]
        at = math.floor(self.t / grid + 1e-9) * grid + grid
        self.scheduled = (at, to)

    def advance(self):
        """One tick of playback, honouring scheduled jumps and the loop."""
        if not self.playing:
            return
        new = self.t + self.step
        if self.scheduled and new >= self.scheduled[0] - 1e-9:
            at, to = self.scheduled
            self.scheduled = None
            self.log.append(("jump", round(at, 3), round(to, 3)))
            self.t = to + (new - at)
            return
        end = self.loop_start + self.loop_length
        if self.loop and self.t < end <= new + 1e-9:
            self.log.append(("wrap", round(end, 3)))
            self.t = self.loop_start + (new - end)
            return
        self.t = new


def run(engine, live, ticks):
    for _ in range(ticks):
        was = live.playing
        live.advance()
        if live.playing != was:
            engine.on_playing_changed(live.playing)
        engine.on_time(live.t)
        engine.tick()


def make(cue_times, plan=None, step=0.2):
    live = FakeLive(cue_times, step)
    sent = []
    engine = JumpEngine(live, sent.append, lambda *_: None)
    if plan:
        engine.set_plan(plan)
    return live, engine, sent


class EngineTests(unittest.TestCase):
    def test_plan_jump_lands_exactly_on_boundary(self):
        live, engine, sent = make([0, 64, 96], {"events": [{"at": 64, "type": "jump", "to": 96}], "loops": []})
        engine.play()
        run(engine, live, 340)
        self.assertIn(("jump", 64.0, 96.0), live.log)
        self.assertEqual(live.quant, 4, "quantization restored")
        self.assertTrue(any(m.get("event") == "jump" for m in sent))

    def test_stop_and_relocate(self):
        live, engine, sent = make([0, 16, 32], {"events": [{"at": 16, "type": "stop", "relocate": 32}], "loops": []})
        engine.play()
        run(engine, live, 100)
        self.assertFalse(live.playing)
        self.assertEqual(live.log[0][0], "stop")
        self.assertGreaterEqual(live.log[0][1], 16.0)
        self.assertEqual(live.t, 32)

    def test_restart_from_stop_point_does_not_refire(self):
        live, engine, _ = make([0, 16], {"events": [{"at": 16, "type": "stop", "relocate": None}], "loops": []})
        engine.play()
        run(engine, live, 100)
        self.assertEqual(live.t, 16)
        engine.play()
        run(engine, live, 20)
        self.assertTrue(live.playing)

    def test_queued_jump_overrides_plan_event_at_same_boundary(self):
        plan = {"events": [{"at": 16, "type": "stop", "relocate": None}], "loops": []}
        live, engine, sent = make([0, 16, 48], plan)
        engine.play()
        run(engine, live, 10)
        engine.queue(16, 48)
        run(engine, live, 80)
        self.assertIn(("jump", 16.0, 48.0), live.log)
        self.assertTrue(live.playing)
        self.assertTrue(any(m.get("event") == "queued" for m in sent))

    def test_loop_with_count(self):
        plan = {"events": [], "loops": [{"start": 8, "end": 16, "count": 3, "full": False}]}
        live, engine, sent = make([0, 8, 16], plan)
        engine.play()
        run(engine, live, 200)
        wraps = [e for e in live.log if e[0] == "wrap"]
        self.assertEqual(len(wraps), 2, "played 3 times = 2 wraps")
        self.assertGreater(live.t, 16)
        self.assertFalse(live.loop)

    def test_loop_followed_by_jump_at_its_end(self):
        # > Chorus +LOOP:2 (8-16) followed by a +SKIP section at 16 -> jump 16 => 24
        plan = {"events": [{"at": 16, "type": "jump", "to": 24}],
                "loops": [{"start": 8, "end": 16, "count": 2, "full": False}]}
        live, engine, _ = make([0, 8, 16, 24], plan)
        engine.play()
        run(engine, live, 200)
        self.assertEqual(len([e for e in live.log if e[0] == "wrap"]), 1)
        self.assertIn(("jump", 16.0, 24.0), live.log)

    def test_escape_loop_continues(self):
        plan = {"events": [], "loops": [{"start": 8, "end": 16, "count": None, "full": False}]}
        live, engine, _ = make([0, 8, 16], plan)
        engine.play()
        run(engine, live, 100)  # 20 beats -> looping
        self.assertTrue(live.loop)
        engine.set_loop(False)
        run(engine, live, 60)
        self.assertGreater(live.t, 16)
        self.assertFalse(live.loop, "escaped loop is not re-enabled")

    def test_queue_escapes_loop(self):
        plan = {"events": [], "loops": [{"start": 8, "end": 16, "count": None, "full": False}]}
        live, engine, _ = make([0, 8, 16, 32], plan)
        engine.play()
        run(engine, live, 50)
        engine.queue(16, 32)
        run(engine, live, 60)
        self.assertIn(("jump", 16.0, 32.0), live.log)

    def test_jump_without_cue_falls_back_keeping_phase(self):
        live, engine, _ = make([0], {"events": [{"at": 8, "type": "jump", "to": 40}], "loops": []}, step=0.3)
        engine.play()
        run(engine, live, 40)
        jb = [e for e in live.log if e[0] == "jump_by"]
        self.assertEqual(len(jb), 1)
        # Crossed 8 at t=8.1; jumping by (40 - 8) keeps the 0.1 beat of overshoot.
        self.assertEqual(jb[0][2] - jb[0][1], 32.0)

    def test_count_in(self):
        live, engine, _ = make([0, 16])
        done = []
        engine.start_count_in(16, 1, lambda: done.append(live.t))
        self.assertEqual(live.t, 12)
        run(engine, live, 30)
        self.assertEqual(len(done), 1)
        self.assertGreaterEqual(done[0], 16 - 1e-6)

    def test_pause_keeps_position(self):
        live, engine, _ = make([0])
        engine.play()
        run(engine, live, 10)
        pos = live.t
        engine.pause()
        live.t = 0  # Live resets to start marker
        run(engine, live, 1)
        self.assertAlmostEqual(live.t, pos)


if __name__ == "__main__":
    unittest.main()

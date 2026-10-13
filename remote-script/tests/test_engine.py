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


class LateResetLive(FakeLive):
    """Like real Live: a moment after stop_playing(), Live itself settles the playhead
    (here: where playback stopped), overriding a position set right after the stop."""

    def __init__(self, *a, **kw):
        FakeLive.__init__(self, *a, **kw)
        self.reset_in = None
        self.stopped_at = None

    def stop_playing(self):
        self.stopped_at = self.t
        FakeLive.stop_playing(self)
        self.reset_in = 2  # two ticks later

    def advance(self):
        if self.reset_in is not None:
            self.reset_in -= 1
            if self.reset_in <= 0:
                self.reset_in = None
                self.t = self.stopped_at
        FakeLive.advance(self)


class StartMarkerLive(FakeLive):
    """Real Live's transport: start_playing() plays from the *start marker* (set by clicking in
    the arrangement), which setting current_song_time through the API does not move.
    continue_playing() plays from the current position. Stopping returns to the start marker."""

    def __init__(self, *a, **kw):
        FakeLive.__init__(self, *a, **kw)
        self.start_marker = 0.0

    def click(self, t):
        """The user clicks in Live's arrangement."""
        self.start_marker = t
        self.t = t

    def start_playing(self):
        self.t = self.start_marker
        self.playing = True

    def continue_playing(self):
        self.playing = True

    def stop_playing(self):
        FakeLive.stop_playing(self)
        self.t = self.start_marker


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

    def test_fast_tempo_plan_jump_happens_once(self):
        # 0.7 beats per tick (e.g. 210 bpm, or slower with a laggy ~100 ms tick): the playhead is well past
        # the target when the engine next looks. Must not be mistaken for a missed jump.
        live, engine, _ = make([0, 64, 96], {"events": [{"at": 64, "type": "jump", "to": 96}], "loops": []}, step=0.7)
        engine.play()
        run(engine, live, 160)
        self.assertEqual([e for e in live.log if e[0] in ("jump", "jump_by")], [("jump", 64.0, 96.0)])
        self.assertEqual(live.quant, 4)
        self.assertGreater(live.t, 100)

    def test_backward_plan_jump_finishes_and_does_not_repeat(self):
        # "> Outro >>> Chorus": jump back from 32 to 8, then play on without jumping again early.
        live, engine, _ = make([0, 8, 32], {"events": [{"at": 32, "type": "jump", "to": 8}], "loops": []}, step=0.6)
        engine.play()
        run(engine, live, 70)  # reach 32 (~54 ticks), jump back to 8, continue to ~17
        jumps = [e for e in live.log if e[0] in ("jump", "jump_by")]
        self.assertEqual(jumps, [("jump", 32.0, 8.0)])
        self.assertIsNone(engine.pending)
        self.assertEqual(live.quant, 4, "quantization restored right after the jump")

    def test_manual_jump_cancels_an_armed_jump(self):
        live, engine, _ = make([0, 16, 48], {"events": [{"at": 16, "type": "jump", "to": 48}], "loops": []})
        engine.play()
        run(engine, live, 66)  # inside the arming window before 16
        self.assertIsNotNone(engine.pending)
        live.scheduled = None  # the user jumped elsewhere: Live drops the scheduled jump
        live.t = 100.0
        run(engine, live, 2)
        self.assertIsNone(engine.pending)
        self.assertEqual(live.quant, 4)

    def test_stop_and_relocate(self):
        live, engine, sent = make([0, 16, 32], {"events": [{"at": 16, "type": "stop", "relocate": 32}], "loops": []})
        engine.play()
        run(engine, live, 100)
        self.assertFalse(live.playing)
        self.assertEqual(live.log[0][0], "stop")
        self.assertGreaterEqual(live.log[0][1], 16.0)
        self.assertEqual(live.t, 32)

    def test_stop_relocation_survives_lives_late_reset(self):
        # Setlist "B then A": B (16..32) ends with STOP, next song A starts at 0 (earlier in the arrangement).
        live = LateResetLive([0, 16, 32], step=0.2)
        engine = JumpEngine(live, lambda m: None, lambda *_: None)
        engine.set_plan({"events": [{"at": 32, "type": "stop", "relocate": 0}], "loops": []})
        live.t = 20.0
        engine.play()
        run(engine, live, 70)  # reach 32, stop; two ticks later Live parks the playhead back at 32
        self.assertFalse(live.playing)
        self.assertEqual(live.t, 0, "parked at the next setlist song, not at B's STOP")
        engine.play()
        run(engine, live, 3)
        self.assertTrue(live.playing)
        self.assertLess(live.t, 2, "playback starts at the next setlist song")

    def test_play_after_stop_starts_the_parked_song_not_lives_start_marker(self):
        # Setlist "B then A": B (16..32) ends with STOP -> park at A (0). The user had started B
        # by clicking at 20 in Live, so Live's start marker is at 20.
        live = StartMarkerLive([0, 16, 32], step=0.2)
        engine = JumpEngine(live, lambda m: None, lambda *_: None)
        engine.set_plan({"events": [{"at": 32, "type": "stop", "relocate": 0}], "loops": []})
        live.click(20.0)
        engine.play()
        run(engine, live, 80)  # stop at 32, then the hold window passes
        self.assertFalse(live.playing)
        self.assertEqual(live.t, 0, "parked at A")
        engine.play(0.0)  # GO: the app shows A, so it sends A's position
        run(engine, live, 3)
        self.assertTrue(live.playing)
        self.assertLess(live.t, 2, "A plays, not B from Live's start marker (20)")

    def test_play_pressed_during_the_park_hold_uses_the_parked_position(self):
        live = StartMarkerLive([0, 16, 32], step=0.2)
        engine = JumpEngine(live, lambda m: None, lambda *_: None)
        engine.set_plan({"events": [{"at": 32, "type": "stop", "relocate": 0}], "loops": []})
        live.click(20.0)
        engine.play()
        run(engine, live, 61)  # just past the stop at 32
        self.assertFalse(live.playing)
        engine.play(20.0)  # the app may still show a stale position for a moment
        run(engine, live, 2)
        self.assertTrue(live.playing)
        self.assertLess(live.t, 2)

    def test_count_in_starts_before_the_given_position_not_at_the_start_marker(self):
        live = StartMarkerLive([0, 16], step=0.2)
        engine = JumpEngine(live, lambda m: None, lambda *_: None)
        live.click(40.0)
        done = []
        engine.start_count_in(16, 1, lambda: done.append(live.t))
        self.assertTrue(live.playing)
        self.assertEqual(live.t, 12)
        run(engine, live, 30)
        self.assertEqual(len(done), 1)

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

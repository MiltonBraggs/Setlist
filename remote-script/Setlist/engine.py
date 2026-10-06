"""Timing-critical playback logic, executed inside Live's update loop.

The Setlist app sends a *plan* (stop / jump events at arrangement positions and
+LOOP regions) and *queued jumps*. This engine executes them as the playhead
crosses the positions, so timing never depends on network latency.

Exact boundary jumps use Live's own quantization: during the last grid interval
before the boundary we temporarily set the global quantization so the boundary
is the next grid point, and trigger the target locator's jump().

The engine only talks to Live through an adapter (see surface.LiveAdapter), so it
can be tested without Live (see tests/test_engine.py).
"""

EPS = 1e-4
# Live.Song.Quantization values and their length in beats (quarter notes).
Q_BAR = 4
GRID = [(5, 2.0), (7, 1.0), (9, 0.5), (11, 0.25), (13, 0.125)]
# Playhead moves larger than this between two updates are jumps, not playback.
DISCONTINUITY_BEATS = 1.0


def _on_grid(value, step):
    ratio = value / step
    return abs(ratio - round(ratio)) < EPS


class JumpEngine(object):
    def __init__(self, live, send, log):
        self.live = live
        self.send = send
        self.log = log
        self.events = []
        self.loops = []
        self.last_time = None
        self.pending = None          # boundary jump in progress
        self.queued_at = None        # boundary of a user-queued jump (overrides plan events there)
        self.active_loop = None      # loop region we enabled
        self.escaped_loop = None     # loop region the user escaped from
        self.loop_passes = 0
        self.count_in = None
        self.relocate_after_stop = None

    # ------------------------------------------------------------------ plan

    def set_plan(self, plan):
        self.events = sorted(plan.get("events", []), key=lambda e: e["at"])
        self.loops = plan.get("loops", [])
        if self.pending and self.pending["source"] == "plan":
            self._finish_pending(restore_only=True)

    # ------------------------------------------------------------- commands

    def play(self):
        self.relocate_after_stop = None
        self.last_time = self.live.time()
        self.live.start_playing()

    def resume(self):
        self.relocate_after_stop = None
        self.last_time = self.live.time()
        self.live.continue_playing()

    def stop(self):
        self.cancel_queue()
        self.live.stop_playing()

    def pause(self):
        position = self.live.time()
        self.cancel_queue()
        self.live.stop_playing()
        self._relocate(position)

    def jump(self, to, quantized):
        self.cancel_queue()
        self._leave_loop_if_outside(to)
        if not self.live.is_playing():
            self._relocate(to)
            return
        if quantized:
            cue = self.live.cue_at(to)
            if cue is not None:
                cue.jump()
                return
        self._jump_now(to)

    def queue(self, at, to):
        self.cancel_queue()
        self.queued_at = at
        # A queued jump escapes the current loop so the boundary is actually reached.
        if self.active_loop is not None and not (self.active_loop["start"] - EPS <= to < self.active_loop["end"] - EPS):
            self._escape_loop()
        self.pending = self._make_pending(at, to, "queue")

    def cancel_queue(self):
        if self.pending and self.pending["source"] == "queue":
            self._finish_pending(restore_only=True)
        self.queued_at = None

    def set_loop(self, on, start=None, length=None, count=None):
        if not on:
            self._escape_loop()
            return
        if start is None:
            return
        region = {"start": start, "end": start + length, "count": count, "full": False}
        self._enable_loop(region)
        self.escaped_loop = None

    def start_count_in(self, target, bars, on_done):
        num, den = self.live.signature()
        start = max(0.0, target - bars * num * 4.0 / den)
        self.cancel_queue()
        self._relocate(start)
        self.count_in = {"target": target, "done": on_done}
        self.relocate_after_stop = None
        self.last_time = start
        self.live.start_playing()

    # --------------------------------------------------------------- updates

    def on_playing_changed(self, playing):
        if not playing:
            if self.count_in:
                self.count_in["done"]()
                self.count_in = None
            if self.relocate_after_stop is not None:
                self.live.set_time(self.relocate_after_stop)
        self.last_time = self.live.time()

    def tick(self):
        # Live may move the playhead back to the start marker after stop_playing(),
        # so re-apply a pending relocation once playback has stopped.
        if self.relocate_after_stop is not None and not self.live.is_playing():
            if abs(self.live.time() - self.relocate_after_stop) > EPS:
                self.live.set_time(self.relocate_after_stop)
            self.relocate_after_stop = None
            self.last_time = self.live.time()

    def on_time(self, t):
        last = self.last_time
        self.last_time = t
        if not self.live.is_playing() or last is None:
            return

        if t < last - EPS:
            self._on_backwards(last, t)
            return
        continuous = t - last <= DISCONTINUITY_BEATS

        if self.count_in and last < self.count_in["target"] - EPS <= t:
            self.count_in["done"]()
            self.count_in = None

        self._update_pending(t)
        if not continuous:
            self._update_loops(t)
            return

        for event in self.events:
            at = event["at"]
            if at > t + 8:
                break
            if event["type"] == "jump":
                self._maybe_arm_plan_jump(event, t)
            elif last < at <= t + EPS and last < at - EPS:
                if self.queued_at is not None and abs(self.queued_at - at) < EPS:
                    continue
                self._fire_stop(event)
                return
        self._update_loops(t)

    # -------------------------------------------------------------- internals

    def _relocate(self, position):
        self.live.set_time(position)
        self.relocate_after_stop = position
        self.last_time = position

    def _jump_now(self, to):
        t = self.live.time()
        self.live.jump_by(to - t)
        self.last_time = to

    def _fire_stop(self, event):
        self.live.stop_playing()
        target = event["relocate"] if event["relocate"] is not None else event["at"]
        self._relocate(target)
        self._disable_loop()
        self.send({"type": "fired", "event": "stop", "at": event["at"]})

    def _make_pending(self, at, to, source):
        cue = self.live.cue_at(to)
        num, den = self.live.signature()
        bar = num * 4.0 / den
        grid = [(Q_BAR, bar)] + GRID if _on_grid(at, bar) else GRID
        quant = None
        for q, step in grid:
            if _on_grid(at, step):
                quant = (q, step)
                break
        return {
            "at": at,
            "to": to,
            # Jump to where playback continues anyway: only suppress plan events at `at`.
            "noop": abs(to - at) < EPS,
            "source": source,
            "cue": cue,
            "quant": quant if cue is not None else None,
            "armed": False,
            "prev_quant": None,
        }

    def _maybe_arm_plan_jump(self, event, t):
        if self.pending is not None:
            return
        if self.queued_at is not None and self.queued_at <= event["at"] + EPS:
            return
        loop = self.active_loop
        if loop is not None and abs(loop["end"] - event["at"]) < EPS:
            return  # the loop wraps here; arm once the loop is finished or escaped
        window = self._window_for(event["at"])
        if event["at"] - window - EPS <= t < event["at"] - EPS:
            self.pending = self._make_pending(event["at"], event["to"], "plan")
            self._update_pending(t)

    def _window_for(self, at):
        num, den = self.live.signature()
        bar = num * 4.0 / den
        if _on_grid(at, bar):
            return bar
        for _q, step in GRID:
            if _on_grid(at, step):
                return step
        return 0.0

    def _update_pending(self, t):
        p = self.pending
        if p is None:
            return
        at, to = p["at"], p["to"]
        if p["noop"]:
            if t >= at - EPS:
                self._finish_pending()
            return
        if p["armed"]:
            if abs(t - to) < 0.25:
                self._finish_pending()
            elif t >= at + 0.05:
                # Live didn't jump (e.g. quantization changed under us): fall back,
                # keeping the rhythmic phase by jumping relative to the boundary.
                self.live.jump_by(to - at)
                self._finish_pending()
            return
        if p["quant"] is not None:
            q, step = p["quant"]
            if at - step - EPS <= t < at - EPS:
                p["prev_quant"] = self.live.quantization()
                self.live.set_quantization(q)
                self._leave_loop_if_outside(to)
                p["cue"].jump()
                p["armed"] = True
            elif t >= at - EPS:
                # Boundary already reached without arming (queued too late).
                self.live.jump_by(to - t if t - at > 0.5 else to - at)
                self._finish_pending()
        elif t >= at - EPS:
            # No locator at the target: jump on crossing, preserving phase.
            self._leave_loop_if_outside(to)
            self.live.jump_by(to - at)
            self._finish_pending()

    def _finish_pending(self, restore_only=False):
        p = self.pending
        self.pending = None
        if p is None:
            return
        if p["prev_quant"] is not None:
            self.live.set_quantization(p["prev_quant"])
        if not restore_only:
            if p["source"] == "queue":
                self.queued_at = None
            self.last_time = self.live.time()
            self.send({"type": "fired", "event": "queued" if p["source"] == "queue" else "jump", "at": p["at"]})

    # ----------------------------------------------------------------- loops

    def _loop_for(self, t):
        for loop in self.loops:
            if loop["start"] - EPS <= t < loop["end"] - EPS:
                return loop
        return None

    def _same(self, a, b):
        return a is not None and b is not None and abs(a["start"] - b["start"]) < EPS and abs(a["end"] - b["end"]) < EPS

    def _update_loops(self, t):
        if self.escaped_loop is not None and not (self.escaped_loop["start"] - EPS <= t < self.escaped_loop["end"] - EPS):
            self.escaped_loop = None
        if self.active_loop is not None:
            if self.active_loop["start"] - EPS <= t < self.active_loop["end"] - EPS:
                return
            self._disable_loop()
        if self.pending is not None and self.pending["source"] == "queue":
            return
        region = self._loop_for(t)
        if region is not None and not self._same(region, self.escaped_loop):
            self._enable_loop(region)

    def _enable_loop(self, region):
        self.active_loop = region
        self.loop_passes = 0
        self.live.set_loop(True, region["start"], region["end"] - region["start"])
        self.send({"type": "patch", "state": {"loop": {"on": True, "start": region["start"], "length": region["end"] - region["start"]}}})

    def _disable_loop(self):
        if self.active_loop is not None:
            self.active_loop = None
            self.live.set_loop(False)

    def _escape_loop(self):
        if self.active_loop is not None:
            self.escaped_loop = self.active_loop
        self._disable_loop()
        if self.live.loop_on():
            self.live.set_loop(False)

    def _leave_loop_if_outside(self, to):
        loop = self.active_loop
        if loop is not None and not (loop["start"] - EPS <= to < loop["end"] - EPS):
            self._escape_loop()

    def _on_backwards(self, last, t):
        loop = self.active_loop
        if loop is not None and last >= loop["end"] - 1.0 and abs(t - loop["start"]) < 1.0:
            self.loop_passes += 1
            count = loop.get("count")
            if count is not None and self.loop_passes >= count - 1:
                self._escape_loop()
                self.send({"type": "fired", "event": "loopEnd", "at": loop["end"]})

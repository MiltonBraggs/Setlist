"""Run the real Setlist Remote Script against a simulated Live set.

    python remote-script/simulator/sim.py [set.json] [--plugin]

--plugin also simulates the "Setlist Sync" VST3 plugin on Master.

Lets you develop and test the app without Ableton: the server talks to this
process over the same UDP protocol it uses with Live.
"""

import json
import os
import socket
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import fake_live  # noqa: E402
from fake_plugin import FakePlugin  # noqa: E402

FRAME = 0.02      # playback resolution (s)
DISPLAY = 0.1     # Live calls update_display about every 100 ms
SPEED = float(os.environ.get("SIM_SPEED", "1"))  # >1 plays faster (for tests)
# Test hook: send {"click": beats} to this UDP port to simulate clicking in Live's arrangement.
DEBUG_PORT = 39199


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = args[0] if args else os.path.join(HERE, "demo_set.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    song = fake_live.Song(data)
    # Mimic a Live whose start marker can't be set through the API (exercises the start check).
    song.settable_start_time = os.environ.get("SIM_NO_START_TIME") != "1"
    fake_live.install(song)

    import Setlist  # noqa: E402  (imports Live / _Framework fakes)

    sys.stdout.reconfigure(line_buffering=True)
    surface = Setlist.create_instance(None)
    plugin = FakePlugin(song) if "--plugin" in sys.argv else None
    print("Simulated Live running with %d locators, %d tracks. Ctrl+C to quit." % (len(song.cue_points), len(song.tracks)))

    debug = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    debug.bind(("127.0.0.1", DEBUG_PORT))
    debug.setblocking(False)

    last_display = time.time()
    last = time.time()
    try:
        while True:
            time.sleep(FRAME)
            now = time.time()
            try:
                data, _ = debug.recvfrom(1024)
                msg = json.loads(data.decode("utf-8"))
                if "click" in msg:
                    song.click(msg["click"])
            except (BlockingIOError, OSError, ValueError):
                pass
            song.advance((now - last) * SPEED)
            if plugin:
                plugin.frame(last, now)
            last = now
            if now - last_display >= DISPLAY:
                last_display = now
                surface.update_display()
    except KeyboardInterrupt:
        surface.disconnect()


if __name__ == "__main__":
    main()

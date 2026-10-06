"""Run the real Setlist Remote Script against a simulated Live set.

    python remote-script/simulator/sim.py [set.json]

Lets you develop and test the app without Ableton: the server talks to this
process over the same UDP protocol it uses with Live.
"""

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))

import fake_live  # noqa: E402

FRAME = 0.02      # playback resolution (s)
DISPLAY = 0.1     # Live calls update_display about every 100 ms
SPEED = float(os.environ.get("SIM_SPEED", "1"))  # >1 plays faster (for tests)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "demo_set.json")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    song = fake_live.Song(data)
    fake_live.install(song)

    import Setlist  # noqa: E402  (imports Live / _Framework fakes)

    sys.stdout.reconfigure(line_buffering=True)
    surface = Setlist.create_instance(None)
    print("Simulated Live running with %d locators, %d tracks. Ctrl+C to quit." % (len(song.cue_points), len(song.tracks)))

    last_display = time.time()
    last = time.time()
    try:
        while True:
            time.sleep(FRAME)
            now = time.time()
            song.advance((now - last) * SPEED)
            last = now
            if now - last_display >= DISPLAY:
                last_display = now
                surface.update_display()
    except KeyboardInterrupt:
        surface.disconnect()


if __name__ == "__main__":
    main()

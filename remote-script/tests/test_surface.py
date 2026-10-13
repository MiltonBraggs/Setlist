"""Surface tests: the real Remote Script against the simulator's fake Live API."""

import os
import sys
import unittest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, "..", "simulator"))
sys.path.insert(0, os.path.join(HERE, ".."))

import fake_live  # noqa: E402

SET = {
    "tempo": 120,
    "cues": [[0, "Song"], [16, "SONG END"]],
    "tracks": [
        {"name": "Vocals +LYRICS", "clips": [["Line one", 0, 4], ["Line two", 4, 8]]},
        {"name": "Drums +NOTES", "clips": [["Kick only", 0, 8]]},
        {"name": "Bass"},
        {"name": "Chords +CHORDS", "clips": [["C-G-Am-F", 0, 4]]},
    ],
}


class FakeLink(object):
    def __init__(self, log):
        self.sent = []

    def send(self, message):
        self.sent.append(message)

    def receive(self):
        return []

    def close(self):
        pass


class SurfaceTests(unittest.TestCase):
    def setUp(self):
        self.song = fake_live.Song(SET)
        fake_live.install(self.song)
        import Setlist.surface as surface  # noqa: E402

        surface.UdpLink = FakeLink
        surface.Live = sys.modules["Live"]  # the module caches the first fake; point it at this test's song
        self.surface = surface.SetlistSurface(None)
        self.link = self.surface._link
        self.link.sent = []

    def tick(self):
        self.surface.update_display()
        sent, self.link.sent = self.link.sent, []
        return sent

    def test_snapshot_reports_notes_clips(self):
        state = self.surface._snapshot()
        drums = [t for t in state["tracks"] if t["name"] == "Drums +NOTES"][0]
        self.assertEqual([c["name"] for c in drums["clips"]], ["Kick only"])
        bass = [t for t in state["tracks"] if t["name"] == "Bass"][0]
        self.assertNotIn("clips", bass)

    def test_snapshot_reports_chords_clips(self):
        state = self.surface._snapshot()
        chords = [t for t in state["tracks"] if t["name"] == "Chords +CHORDS"][0]
        self.assertEqual([c["name"] for c in chords["clips"]], ["C-G-Am-F"])

    def test_fader_moves_send_only_a_mixer_message(self):
        self.song.tracks[2].mixer_device.volume.value = 0.5
        self.song.tracks[2].mute = True
        sent = self.tick()
        types = [m["type"] for m in sent]
        self.assertNotIn("patch", types)
        mixer = [m for m in sent if m["type"] == "mixer"]
        self.assertEqual(mixer, [{"type": "mixer", "tracks": [["t2", True, False, 0.5]]}])

    def test_structural_changes_send_the_full_track_list(self):
        self.song.tracks[0].arrangement_clips[1].name = "Line 2 (edited)"
        sent = self.tick()
        patches = [m for m in sent if m["type"] == "patch"]
        self.assertEqual(len(patches), 1)
        vocals = patches[0]["state"]["tracks"][0]
        self.assertEqual(vocals["clips"][1]["name"], "Line 2 (edited)")

    def test_rename_into_a_clip_track_starts_reporting_clips(self):
        self.song.tracks[2].name = "Bass +NOTES"
        sent = self.tick()
        patch = [m for m in sent if m["type"] == "patch"][0]
        self.assertIn("clips", patch["state"]["tracks"][2])

    def test_nothing_changed_sends_nothing_but_time(self):
        self.tick()
        sent = self.tick()
        self.assertEqual([m["type"] for m in sent if m["type"] != "time"], [])


if __name__ == "__main__":
    unittest.main()

# Setlist Sync (VST3 / AU)

An optional audio plugin that makes STOP and `+PAUSE` exact.

Live's API can only stop the transport on the Remote Script's ~100 ms tick. Setlist Sync runs in
the audio thread instead and does two things:

- **Exact stops:** when the playhead crosses a stop point, it starts a 5 ms fade on the exact sample, so
  the output is silent from the stop point on. The Remote Script then stops Live on its next tick.
- **Precise playhead:** it reports Live's playhead to Setlist about 60 times a second, and the UI uses it
  when the plugin is present.

**Safety:**
- If Live is still playing 750 ms after a stop point (for example, the Remote Script isn't running), the plugin fades back in.
- If the playhead jumps while the output is silent, the plugin fades back in.
- If the transport stays stopped for 1.5 s, the plugin re-opens so monitoring and tails pass again.

Without a position from the host, it never silences anything.

## Where to put it

Put an instance on **Master** and on every other path that leaves Live directly, such as a click or in-ear
track routed to its own interface outputs. Every instance gets the same stop points. Setlist shows the
connected instances under *Settings → Connection*.

## Building

You need CMake 3.22+ and a C++17 compiler:

- **Windows:** Visual Studio 2022 or its free Build Tools, with the *Desktop development with C++* workload (it includes CMake).
- **macOS:** Xcode, then `brew install cmake`.

JUCE 8 is downloaded automatically on the first configure.

```bash
cd plugin
cmake -B build
cmake --build build --config Release
ctest --test-dir build -C Release   # gate unit tests
```

Output:
- **Windows:** `build/SetlistSync_artefacts/Release/VST3/Setlist Sync.vst3`. Copy it to `C:\Program Files\Common Files\VST3`.
- **macOS:** `build/SetlistSync_artefacts/Release/VST3/Setlist Sync.vst3` and `.../AU/Setlist Sync.component`. Copy them to
  `~/Library/Audio/Plug-Ins/VST3` and `~/Library/Audio/Plug-Ins/Components`.

In Live, enable *Preferences → Plug-Ins → Use VST3 Plug-In System Folders*, then rescan.

To build only the gate unit tests, without downloading JUCE:

```bash
cmake -B build-tests -DSETLIST_TESTS_ONLY=ON && cmake --build build-tests && ctest --test-dir build-tests
```

## Protocol

The plugin sends UDP JSON to `127.0.0.1:39102`. Messages are typed in `packages/core/src/protocol.ts` (`PluginToServer` and `ServerToPlugin`).

- **Plugin → server:**
  - `{type:"hello", id, version, track}` every second.
  - `{type:"time", id, time, playing, tempo}` about 60 times a second while playing.
  - `{type:"gated", id, at}` when it silences the output.
- **Server → plugin:** `{type:"gates", points:[beats…]}`, sent in reply to every hello and whenever the plan or the queued jump changes.

## Files

| File | |
|---|---|
| `Source/Gate.h` | The stop gate. Plain C++, no JUCE, real-time safe |
| `Source/PluginProcessor.*` | Reads the host playhead and runs the gate on every block |
| `Source/Link.*` | Network thread (UDP JSON) |
| `Source/PluginEditor.*` | Status panel |
| `tests/GateTests.cpp` | Unit tests for the gate |

## License note

JUCE 8 is dual-licensed under AGPLv3 or a commercial license. That's fine for personal use; you'd need a JUCE license
to distribute a closed-source build.

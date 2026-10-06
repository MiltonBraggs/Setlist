# Setlist

Setlist and performance control for Ableton Live 12, modelled on [AbleSet](https://ableset.com/docs/all).
It reads the locators in your Arrangement as songs and sections and gives every phone, tablet or
laptop on your network a performance view, setlist editor, synced lyrics and a mixer. It also handles quantized
and queued jumps, loops, MIDI and OSC control.

## How it works

```
Ableton Live 12 ── Remote Script "Setlist" (Python, runs inside Live)
       │             executes timing-critical stops / jumps / loops at bar boundaries
       │ UDP 39100/39101 (localhost, JSON)
Setlist server (Node) ── state, setlists, MIDI in, OSC :39051, HTTP + WebSocket
       │
Browsers on the LAN (React UI)
```

The server sends the Remote Script a *plan* (stop and jump events, plus `+LOOP` regions), and the script executes it
inside Live's update loop. Boundary jumps use Live's own quantization, so they land exactly on the bar line
whatever the network latency.

| Path | What |
|---|---|
| `remote-script/Setlist/` | Live Remote Script (`surface.py` listeners/commands, `engine.py` jump engine) |
| `remote-script/simulator/` | Runs the real Remote Script against a fake Live, so you can develop without Ableton |
| `packages/core/` | Locator notation parser, song builder, playback plan, setlists, lyrics (shared TS) |
| `packages/server/` | Live bridge, app state and actions, storage, MIDI, OSC, HTTP/WebSocket |
| `packages/web/` | React UI: Performance, Setlist, Lyrics, Mixer, Settings |
| `apps/desktop/` | Electron tray app, Remote Script installer, packaging |

## Getting started

```bash
npm install
npm run build -w @setlist/web
```

**1. Install the Remote Script.** Copy `remote-script/Setlist` to
`Documents\Ableton\User Library\Remote Scripts\Setlist` (macOS: `~/Music/Ableton/User Library/Remote Scripts/Setlist`).
Restart Live, then choose **Setlist** as a Control Surface under *Preferences → Link, Tempo & MIDI*, with Input and Output set to None.
The desktop app's tray menu can also do this for you.

**2. Run the server.**

```bash
npm start -w @setlist/server
```

Open the printed URL (port 80, or 3000+ if 80 is taken) on any device on the same network.

### Development

```bash
npm run dev:sim   # simulated Live + server (:3000, auto-reload) + Vite UI (:5173)
npm run dev       # same, against real Live
npm test          # TS unit tests + Python engine tests
npm run typecheck
```

`SIM_SPEED=3 npm run sim` runs the simulator faster. Edit `remote-script/simulator/demo_set.json` to try other sets.

### Desktop app

```bash
npm approve-scripts electron   # this npm version blocks Electron's binary download by default
npm install
npm start -w @setlist/desktop  # tray app
npm run build                  # Windows installer in apps/desktop/release
```

## Locator notation

| Locator name | Meaning |
|---|---|
| `Song Title` | Song start |
| `> Verse` / `>> Chorus` | Section / quick-access section (button in Performance view) |
| `SONG END` | End of song: continues with the next song in the setlist |
| `STOP` / `AUTOSTOP` | Stops playback, then parks at the next song (or stays) depending on *Autojump*. Override with `+JUMP` / `+STAY` |
| `. Song Title` | Stop before this song |
| `* anything` | Ignored |
| `> Intro >>> Chorus` | When Intro ends, jump to Chorus (`>>> SONG END` skips to the next song) |
| `+STOP` `+PAUSE` `+SKIP` | Stop at / pause at / skip this section |
| `+LOOP` `+LOOP:4` `+LOOPFULL` | Loop the section until escaped (GO or →), or 4 times |
| `+END` | This and the following sections are optional (excluded from the duration and skipped) |
| `{Capo 2}` | Description |
| `[3:20]` | Manual duration |
| `[blue]` `[#ff8800]` | Color (gray, red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose) |
| `#tag` `[nosong]` `[.class]` | Search tag / not counted as a song / CSS class |
| `[c:2]` `[c:0]` | Count-in bars for this section (0 = none) |
| `[+2]` `[-1b]` | Transpose lyrics chords (semitones, `b` = prefer flats) |

**Section clips:** a MIDI track named `Sections` (or flagged `+SECTIONS`) with empty clips, one per section.
Without a locator these can only be jumped to while stopped. *Settings → Place locators on section clips* fixes that.

**Track flags:**
- `+G:NAME` / `+GROUP:NAME`: mixer group.
- `+GUIDE` / `+LOOPGUIDE` / `+JUMPGUIDE`: guide tracks that are muted and unmuted automatically.
- `+NEVERMUTE` / `+NM`: never muted.
- `Click` / `+CLICK`: soloed during count-in.
- `Measures`: one clip per bar, named with the bar label.

### Lyrics

A MIDI track flagged `+LYRICS`, with one clip per line, named with the text:

- **Inline formatting:** `**bold**`, `*italic*`, and `\` for a line break inside one clip.
- **Line options:** `[red]` color, `[large|small|tiny]` size, `[left|center]` alignment, `[mono]`. `[<]` / `[>]` put the line before / after the section header.
- **Chords:** ChordPro style, e.g. `[C]Neon [G]lights`.
- **Images:** `[img:file.png] [full]` shows an image from `<project folder>/Lyrics/`.
- **Track options:** `[top+2]`, `[nofade]`, `[nozoom]`, `[nosections]`, `[linemarker]`, `[progress]`, `[allsongs]`, `[+150ms]`, `[nochords]`, `[onlychords]`, `[chords:red]`, and `+CLIPCOLORS`.

## Control

**Keyboard:**
- Transport: `Space` play/pause, `⇧Space` play, `⇧R` record.
- Navigation: `←/→` song, `↑/↓` section, `⇧←/⇧→` bar.
- Loop, queue and lock: `L` loop, `J` / `⇧J` jump to queued (quantized / now), `C` cancel queue, `G` GO, `⇧L` lock.
- Setlist editor: `Ctrl+K` add song, `⇧S` save, `⇧O` load, `⇧H` hide removed, `Ctrl+P` print.
- Lyrics view: `.` / `,` next / previous line, `B` back to the current line, `M` / `N` jump to the next / previous line, `⇧M` pin.

**GO button:**
- Stopped after a song: moves to the next song.
- Stopped inside a song: starts playback.
- In a loop: escapes the loop.
- With a jump queued: jumps now.

**Jump modes:**
- Quantized: Live's global quantization.
- End of section.
- End of song.
- Dynamic: sections jump at the section end, songs at the song end.
- Manual: jumps only while stopped.

**MIDI:** *Settings → MIDI mapping → Add mapping* starts learn mode. A mapping can run a named action or a custom OSC
string such as `/global/stop; //sleep 500; /setlist/jumpBySongs 1`. External targets also work, for example `192.168.1.25:10023/ch/01/mix ON`.
On Windows a MIDI port can only be opened by one app, so disable the device in Live's MIDI preferences.

**OSC (UDP 39051):**
- Transport: `/global/play|pause|stop|playPause|go|toggleRecording`.
- Setlist: `/setlist/jumpBySongs n`, `/setlist/jumpToSong name|index`, `/setlist/jumpBySections n`, `/setlist/jumpToSection name`, `/setlist/jumpToQueued[Now]`, `/setlist/cancelQueued`.
- Sections and loops: `/sections/next|previous`, `/loop/toggle|enable|escape`.
- Mixer and notifications: `/mixer/group NAME mute|unmute|toggleMute|solo|unsolo|toggleSolo|volume v`, `/notify/big all "text"`.
- Subscriptions: send `/subscribe [host] port` to receive `/global/isPlaying`, `/setlist/activeSongName`, `/setlist/nextSongName`,
  `/setlist/activeSectionName`, `/setlist/songProgress`, `/setlist/setRemaining`, … (for example with Bitfocus Companion or Stream Deck).

## Data

Settings and setlists live in `%APPDATA%\setlist` (macOS: `~/Library/Application Support/setlist`). Override this with
`SETLIST_DATA_DIR`. Live doesn't expose the path of the open `.als`, so setlists are stored per project, recognised by
which songs it contains.

## Known limitations

- **STOP and +PAUSE timing.** These fire on the Remote Script's ~100 ms tick, so playback can stop up to about 100 ms after the locator. Jumps don't have this problem. Place STOP locators slightly after the song's tail.
- **Locator grid.** Put locators on the bar or beat grid. Off-grid targets fall back to a less precise jump.
- **Tempo changes.** Song durations assume the tempo shown in Live; tempo automation isn't accounted for.
- **Not built yet.** Canvas builder, voice cues/TTS, AbleNet redundancy, audio interface control and multi-file projects.

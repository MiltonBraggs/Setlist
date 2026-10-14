# Setlist

Setlist and performance control for Ableton Live 12, modelled on [AbleSet](https://ableset.com/docs/all).
It reads the locators in your Arrangement as songs and sections and gives every phone, tablet or
laptop on your network a performance view, setlist editor and synced lyrics and chords. It also handles quantized
and queued jumps, loops, MIDI and OSC control.

## How it works

```
Ableton Live 12 ── Remote Script "Setlist" (Python, runs inside Live)
       │             executes timing-critical stops / jumps / loops at bar boundaries
       │ UDP 39100/39101 (localhost, JSON)
Setlist server (Node) ── state, setlists, MIDI in, OSC :39051, HTTP + WebSocket
       │
Browsers on the LAN (React UI) ── owner devices and viewer devices
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
| `packages/web/` | React UI: Performance, Setlist, Lyrics, Settings |
| `apps/desktop/` | *On hold.* Electron tray app (not built or installed) |
| `plugin/` | *On hold.* "Setlist Sync" VST3/AU for exact stops, see [plugin/README.md](plugin/README.md). The server only talks to it with `SETLIST_PLUGINS=1` |

## Getting started

Needs Node.js 22.12 or newer (Python only for the tests and the simulator).

```bash
npm install
```

**1. Install the Remote Script** on the computer running Live:

```bash
npm run install-script
```

It finds Live's User Library (including one moved in *Preferences → Library*, or Documents inside OneDrive) and
copies `remote-script/Setlist` into its `Remote Scripts` folder. If it can't find it, pass the path:
`npm run install-script -- "D:\Music\User Library"`. Restart Live, then choose **Setlist** as a Control Surface under
*Preferences → Link, Tempo & MIDI*, with Input and Output set to None.

**After every `git pull`, run `npm run install-script` again and restart Live.** The script runs inside Live, so
pulling the repo doesn't update it. When Live runs an old copy, the owner sees an orange banner and the server prints
a warning, because an old script silently breaks newer features: chords from a `+CHORDS` track, part notes, and GO
starting from the song the UI shows.

**2. Run the server.**

```bash
npm start
```

This builds the web page first, so phones always get the version you pulled; a phone that still has the old page
open reloads itself when it reconnects. Open the printed URL (port 80, or
3000+ if 80 is taken) on any device on the same network.

### Development

```bash
npm run dev:sim   # simulated Live + server (:3000, auto-reload) + Vite UI (:5173)
npm run dev       # same, against real Live
npm test          # TS unit tests + Python engine tests
npm run typecheck
```

`SIM_SPEED=3 npm run sim` runs the simulator faster. Edit `remote-script/simulator/demo_set.json` to try other sets.

## Setlists

Every Live set starts with an **All songs** setlist in arrangement order. New songs you add in Live appear in it automatically.

- **New setlist** (on the Setlist page, or ⇧S): name it and tap songs in the order you'll play them.
- **Switching:** tap a setlist's pill at the top of the Setlist page. Performance, the playback plan and OSC all follow the active setlist.
- **Edit:** drag to reorder, remove and restore songs, and add songs. Changes save automatically.
- **Options:** rename, duplicate, delete, import or export (text or JSON), or sort back to arrangement order.
- **New songs:** songs added in Live later show up dimmed in your own setlists, ready under *Add songs*, so a setlist you built never changes by itself.

## Owner and viewers

Setlist has two roles:

- **Owner:** full control, including Settings. The computer running Setlist is always owner.
- **Viewer:** bandmates' phones and tablets. They get whatever the owner allows.

Until you set an **owner PIN** (*Settings → Owner and bandmates*), every device is owner. Once a PIN is set:

- Any other device opens as a viewer. Tapping *Viewer · Sign in* and entering the PIN makes it an owner, and it stays owner after reloads.
- Changing or removing the PIN signs out every other owner device.
- Wrong PINs are rate-limited, and the PIN is stored only as a hash.

The owner decides, for all viewers at once:

- **Pages:** Performance, Setlist and Lyrics. Settings is always owner-only.
- **Lyrics tracks:** which `+LYRICS` tracks viewers can open.
- **Controls:** play, stop and GO; jumping to songs and sections; editing the setlist.

Permissions are enforced by the server, not just hidden in the UI.

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
| `Metronome +METRONOME` | Click-only emergency section (also `+METRO`; the `>` is optional with this flag). Put it **before** the song's `STOP` / `SONG END`: anything after those isn't part of the song. Never played in the normal flow; the *Metronome* button jumps in and it loops until you leave |
| `{Capo 2}` / `{Key of E}` | Description. On a song locator, put the key here: it's shown with the song on the Performance page (song card, setlist, *Next*), the Lyrics page and the Setlist page |
| `[3:20]` | Manual duration |
| `[blue]` `[#ff8800]` | Color (gray, red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose) |
| `#tag` `[nosong]` `[.class]` | Search tag / not counted as a song / CSS class |
| `[c:2]` `[c:0]` | Count-in bars for this section (0 = none) |
| `[+2]` `[-1b]` | Transpose lyrics chords (semitones, `b` = prefer flats) |

**Section clips:** a MIDI track named `Sections` (or flagged `+SECTIONS`) with empty clips, one per section.
Without a locator these can only be jumped to while stopped. *Settings → Place locators on section clips* fixes that.

**Track flags:**
- `+GUIDE` / `+LOOPGUIDE` / `+JUMPGUIDE`: guide tracks that are muted and unmuted automatically.
- `+NEVERMUTE` / `+NM`: never muted.
- `Click` / `+CLICK`: soloed during count-in.
- `Measures`: one clip per bar, named with the bar label.
- `+NOTES` / `+NOTES:ALL`: part notes (see below).

### Lyrics

A MIDI track flagged `+LYRICS`, with one clip per line, named with the text:

- **Inline formatting:** `**bold**`, `*italic*`, and `\` for a line break inside one clip.
- **Line options:** `[red]` color, `[large|small|tiny]` size, `[left|center]` alignment, `[mono]`. `[<]` / `[>]` put the line before / after the section header.
- **Chords:** ChordPro style, e.g. `[C]Neon [G]lights`.
- **Images:** `[img:file.png] [full]` shows an image from `<project folder>/Lyrics/`.
- **Track options:** `[top+2]`, `[nofade]` (don't mark the current line), `[nosections]`, `[linemarker]`, `[progress]`, `[allsongs]`, `[+150ms]`, `[nochords]`, `[onlychords]`, `[chords:red]`, and `+CLIPCOLORS`.

**Several views.** Make one `+LYRICS` track per view, for example `Vocals +LYRICS`, `Chords +LYRICS [onlychords]` and
`Harmony +LYRICS [blue]`. Each becomes a tab on the Lyrics page. If a track has chords, a *Lyrics / Lyrics + Chords / Chords*
toggle appears. Its starting value comes from the track's `[nochords]` / `[onlychords]`, and each device remembers its own choice.

### Chords track

Writing `[C]` into every lyric clip is slow. Instead, add a MIDI track flagged `+CHORDS` (for example `Chords +CHORDS`)
and name its clips after the chords:

| Clip name | Result |
|---|---|
| `Am` | One chord for the whole clip |
| `C-G-Am-F` | The clip is split evenly: in a 1-bar 4/4 clip, one chord per beat; in a 4-bar clip, one per bar |
| `C--G-` | An empty slot holds the chord before it: C for 2 beats, then G for 2 beats |

Mix both styles freely: one clip per chord with any length you like, or one clip per bar or phrase.

- **Lyrics + Chords:** each chord appears over the word sung when it starts (placed by time within the lyric clip;
  a chord up to a beat early counts as a pickup on the first word). Chords between lyric lines (intros, solos, endings)
  show as rows of bars, aligned to the section's bar grid.
- **Chords:** a full chord chart per section, four bars to a row (two on phones). Held chords are dimmed, the chord
  playing now is highlighted, and tapping a chord jumps there.
- With a `+CHORDS` track, every lyrics tab gets the **Lyrics / Lyrics + Chords / Chords** toggle (on phones the
  middle option reads *Both*). Each device remembers its choice. A set with no `+LYRICS` track shows the `+CHORDS`
  track as its own chord-chart tab.
- Lyric lines that already have inline `[C]hords` keep them; every other line takes its chords from the `+CHORDS`
  track, so you can move over gradually.
- When a song shows no chords, the owner sees why under the toolbar: an old Remote Script in Live, a `+CHORDS` track
  with no clips in the Arrangement (clips in Session View aren't read), or no chord clips in that song yet.
- `[+2]` on the `+CHORDS` track name transposes it; the song's own transpose applies on top.

### Part notes

Instructions for one instrument (*Kick only*, *Full beat*) or for the whole band (*STOP – only piano*):

| Track | Who sees it |
|---|---|
| `Drums +NOTES`, `Keys +NOTES`, … | Devices that follow that part. Each device picks its parts under *Parts…* on the Performance page |
| `Band +NOTES:ALL` | Every device, as an orange callout. It also appears 8 bars before it starts, with a countdown |
| `> Bridge {STOP – only piano}` (section description) | Everyone, as a band cue: in orange beside the section on the Lyrics page, under the section name in the Performance *Now* card, and in the *Next* card before it starts |

Each clip's name is the instruction, shown while the playhead is inside the clip, and `**bold**` and `[color]` work.
The next instruction shows with a bar countdown, for example *Then Full beat · in 2 bars*. Notes appear on the
Performance page and as a strip at the top of the Lyrics page.

### Pages

- **Performance** (owner, drummer): a tappable setlist on the left (tap a song to queue it, or to jump while stopped),
  the song card, *Now* / *Next* with section cues and a bar countdown, and every section as a button. Long songs wrap
  the section buttons onto more rows instead of shrinking them. Fits a 1280×650 laptop or an iPad without scrolling.
  When a song's locator comes before its first section (for example a one-bar gap before `> Intro`), the section
  buttons start with one named after the song: it jumps back to the song locator, timed like a section button, and
  *Now* shows the song's name during that gap.
- **Metronome (emergency click):** give each song a click-only section, best as its last section before the
  `STOP` / `SONG END`, e.g. a locator `Metronome +METRONOME` over a few bars with only the click playing. Setlist never plays
  it in the normal flow (the song ends where it starts). The orange **Metronome** button on the song card jumps
  into it at the next bar, at the song's tempo, and it loops for as long as you need. The button then reads
  **Back to Chorus** (the section you left): it, or GO, goes back there at the next bar; tapping any section works
  too. Also on `K`, OSC `/setlist/metronome`, and MIDI (*Settings → MIDI*), e.g. for a footswitch.
- **Lyrics** (singers, band): each section header has its cue and a row of dots, one per bar (one per 2–8 bars in
  very long sections), filled as the section plays, so you can see how much of it is left.
- Each device reopens on the page it last used.

## Control

**Keyboard:**
- Transport: `Space` play/pause, `⇧Space` play, `⇧R` record.
- Navigation: `←/→` song, `↑/↓` section, `⇧←/⇧→` bar.
- Loop, queue and lock: `L` loop, `J` / `⇧J` jump to queued (quantized / now), `C` cancel queue, `G` GO, `⇧L` lock.
- Emergency click: `K` Metronome (again, or `G`, to go back).
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
- Sections and loops: `/sections/next|previous`, `/loop/toggle|enable|escape`, `/setlist/metronome`.
- Notifications: `/notify/big all "text"`.
- Subscriptions: send `/subscribe [host] port` to receive `/global/isPlaying`, `/setlist/activeSongName`, `/setlist/nextSongName`,
  `/setlist/activeSectionName`, `/setlist/songProgress`, `/setlist/setRemaining`, … (for example with Bitfocus Companion or Stream Deck).

## Data

Settings and setlists live in `%APPDATA%\setlist` (macOS: `~/Library/Application Support/setlist`). Override this with
`SETLIST_DATA_DIR`. Live doesn't expose the path of the open `.als`, so setlists are stored per project, recognised by
which songs it contains.

## Known limitations

- **STOP and +PAUSE timing.** These fire on the Remote Script's ~100 ms tick, so playback can stop up to about 100 ms after the locator. Place STOP locators slightly after the song's tail.
- **Locator grid.** Put locators on the bar or beat grid. Off-grid targets fall back to a less precise jump.
- **Tempo changes.** Song durations assume the tempo shown in Live; tempo automation isn't accounted for.
- **Screen sizes.** The Performance page fits laptop screens down to a 1280×650 browser window without scrolling. On phones it stacks and scrolls.
- **Not built yet.** Canvas builder, voice cues/TTS, AbleNet redundancy, audio interface control and multi-file projects.

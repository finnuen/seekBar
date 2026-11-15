# Release notes

## v1.2

The automatic GIF handling from 1.1 is gone — it misfired on real videos — and is replaced by four settings, all on by default so nothing changes for anyone who does not open the popup.

- A clip counts as a GIF when its file name ends in `.gif`, `.webp` or `.apng`, which is how Reddit serves one (an MP4 payload under the original name). Everything else is a video. Nothing about the media is sniffed.
- **Shortcut control for** — GIF and Video, both on. Turn one off to leave that kind to the site while the keys act on the other.
- **Progress line for** — GIF and Video, both on, so you can have the line without the keys or the keys without the line.
- **Max progress lines** — 2 by default. The clip the shortcuts act on always keeps its line, so pressing Space always moves something you can see; the rest of the budget goes to the most recently started clips, and the newest of them sits at the bottom edge. 0 turns every line off.
- **Jump forward on GIF** (2 s) and **on video** (3 s) — the plain `←`/`→` step, per kind. `Ctrl` + arrow still jumps 30 s.
- The speed fix from 1.1 stays: two quick presses no longer make the speed jump back to the older value while the change is being saved.

## v1.1

- GIFs that sites ship as short silent `<video>` loops — Discord messages, Reddit comment sections — no longer get a progress line, and the shortcuts skip them. A short looping clip that has sound is still a video and keeps its line.
- Pressing a speed key twice in quick succession no longer makes the speed jump back to the older value for a moment while the change is being saved.

## v1.0

First release.

- Keyboard control for every `<video>` on every website: play/pause, seek 3 s (30 s with Ctrl), volume, mute, fullscreen, and speed in 10% steps.
- Speed carries over to the next video, is shared across tabs, and is kept between sessions. `Ctrl` + `` ` `` resets it.
- A thin progress line at the bottom of the window for each playing video, in a color of your choice, with per-site blacklist/whitelist lists.
- Videos inside closed shadow DOM and inside iframes are found and controlled.
- Volume keys (`↑`/`↓`) and `M` set the video element's own volume and mute, 5% per press, so they work the same way on every site and nothing is saved. One press up from a muted video starts at a listenable level instead of full blast. Some players keep a mute icon or volume slider of their own and will not redraw it, so **audio control is a little bit buggy** and is **off by default**; turn on *Enable audio control* in the popup to use those three keys.
- Manifest V3, no network access, no data collection.

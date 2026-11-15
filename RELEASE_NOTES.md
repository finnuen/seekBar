# Release notes

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

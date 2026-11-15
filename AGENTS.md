# AGENTS.md

Guide for anyone (human or AI agent) modifying **seekBar**. Read this before changing code.

## What this is

A Manifest V3 Chromium extension built on top of two earlier extensions, used as reference rather than merged:

- **progressBar** — a thin progress line at the bottom of the window for every playing video, with color and per-site settings;
- **Meta Video Control** — keyboard shortcuts for the video under the cursor.

Two things from those two were deliberately not carried over. *Enable audio at start* is gone: it forces sound on a page, which fights the player and the browser's autoplay rules. Global volume memory is gone too: storing a volume and re-applying it to every video would make the extension decide how loud every site is. The volume keys that survived set the element's own `volume`/`muted` for the video being watched, store nothing, and are off until *Enable audio control* is switched on (see rule 4).

Playback speed is the only setting that is carried.

seekBar works on **every website**, not a fixed list, and is built to reach videos that ordinary content scripts cannot: inside closed shadow DOM, inside open shadow DOM, and inside frames.

## Files

| File | Role |
| --- | --- |
| `extension/manifest.json` | MV3 definition: content scripts in two worlds, permissions, icons, popup |
| `extension/content.js` | Isolated world. Reads settings/speed from `chrome.storage`, relays to the page world, injects the overlay stylesheet, writes speed changes back |
| `extension/main.js` | Page world. Video discovery, overlay lines, keyboard control, volume/mute, speed carry-over, paused-stays-paused |
| `extension/background.js` | Service worker. Injects both scripts into tabs that were already open |
| `extension/popup.html` | Popup layout and the shortcut list |
| `extension/popup.css` | Popup styles (dark, blue accent) |
| `extension/popup.js` | Speed slider/reset, color picker, site lists |
| `extension/icons/` | 16, 32, 48, 128 px PNGs, drawn by `tools/make-icon.ps1` |
| `tools/make-icon.ps1` | Builds the icons from geometry (wifiForce tile: blue gradient, white mark) |
| `tools/make-key.js` | Creates `key.pem` on first build |
| `tools/build.ps1` | Builds `build/seekBar_v<version>.zip` and `.crx` |
| `README.md`, `RELEASE_NOTES.md` | User-facing docs |

No bundler, dependency or test framework. `extension/` is loaded as-is.

## Design rules (don't break these)

1. **Works on every site.** No site selectors or class names; only standard `<video>` behavior. `manifest.json` matches `<all_urls>`, all frames.
2. **Two worlds, one job each.** Storage and CSS injection live in the isolated world (`content.js`); DOM discovery and key handling live in the page world (`main.js`). Page-world code cannot call `chrome.storage`; don't try.
3. **Minimal interference.** A key is swallowed (`preventDefault` + `stopImmediatePropagation`) only when a video is on screen and the extension acted on that key. Everything else passes through. With *Enable audio control* on, `↑`/`↓` are volume while a video is on screen, so they stop scrolling there; with no video on screen, or the switch off, they scroll normally. `Ctrl`+`↑`/`↓` is left to the browser.
4. **Audio control is a gate, and it is off until it is switched on.** `↑`/`↓`/`M` set `video.volume` / `video.muted` on the target video and nowhere else. Never store a volume, never re-apply one on `loadedmetadata`/`play`, never unmute on page load, no *Enable audio at start*. This deliberately works below the site: a player that keeps its own mute flag or level will not redraw its icon or slider, which is why `settings.audioControl` (popup: *Enable audio control*, default off) gates the three keys — while it is off they return `false` from `handle()` and the site gets them untouched. Do not reintroduce control-clicking heuristics for mute or level: that path was tried, is unreliable across players, and was rejected.
5. **Only speed is carried.** `rate` is applied to videos and stored; `volume`/`muted` are not stored at all and are touched only in response to a key press.
6. **Self-healing.** The overlay, its lines and its stylesheet are recreated if a site removes them.
7. **Minimal permissions.** `storage`, `tabs`, `scripting`, and `<all_urls>` host access. No network requests, no analytics, no remote code.

## The relay (content.js ↔ main.js)

`window.postMessage` with `source: 'seekbar'`:

| Direction | Message | Meaning |
| --- | --- | --- |
| main → content | `{type:'ready'}` | main is alive; content replies with settings |
| main → content | `{type:'need-style'}` | stylesheet missing; inject it |
| main → content | `{type:'carry', rate}` | store the speed (`null` = remove the saved speed) |
| content → main | `{type:'settings', settings, siteActive, rate, id}` | full state; also sent after every storage change |
| content → main | `{type:'style-injected'}` | CSS just landed; let the overlay pick it up |

`id` (content's per-frame `PAGE_ID`) is written into `carry.src`. A storage change whose `src` is this frame's own id is ignored, so rapid key presses are not overwritten by stale echoes. Every other change is adopted and applied.

Each push also carries `seq`, a counter for that frame's pushes, and a push that follows a write sends the rate just written instead of re-reading storage. Two fast key presses start two overlapping storage reads, and without that pair the older read can finish last and hand the tab the speed from one press ago; `main.js` drops a push whose `seq` it has already passed (a new `id`, from a re-injected `content.js`, restarts the count).

`content.js` may be re-injected after an extension reload; it disposes the previous instance through `window.__seekBarRelay.dispose()` before taking over. `main.js` guards itself with `window.__seekBarMain` and survives reloads, which is fine because it uses no extension APIs.

## Storage

- Settings — `chrome.storage.sync`, with a local fallback:
  `{ enabled, color, mode, whitelist[], blacklist[], history[], audioControl }`
  If sync refuses writes, the popup writes to `local` with `__storeMode: 'local'` and both readers prefer the local copy. Keep this rule in both `content.js` and `popup.js`.
- Speed — `chrome.storage.local` under `carry`:
  `{ rate, src }`
  `rate` absent/`null` means "no saved speed — use the site's default". `src` is a writer id (`content`'s `PAGE_ID` or `'popup'`).

Volume and mute are **not** stored anywhere: `audioControl` switches the keys on or off, it does not remember a level.

## main.js internals

### Discovery

- `scan(root)` queries `video` in the document or a shadow root, recurses into open roots, and observes the root.
- `absorb(node)` handles mutation records: videos and shadow hosts in an added subtree.
- `Element.prototype.attachShadow` is wrapped at `document_start`, before page code, so **closed** roots are observed and scanned too. This is the reason the script is in the page world.
- A 2-second watchdog rescans the document (skipped while `document.hidden`).
- `tracked` is a `Map<HTMLVideoElement, entry>` used by both the overlay and the keyboard.

### Overlay

- `#seekbar-overlay-root` is a fixed, zero-height, `pointer-events: none` element at the bottom; its styles live in `content.js` and are injected by that script (page CSP does not apply to content-script CSS).
- One `.sb-line` per video that has started playing. Height 2 px, stacked with a 3 px stride; newest discovered at the bottom.
- Determinate video: `transform: scaleX(currentTime / duration)`.
- Live stream playing: dim track + sliding `.sb-glide`; paused live: dim static line.
- A paused video keeps its frozen line only while it is on screen. A video that never played shows nothing.
- Fullscreen (`document.fullscreenElement`) hides all lines; exiting brings them back.

### Video selection

1. Fullscreen: the fullscreen video itself, or a tracked video inside the fullscreen element. `withinHost()` walks `parentNode`/`host` because `Node.contains` does not cross a shadow boundary.
2. Hovered: `pointermove` remembers the last mouse position; the video whose client rect contains it. Uses `tracked`, not `elementsFromPoint`, so closed-shadow videos participate.
3. Most visible: viewport-intersection area, weighted 1.5x when playing.

### Key handling

- One `keydown` on `window` in the capture phase, plus a matching `keyup` that swallows the same `code` (stops a focused button from being "clicked" by Space).
- Ignored: `defaultPrevented`, Alt/Meta, any Ctrl combo except `←`/`→`/`` ` ``, and typing in editable elements. The real target comes from `composedPath()[0]` so inputs inside shadow roots are recognised.
- `handle()` returns true only when it acted; only then is the event blocked.
- Toggles (Space/P, F, `M`, reset) ignore key repeat; seeking, speed and volume allow it, so holding a key ramps.
- `0` is speed 1x; Ctrl+`0` is *not* used, so browser zoom reset keeps working.
- Speed: `RATE_STEP = 0.1`, `RATE_MIN = 0.25`, `RATE_MAX = 4`, values rounded to 2 decimals.
- Volume: `VOLUME_STEP = 0.05`, clamped to 0–1 and rounded to 2 decimals. `volumeBy()` unmutes only when raising; lowering a muted video keeps it muted. A video muted by its site usually still carries volume 1, so the unmuting press caps the level at `UNMUTE_CAP` (0.5) before stepping, instead of jumping to full blast; a video muted with the keys keeps the level it had.
- `settings.audioControl` (popup switch *Enable audio control*, **default off**) gates the `ArrowUp`/`ArrowDown`/`M` cases in `handle()`: while it is off they return `false`, so the key falls through to the page — `↑`/`↓` scroll and `M` does whatever the site does with it. The popup writes it with the other settings; `content.js` relays it in every push.
- The Ctrl allow-list lives in the pre-filter **and** in `handle`; change both.

### Speed carry-over

- `carryRate` mirrors the stored `carry.rate`.
- `applyCarry(v)` sets `defaultPlaybackRate` and `playbackRate`. The default rate is what a player falls back to when it loads the next source into the same element.
- Applied on `loadedmetadata`, `play`, `playing`, when settings arrive from the popup/another tab, and on `ratechange` within `SETTLE_MS` (3 s) of the video starting — that is the window in which players reset it.
- A removed setting (`null` in a settings push) resets that tab's target video to 1x. A setting that never existed changes nothing, so the site's own default speed is respected.
- `setRate` writes the value locally first, then asks `content.js` to store it. Reset posts `rate: null`.

### Paused stays paused

- `pausedByUs` marks videos paused with Space/P; `onPlayAttempt` re-pauses a marked video unless real input (`keydown`, `pointerdown`, `touchstart`) happened within `INPUT_MS` (1 s), or 20 blocks have already happened.
- `hold()` resets `lastInput`, because our own key press is not a request to play.
- The mark is cleared by resuming with Space/P, by real input before a play, or by `loadstart`/`emptied` (new source, reused element).

## Keeping things in sync

- **Shortcut changes:** `main.js` (`handle`, Ctrl pre-filter), the table in `popup.html`, the table in `README.md`, `RELEASE_NOTES.md`.
- **Step or range changes:** constants at the top of `main.js` (`RATE_STEP`, `RATE_MIN`, `RATE_MAX`, `VOLUME_STEP`), the slider in `popup.html` (currently `min 0.25`, `max 4`, `step 0.05`, so keyboard values are representable), and the README text.
- **Storage changes:** `content.js`, `popup.js` (and `main.js` if it consumes the field).
- **Overlay style:** `content.js` (`STYLE`) and the class names used by `tick()`/`makeLine()`.
- **Add a site-independent feature:** keep it out of `manifest.json` `matches`; everything already runs everywhere.

## Testing (manual)

Load `extension/` from `chrome://extensions` (Developer mode, *Load unpacked*), then open a page with video.

1. Every shortcut works on a normal `<video>` (YouTube, a news site) and on a social feed with several videos; the hovered video is the target.
2. Speed changes by 10% per press, survives a scroll to the next video, another tab, and a browser restart; `0` returns to 1x; `Ctrl` + `` ` `` clears it.
3. Typing in a comment box or search field does not trigger anything.
4. Volume (with *Enable audio control* on): `↑`/`↓` move the target video 5% per press, holding them ramps, `M` mutes and unmutes; one press up from a muted video lands around 50%, not at full blast. Scroll to the next video and confirm the volume did **not** follow; reload and confirm nothing was remembered. With no video on screen, or the switch off, `↑`/`↓` scroll the page.
5. Popup switch *Enable audio control*: it starts off, so `↑`/`↓` must scroll the page and `M` must do nothing to the video. Switch it on and they control the video; switch it off and they go back to the site. The switch must survive a reload.
6. A paused video stays paused after switching tabs and back (Instagram is the useful test).
7. The line matches the video's progress, stacks for several videos, hides in fullscreen, and stays put when paused.
8. A site whose player is a web component (shadow DOM) is controlled; test a closed root if you can.
9. A video inside an iframe responds while the frame has focus.
10. Popup: enable/disable, the audio switch, speed slider and reset, color presets/custom, site lists. The speed slider moves while the keyboard changes speed.
11. After an extension reload, open tabs either keep working (old main.js) or are re-injected; a tab that misbehaves should be reloaded.

There is no committed automated test. A throwaway smoke test can load the unpacked extension into headless Edge over CDP and drive synthetic keydown events; it is worth doing after changes to `main.js`.

## Releasing

1. Bump `version` in `extension/manifest.json` — plain `major.minor`, e.g. `1.1`.
2. Add that version at the top of `RELEASE_NOTES.md`.
3. Commit and tag with the bare version, no `v`:
   ```sh
   git tag -a 1.1 -m "seekBar 1.1"
   ```
4. Build:
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\build.ps1
   ```
   This writes `build/seekBar_v1.1.zip` and `build/seekBar_v1.1.crx`.
5. Attach them to the release under the unversioned names:
   ```
   seekBar.zip
   seekBar.crx
   ```
   The zip root is the folder `seekBar`, so unzipping gives a folder to point *Load unpacked* at. The build writes entry names with forward slashes; verify after any change to the build script.
6. Title the release `seekBar v1.1` (lowercase `v`, space), body = that version's release notes section.

### The signing key

- `key.pem` fixes the extension ID. A different key produces a different extension, so installed copies would not update.
- It is gitignored and created by the first build. Keep a backup outside the repository; git cannot give it back.
- Browsers often refuse `.crx` files that are not from a web store, so *Load unpacked* stays the primary documented install path.

## Known limitations

- Canvas-only players with no `<video>` element cannot be controlled.
- Cross-origin frames each run their own copy; a key press only reaches the frame that has focus.
- A site that registers its own capture-phase `keydown` on `window` before this script loads could see a key first. The script loads at `document_start`, so this is unlikely but possible.
- Fullscreen uses the raw video element, so the site's controls are not shown.
- Changes made in a site's own speed menu are not saved.
- Resuming a video we paused can produce a brief audio blip before it is paused again.
- Audio control is a gate, so a player that keeps a mute icon or volume slider of its own will not redraw it, and the site may keep sounding muted while the element is not (Instagram, Threads, Facebook). That is expected, is stated in the popup and the README, and is why the gate is off by default behind *Enable audio control*.

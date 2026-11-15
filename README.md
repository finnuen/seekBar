# seekBar

Keyboard video controls and a progress line, on every website — a Chromium extension.

Any page, any site: press a key and the video under your cursor responds, without hunting for the player's own controls. While a video plays, a thin line at the very bottom of the window shows how far along it is. Videos inside shadow DOM — even closed shadow roots — and inside iframes are found too, because the script runs in the page's own JavaScript world and wraps `attachShadow` before any site code does.

## Shortcuts

| Key | Action |
| --- | --- |
| `Space` / `P` | Play / pause |
| `←` / `→` | Seek back / forward 3 s |
| `Ctrl` + `←` / `→` | Seek back / forward 30 s |
| `↑` / `↓` | Volume up / down (needs *Enable audio control*) |
| `M` | Mute / unmute (needs *Enable audio control*) |
| `F` | Fullscreen the video |
| `-` / `=` | Speed down / up 10% per press |
| `0` | Speed back to 1x |
| `Ctrl` + `` ` `` | Reset the saved speed |

Volume and mute are the one part that works by setting the video element's own `volume` and `muted` — a gate between the site and its player. That is what makes them behave the same way on every site, and it is also their weakness: a site that keeps a mute icon or a volume slider of its own will not redraw it, so the sound changes and its control does not. **Audio control is a little bit buggy** because of it, so it is **off by default**: turn on *Enable audio control* in the popup to let `↑`, `↓` and `M` take the keys, and leave it off to keep those three keys with the site. Nothing is stored, no other video is touched, and the extension never turns sound on by itself.

## Install

**Load unpacked (recommended)**

1. Download and unzip `seekBar.zip`.
2. Open `chrome://extensions` (or `edge://extensions`, `opera://extensions`).
3. Enable *Developer mode*, click *Load unpacked*, and pick the unzipped `seekBar` folder.

`.crx` files are signed packages for browsers or setups that allow them. Chrome on Windows refuses drag-installed `.crx` files that did not come from the Web Store, so the zip above is the reliable path.

## Usage

The toolbar button opens a small popup:

- **Enabled** — the global on/off switch. Turning it off stops both the shortcuts and the line.
- **Enable audio control** — off by default. Switch it on to let `↑`, `↓` and `M` set the video's volume and mute; leave it off and those three keys stay with the site. See *Behavior* below.
- **Speed** — the saved playback speed, 0.25x–4x. The slider sets it directly; `-` and `=` change it by 10% per press. *Reset to 1x* clears the saved speed, so each site's own default is used again.
- **Bar color** — five presets plus a *Custom color...* picker that recolors the lines live while you drag. The row below keeps your five most recently used custom colors.
- **Site lists** — choose how the per-site list behaves:
  - **Blacklist** (default): seekBar is on everywhere *except* the listed sites.
  - **Whitelist**: seekBar is off everywhere *except* the listed sites.

Type a domain under *Add a website...* and press Enter to add it, or use the site button to add or remove the site you are currently on. The list below shows every entry, with a bin icon to delete it.

The **Shortcuts** section shows the same key table as above.

## Behavior

- **Target video:** the fullscreen video if there is one, otherwise the video under the mouse pointer, otherwise the video most visible in the viewport. With no video on screen, every key behaves as normal.
- **Volume is a gate, and it starts closed:** `↑` and `↓` set the video element's own volume in 5% steps and `M` sets its `muted`, so they work the same way everywhere. The value lives on that video only: it is not saved, not copied to the next video or another tab, and never applied when a video starts. One press up from a muted video unmutes it at a listenable level (about 50%) and the presses after it step up from there; pressing down never unmutes, so a muted video cannot become loud. While a video is on screen and audio control is on, those two keys are volume, so they no longer scroll the page; otherwise they scroll as usual. *Enable audio control* is off by default: until it is switched on, `↑`, `↓` and `M` go to the site untouched.
- **A site can disagree with it:** players that keep a mute icon or a volume slider of their own (Instagram, Threads, Facebook) do not redraw it, because the change happens below them. Audio control is a little bit buggy for that reason, which is why it is opt-in; speed, seeking, play/pause and the line are unaffected either way.
- **Speed follows you:** the speed is carried to the next video (for example the next reel), shared across all tabs, and kept between browser sessions. Changes from the keys, the popup or another tab apply to the playing video immediately. A player that resets speed right after a video starts is corrected for 3 seconds; afterwards its own controls are left alone.
- **Typing is safe:** shortcuts are ignored in text fields and editable areas.
- **Paused stays paused:** a video you pause with the keys is not resumed by the site on its own, for example when you switch away and back to the tab. It plays again when you start it (key or click) or when the site loads a new video into the player.
- **Only the keys used are intercepted:** anything else passes through to the site.
- **The line:** one line per video that has started playing, stacked upward with the newest at the bottom. A paused video keeps its line frozen while it is on screen. A live stream has no progress, so it shows a dim line with a sliding segment. Fullscreen hides the lines. GIFs, APNGs, canvas and CSS animations never get a line — only real `<video>` elements count.
- **Multiple videos:** each playing video gets its own line; the shortcuts act on the one under the cursor, or the most visible one.

## How it works

Two scripts run in every frame:

- `content.js` in the extension's isolated world reads the settings from `chrome.storage` and passes them to the other script over `window.postMessage`. It also injects the overlay stylesheet, because content scripts are exempt from the page's CSP.
- `main.js` in the page's own world draws the lines and handles the keys. That placement is what reaches closed shadow DOM: it wraps `Element.prototype.attachShadow` before any page code runs, so every shadow root a site creates is seen, open or closed.

On top of that:

- new videos are caught by mutation observers, the `attachShadow` patch, and a 2-second watchdog rescan,
- the overlay and its lines are self-healing: if a site deletes them, they are redrawn,
- each iframe runs its own copy, so embedded players work and show their line at their own bottom edge,
- already-open tabs are covered: after install or reload, a service worker injects the scripts without requiring a page refresh.

## Permissions and privacy

- `storage`: saves the speed, color, enable/disable state and site lists.
- `tabs` and `scripting`: injects the scripts into tabs that were already open when the extension was installed, so they do not need a refresh.
- `host_permissions: <all_urls>`: the extension works on every website, including frames.
- All processing is local. No network requests, no analytics, no data leaves your browser.

## Project structure

```
extension/
  manifest.json    Manifest V3 definition
  content.js       Isolated world: settings relay, stylesheet injection, storage writes
  main.js          Page world: video discovery, overlay lines, keyboard control
  background.js    Service worker: injects into already-open tabs
  popup.html       Popup layout and shortcut list
  popup.css        Popup styles
  popup.js         Popup logic: speed, color, site lists
  icons/           Extension icons (16, 32, 48, 128)
tools/
  make-icon.ps1    Draws the icons from geometry
  make-key.js      Creates key.pem for the .crx on first build
  build.ps1        Builds the zip and the signed .crx into build/
```

## Building

```powershell
powershell -ExecutionPolicy Bypass -File tools\build.ps1
```

Output, in `build/`:

```
seekBar_v1.0.zip   Load unpacked / release download
seekBar_v1.0.crx   signed package
```

The build keeps the version in the file name; the release attaches the same files as `seekBar.zip` and `seekBar.crx`. `key.pem` is created on the first build and reused afterwards: it fixes the extension ID, so keep it out of the repository and back it up. `-SkipIcons` and `-SkipCrx` are available when only part of the build is needed.

## Known limitations

- A player that draws into `<canvas>` without a `<video>` element cannot be controlled; there is nothing standard to seek or speed up.
- A video inside an iframe responds to keys while that frame has keyboard focus; this is how browser key handling works, not a setting.
- Fullscreen uses the raw video element, so the site's own controls are not shown while in fullscreen.
- Speed changes made through a site's own menu are not saved; only the keys and the popup are.
- When a site resumes a video we paused, its play briefly starts before it is paused again, so a very short audio blip or UI flicker is possible.
- After updating the extension, reload any tab whose keys or line stop responding; its old copy keeps running until then.

See [RELEASE_NOTES.md](RELEASE_NOTES.md) for the version history.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

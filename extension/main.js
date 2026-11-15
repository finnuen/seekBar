// seekBar main-world script.
//
// Runs at document_start in the page's own JavaScript world. That placement is
// what makes it work on sites that build their player in shadow DOM: the
// attachShadow patch below sees every shadow root a page creates - open and
// closed - so the <video> inside is found and can be controlled. An isolated-
// world script can never reach a closed root.
//
// Two jobs:
//
//   1. The line. One thin line at the very bottom of the window for each video
//      that has started playing, stacked upward with the newest at the bottom.
//      A paused video keeps its line, frozen, while it is on screen. A live
//      stream has no progress, so it shows a dim line with a sliding segment.
//      Fullscreen hides the lines. Only HTMLVideoElement counts: GIFs, APNGs,
//      canvas and CSS animations are not videos - and neither is a GIF that a
//      site ships as a short silent <video> loop, which is how Discord and
//      Reddit deliver them (see gifState()).
//
//   2. The keyboard. Play/pause, seek, volume, mute, speed and fullscreen for
//      the video the user means: the fullscreen one, else the one under the
//      cursor, else the most visible one. Volume and mute are set on that
//      element and nowhere else - a gate the popup leaves open or closes, off by
//      default, because a site that keeps its own mute flag or level will not
//      redraw its icon or slider when the element changes. Nothing is stored and
//      nothing is re-applied. Speed follows you from video to video, tab to tab
//      and session to session. A video paused with the keys stays paused when the
//      site tries to resume it on its own.
//
// Settings come from content.js over window.postMessage (chrome.storage only
// exists in the isolated world). The overlay stylesheet is injected there too.
// Speed changes go back the same way to be stored.
//
// Coverage, aggressively:
//   1. light DOM videos: scan at document_start + incremental MutationObserver
//   2. every shadow root created from now on, open or closed
//   3. nested roots: the patch is global, so roots inside roots are covered
//   4. a 2 s watchdog rescan as the last-resort safety net
//   5. self-healing rendering: if the site deletes the overlay or a line, the
//      next frame recreates it
//   6. videos inside iframes are handled by this script running in each frame

(() => {
  if (window.__seekBarMain) return;
  window.__seekBarMain = true;

  const SEEK_SHORT = 3;      // seconds on a plain arrow key
  const SEEK_LONG = 30;      // seconds with Ctrl
  const RATE_STEP = 0.1;     // one press of - or = is 10%
  const RATE_MIN = 0.25;
  const RATE_MAX = 4;
  const VOLUME_STEP = 0.05;  // one press of Up or Down is 5%
  const SETTLE_MS = 3000;    // correct player resets this long after a video starts
  const INPUT_MS = 1000;     // a play this soon after real input is the user's choice
  const GIF_GRACE = 0.5;     // seconds of playback before a silent loop is taken for a GIF
  const GIF_MAX = 8;         // a silent clip no longer than this is a GIF, not a video

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const round2 = (v) => Math.round(v * 100) / 100;

  // --- settings, relayed from the isolated world ---------------------------
  const DEFAULTS = { enabled: true, color: '#00FF26', mode: 'blacklist', whitelist: [], blacklist: [], audioControl: false };
  const COLOR_RE = /^#[0-9a-f]{6}$/i;
  const settings = { ...DEFAULTS };
  let siteActive = true;
  let carryRate = null;
  // Orders the relay's pushes (see the settings handler).
  let pushId = null;
  let lastSeq = 0;

  const activeColor = () => (COLOR_RE.test(settings.color || '') ? settings.color : DEFAULTS.color);
  const post = (msg) => { try { window.postMessage({ source: 'seekbar', ...msg }, '*'); } catch {} };

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'seekbar') return;

    if (d.type === 'settings') {
      // A frame's pushes can arrive out of order when two key presses overlap;
      // the stale one must not undo the newer speed.
      if (d.id !== pushId) { pushId = d.id; lastSeq = 0; }
      if (typeof d.seq === 'number') {
        if (d.seq <= lastSeq) return;
        lastSeq = d.seq;
      }
      // `own` marks the echo of a write this frame made. Its rate is the one
      // already on the video; adopting it would walk the speed backwards
      // through every press until the last echo arrived.
      const nextRate = d.own === true
        ? carryRate                                  // our own write, already applied
        : (typeof d.rate === 'number' && isFinite(d.rate)
            ? round2(clamp(d.rate, RATE_MIN, RATE_MAX))
            : null);
      const prevRate = carryRate;
      const wasActive = siteActive;

      Object.assign(settings, d.settings || {});
      siteActive = !!d.siteActive;
      carryRate = nextRate;

      // A speed set elsewhere (popup or another tab) applies right away, and so
      // does turning the extension back on. A reset (removed setting) returns
      // this tab's video to 1x; a setting that was never there changes nothing.
      if (siteActive) {
        if (nextRate != null && (nextRate !== prevRate || !wasActive)) applyCarry(getTargetVideo());
        else if (nextRate == null && prevRate != null) setDefaults(getTargetVideo());
      }
      applySettings();
    } else if (d.type === 'style-injected') {
      poke(); // CSS just arrived: one frame to pick it up
    }
  });

  function applySettings() {
    ensureOverlay();
    recolorAll();
    if (!siteActive) {
      hideAll();
      stopLoop();
    } else {
      poke();
    }
  }

  // --- playback speed ------------------------------------------------------
  // The rate is the only setting that is carried. Volume and mute are handled
  // separately, on the element, for as long as the key press lasts.
  const startedAt = new WeakMap();

  function applyCarry(v) {
    if (!v || carryRate == null) return;
    // defaultPlaybackRate is what the browser falls back to when a player
    // loads a new source into the same element (the next reel, say).
    if (v.defaultPlaybackRate !== carryRate) v.defaultPlaybackRate = carryRate;
    if (v.playbackRate !== carryRate) v.playbackRate = carryRate;
  }

  function setDefaults(v) {
    if (!v) return;
    v.defaultPlaybackRate = 1;
    v.playbackRate = 1;
  }

  function setRate(v, value) {
    const rate = round2(clamp(value, RATE_MIN, RATE_MAX));
    carryRate = rate;
    v.defaultPlaybackRate = rate;
    v.playbackRate = rate;
    post({ type: 'carry', rate });
  }

  function resetRate(v) {
    carryRate = null;
    setDefaults(v);
    post({ type: 'carry', rate: null });
  }

  const onStart = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    startedAt.set(v, Date.now());
    if (siteActive) applyCarry(v);
  };

  // Players tend to reset speed right after a video starts. Correct that
  // briefly; later changes (the site's own speed menu) are left alone.
  const onRateReset = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || !siteActive) return;
    if (Date.now() - (startedAt.get(v) || 0) < SETTLE_MS) applyCarry(v);
  };

  // Media events do not bubble, so listen in the capture phase.
  for (const t of ['loadedmetadata', 'play', 'playing']) document.addEventListener(t, onStart, true);
  document.addEventListener('ratechange', onRateReset, true);

  // --- keep paused videos paused -------------------------------------------
  // Some sites (Instagram, for one) resume the in-view video when the tab
  // becomes visible again. A video paused with the keys stays paused unless the
  // user starts it again.
  const pausedByUs = new WeakSet();
  const strikes = new WeakMap();
  let lastInput = 0;

  // Registered before the key handler below, which resets it for keys we handle.
  for (const t of ['keydown', 'pointerdown', 'touchstart']) {
    window.addEventListener(t, () => { lastInput = Date.now(); }, { capture: true, passive: true });
  }

  function hold(v) {
    pausedByUs.add(v);
    strikes.delete(v);
    lastInput = 0; // our own key press is not a request to play
  }

  const onPlayAttempt = (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || !pausedByUs.has(v)) return;
    const n = (strikes.get(v) || 0) + 1;
    // A play shortly after a real click or key press is the user's choice. Give
    // up after many blocks so a site that keeps retrying can't make us fight it
    // forever.
    if (Date.now() - lastInput < INPUT_MS || n > 20) {
      pausedByUs.delete(v);
      return;
    }
    strikes.set(v, n);
    v.pause();
  };

  // A new source means a new video (some sites reuse one element for every reel).
  const onNewMedia = (e) => {
    if (e.target instanceof HTMLVideoElement) pausedByUs.delete(e.target);
  };

  for (const t of ['play', 'playing']) document.addEventListener(t, onPlayAttempt, true);
  for (const t of ['loadstart', 'emptied']) document.addEventListener(t, onNewMedia, true);

  // --- overlay -------------------------------------------------------------
  const STRIDE = 3; // 2 px line + 1 px gap between stacked lines
  const overlay = document.createElement('div');
  overlay.id = 'seekbar-overlay-root';
  let overlayParent = null;

  function ensureOverlay() {
    const parent = document.documentElement;
    if (!parent) return null;
    if (overlayParent !== parent || !overlay.isConnected) {
      overlayParent = parent;
      try { parent.appendChild(overlay); } catch { return null; }
    }
    return overlay;
  }

  // Fullscreen hides the lines; exiting re-enables them via poke().
  document.addEventListener('fullscreenchange', () => { ensureOverlay(); poke(); });

  // --- tracking ------------------------------------------------------------
  const tracked = new Map(); // HTMLVideoElement -> entry

  // A GIF served as a video: Discord, Reddit and others ship GIFs as short
  // silent MP4/WebM loops in a plain <video>, so the tag alone cannot tell them
  // from a video. Three standard things can:
  //
  //   - it loops, and it has no native controls of its own; and
  //   - it is short (a GIF is a few seconds), or loops outright; and
  //   - it carries no audio track at all.
  //
  // Only the last one is hard to see. captureStream() would answer it exactly,
  // but it throws a SecurityError for cross-origin media - which is how a CDN
  // serves these clips - so the answer comes from Chromium's decoded-byte
  // counter instead: a clip with an audio track decodes audio within ~80 ms of
  // playback, even while muted, and one without an audio track never does.
  //
  // Until that is settled the clip is treated as a GIF, so a GIF never gets a
  // line; a real clip's line appears a fraction of a second after it starts.
  // 0 = a real video, 1 = a GIF, -1 = not settled yet.
  function gifState(v, entry) {
    if (entry.gif) return 1;
    if (entry.audio) return 0;
    if (v.controls) { entry.audio = true; return 0; }          // a player of its own
    const looping = v.loop === true;
    const short = isFinite(v.duration) && v.duration > 0 && v.duration <= GIF_MAX;
    if (!looping && !short) { entry.audio = true; return 0; }
    const bytes = v.webkitAudioDecodedByteCount;
    if (typeof bytes !== 'number') { entry.audio = true; return 0; } // no way to tell
    if (bytes > 0) { entry.audio = true; return 0; }            // it has sound: a video
    if ((v.currentTime || 0) >= GIF_GRACE) { entry.gif = true; return 1; }
    return -1;
  }

  const isGif = (v) => {
    const entry = tracked.get(v);
    return !!entry && entry.gif === true;
  };

  function track(video) {
    if (!(video instanceof HTMLVideoElement) || tracked.has(video)) return;
    const entry = { line: null, trackEl: null, glideEl: null, started: false, audio: false, gif: false };
    tracked.set(video, entry);
    for (const ev of ['play', 'playing', 'pause', 'ended', 'emptied', 'seeked',
                      'loadedmetadata', 'durationchange', 'ratechange']) {
      video.addEventListener(ev, poke, true);
    }
    // A new source into the same element is a new clip: forget what the old
    // one was.
    video.addEventListener('loadstart', () => { entry.audio = false; entry.gif = false; }, true);
    poke();
  }

  function makeLine(entry, ov) {
    const line = document.createElement('div');
    line.className = 'sb-line';
    const trackEl = document.createElement('div'); // dim track for live streams
    trackEl.className = 'sb-track';
    const glideEl = document.createElement('div'); // sliding segment for live streams
    glideEl.className = 'sb-glide';
    line.append(trackEl, glideEl);
    ov.appendChild(line);
    entry.line = line;
    entry.trackEl = trackEl;
    entry.glideEl = glideEl;
  }

  function setSegments(entry, on, color) {
    if (!entry.trackEl) return;
    entry.trackEl.style.display = on ? 'block' : 'none';
    entry.glideEl.style.display = on ? 'block' : 'none';
    if (on) {
      entry.trackEl.style.background = color;
      entry.glideEl.style.background = color;
    }
  }

  function hideLine(entry) {
    if (entry.line) entry.line.style.display = 'none';
  }

  function hideAll() {
    for (const entry of tracked.values()) hideLine(entry);
    overlay.style.display = 'none';
  }

  // --- render loop ---------------------------------------------------------
  let running = false;
  let rafId = 0;

  function poke() {
    if (!running) {
      running = true;
      rafId = requestAnimationFrame(tick);
    }
  }

  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function tick() {
    rafId = 0;
    let keepGoing = false;
    try {
      if (!siteActive) { running = false; return; }

      if (document.fullscreenElement) {     // fullscreen: lines off
        hideAll();
        running = false;
        return;
      }

      const ov = ensureOverlay();
      if (!ov) { running = false; return; }

      const color = activeColor();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;

      const shownEntries = [];
      for (const [video, entry] of tracked) {
        if (!video.isConnected) {           // gone from the document
          if (entry.line) entry.line.remove();
          tracked.delete(video);
          continue;
        }
        if (entry.line && !entry.line.isConnected) ov.appendChild(entry.line); // self-heal

        const playing = !video.paused && !video.ended;
        if (playing) entry.started = true;

        // A GIF is not something to track: no line, and the keys skip it (see
        // getTargetVideo). A playing clip that is not settled yet keeps the loop
        // awake until it is; a paused one waits for its own play event.
        const gif = gifState(video, entry);
        if (gif !== 0) {
          hideLine(entry);
          if (gif < 0 && playing) keepGoing = true;
          continue;
        }

        const rects = video.getClientRects();
        let onscreen = false;
        if (rects.length) {
          const r = video.getBoundingClientRect();
          onscreen = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
        }

        // Playing videos always show their line (even offscreen - that is the
        // multi-video view). A paused video shows its frozen line only if it
        // has been playing before AND is on screen right now.
        if (!playing && !entry.started) { hideLine(entry); continue; }
        if (!rects.length) { hideLine(entry); continue; }
        if (!playing && !onscreen) { hideLine(entry); continue; }

        if (!entry.line) makeLine(entry, ov);

        const line = entry.line;
        const dur = video.duration;
        const determinate = typeof dur === 'number' && isFinite(dur) && dur > 0;
        line.style.display = 'block';

        if (determinate) {
          const p = Math.min(1, Math.max(0, (video.currentTime || 0) / dur));
          line.classList.remove('sb-live');
          line.style.transform = 'scaleX(' + p + ')';
          line.style.background = color;
          line.style.opacity = '';
          setSegments(entry, false);
        } else if (playing) {
          // live stream playing: dim track + sliding bright segment
          line.classList.add('sb-live');
          line.style.transform = 'none';
          line.style.background = 'transparent';
          line.style.opacity = '';
          setSegments(entry, true, color);
        } else {
          // live stream paused: static dim line (no progress exists)
          line.classList.remove('sb-live');
          line.style.transform = 'scaleX(1)';
          line.style.background = color;
          line.style.opacity = '0.35';
          setSegments(entry, false);
        }
        shownEntries.push(entry);
        keepGoing = true;                   // started lines need scroll re-checks
      }
      // Stack upward with the newest discovered video at the bottom.
      const n = shownEntries.length;
      for (let i = 0; i < n; i++) {
        shownEntries[i].line.style.bottom = ((n - 1 - i) * STRIDE) + 'px';
      }
      ov.style.display = n ? 'block' : 'none';
    } catch {
      // A site breaking one frame must not kill the loop; it re-runs below.
    }
    if (keepGoing) rafId = requestAnimationFrame(tick);
    else running = false;
  }

  function recolorAll() {
    const color = activeColor();
    for (const entry of tracked.values()) {
      if (!entry.line) continue;
      entry.line.style.background = color;
      if (entry.trackEl) entry.trackEl.style.background = color;
      if (entry.glideEl) entry.glideEl.style.background = color;
    }
  }

  // --- discovery -----------------------------------------------------------
  // Track the videos inside an added subtree and catch shadow roots it opens.
  function absorb(node) {
    if (!node || node.nodeType !== 1) return;
    if (node instanceof HTMLVideoElement) track(node);
    try {
      if (node.shadowRoot) { observeRoot(node.shadowRoot); scan(node.shadowRoot); }
      if (node.querySelectorAll) {
        for (const v of node.querySelectorAll('video')) track(v);
        for (const el of node.querySelectorAll('*')) {
          if (el.shadowRoot) { observeRoot(el.shadowRoot); scan(el.shadowRoot); }
        }
      }
    } catch {}
  }

  // Scan a document or shadow root for videos, then keep watching it.
  const rootObservers = new WeakMap();

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    try {
      for (const v of root.querySelectorAll('video')) track(v);
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) { observeRoot(el.shadowRoot); scan(el.shadowRoot); }
      }
      if (root !== document && root !== document.documentElement) observeRoot(root);
    } catch {}
  }

  function observeRoot(root) {
    if (!root || rootObservers.has(root)) return;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) absorb(n);
      poke();
    });
    obs.observe(root, { childList: true, subtree: true });
    rootObservers.set(root, obs);
  }

  // Runs before any page JavaScript: every shadow root a site ever creates
  // passes through here, open and closed alike.
  const origAttachShadow = Element.prototype.attachShadow;
  if (typeof origAttachShadow === 'function') {
    Element.prototype.attachShadow = function (init) {
      const root = origAttachShadow.call(this, init);
      if (root) { try { observeRoot(root); scan(root); } catch {} }
      return root;
    };
  }

  const docObserver = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) absorb(n);
    poke();
  });
  docObserver.observe(document, { childList: true, subtree: true });

  // --- video selection -----------------------------------------------------
  // Last known mouse position, so shortcuts act on the video under the cursor.
  let pointer = null;
  window.addEventListener(
    'pointermove',
    (e) => { if (e.pointerType === 'mouse') pointer = { x: e.clientX, y: e.clientY }; },
    { capture: true, passive: true }
  );
  document.documentElement.addEventListener('mouseleave', () => { pointer = null; });

  // The tracked set is used rather than elementsFromPoint: it also contains
  // videos inside closed shadow roots, which no DOM query can reach.
  function hoveredVideo() {
    if (!pointer) return null;
    const under = [];
    for (const v of tracked.keys()) {
      if (!v.isConnected || isGif(v)) continue;
      const r = v.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (pointer.x >= r.left && pointer.x <= r.right &&
          pointer.y >= r.top && pointer.y <= r.bottom) under.push(v);
    }
    return under.find((v) => !v.paused) || under[under.length - 1] || null;
  }

  // Walks from a node up through shadow roots to see whether it lives inside
  // the given element. Node.contains does not cross a shadow boundary.
  function withinHost(node, host) {
    let n = node;
    while (n) {
      if (n === host) return true;
      n = n.parentNode || n.host || null;
    }
    return false;
  }

  // Priority: fullscreen video, then the video under the cursor, then the most
  // visible one. If nothing is tracked yet (late install), one last scan.
  function getTargetVideo() {
    if (!tracked.size) scan(document);

    const fs = document.fullscreenElement;
    if (fs) {
      if (fs.tagName === 'VIDEO' && !isGif(fs)) return fs;
      for (const v of tracked.keys()) {
        if (v.isConnected && !isGif(v) && withinHost(v, fs)) return v;
      }
    }

    const hovered = hoveredVideo();
    if (hovered) return hovered;

    let best = null;
    let bestScore = 0;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    for (const v of tracked.keys()) {
      if (!v.isConnected || isGif(v)) continue;
      const r = v.getBoundingClientRect();
      const w = Math.min(r.right, vw) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0) continue;
      const score = w * h * (v.paused ? 1 : 1.5);
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    return best;
  }

  // --- actions -------------------------------------------------------------
  function seek(v, delta) {
    if (!isFinite(v.duration) || v.duration <= 0) return;
    v.currentTime = clamp(v.currentTime + delta, 0, v.duration);
  }

  // --- volume --------------------------------------------------------------
  // Volume and mute are a gate, on purpose: the keys set video.volume and
  // video.muted on the video being watched and nothing else.
  //
  // That is what makes them work the same way on every site, and it is also
  // what makes a player that keeps a mute flag or a level of its own disagree:
  // the sound changes and the site's own icon or slider does not. So the gate
  // is off until it is switched on (`audioControl` in the popup), and the popup
  // says plainly that it is the unreliable part of the extension.
  //
  // Nothing is stored, nothing is carried to another video or tab, and nothing
  // is re-applied when a video starts: the keys change what is playing now.
  function setMuted(v, wantMuted) {
    v.muted = wantMuted;
    return v.muted === wantMuted;
  }

  function toggleMute(v) {
    return setMuted(v, !v.muted);
  }

  // A video muted by its site often still carries a volume of 1, so unmuting
  // straight into "one step up" would jump to full blast. One press up from
  // silence lands at a level that can be listened to; the presses after it step
  // up from there. A video muted with the keys keeps the level it had.
  const UNMUTE_CAP = 0.5;

  function volumeBy(v, delta) {
    if (delta > 0 && v.muted) {
      v.muted = false;
      if (v.volume > UNMUTE_CAP) v.volume = UNMUTE_CAP;
    }
    v.volume = clamp(round2(v.volume + delta), 0, 1);
  }

  // Returns true if the key was handled.
  function handle(e, v) {
    const ctrl = e.ctrlKey;
    if (ctrl && e.code === 'Backquote') {
      if (e.repeat) return false;
      resetRate(v);
      return true;
    }
    switch (e.key) {
      case ' ':
      case 'p':
      case 'P':
        if (ctrl || e.repeat) return false;
        if (v.paused) {
          pausedByUs.delete(v);
          v.play().catch(() => {});
        } else {
          v.pause();
          hold(v);
        }
        return true;
      case 'ArrowLeft':
        seek(v, -(ctrl ? SEEK_LONG : SEEK_SHORT));
        return true;
      case 'ArrowRight':
        seek(v, ctrl ? SEEK_LONG : SEEK_SHORT);
        return true;
      case 'ArrowUp':
        if (!settings.audioControl) return false;
        volumeBy(v, VOLUME_STEP);
        return true;
      case 'ArrowDown':
        if (!settings.audioControl) return false;
        volumeBy(v, -VOLUME_STEP);
        return true;
      case 'm':
      case 'M':
        if (ctrl || e.repeat || !settings.audioControl) return false;
        toggleMute(v);
        return true;
      case 'f':
      case 'F':
        if (ctrl || e.repeat) return false;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else v.requestFullscreen?.().catch(() => {});
        return true;
      case '-':
      case '_':
        if (ctrl) return false;
        setRate(v, v.playbackRate - RATE_STEP);
        return true;
      case '=':
      case '+':
        if (ctrl) return false;
        setRate(v, v.playbackRate + RATE_STEP);
        return true;
      case '0':
        if (ctrl) return false;
        setRate(v, 1);
        return true;
      default:
        return false;
    }
  }

  // --- key handling --------------------------------------------------------
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
    return el.getAttribute?.('role') === 'textbox';
  }

  const swallowed = new Set();

  window.addEventListener(
    'keydown',
    (e) => {
      if (!siteActive) return;
      if (e.defaultPrevented || e.altKey || e.metaKey) return;
      // Ctrl is only used with the arrow keys and the backtick (reset speed).
      if (e.ctrlKey && e.code !== 'Backquote' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

      // composedPath reaches the real target when typing inside a shadow root.
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const target = path[0] || e.target;
      if (isEditable(target) || isEditable(document.activeElement)) return;

      const v = getTargetVideo();
      if (!v || !handle(e, v)) return;

      // Only block the site's own handling when we actually acted.
      e.preventDefault();
      e.stopImmediatePropagation();
      swallowed.add(e.code);
    },
    true
  );

  // Stop a focused button from being "clicked" by the matching keyup (Space).
  window.addEventListener(
    'keyup',
    (e) => {
      if (!swallowed.delete(e.code)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true
  );

  // --- safety nets ---------------------------------------------------------
  setInterval(() => {
    if (document.hidden) return;
    if (!document.getElementById('seekbar-style')) post('need-style');
    scan(document);
    poke();
  }, 2000);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { scan(document); poke(); }
  });

  window.addEventListener('pageshow', () => { scan(document); poke(); }); // bfcache restore

  // --- boot ----------------------------------------------------------------
  ensureOverlay();
  if (!document.getElementById('seekbar-style')) post('need-style');
  scan(document);

  // Tell the isolated world we are live so it can resend the settings (its
  // first push may have fired before this script was registered).
  post({ type: 'ready' });
})();

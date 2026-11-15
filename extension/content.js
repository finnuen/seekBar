// seekBar isolated-world script.
//
// chrome.storage is only reachable from this world, so this script reads the
// settings and forwards them to main.js (same page, main world) over
// window.postMessage. It also injects the overlay stylesheet: content scripts
// are exempt from the page's CSP, a main-world <style> element is not.
//
// Writes go the other way: when the main world changes playback speed with the
// keyboard, it asks this script to store it, so every tab and the popup see the
// same value.
//
// Reading uses readAll(): sync is authoritative, but if the popup detected that
// sync silently refuses writes (some browsers do when their sync backend is
// signed out), the popup writes to local storage and flags it with __storeMode -
// local values then win.

(() => {
  // A tab can already hold an older copy after the extension is reloaded or
  // updated. That copy's extension context is dead (its chrome.storage calls
  // throw), so it is told to stand down before this one takes over.
  const previous = window.__seekBarRelay;
  if (previous && typeof previous.dispose === 'function') {
    try { previous.dispose(); } catch {}
  }

  const DEFAULTS = {
    enabled: true, color: '#00FF26', mode: 'blacklist', whitelist: [], blacklist: [], history: [],
    audioControl: false,
    controlGif: true, controlVideo: true,
    lineGif: true, lineVideo: true,
    maxLines: 2,
    seekGif: 2, seekVideo: 3,
  };
  const host = location.hostname.replace(/^www\./, '');

  // Identifies this frame's writes, so the storage echo of our own write is not
  // pushed back into the main world as if it came from elsewhere.
  const PAGE_ID = Math.random().toString(36).slice(2);

  const STYLE = `
#seekbar-overlay-root {
  position: fixed; left: 0; right: 0; bottom: 0; top: auto;
  height: 0; margin: 0; padding: 0; border: 0; background: transparent;
  pointer-events: none; z-index: 2147483647;
}
.sb-line {
  position: absolute; left: 0; width: 100%;
  height: 2px;
  transform-origin: 0 50%; transform: scaleX(0);
  will-change: transform;
}
.sb-track {
  position: absolute; inset: 0; display: none;
}
.sb-glide {
  position: absolute; top: 0; bottom: 0; left: 0; width: 25%; display: none;
}
.sb-line.sb-live .sb-glide { animation: sb-slide 1.2s linear infinite; }
@keyframes sb-slide { from { transform: translateX(-110%); } to { transform: translateX(410%); } }
`;

  function injectStyle() {
    if (document.getElementById('seekbar-style')) return;
    const style = document.createElement('style');
    style.id = 'seekbar-style';
    style.textContent = STYLE;
    (document.head || document.documentElement).appendChild(style);
    try { window.postMessage({ source: 'seekbar', type: 'style-injected' }, '*'); } catch {}
  }

  function computeSiteActive(mode, whitelist, blacklist) {
    const match = (list) => (list || []).some((d) => host === d || host.endsWith('.' + d));
    if (mode === 'whitelist') return match(whitelist);
    return !match(blacklist); // blacklist mode (default)
  }

  function readAll(cb) {
    try {
      chrome.storage.sync.get(DEFAULTS, (sync) => {
        chrome.storage.local.get(null, (local) => {
          const out = { ...sync };
          if (local && local.__storeMode === 'local') {
            for (const k of Object.keys(DEFAULTS)) {
              if (k in local) out[k] = local[k];
            }
          }
          cb(out, local || {});
        });
      });
    } catch {
      cb({ ...DEFAULTS }, {});
    }
  }

  // Pushes can overlap - a fast pair of key presses starts two storage reads,
  // and the older one can finish last. The sequence lets the page world drop a
  // push it has already seen past, and a push that follows our own write is
  // marked `own`: it carries the rate this frame wrote, which the page world
  // already applied, so re-applying it would drag the speed backwards until the
  // last echo lands.
  let seq = 0;

  function push(rateOverride) {
    readAll((s, local) => {
      const carry = local.carry;
      const rate = rateOverride !== undefined
        ? rateOverride
        : (carry && typeof carry.rate === 'number' && isFinite(carry.rate) ? carry.rate : null);
      window.postMessage({
        source: 'seekbar',
        type: 'settings',
        id: PAGE_ID,
        seq: ++seq,
        own: rateOverride !== undefined,
        settings: {
          enabled: s.enabled !== false,
          color: s.color,
          mode: s.mode,
          whitelist: s.whitelist,
          blacklist: s.blacklist,
          audioControl: s.audioControl === true,
          controlGif: s.controlGif !== false,
          controlVideo: s.controlVideo !== false,
          lineGif: s.lineGif !== false,
          lineVideo: s.lineVideo !== false,
          maxLines: s.maxLines,
          seekGif: s.seekGif,
          seekVideo: s.seekVideo,
        },
        siteActive: s.enabled !== false &&
          computeSiteActive(s.mode || 'blacklist', s.whitelist || [], s.blacklist || []),
        rate,
      }, '*');
    });
  }

  // The keyboard's speed choice is stored from here: the main world has no
  // chrome.storage. A null rate means "forget it" (back to the site's default).
  function saveCarry(rate) {
    const clean = typeof rate === 'number' && isFinite(rate) ? rate : null;
    const done = () => push(clean);
    try {
      if (clean == null) chrome.storage.local.remove('carry', done);
      else chrome.storage.local.set({ carry: { rate: clean, src: PAGE_ID } }, done);
    } catch {
      done();
    }
  }

  // main.js announces itself; answer with a fresh push so a page that loaded
  // before this script was registered also receives the settings.
  function onMessage(e) {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'seekbar') return;
    if (d.type === 'ready') { injectStyle(); push(); }
    else if (d.type === 'need-style') injectStyle();
    else if (d.type === 'carry') saveCarry(d.rate);
  }
  window.addEventListener('message', onMessage);

  function onStorage(changes, area) {
    if (area !== 'sync' && area !== 'local') return;
    if (changes.carry) {
      const next = changes.carry.newValue;
      if (next && next.src === PAGE_ID) return; // our own write echoing back
    }
    push();
  }
  chrome.storage.onChanged.addListener(onStorage);

  // Lets a newer copy of this script take over after an extension reload.
  window.__seekBarRelay = {
    dispose() {
      window.removeEventListener('message', onMessage);
      try { chrome.storage.onChanged.removeListener(onStorage); } catch {}
    },
  };

  injectStyle();
  push();
})();

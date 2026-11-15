const DEFAULTS = {
  enabled: true, color: '#00FF26', mode: 'blacklist', whitelist: [], blacklist: [], history: [],
  audioControl: false,
  controlGif: true, controlVideo: true,
  lineGif: true, lineVideo: true,
  maxLines: 2,
  seekGif: 2, seekVideo: 3,
};

// Five fixed presets; the first one is the green from the extension's default
// line color. Custom colors picked with the picker land in the row below.
const PRESETS = [
  ['#00FF26', 'Green'],
  ['#EF4444', 'Red'],
  ['#F97316', 'Orange'],
  ['#EAB308', 'Yellow'],
  ['#06B6D4', 'Cyan'],
];

const enabledEl = document.getElementById('enabled');
const audioControlEl = document.getElementById('audioControl');
const controlGifEl = document.getElementById('controlGif');
const controlVideoEl = document.getElementById('controlVideo');
const lineGifEl = document.getElementById('lineGif');
const lineVideoEl = document.getElementById('lineVideo');
const maxLinesEl = document.getElementById('maxLines');
const seekGifEl = document.getElementById('seekGif');
const seekVideoEl = document.getElementById('seekVideo');
const speedEl = document.getElementById('speed');
const speedOut = document.getElementById('speedOut');
const resetSpeed = document.getElementById('resetSpeed');
const modeEl = document.getElementById('mode');
const addInput = document.getElementById('addInput');
const siteBtn = document.getElementById('siteBtn');
const hintEl = document.getElementById('hint');
const siteListEl = document.getElementById('siteList');
const swatchesEl = document.getElementById('swatches');
const customBtn = document.getElementById('customBtn');
const customDot = document.getElementById('customDot');
const customLabel = document.getElementById('customLabel');
const customHex = document.getElementById('customHex');
const customColor = document.getElementById('customColor');
const previewFill = document.getElementById('previewFill');

let siteHost = null;

const BIN_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
  '<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

// Only real web pages have a hostname worth listing: a chrome-extension:// or
// edge:// page reports its own ID as the host, which must not reach the list.
function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

// Normalizes whatever the user typed into a bare hostname.
function normalizeHost(text) {
  const t = text.trim();
  if (!t) return null;
  try {
    const u = new URL(t.includes('://') ? t : 'https://' + t);
    return u.hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function activeList(settings) {
  return settings.mode === 'whitelist' ? settings.whitelist : settings.blacklist;
}

function inList(list, host) {
  return list.some((d) => host === d || host.endsWith('.' + d));
}

function isPreset(color) {
  return PRESETS.some(([hex]) => hex.toLowerCase() === (color || '').toLowerCase());
}

// --- storage -----------------------------------------------------------------
// Sync is authoritative, but if the popup detected that sync silently refuses
// writes (some browsers do when their sync backend is signed out), local
// storage holds the real values, flagged with __storeMode - same rule
// content.js applies when reading.
function readSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULTS, (sync) => {
      chrome.storage.local.get(null, (local) => {
        const out = { ...sync };
        if (local && local.__storeMode === 'local') {
          for (const k of Object.keys(DEFAULTS)) {
            if (k in local) out[k] = local[k];
          }
        }
        resolve(out);
      });
    });
  });
}

// The speed is stored on its own, next to the settings, because the keyboard
// writes it from every tab through content.js.
function readRate() {
  return new Promise((resolve) => {
    chrome.storage.local.get('carry', (r) => {
      const c = r && r.carry;
      resolve(c && typeof c.rate === 'number' && isFinite(c.rate) ? c.rate : null);
    });
  });
}

async function getState() {
  return { settings: await readSettings(), rate: await readRate() };
}

// Write to sync, then read back to make sure it stuck - a sync backend that
// swallows writes would otherwise lose color choices silently. When it did
// not stick, fall back to local storage.
async function save(patch) {
  const keys = Object.keys(patch);
  try { await chrome.storage.sync.set(patch); } catch {}
  let ok = false;
  try {
    const check = await chrome.storage.sync.get(keys);
    ok = keys.every((k) => JSON.stringify(check[k]) === JSON.stringify(patch[k]));
  } catch {}
  if (ok) {
    try { await chrome.storage.local.remove([...keys, '__storeMode']); } catch {}
  } else {
    try { await chrome.storage.local.set({ ...patch, __storeMode: 'local' }); } catch {}
  }
}

async function saveRate(rate) {
  try {
    if (rate == null) await chrome.storage.local.remove('carry');
    else await chrome.storage.local.set({ carry: { rate, src: 'popup' } });
  } catch {}
}

// --- speed -------------------------------------------------------------------
function formatRate(rate) {
  return (Math.round(rate * 100) / 100) + 'x';
}

function renderSpeed(rate) {
  speedOut.textContent = rate == null ? 'Default' : formatRate(rate);
  const value = rate == null ? 1 : rate;
  if (+speedEl.value !== value) speedEl.value = value;
  resetSpeed.disabled = rate == null;
}

speedEl.addEventListener('input', () => {
  const rate = +speedEl.value;
  speedOut.textContent = formatRate(rate);
  resetSpeed.disabled = false;
  saveRate(rate);
});

resetSpeed.addEventListener('click', async () => {
  await saveRate(null);
  renderSpeed(null);
});

// --- color -------------------------------------------------------------------
const HEX_RE = /^#[0-9a-f]{6}$/i;

// A picked custom color goes to the front of the previously-used row
// (five slots, presets never duplicate into it).
function pushHistory(color, history) {
  const c = (color || '').toLowerCase();
  if (!HEX_RE.test(c) || isPreset(c)) return history || [];
  const kept = (history || []).filter((h) => h && h.toLowerCase() !== c);
  return [c, ...kept].slice(0, 5);
}

// Five slots: the fixed presets on top, then the most recently used custom
// colors. Only colors that were actually used are drawn, so the row does not
// fill up with placeholders that do nothing.
function renderSwatches(settings) {
  swatchesEl.textContent = '';
  for (const [hex, name] of PRESETS) {
    const b = document.createElement('button');
    b.className = 'swatch' + (settings.color.toLowerCase() === hex.toLowerCase() ? ' sel' : '');
    b.style.background = hex;
    b.title = name;
    b.addEventListener('click', () => save({ color: hex }).then(refresh));
    swatchesEl.append(b);
  }

  for (const hex of (settings.history || []).slice(0, 5)) {
    if (!HEX_RE.test(hex || '')) continue;
    const b = document.createElement('button');
    b.className = 'swatch' + (settings.color.toLowerCase() === hex.toLowerCase() ? ' sel' : '');
    b.style.background = hex;
    b.title = 'Previously used';
    b.addEventListener('click', () => save({ color: hex }).then(refresh));
    swatchesEl.append(b);
  }
}

function renderCustom(settings) {
  const active = !isPreset(settings.color);
  customBtn.classList.toggle('active', active);
  customDot.style.background = active ? settings.color : '';
  customHex.textContent = active ? settings.color : '';
  customLabel.textContent = active ? 'Custom color' : 'Custom color...';
  // Only assign when it actually differs: rewriting the value mid-drag can
  // desync the open native picker.
  if (customColor.value.toLowerCase() !== (settings.color || '').toLowerCase()) {
    customColor.value = settings.color;
  }
}

function renderPreview(settings) {
  previewFill.style.background = settings.color;
}

customBtn.addEventListener('click', () => customColor.click());

// 'input' fires continuously while the picker is open, so the lines in every
// tab recolor live while dragging (only the color is written). 'change' fires
// on close, covers browsers or flows where input was missed, and is where the
// color enters the previously-used row.
customColor.addEventListener('input', () => {
  save({ color: customColor.value }).then(refresh);
});

customColor.addEventListener('change', async () => {
  const s = await readSettings();
  await save({ color: customColor.value, history: pushHistory(customColor.value, s.history) });
  refresh();
});

// --- site lists --------------------------------------------------------------
function updateSiteButton(settings) {
  const listed = inList(activeList(settings), siteHost);
  const verb = settings.mode === 'whitelist' ? 'whitelist' : 'blacklist';
  siteBtn.textContent = listed
    ? `Remove from ${verb}`
    : `${verb[0].toUpperCase() + verb.slice(1)} this site`;
  hintEl.textContent = listed
    ? `${siteHost} is ${settings.mode === 'whitelist' ? 'on the whitelist' : 'blacklisted'} - seekBar is OFF there.`
    : `${siteHost} is not ${settings.mode === 'whitelist' ? 'whitelisted' : 'blacklisted'} - seekBar is ON.`;
}

// The website list box: one row per entry, bin icon to delete.
function renderList(settings) {
  const list = activeList(settings);
  siteListEl.hidden = list.length === 0;
  siteListEl.textContent = '';

  for (const domain of list) {
    const row = document.createElement('div');
    row.className = 'site-row';

    const label = document.createElement('span');
    label.textContent = domain;
    label.title = domain;

    const del = document.createElement('button');
    del.className = 'bin';
    del.title = `Remove ${domain}`;
    del.innerHTML = BIN_SVG;
    del.addEventListener('click', async () => {
      const s = await readSettings();
      const key = s.mode === 'whitelist' ? 'whitelist' : 'blacklist';
      await save({ [key]: s[key].filter((d) => d !== domain) });
      const fresh = await readSettings();
      if (siteHost) updateSiteButton(fresh);
      renderList(fresh);
    });

    row.append(label, del);
    siteListEl.append(row);
  }
}

async function init() {
  const { settings, rate } = await getState();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  siteHost = hostOf(tab?.url);

  enabledEl.checked = settings.enabled;
  audioControlEl.checked = settings.audioControl === true;
  renderKinds(settings);
  modeEl.value = settings.mode;
  renderSpeed(rate);

  if (!siteHost) {
    siteBtn.disabled = true;
    siteBtn.textContent = 'No website detected';
    hintEl.textContent = 'Open a website to manage it.';
  } else {
    updateSiteButton(settings);
  }

  renderSwatches(settings);
  renderCustom(settings);
  renderPreview(settings);
  renderList(settings);
}

function refresh() {
  getState().then(async ({ settings, rate }) => {
    if (!siteHost) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      siteHost = hostOf(tab?.url);
    }
    enabledEl.checked = settings.enabled;
    audioControlEl.checked = settings.audioControl === true;
    renderKinds(settings);
    modeEl.value = settings.mode;
    renderSpeed(rate);
    renderSwatches(settings);
    renderCustom(settings);
    renderPreview(settings);
    if (siteHost) updateSiteButton(settings);
    renderList(settings);
  });
}

// Per-kind switches and the two numbers. Everything here defaults to "on" and
// to the values the extension shipped with, so a fresh install behaves as
// before: GIFs and videos are both controlled, both get a line, at most two
// lines, 2 s per arrow press on a GIF and 3 s on a video.
const KINDS = [
  ['controlGif', controlGifEl],
  ['controlVideo', controlVideoEl],
  ['lineGif', lineGifEl],
  ['lineVideo', lineVideoEl],
];

const NUMBERS = [
  ['maxLines', maxLinesEl, 0, 20],
  ['seekGif', seekGifEl, 1, 60],
  ['seekVideo', seekVideoEl, 1, 60],
];

function renderKinds(settings) {
  for (const [key, el] of KINDS) el.checked = settings[key] !== false;
  for (const [key, el, lo, hi] of NUMBERS) {
    const n = Number(settings[key]);
    el.value = String(isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : DEFAULTS[key]);
  }
}

for (const [key, el] of KINDS) {
  el.addEventListener('change', async () => { await save({ [key]: el.checked }); });
}

for (const [key, el, lo, hi] of NUMBERS) {
  el.addEventListener('change', async () => {
    const n = Number(el.value);
    const value = isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : DEFAULTS[key];
    el.value = String(value);
    await save({ [key]: value });
  });
}

enabledEl.addEventListener('change', async () => {
  await save({ enabled: enabledEl.checked });
});

// Off by default: the keys would set the video element's own volume and mute,
// which no site has to agree with, so the gate only closes when asked for.
audioControlEl.addEventListener('change', async () => {
  await save({ audioControl: audioControlEl.checked });
});

modeEl.addEventListener('change', async () => {
  await save({ mode: modeEl.value });
  const settings = await readSettings();
  if (siteHost) updateSiteButton(settings);
  renderList(settings);
});

siteBtn.addEventListener('click', async () => {
  if (!siteHost) return;
  const settings = await readSettings();
  const key = settings.mode === 'whitelist' ? 'whitelist' : 'blacklist';
  const list = settings[key].slice();
  const idx = list.indexOf(siteHost);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(siteHost);
  await save({ [key]: list });
  const fresh = await readSettings();
  updateSiteButton(fresh);
  renderList(fresh);
});

async function addFromInput() {
  const host = normalizeHost(addInput.value);
  if (!host) return;
  const settings = await readSettings();
  const key = settings.mode === 'whitelist' ? 'whitelist' : 'blacklist';
  if (!inList(settings[key], host)) {
    await save({ [key]: [...settings[key], host] });
  }
  addInput.value = '';
  addInput.focus();
  const fresh = await readSettings();
  if (siteHost) updateSiteButton(fresh);
  renderList(fresh);
}

addInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addFromInput();
});

// Speed may be changed with the keyboard while the popup is open; keep the
// slider and every other control in step.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' || area === 'local') refresh();
});

document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
init();

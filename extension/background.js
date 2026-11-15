// seekBar service worker.
// The manifest's content scripts only load on pages that load AFTER the
// extension does. This worker pushes them into tabs that are already open
// (after install, update, or restart), so the lines and the shortcuts appear
// without the user having to reload every tab. Both scripts are idempotent, so
// re-injecting into a tab that already has them changes nothing; injecting
// content.js into a tab whose old main.js survived an extension reload
// re-attaches the settings relay through the window-message handshake.

function inject(tabId) {
  if (!tabId) return;
  chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] })
    .catch(() => {});
  chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, files: ['main.js'], world: 'MAIN' })
    .catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (t.url && /^(https?|file):/i.test(t.url)) inject(t.id);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') inject(tabId);
});

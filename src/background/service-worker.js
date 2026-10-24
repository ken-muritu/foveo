/* Foveo — service worker (MV3 background).
 *
 * Owns session state and relays gaze samples:
 *   engine window (camera + inference) -> this worker -> reading tab(s).
 * Streaming goes over kept ports (api.runtime.connect), not sendMessage —
 * at ~30Hz per-message service-worker wake-ups are wasteful and throttled.
 */

// Firefox exposes the promise-native `browser` global; Chrome (116+) also
// resolves promises from these same calls when no callback is passed, so a
// single alias covers both without a polyfill library.
const api = typeof browser !== 'undefined' ? browser : chrome;

const state = {
  phase: 'none',          // 'none' | 'calibrating' | 'ready'
  foveoOn: false,
  accuracyPx: null,
  engineTabId: null,
  engineWindowId: null,
};

const contentPorts = new Map();   // tabId -> port
const runningTabs = new Set();    // tabs currently receiving start + gaze
let enginePort = null;

const ENGINE_URL = 'src/engine/gaze-engine.html';

// ---- engine window --------------------------------------------------------

async function ensureEngine(calibrate) {
  if (state.engineTabId !== null) {
    if (calibrate && enginePort) {
      enginePort.postMessage({ type: 'mode', mode: 'calibrate' });
      try {
        await api.windows.update(state.engineWindowId, {
          focused: true, width: 1100, height: 760,
        });
      } catch (_) { /* window already gone */ }
    } else {
      try { await api.tabs.update(state.engineTabId, { active: true }); } catch (_) {}
      try { await api.windows.update(state.engineWindowId, { focused: true }); } catch (_) {}
    }
    return;
  }

  const url = api.runtime.getURL(ENGINE_URL + (calibrate ? '#calibrate' : ''));
  const win = await api.windows.create({
    url,
    type: 'popup',
    focused: true,
    width: 1100,
    height: 760,
  });
  state.engineWindowId = win.id;
  state.engineTabId = win.tabs && win.tabs[0] ? win.tabs[0].id : null;
  state.phase = 'calibrating';
  setBadge();
}

// ---- badge ----------------------------------------------------------------

function setBadge() {
  let text = '';
  if (state.foveoOn) text = 'ON';
  else if (state.phase === 'calibrating') text = 'CAL';
  api.action.setBadgeText({ text });
  api.action.setBadgeBackgroundColor({ color: '#F0B24B' });
  api.action.setBadgeTextColor({ color: '#1a1408' });
}

// ---- start / stop on tabs --------------------------------------------------

async function startOnTab(tabId) {
  const port = contentPorts.get(tabId);
  if (!port) return;
  const { foveoSettings } = await api.storage.local.get('foveoSettings');
  try {
    port.postMessage({ type: 'start', settings: foveoSettings || null });
    runningTabs.add(tabId);
  } catch (_) {
    contentPorts.delete(tabId);
  }
}

function stopAllTabs() {
  for (const tabId of runningTabs) {
    const port = contentPorts.get(tabId);
    if (port) {
      try { port.postMessage({ type: 'stop' }); } catch (_) {}
    }
  }
  runningTabs.clear();
}

// ---- ports ------------------------------------------------------------------

api.runtime.onConnect.addListener((port) => {
  if (port.name === 'foveo-engine') {
    enginePort = port;

    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'phase') {
        state.phase = msg.phase;
        if (typeof msg.accuracyPx === 'number') {
          state.accuracyPx = msg.accuracyPx;
        }
        if (msg.phase === 'ready' && msg.shrinkRect && state.engineWindowId !== null) {
          // Calibration done: let the engine window shrink out of the way.
          try {
            await api.windows.update(state.engineWindowId, {
              width: msg.shrinkRect.width,
              height: msg.shrinkRect.height,
            });
          } catch (_) { /* user closed it */ }
        }
        setBadge();
      } else if (msg.type === 'gaze') {
        for (const tabId of runningTabs) {
          const p = contentPorts.get(tabId);
          if (p) {
            try { p.postMessage(msg); } catch (_) { contentPorts.delete(tabId); runningTabs.delete(tabId); }
          }
        }
      } else if (msg.type === 'log') {
        console[msg.level === 'error' ? 'error' : 'log']('[foveo:engine]', msg.text);
      }
    });

    port.onDisconnect.addListener(() => {
      enginePort = null;
    });
    return;
  }

  if (port.name === 'foveo-content') {
    const tabId = port.sender && port.sender.tab ? port.sender.tab.id : null;
    if (tabId === null) return;
    contentPorts.set(tabId, port);

    port.onMessage.addListener((msg) => {
      if (msg.type === 'hello' && state.foveoOn && state.phase === 'ready'
          && runningTabs.size === 0) {
        // Reconnected tab asking for state.
        startOnTab(tabId);
      }
    });

    port.onDisconnect.addListener(() => {
      contentPorts.delete(tabId);
      runningTabs.delete(tabId);
    });
  }
});

// ---- engine window lifecycle -----------------------------------------------

api.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== state.engineTabId) {
    runningTabs.delete(tabId);
    contentPorts.delete(tabId);
    return;
  }
  // The engine window closed: nothing to look with.
  state.engineTabId = null;
  state.engineWindowId = null;
  state.phase = 'none';
  state.foveoOn = false;
  enginePort = null;
  stopAllTabs();
  setBadge();
});

api.tabs.onActivated.addListener(() => {
  // Gaze follows the focused tab automatically: the relay only forwards to
  // runningTabs, and startOnTab is issued for the tab the user toggled.
});

// ---- popup requests -----------------------------------------------------------

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'status') {
      sendResponse({
        phase: state.phase,
        foveoOn: state.foveoOn,
        accuracyPx: state.accuracyPx,
        engineOpen: state.engineTabId !== null,
      });
      return;
    }

    if (msg.type === 'toggle') {
      if (state.foveoOn) {
        state.foveoOn = false;
        stopAllTabs();
        setBadge();
        sendResponse({ foveoOn: false });
        return;
      }
      if (state.phase !== 'ready') {
        await ensureEngine(true); // no calibration yet -> run it
        sendResponse({ foveoOn: false, needsCalibration: true });
        return;
      }
      state.foveoOn = true;
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        if (!contentPorts.has(tab.id)) {
          // Page was loaded before the extension, or content script missed:
          // inject it now.
          try {
            await api.scripting.executeScript({
              target: { tabId: tab.id },
              files: [
                'src/content/lines.js',
                'src/content/fusion.js',
                'src/content/overlay.js',
                'src/content/content.js',
              ],
            });
            await api.scripting.insertCSS({
              target: { tabId: tab.id },
              files: ['src/content/content.css'],
            });
            // Give the fresh port a beat to register, then start it.
            await new Promise((r) => setTimeout(r, 150));
          } catch (_) { /* page type blocks injection */ }
        }
        await startOnTab(tab.id);
      }
      setBadge();
      sendResponse({ foveoOn: state.foveoOn });
      return;
    }

    if (msg.type === 'recalibrate') {
      await ensureEngine(true);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'openEngine') {
      await ensureEngine(false);
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ error: 'unknown message' });
  })();
  return true; // async sendResponse
});

// ---- install ------------------------------------------------------------------

api.runtime.onInstalled.addListener(() => {
  api.storage.local.get('foveoSettings').then(({ foveoSettings }) => {
    if (!foveoSettings) {
      api.storage.local.set({
        foveoSettings: {
          blurPx: 6,
          windowLines: 1.6,
          softPx: 28,
          dim: 0.05,
          transitionMs: 180,
          pxPerDegree: 35,
        },
      });
    }
  });
});

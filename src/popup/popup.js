/* Foveo — popup logic */

const api = typeof browser !== 'undefined' ? browser : chrome;

const $ = (id) => document.getElementById(id);

const els = {
  toggle: $('toggle'),
  toggleLabel: $('toggle-label'),
  stEngine: $('st-engine'),
  stCal: $('st-cal'),
  stAccess: $('st-access'),
  blur: $('in-blur'), outBlur: $('out-blur'),
  window: $('in-window'), outWindow: $('out-window'),
  soft: $('in-soft'), outSoft: $('out-soft'),
  recal: $('recal'),
};

let settings = null;

// Firefox does not grant Manifest V3 host permissions at install, so without
// this the reading-page script never runs. activeTab (granted by opening this
// popup) still covers the current tab; all-sites access is asked for once.
const ALL_SITES = { origins: ['<all_urls>'] };
let allSites = true;

function renderAccess() {
  els.stAccess.textContent = allSites ? 'all sites' : 'this tab only';
  els.stAccess.className = allSites ? 'good' : '';
}

function renderStatus(status, cal) {
  els.stEngine.textContent = status.engineOpen
    ? (status.phase === 'ready' ? 'running' : 'calibrating…')
    : 'closed';
  els.stEngine.className = status.phase === 'ready' ? 'good' : '';

  if (cal && cal.meanPx != null) {
    els.stCal.textContent = `${cal.meanPx}px avg error`;
    els.stCal.className = cal.meanPx <= 220 ? 'good' : '';
  } else {
    els.stCal.textContent = 'not calibrated';
    els.stCal.className = '';
  }

  const on = status.foveoOn;
  els.toggle.setAttribute('aria-pressed', String(on));
  els.toggleLabel.textContent = on ? 'Turn off' : 'Turn on';
}

function renderSettings() {
  els.blur.value = settings.blurPx;
  els.outBlur.textContent = `${settings.blurPx}px`;
  els.window.value = settings.windowLines;
  els.outWindow.textContent = `${settings.windowLines} lines`;
  els.soft.value = settings.softPx;
  els.outSoft.textContent = `${settings.softPx}px`;
}

async function refresh() {
  const [status, stored] = await Promise.all([
    api.runtime.sendMessage({ type: 'status' }),
    api.storage.local.get(['foveoSettings', 'foveoCalibration']),
  ]);
  try { allSites = await api.permissions.contains(ALL_SITES); } catch (_) { allSites = true; }
  renderAccess();
  settings = stored.foveoSettings || {};
  renderSettings();
  renderStatus(status, stored.foveoCalibration);
}

els.toggle.addEventListener('click', async () => {
  // Both calls start synchronously inside the click, which the permission
  // prompt requires; the toggle is already sent if the prompt closes the popup.
  const pending = api.runtime.sendMessage({ type: 'toggle' });
  if (!allSites) {
    api.permissions.request(ALL_SITES)
      .then((granted) => { allSites = granted; renderAccess(); })
      .catch(() => { /* dismissed */ });
  }
  const res = await pending;
  if (res && res.needsCalibration) {
    els.stCal.textContent = 'calibrating…';
  }
  // Give the engine a moment before re-reading status.
  setTimeout(refresh, 400);
});

els.recal.addEventListener('click', () => {
  api.runtime.sendMessage({ type: 'recalibrate' });
  window.close();
});

function onSlider(input, key, fmt, out) {
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    settings[key] = v;
    out.textContent = fmt(v);
    api.storage.local.set({ foveoSettings: settings });
  });
}
onSlider(els.blur, 'blurPx', (v) => `${v}px`, els.outBlur);
onSlider(els.window, 'windowLines', (v) => `${v} lines`, els.outWindow);
onSlider(els.soft, 'softPx', (v) => `${v}px`, els.outSoft);

refresh();

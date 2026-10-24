/* Foveo — popup logic */

const api = typeof browser !== 'undefined' ? browser : chrome;

const $ = (id) => document.getElementById(id);

const els = {
  toggle: $('toggle'),
  toggleLabel: $('toggle-label'),
  stEngine: $('st-engine'),
  stCal: $('st-cal'),
  blur: $('in-blur'), outBlur: $('out-blur'),
  window: $('in-window'), outWindow: $('out-window'),
  soft: $('in-soft'), outSoft: $('out-soft'),
  recal: $('recal'),
};

let settings = null;

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
  settings = stored.foveoSettings || {};
  renderSettings();
  renderStatus(status, stored.foveoCalibration);
}

els.toggle.addEventListener('click', async () => {
  const res = await api.runtime.sendMessage({ type: 'toggle' });
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

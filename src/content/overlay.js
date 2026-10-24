/* Foveo — blur overlay (PRD §6.5).
 *
 * One fixed, pointer-transparent layer with backdrop-filter: blur().
 * A gradient mask cuts a soft-edged sharp band whose top/height are
 * registered custom properties, so the window GLIDES between lines
 * (CSS transitions on @property values) instead of snapping.
 */

(function () {
  class FoveoOverlay {
    constructor() {
      this.root = null;
      this.overlay = null;
      this.settings = null;
    }

    mount(settings) {
      this.settings = settings;
      if (!this.root) {
        this.root = document.createElement('div');
        this.root.id = 'foveo-root';
        this.overlay = document.createElement('div');
        this.overlay.id = 'foveo-overlay';
        this.root.appendChild(this.overlay);
        (document.body || document.documentElement).appendChild(this.root);
      }
      this._applySettings();
    }

    _applySettings() {
      const s = this.settings;
      const o = this.overlay;
      o.style.setProperty('--fv-blur', `${s.blurPx}px`);
      o.style.setProperty('--fv-soft', `${s.softPx}px`);
      o.style.setProperty('--fv-dim', String(s.dim));
      o.style.setProperty('--fv-speed', `${s.transitionMs}ms`);
    }

    updateSettings(settings) {
      this.settings = settings;
      if (this.overlay) this._applySettings();
    }

    /**
     * @param {object} band      line band {top, bottom, h, ...}
     * @param {number} medianH   median line height on this page
     */
    showBand(band, medianH) {
      if (!this.overlay || !band) return;
      const windowLines = this.settings.windowLines;
      const pad = ((windowLines - 1) / 2) * medianH + 8;
      const top = band.top - pad;
      const height = band.h + pad * 2;
      this.overlay.style.setProperty('--fv-top', `${top}px`);
      this.overlay.style.setProperty('--fv-h', `${height}px`);
      this.overlay.classList.add('fv-on');
    }

    hide() {
      if (this.overlay) this.overlay.classList.remove('fv-on');
    }

    unmount() {
      if (this.root) {
        this.root.remove();
        this.root = null;
        this.overlay = null;
      }
    }
  }

  window.FoveoOverlay = FoveoOverlay;
})();

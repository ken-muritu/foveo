/* Foveo — line-band detection (PRD §6.3).
 *
 * Walks visible text nodes, asks Range.getClientRects() for each node's
 * per-line boxes, and clusters those boxes into horizontal bands — one per
 * visual text line. The overlay tracks bands, not raw rects, so wrapped
 * paragraphs and justified text behave as single lines.
 */

(function () {
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME',
    'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'SELECT', 'INPUT', 'TEXTAREA',
  ]);
  const PAD = 300;          // cull margin beyond the viewport
  const LINE_TOL = 4;       // rects whose tops differ by <= this are one line
  const MAX_NODES = 6000;   // safety valve for enormous DOMs
  const MIN_W = 14;
  const MIN_H = 6;

  class FoveoLines {
    constructor() {
      this.bands = [];
      this.medianHeight = 20;
      this._styleCache = new Map();
      this._dirty = false;
      this._observer = null;
      this._scheduled = false;
      this.build();
      this._watch();
    }

    _visible(el) {
      if (this._styleCache.has(el)) return this._styleCache.get(el);
      const cs = window.getComputedStyle(el);
      const vis = cs.display !== 'none' && cs.visibility !== 'hidden';
      this._styleCache.set(el, vis);
      return vis;
    }

    build() {
      const rects = [];
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const range = document.createRange();
      const walker = document.createTreeWalker(
        document.body || document.documentElement,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            if (!node.data || !node.data.trim()) return NodeFilter.FILTER_REJECT;
            const el = node.parentElement;
            if (!el) return NodeFilter.FILTER_REJECT;
            if (el.closest('#foveo-root')) return NodeFilter.FILTER_REJECT;
            for (let p = el; p; p = p.parentElement) {
              if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );

      let count = 0;
      while (walker.nextNode() && count < MAX_NODES) {
        const node = walker.currentNode;
        const el = node.parentElement;
        if (!this._visible(el)) continue;
        count++;

        range.selectNodeContents(node);
        const nodeRects = range.getClientRects();
        for (let i = 0; i < nodeRects.length; i++) {
          const r = nodeRects[i];
          if (r.width < MIN_W || r.height < MIN_H) continue;
          if (r.bottom < -PAD || r.top > vh + PAD) continue;
          if (r.right < -PAD || r.left > vw + PAD) continue;
          rects.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
        }
      }
      range.detach();

      this.bands = this._cluster(rects);
      this.medianHeight = this._medianHeight();
      return this.bands;
    }

    _cluster(rects) {
      if (!rects.length) return [];
      rects.sort((a, b) => a.top - b.top || a.left - b.left);
      const bands = [];
      let cur = null;

      for (const r of rects) {
        if (cur && Math.abs(r.top - cur.top) <= LINE_TOL) {
          cur.top = Math.min(cur.top, r.top);
          cur.bottom = Math.max(cur.bottom, r.bottom);
          cur.left = Math.min(cur.left, r.left);
          cur.right = Math.max(cur.right, r.right);
        } else {
          cur = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          bands.push(cur);
        }
      }
      for (let i = 0; i < bands.length; i++) {
        const b = bands[i];
        b.cy = (b.top + b.bottom) / 2;
        b.h = b.bottom - b.top;
        b.idx = i;
      }
      return bands;
    }

    _medianHeight() {
      if (!this.bands.length) return 20;
      const hs = this.bands.map((b) => b.h).sort((a, b) => a - b);
      return hs[Math.floor(hs.length / 2)];
    }

    /**
     * Nearest band to a point. Vertical distance dominates; points well
     * outside a band's horizontal span pay a penalty so blank margins don't
     * grab the window.
     */
    nearestBand(x, y) {
      let best = null;
      let bestScore = Infinity;
      for (const b of this.bands) {
        let dy;
        if (y < b.top) dy = b.top - y;
        else if (y > b.bottom) dy = y - b.bottom;
        else dy = 0;

        let dx = 0;
        if (x < b.left - 60) dx = 80;
        else if (x > b.right + 60) dx = 80;

        const score = dy + dx;
        if (score < bestScore) {
          bestScore = score;
          best = b;
        }
      }
      return best;
    }

    _watch() {
      const scheduleRebuild = () => {
        if (this._scheduled) return;
        this._scheduled = true;
        requestAnimationFrame(() => {
          this._scheduled = false;
          this._styleCache.clear();
          this.build();
          if (this.onRebuild) this.onRebuild(this.bands);
        });
      };

      this._observer = new MutationObserver(scheduleRebuild);
      this._observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden'],
      });
      window.addEventListener('scroll', scheduleRebuild, { passive: true, capture: true });
      window.addEventListener('resize', scheduleRebuild, { passive: true });
    }
  }

  window.FoveoLines = FoveoLines;
})();

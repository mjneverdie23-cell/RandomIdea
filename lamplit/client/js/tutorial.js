// A first-visit tour: a dimmed screen with a spotlight on one thing at a time and a
// short card explaining it. Some steps move on by themselves (e.g. once you sit down).

import { t } from './i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class Tutorial {
  /**
   * @param steps [{ id, target?: () => DOMRect|null, title, body, waitFor? }]
   * @param onEnd (finished: boolean) => void
   */
  constructor(steps, onEnd) {
    this.steps = steps;
    this.onEnd = onEnd;
    this.i = -1;
    this.root = document.createElement('div');
    this.root.id = 'coach';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-live', 'polite');
    this.spot = document.createElement('div');
    this.spot.className = 'coach-spot';
    this.card = document.createElement('div');
    this.card.className = 'coach-card';
    this.root.append(this.spot, this.card);
    this.onClick = (e) => {
      const b = e.target.closest('[data-coach]');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      const a = b.dataset.coach;
      if (a === 'next') this.go(this.i + 1);
      else if (a === 'back') this.go(this.i - 1);
      else if (a === 'skip') this.end(false);
    };
    this.root.addEventListener('click', this.onClick);
    this.onResize = () => this.place();
  }

  get active() {
    return this.i >= 0;
  }

  get step() {
    return this.steps[this.i];
  }

  start() {
    document.body.append(this.root);
    window.addEventListener('resize', this.onResize);
    this.timer = setInterval(() => this.place(), 400);
    this.go(0);
  }

  /** Lets main.js report events such as 'sat'; a waiting step then moves on. */
  notify(event) {
    if (this.active && this.step.waitFor === event) this.go(this.i + 1);
  }

  go(i) {
    if (i >= this.steps.length) {
      this.end(true);
      return;
    }
    this.i = Math.max(0, i);
    const s = this.step;
    const last = this.i === this.steps.length - 1;
    this.card.innerHTML = `
      <div class="coach-count">${this.i + 1} / ${this.steps.length}</div>
      <h3>${esc(s.title)}</h3>
      <p>${esc(s.body)}</p>
      <div class="coach-row">
        ${last ? '' : `<button class="link" data-coach="skip">${esc(t('tourSkip'))}</button>`}
        <span class="spacer"></span>
        ${this.i > 0 ? `<button class="btn ghost small" data-coach="back">${esc(t('tourBack'))}</button>` : ''}
        <button class="btn primary small" data-coach="next">${esc(last ? t('tourDone') : s.waitFor ? t('tourSkipStep') : t('tourNext'))}</button>
      </div>`;
    this.place();
    this.card.querySelector('[data-coach="next"]')?.focus({ preventScroll: true });
  }

  place() {
    if (!this.active) return;
    const rect = this.step.target?.() ?? null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!rect) {
      this.spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0;`;
      this.card.style.cssText = `left:50%;top:50%;transform:translate(-50%,-50%);`;
      return;
    }
    const pad = 8;
    const x = Math.max(4, rect.left - pad);
    const y = Math.max(4, rect.top - pad);
    const w = Math.min(vw - x - 4, rect.width + pad * 2);
    const h = Math.min(vh - y - 4, rect.height + pad * 2);
    this.spot.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
    const cw = Math.min(340, vw - 24);
    const ch = this.card.offsetHeight || 170;
    let top = y + h + 12;
    if (top + ch > vh - 12) top = y - ch - 12;
    if (top < 12) top = Math.min(vh - ch - 12, Math.max(12, vh / 2 - ch / 2));
    const left = Math.min(vw - cw - 12, Math.max(12, x + w / 2 - cw / 2));
    this.card.style.cssText = `left:${left}px;top:${top}px;width:${cw}px;`;
  }

  end(finished) {
    if (!this.active) return;
    this.i = -1;
    clearInterval(this.timer);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
    this.onEnd?.(finished);
  }
}

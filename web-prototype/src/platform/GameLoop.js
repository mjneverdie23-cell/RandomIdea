/**
 * Fixed-timestep game loop.
 *
 * The simulation always advances in identical steps (SimConfig.tickRate) while
 * rendering happens once per animation frame. That keeps physics, spread and
 * bot behaviour framerate-independent and deterministic.
 */
import { SimConfig } from '../config/gameplay.config.js';

export class GameLoop {
  /**
   * @param {object} deps
   * @param {(dt:number)=>void} deps.tick    fixed-step simulation update
   * @param {(dt:number)=>void} deps.render  variable-step presentation update
   */
  constructor({ tick, render, config = SimConfig }) {
    this.tick = tick;
    this.render = render;
    this.config = config;
    this.running = false;
    this.accumulator = 0;
    this.lastTime = 0;
    this.timeScale = 1;
    this.stats = { fps: 0, ticksLastFrame: 0, frameMs: 0 };
    this._frameCount = 0;
    this._fpsTimer = 0;
    this._frame = this._frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() { this.running = false; }

  _frame(now) {
    if (!this.running) return;
    const frameStart = now;
    // Clamp the delta so a background tab does not fast-forward the match.
    let delta = Math.min(0.25, (now - this.lastTime) / 1000) * this.timeScale;
    this.lastTime = now;

    this.accumulator += delta;
    const step = this.config.fixedDelta;
    let ticks = 0;
    while (this.accumulator >= step && ticks < this.config.maxTicksPerFrame) {
      this.tick(step);
      this.accumulator -= step;
      ticks += 1;
    }
    if (ticks === this.config.maxTicksPerFrame) this.accumulator = 0; // give up on catching up

    this.render(delta);

    this.stats.ticksLastFrame = ticks;
    this.stats.frameMs = performance.now() - frameStart;
    this._frameCount += 1;
    this._fpsTimer += delta;
    if (this._fpsTimer >= 0.5) {
      this.stats.fps = Math.round(this._frameCount / this._fpsTimer);
      this._frameCount = 0;
      this._fpsTimer = 0;
    }

    requestAnimationFrame(this._frame);
  }
}

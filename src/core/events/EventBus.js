/**
 * Tiny synchronous pub/sub bus.
 *
 * Deliberately dependency-free and synchronous: listeners run in the same tick
 * the event was emitted in, which keeps cause and effect easy to follow when
 * debugging round logic.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    /** @type {Set<Function>} */
    this._wildcards = new Set();
    this.debug = false;
  }

  /**
   * Subscribe to an event.
   * @returns {() => void} unsubscribe handle
   */
  on(eventName, handler) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }

  /** Subscribe to a single occurrence. */
  once(eventName, handler) {
    const wrapped = (payload) => { off(); handler(payload); };
    const off = this.on(eventName, wrapped);
    return off;
  }

  /** Subscribe to every event; handler receives (eventName, payload). */
  onAny(handler) {
    this._wildcards.add(handler);
    return () => this._wildcards.delete(handler);
  }

  off(eventName, handler) {
    this._listeners.get(eventName)?.delete(handler);
  }

  emit(eventName, payload = {}) {
    if (this.debug) console.log(`[event] ${eventName}`, payload);
    const handlers = this._listeners.get(eventName);
    if (handlers) {
      // Copy first: handlers are allowed to subscribe/unsubscribe while running.
      for (const handler of [...handlers]) handler(payload, eventName);
    }
    for (const handler of [...this._wildcards]) handler(eventName, payload);
  }

  clear() {
    this._listeners.clear();
    this._wildcards.clear();
  }
}

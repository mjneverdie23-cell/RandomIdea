// WebSocket connection with automatic reconnects and a server clock estimate.

export class Net {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.handlers = new Map();
    this.offset = 0;
    this.samples = [];
    this.retry = 0;
    this.wantOpen = false;
    this.makeHello = null;
    this.pingTimer = 0;
    this.retryTimer = 0;
  }

  on(type, fn) {
    this.handlers.set(type, fn);
    return this;
  }

  emit(type, arg) {
    this.handlers.get(type)?.(arg);
  }

  /** Server time in milliseconds, estimated from ping round trips. */
  now() {
    return Date.now() + this.offset;
  }

  get open() {
    return this.ws?.readyState === 1;
  }

  connect(makeHello) {
    this.makeHello = makeHello;
    this.wantOpen = true;
    clearTimeout(this.retryTimer);
    if (!this.ws) this.openSocket();
  }

  disconnect() {
    this.wantOpen = false;
    clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  /** Close and reconnect straight away (e.g. after the page was frozen). */
  reconnectNow() {
    if (!this.wantOpen) return;
    clearTimeout(this.retryTimer);
    if (this.ws && this.ws.readyState <= 1) return;
    this.retry = 0;
    this.openSocket();
  }

  openSocket() {
    this.emit('status', this.retry === 0 ? 'connecting' : 'reconnecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.samples = [];
      this.send(this.makeHello());
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 10_000);
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') this.onPong(msg);
      else this.emit('message', msg);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws === ws) this.ws = null;
      if (this.wantOpen) this.scheduleRetry();
    };
    ws.onerror = () => {};
  }

  scheduleRetry() {
    this.emit('status', this.retry < 4 ? 'reconnecting' : 'offline');
    const delay = Math.min(15_000, 600 * 2 ** this.retry) * (0.7 + Math.random() * 0.6);
    this.retry++;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.wantOpen && !this.ws) this.openSocket();
    }, delay);
  }

  send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  /** A rough first estimate, refined by pings. */
  setServerTime(serverNow) {
    if (this.samples.length === 0) this.offset = serverNow - Date.now();
  }

  ping() {
    this.send({ t: 'ping', c: Date.now() });
  }

  onPong(msg) {
    const now = Date.now();
    const rtt = now - msg.c;
    if (!(rtt >= 0 && rtt < 10_000)) return;
    this.samples.push({ rtt, offset: msg.s + rtt / 2 - now });
    if (this.samples.length > 8) this.samples.shift();
    // The quickest round trip gives the most trustworthy estimate.
    this.offset = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset;
  }
}

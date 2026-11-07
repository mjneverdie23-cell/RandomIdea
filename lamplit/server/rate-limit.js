/** Classic token bucket: `capacity` burst, refilled at `perSecond` tokens per second. */
export class TokenBucket {
  constructor(capacity, perSecond, now = () => Date.now()) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.rate = perSecond / 1000;
    this.now = now;
    this.last = now();
  }

  take(n = 1) {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (t - this.last) * this.rate);
    this.last = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

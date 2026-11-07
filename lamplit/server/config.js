// Runtime settings, all overridable with environment variables.

const int = (name, fallback, min, max) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number.parseInt(raw, 10);
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return v;
};

export const config = Object.freeze({
  port: int('PORT', 8080, 1, 65535),
  host: process.env.HOST || '0.0.0.0',
  /** Visitors per reading room (at most 100, the number of desks). */
  hallCapacity: int('HALL_CAPACITY', 100, 1, 100),
  /** Rooms one server process will open before new visitors queue. */
  maxHalls: int('MAX_HALLS', 100, 1, 10000),
  maxQueue: int('MAX_QUEUE', 5000, 0, 1000000),
  /** How often room events are batched and sent, in milliseconds. */
  tickMs: int('TICK_MS', 200, 50, 2000),
  /** Open sockets allowed per IP address (schools and offices share addresses). */
  maxConnectionsPerIp: int('MAX_CONN_PER_IP', 40, 1, 100000),
  /** Set to 1 behind a reverse proxy so X-Forwarded-For is used for the client address. */
  trustProxy: process.env.TRUST_PROXY === '1',
  /** Comma-separated list of allowed Origin values for the WebSocket; empty allows any. */
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
});

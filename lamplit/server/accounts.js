// Passwords, usernames and calendar days.

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

const derive = (password, salt, n = N, r = R, p = P) =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });

/** "scrypt$N$r$p$salt$hash" with a random 16-byte salt. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

// Checked against when a username doesn't exist, so a wrong username takes as long as a
// wrong password and can't be told apart by timing.
const DUMMY = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function verifyPassword(password, stored) {
  const parts = String(stored || DUMMY).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64url');
  const key = await derive(password, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return stored !== undefined && stored !== null && key.length === expected.length && timingSafeEqual(key, expected);
}

/** 3–20 letters, digits or underscores. Usernames are only ever shown to their owner. */
export const validUsername = (u) => typeof u === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(u);
export const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 128;

const formatters = new Map();
function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

export function validTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** "YYYY-MM-DD" for a moment in a time zone. */
export function dayKey(tz, ms) {
  return formatter(validTimeZone(tz) ? tz : 'UTC').format(new Date(ms));
}

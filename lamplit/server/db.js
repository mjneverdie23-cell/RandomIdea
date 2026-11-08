// Persistent storage on Node's built-in SQLite (no extra dependency).
//
// Every visitor has a profile. A guest is a profile without a username; signing up adds
// a username and password to the same profile, so a guest keeps everything they earned.

import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE COLLATE NOCASE,
  pass_hash TEXT,
  friend_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  look TEXT NOT NULL,
  lumens INTEGER NOT NULL DEFAULT 0,
  total_minutes INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  goal INTEGER NOT NULL DEFAULT 120,
  tz TEXT,
  tutorial INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_profile ON tokens(profile_id);
CREATE TABLE IF NOT EXISTS owned (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, item)
);
CREATE TABLE IF NOT EXISTS days (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  PRIMARY KEY (profile_id, day)
);
CREATE TABLE IF NOT EXISTS friends (
  a INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  accepted INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS friends_b ON friends(b);
`;

/** Friend codes avoid look-alike characters (0/O, 1/I). */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => [...randomBytes(8)].map((b) => CODE_ALPHABET[b & 31]).join('');
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function parseProfile(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    username: r.username ?? null,
    passHash: r.pass_hash ?? null,
    code: r.friend_code,
    name: JSON.parse(r.name),
    look: JSON.parse(r.look),
    lumens: Number(r.lumens),
    total: Number(r.total_minutes),
    sessions: Number(r.sessions),
    goal: Number(r.goal),
    tz: r.tz ?? null,
    tutorial: Number(r.tutorial) === 1,
    createdAt: Number(r.created_at),
    lastSeen: Number(r.last_seen),
  };
}

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);

  const st = {
    insertProfile: db.prepare('INSERT INTO profiles (friend_code, name, look, lumens, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)'),
    byId: db.prepare('SELECT * FROM profiles WHERE id = ?'),
    byUsername: db.prepare('SELECT * FROM profiles WHERE username = ?'),
    byCode: db.prepare('SELECT * FROM profiles WHERE friend_code = ?'),
    setCredentials: db.prepare('UPDATE profiles SET username = ?, pass_hash = ? WHERE id = ?'),
    insertToken: db.prepare('INSERT INTO tokens (hash, profile_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    byToken: db.prepare('SELECT p.* FROM tokens t JOIN profiles p ON p.id = t.profile_id WHERE t.hash = ? AND t.expires_at > ?'),
    deleteToken: db.prepare('DELETE FROM tokens WHERE hash = ?'),
    purgeTokens: db.prepare('DELETE FROM tokens WHERE expires_at <= ?'),
    credit: db.prepare('UPDATE profiles SET lumens = lumens + ?, total_minutes = total_minutes + ?, sessions = sessions + ?, last_seen = ? WHERE id = ?'),
    addDay: db.prepare('INSERT INTO days (profile_id, day, minutes) VALUES (?, ?, ?) ON CONFLICT (profile_id, day) DO UPDATE SET minutes = minutes + excluded.minutes'),
    days: db.prepare('SELECT day, minutes FROM days WHERE profile_id = ? AND day >= ? ORDER BY day DESC'),
    isOwned: db.prepare('SELECT 1 FROM owned WHERE profile_id = ? AND item = ?'),
    owned: db.prepare('SELECT item FROM owned WHERE profile_id = ? ORDER BY at'),
    spend: db.prepare('UPDATE profiles SET lumens = lumens - ? WHERE id = ? AND lumens >= ?'),
    addOwned: db.prepare('INSERT INTO owned (profile_id, item, at) VALUES (?, ?, ?)'),
    setLook: db.prepare('UPDATE profiles SET look = ? WHERE id = ?'),
    setName: db.prepare('UPDATE profiles SET name = ? WHERE id = ?'),
    setGoal: db.prepare('UPDATE profiles SET goal = ? WHERE id = ?'),
    setTutorial: db.prepare('UPDATE profiles SET tutorial = 1 WHERE id = ?'),
    setTz: db.prepare('UPDATE profiles SET tz = ?, last_seen = ? WHERE id = ?'),
    relation: db.prepare('SELECT a, b, accepted FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)'),
    request: db.prepare('INSERT INTO friends (a, b, accepted, at) VALUES (?, ?, 0, ?)'),
    accept: db.prepare('UPDATE friends SET accepted = 1, at = ? WHERE a = ? AND b = ? AND accepted = 0'),
    unfriend: db.prepare('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)'),
    friends: db.prepare(
      'SELECT p.id, p.name, p.look FROM friends f JOIN profiles p ON p.id = CASE WHEN f.a = $id THEN f.b ELSE f.a END WHERE f.accepted = 1 AND (f.a = $id OR f.b = $id) ORDER BY f.at DESC',
    ),
    incoming: db.prepare('SELECT p.id, p.name, p.look FROM friends f JOIN profiles p ON p.id = f.a WHERE f.b = ? AND f.accepted = 0 ORDER BY f.at DESC'),
    outgoing: db.prepare('SELECT p.id, p.name, p.look FROM friends f JOIN profiles p ON p.id = f.b WHERE f.a = ? AND f.accepted = 0 ORDER BY f.at DESC'),
    friendCount: db.prepare('SELECT COUNT(*) AS n FROM friends WHERE (a = ? OR b = ?)'),
  };

  const tx = (fn) => {
    db.exec('BEGIN');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const brief = (r) => ({ id: Number(r.id), name: JSON.parse(r.name), look: JSON.parse(r.look) });

  return {
    raw: db,

    createProfile({ name, look, lumens, now }) {
      for (let tries = 0; tries < 8; tries++) {
        try {
          const r = st.insertProfile.run(newCode(), JSON.stringify(name), JSON.stringify(look), lumens, now, now);
          return Number(r.lastInsertRowid);
        } catch (e) {
          if (!/UNIQUE/i.test(String(e.message))) throw e;
        }
      }
      throw new Error('could not allocate a friend code');
    },

    profile: (id) => parseProfile(st.byId.get(id)),
    profileByUsername: (username) => parseProfile(st.byUsername.get(username)),
    profileByCode: (code) => parseProfile(st.byCode.get(code)),

    /** Returns false if the username is already taken. */
    setCredentials(id, username, passHash) {
      try {
        st.setCredentials.run(username, passHash, id);
        return true;
      } catch (e) {
        if (/UNIQUE/i.test(String(e.message))) return false;
        throw e;
      }
    },

    issueToken(profileId, now, ttlMs) {
      const token = randomBytes(32).toString('base64url');
      st.insertToken.run(hashToken(token), profileId, now, now + ttlMs);
      return token;
    },
    profileByToken: (token, now) => parseProfile(st.byToken.get(hashToken(token), now)),
    revokeToken: (token) => st.deleteToken.run(hashToken(token)),
    purgeTokens: (now) => st.purgeTokens.run(now),

    credit(id, lumens, minutes, completed, day, now) {
      tx(() => {
        st.credit.run(lumens, minutes, completed ? 1 : 0, now, id);
        if (minutes > 0) st.addDay.run(id, day, minutes);
      });
    },
    /** Daily minutes from `fromDay` (YYYY-MM-DD) on, newest first. */
    days: (id, fromDay) => st.days.all(id, fromDay).map((r) => ({ day: r.day, minutes: Number(r.minutes) })),

    owned: (id) => new Set(st.owned.all(id).map((r) => r.item)),
    owns: (id, item) => Boolean(st.isOwned.get(id, item)),
    /** 'ok', 'owned' or 'funds'. */
    buy(id, item, price, now) {
      return tx(() => {
        if (st.isOwned.get(id, item)) return 'owned';
        if (st.spend.run(price, id, price).changes === 0) return 'funds';
        st.addOwned.run(id, item, now);
        return 'ok';
      });
    },

    setLook: (id, look) => st.setLook.run(JSON.stringify(look), id),
    setName: (id, name) => st.setName.run(JSON.stringify(name), id),
    setGoal: (id, goal) => st.setGoal.run(goal, id),
    setTutorial: (id) => st.setTutorial.run(id),
    setTz: (id, tz, now) => st.setTz.run(tz, now, id),

    /** The friendship row between two profiles in either direction, or null. */
    relation(x, y) {
      const r = st.relation.get(x, y, y, x);
      return r ? { a: Number(r.a), b: Number(r.b), accepted: Number(r.accepted) === 1 } : null;
    },
    request: (from, to, now) => st.request.run(from, to, now),
    accept: (requester, accepter, now) => st.accept.run(now, requester, accepter).changes > 0,
    unfriend: (x, y) => st.unfriend.run(x, y, y, x).changes > 0,
    friends: (id) => st.friends.all({ $id: id }).map(brief),
    incoming: (id) => st.incoming.all(id).map(brief),
    outgoing: (id) => st.outgoing.all(id).map(brief),
    friendCount: (id) => Number(st.friendCount.get(id, id).n),

    close: () => db.close(),
  };
}

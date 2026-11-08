// Talking to the HTTP auth endpoints, and remembering your login on this device.

const TOKEN_KEY = 'lamplit:token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: the login lasts for this page only
  }
}

export const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** Returns { ok, status, data }; network failures come back as status 0. */
async function call(path, { method = 'POST', body, token } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      // empty body
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } };
  }
}

export const continueAsGuest = () => call('/api/guest', { body: { tz: timeZone() } });
export const signUp = (username, password, guestToken) => call('/api/signup', { body: { username, password, tz: timeZone() }, token: guestToken });
export const logIn = (username, password) => call('/api/login', { body: { username, password, tz: timeZone() } });
export const logOut = (token) => call('/api/logout', { body: {}, token });
export const whoAmI = (token) => call('/api/me', { method: 'GET', token });

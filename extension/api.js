/**
 * Everyday Summariser — shared backend client.
 *
 * Every /api route requires an X-ES-Token header. The token is fetched once from
 * /api/pair (which the backend only answers for chrome-extension:// origins) and
 * cached in chrome.storage.local. Loaded by the service worker via importScripts
 * and by each extension page via <script src="api.js">.
 */

const BACKEND_URL_DEFAULT = 'http://localhost:8000';

let pairingInFlight = null;

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.local.get('backendUrl');
  return backendUrl || BACKEND_URL_DEFAULT;
}

/** Fetch a fresh token from the backend. Concurrent callers share one request. */
function pairWithBackend(base) {
  if (pairingInFlight) return pairingInFlight;

  pairingInFlight = (async () => {
    try {
      const res = await fetch(`${base}/api/pair`);
      if (!res.ok) return '';
      const data = await res.json();
      const token = data.token || '';
      if (token) await chrome.storage.local.set({ esToken: token });
      return token;
    } catch {
      return ''; // backend down — callers still attempt the request so health checks report offline
    } finally {
      pairingInFlight = null;
    }
  })();

  return pairingInFlight;
}

async function getToken(base) {
  const { esToken } = await chrome.storage.local.get('esToken');
  if (esToken) return esToken;
  return pairWithBackend(base);
}

/**
 * fetch() with the auth header attached. Accepts either a path ('/api/stats') or
 * an absolute URL. Re-pairs once on 401 so a rotated token self-heals.
 */
async function apiFetch(pathOrUrl, opts = {}) {
  const base = await getBackendUrl();
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`;

  const token = await getToken(base);
  const headers = { ...(opts.headers || {}), 'X-ES-Token': token };

  let res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    await chrome.storage.local.remove('esToken');
    const fresh = await pairWithBackend(base);
    if (fresh) {
      res = await fetch(url, { ...opts, headers: { ...headers, 'X-ES-Token': fresh } });
    }
  }

  return res;
}

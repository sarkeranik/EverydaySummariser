importScripts('api.js');

const BLOCKLIST_ALARM = 'syncBlocklist';
const PAUSE_ALARM = 'resumeCapture';
const REMINDER_ALARM = 'eveningReminder';
const AUDIO_ROTATE_MINUTES = 10;

// ─── Badge Management ───────────────────────────────────────────────────────
// Persisted, because an MV3 service worker unloads after ~30s idle and any
// in-memory counter would silently reset to zero. The stored date also makes the
// daily rollover self-correcting, with no midnight timer to miss.

async function updateBadge(increment = 1) {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
  const { badgeCount = 0, badgeDate } = await chrome.storage.local.get(['badgeCount', 'badgeDate']);

  const count = (badgeDate === today ? badgeCount : 0) + increment;
  await chrome.storage.local.set({ badgeCount: count, badgeDate: today });

  chrome.action.setBadgeText({ text: count ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
  chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

/** Brief confirmation flash, then restore the running count. */
async function flashBadge(text, color = '#22c55e') {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => updateBadge(0), 1200);
}

// ─── Domain Blocklist Check ─────────────────────────────────────────────────
async function isDomainBlocked(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const result = await chrome.storage.local.get('domainBlocklist');
    const blocklist = (result.domainBlocklist || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    return blocklist.some(blocked => hostname === blocked || hostname.endsWith('.' + blocked));
  } catch {
    return false;
  }
}

async function captureEnabled() {
  const { captureEnabled, pauseUntil } = await chrome.storage.local.get(['captureEnabled', 'pauseUntil']);
  if (captureEnabled === false) return false;
  if (pauseUntil && Date.now() < pauseUntil) return false;
  return true;
}

/** POST JSON to the backend, bump the badge on success. */
async function post(path, payload, badge = 1) {
  try {
    const res = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) await updateBadge(badge);
    return res;
  } catch (err) {
    console.error(`Error posting to ${path}:`, err);
  }
}

// ─── Message Handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.target === 'offscreen') return; // not ours

  (async () => {
    if (!(await captureEnabled())) return;

    if (message.type === 'PAGE_DATA') {
      const { textData, imageData } = message.payload;
      if (textData && await isDomainBlocked(textData.url)) return;

      if (textData && textData.content) {
        await post('/api/text', textData, 1);
      }
      if (imageData && imageData.length > 0) {
        await post('/api/images', imageData, 0); // don't double count
      }
    }

    if (message.type === 'YOUTUBE_DATA') {
      if (await isDomainBlocked(message.payload.url)) return;
      await post('/api/youtube', message.payload);
    }

    if (message.type === 'PDF_DATA') {
      await post('/api/pdf', message.payload);
    }

    if (message.type === 'TWITTER_DATA') {
      if (await isDomainBlocked(message.payload.url)) return;
      await post('/api/twitter', message.payload);
    }
  })();

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  }

  if (message.type === 'OPEN_SIDEPANEL') {
    if (chrome.sidePanel) {
      chrome.sidePanel.open({ windowId: sender.tab?.windowId });
    }
  }

  // Temporarily stop capturing without having to remember to switch it back on.
  if (message.type === 'PAUSE_CAPTURE') {
    const until = Date.now() + (message.minutes || 30) * 60 * 1000;
    chrome.storage.local.set({ pauseUntil: until });
    chrome.action.setBadgeText({ text: '⏸' });
    chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
    chrome.alarms.create(PAUSE_ALARM, { when: until });
  }

  if (message.type === 'RESUME_CAPTURE') {
    chrome.storage.local.remove('pauseUntil');
    chrome.alarms.clear(PAUSE_ALARM);
    updateBadge(0);
  }
});

// ─── Highlight Capture ──────────────────────────────────────────────────────
// An explicit save is the strongest signal the user produces, so it ignores the
// capture-enabled toggle and the dwell gate — but still respects the blocklist.

async function saveHighlight(selectedText, tab) {
  const text = (selectedText || '').trim();
  if (!text) return;
  if (tab?.url && await isDomainBlocked(tab.url)) return;

  const res = await apiFetch('/api/highlights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: tab?.url || '',
      title: tab?.title || '',
      selected_text: text
    })
  }).catch(err => console.error('Error saving highlight:', err));

  if (res && res.ok) {
    flashBadge('✓');
  } else {
    flashBadge('!', '#ef4444');
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: 'save-highlight',
    title: 'Save highlight to journal',
    contexts: ['selection']
  });

  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'save-highlight') {
    saveHighlight(info.selectionText, tab);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-highlight') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Read the selection on demand rather than injecting a persistent listener.
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString()
    });
    await saveHighlight(result, tab);
  } catch (err) {
    console.error('Could not read selection:', err);
  }
});

// ─── Audio Recording ────────────────────────────────────────────────────────
// One session per audible tab. The offscreen document rotates the recorder so
// every uploaded file is a complete, independently decodable webm.

let currentRecordingTabId = null;
let offscreenCreating = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length > 0) return;

  if (offscreenCreating) return offscreenCreating; // concurrent callers must not both create

  offscreenCreating = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Recording audio for local journaling'
  }).catch(err => {
    if (!String(err).includes('Only a single offscreen')) throw err;
  }).finally(() => {
    offscreenCreating = null;
  });

  return offscreenCreating;
}

function stopRecording(tabId) {
  chrome.runtime.sendMessage({
    type: 'STOP_RECORDING',
    target: 'offscreen',
    payload: { tabId }
  }).catch(() => {}); // offscreen document may already be gone
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.audible === undefined) return;
  if (!(await captureEnabled())) return;

  const { capture_audio } = await chrome.storage.local.get('capture_audio');
  if (capture_audio === false) return;

  if (changeInfo.audible === true) {
    if (currentRecordingTabId === tabId) return;
    if (await isDomainBlocked(tab.url || '')) return;

    if (currentRecordingTabId !== null) {
      stopRecording(currentRecordingTabId);
    }
    currentRecordingTabId = tabId;

    await ensureOffscreen();

    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        currentRecordingTabId = null;
        return;
      }
      chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        target: 'offscreen',
        payload: {
          streamId,
          tabId,
          url: tab.url,
          sessionId: `${tabId}-${Date.now()}`,
          rotateMs: AUDIO_ROTATE_MINUTES * 60 * 1000
        }
      }).catch(err => console.error('Could not start recording:', err));
    });
  } else if (changeInfo.audible === false && currentRecordingTabId === tabId) {
    currentRecordingTabId = null;
    stopRecording(tabId);
  }
});

// Recording must not outlive its tab.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (currentRecordingTabId === tabId) {
    currentRecordingTabId = null;
    stopRecording(tabId);
  }
});

// ─── Side Panel Configuration ───────────────────────────────────────────────
if (chrome.sidePanel) {
  chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
}

// ─── Settings Sync ──────────────────────────────────────────────────────────
// chrome.alarms, not setInterval: a service worker unloads while idle and any
// pending interval or timeout dies with it.

async function syncSettings() {
  try {
    const res = await apiFetch('/api/settings');
    const data = await res.json();
    if (data.status === 'success') {
      await chrome.storage.local.set({
        domainBlocklist: data.settings.domain_blocklist || '',
        dwellThresholdMs: parseInt(data.settings.dwell_time_threshold || '5000', 10),
        capture_audio: data.settings.capture_audio !== 'false'
      });
    }
  } catch {
    // Backend not available
  }
}

chrome.alarms.create(BLOCKLIST_ALARM, { periodInMinutes: 5, delayInMinutes: 0 });

// ─── Evening Reminder ───────────────────────────────────────────────────────
// Nudge once in the evening, and only if today's journal hasn't been written yet.

function scheduleEveningReminder() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  chrome.alarms.create(REMINDER_ALARM, {
    when: next.getTime(),
    periodInMinutes: 24 * 60,
  });
}

async function maybeRemind() {
  const today = new Date().toLocaleDateString('en-CA');
  try {
    const res = await apiFetch(`/api/notes/${today}`);
    if (res.ok) return; // already generated today

    const stats = await (await apiFetch('/api/stats')).json();
    const captured = (stats.texts || 0) + (stats.youtubes || 0) + (stats.pdfs || 0) + (stats.highlights || 0);
    if (captured < 3) return; // not enough of a day to be worth summarising

    chrome.notifications.create('daily-reminder', {
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'Your journal is ready to write',
      message: `${captured} things captured today. Open the dashboard to generate your daily note.`,
      buttons: [{ title: 'Open dashboard' }],
    });
  } catch {
    // Backend down — nothing worth nagging about.
  }
}

chrome.notifications?.onButtonClicked.addListener((id) => {
  if (id === 'daily-reminder') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    chrome.notifications.clear(id);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BLOCKLIST_ALARM) syncSettings();
  if (alarm.name === REMINDER_ALARM) maybeRemind();
  if (alarm.name === PAUSE_ALARM) {
    chrome.storage.local.remove('pauseUntil');
    updateBadge(0);
  }
});

// ─── Omnibox: type "es <query>" in the address bar ──────────────────────────

chrome.omnibox.onInputChanged.addListener(async (input, suggest) => {
  if (!input.trim()) return;

  try {
    const res = await apiFetch(`/api/semantic-search?q=${encodeURIComponent(input)}&top_k=6`);
    const data = await res.json();
    if (!data.results) return;

    suggest(data.results
      .filter(r => r.url)
      .map(r => ({
        content: r.url,
        description: `${r.title || r.url} — ${r.chunk_text.slice(0, 90).replace(/[<>&"]/g, ' ')}`,
      })));
  } catch {
    // Backend unavailable; no suggestions.
  }
});

chrome.omnibox.onInputEntered.addListener((input) => {
  const url = input.startsWith('http')
    ? input
    : chrome.runtime.getURL(`dashboard.html#ask=${encodeURIComponent(input)}`);
  chrome.tabs.create({ url });
});

// ─── History Backfill ───────────────────────────────────────────────────────
// A fresh install shows an empty dashboard until tomorrow. Importing recent
// history (titles and URLs only — page text is not re-fetched) gives it
// something to show on day one.

async function backfillHistory(days = 30, maxResults = 500) {
  const items = await chrome.history.search({
    text: '',
    startTime: Date.now() - days * 24 * 60 * 60 * 1000,
    maxResults,
  });

  const payload = [];
  for (const item of items) {
    if (!item.url || !item.url.startsWith('http')) continue;
    if (await isDomainBlocked(item.url)) continue;
    payload.push({
      url: item.url,
      title: item.title || '',
      visit_count: item.visitCount || 1,
      last_visit_ms: item.lastVisitTime || Date.now(),
    });
  }

  const res = await apiFetch('/api/backfill-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BACKFILL_HISTORY') {
    backfillHistory(message.days || 30)
      .then(sendResponse)
      .catch(err => sendResponse({ status: 'error', message: String(err) }));
    return true; // async response
  }
});

// Also sync on each worker start-up so a fresh worker never runs on stale settings.
syncSettings();
scheduleEveningReminder();

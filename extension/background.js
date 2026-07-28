const BACKEND_URL = "http://localhost:8000";

// ─── Badge Management ───────────────────────────────────────────────────────
let todaysCaptureCount = 0;

function updateBadge(increment = 1) {
  todaysCaptureCount += increment;
  chrome.action.setBadgeText({ text: String(todaysCaptureCount) });
  chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
  chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

function resetBadgeDaily() {
  const now = new Date();
  const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  setTimeout(() => {
    todaysCaptureCount = 0;
    chrome.action.setBadgeText({ text: '' });
    resetBadgeDaily(); // Reset again tomorrow
  }, msUntilMidnight);
}

resetBadgeDaily();

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

// ─── Message Handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_DATA') {
    chrome.storage.local.get('captureEnabled', async (result) => {
      const enabled = result.captureEnabled !== false;
      if (!enabled) return;

      const { textData, imageData } = message.payload;

      // Check blocklist
      if (textData && await isDomainBlocked(textData.url)) return;

      // Send Text Data
      if (textData && textData.content) {
        fetch(`${BACKEND_URL}/api/text`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(textData)
        }).then(() => {
          updateBadge(1);
        }).catch(err => console.error("Error sending text:", err));
      }

      // Send Image Data
      if (imageData && imageData.length > 0) {
        fetch(`${BACKEND_URL}/api/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(imageData)
        }).then(() => {
          updateBadge(0); // Don't double count
        }).catch(err => console.error("Error sending images:", err));
      }
    });
  }

  // YouTube transcript
  if (message.type === 'YOUTUBE_DATA') {
    chrome.storage.local.get('captureEnabled', async (result) => {
      if (result.captureEnabled === false) return;
      if (await isDomainBlocked(message.payload.url)) return;

      fetch(`${BACKEND_URL}/api/youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.payload)
      }).then(() => {
        updateBadge(1);
      }).catch(err => console.error("Error sending YouTube data:", err));
    });
  }

  // PDF data
  if (message.type === 'PDF_DATA') {
    chrome.storage.local.get('captureEnabled', async (result) => {
      if (result.captureEnabled === false) return;

      fetch(`${BACKEND_URL}/api/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.payload)
      }).then(() => {
        updateBadge(1);
      }).catch(err => console.error("Error sending PDF data:", err));
    });
  }

  // Twitter thread
  if (message.type === 'TWITTER_DATA') {
    chrome.storage.local.get('captureEnabled', async (result) => {
      if (result.captureEnabled === false) return;
      if (await isDomainBlocked(message.payload.url)) return;

      fetch(`${BACKEND_URL}/api/twitter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message.payload)
      }).then(() => {
        updateBadge(1);
      }).catch(err => console.error("Error sending Twitter data:", err));
    });
  }

  // Open dashboard
  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  }

  // Open side panel
  if (message.type === 'OPEN_SIDEPANEL') {
    if (chrome.sidePanel) {
      chrome.sidePanel.open({ windowId: sender.tab?.windowId });
    }
  }
});

// ─── Onboarding on Install ──────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});

// ─── Audio Recording ────────────────────────────────────────────────────────
let currentRecordingTabId = null;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const { captureEnabled } = await chrome.storage.local.get('captureEnabled');
  const enabled = captureEnabled !== false;

  if (changeInfo.audible === true && enabled) {
    if (currentRecordingTabId === tabId) return;

    // Stop any existing recording
    if (currentRecordingTabId !== null) {
      console.log(`Tab ${tabId} became audible. Stopping previous capture on tab ${currentRecordingTabId}...`);
      chrome.runtime.sendMessage({
        type: 'STOP_RECORDING',
        target: 'offscreen',
        payload: {
          tabId: currentRecordingTabId
        }
      });
    }

    console.log(`Tab ${tabId} became audible. Starting capture...`);
    currentRecordingTabId = tabId;

    const existingContexts = await chrome.runtime.getContexts({});
    const offscreenDocument = existingContexts.find(
      (c) => c.contextType === 'OFFSCREEN_DOCUMENT'
    );

    if (!offscreenDocument) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Recording audio for local journaling'
      });
    }

    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (streamId) {
        chrome.runtime.sendMessage({
          type: 'START_RECORDING',
          target: 'offscreen',
          payload: {
            streamId: streamId,
            tabId: tabId,
            url: tab.url
          }
        });
      }
    });
  } else if (changeInfo.audible === false && currentRecordingTabId === tabId) {
    console.log(`Tab ${tabId} stopped being audible. Stopping capture...`);
    currentRecordingTabId = null;
    chrome.runtime.sendMessage({
      type: 'STOP_RECORDING',
      target: 'offscreen',
      payload: {
        tabId: tabId
      }
    });
  }
});

// ─── Side Panel Configuration ───────────────────────────────────────────────
if (chrome.sidePanel) {
  chrome.sidePanel.setOptions({
    path: 'sidepanel.html',
    enabled: true
  });
}

// ─── Sync Domain Blocklist from Backend Settings ────────────────────────────
async function syncBlocklist() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/settings`);
    const data = await res.json();
    if (data.status === 'success' && data.settings.domain_blocklist) {
      chrome.storage.local.set({ domainBlocklist: data.settings.domain_blocklist });
    }
  } catch {
    // Backend not available
  }
}

// Sync on startup and periodically
syncBlocklist();
setInterval(syncBlocklist, 5 * 60 * 1000); // Every 5 minutes

const BACKEND_URL = "http://localhost:8000";

// ─── DOM Elements ────────────────────────────────────────────────────────────
const statusDot = document.getElementById('statusDot');
const statusLabel = document.getElementById('statusLabel');
const statusBadge = document.getElementById('statusBadge');
const statTexts = document.getElementById('statTexts');
const statImages = document.getElementById('statImages');
const statAudios = document.getElementById('statAudios');
const statYoutubes = document.getElementById('statYoutubes');
const statPdfs = document.getElementById('statPdfs');
const statTweets = document.getElementById('statTweets');
const generateBtn = document.getElementById('generateBtn');
const spinner = document.getElementById('spinner');
const btnText = document.getElementById('btnText');
const resultBox = document.getElementById('resultBox');
const resultTitle = document.getElementById('resultTitle');
const resultPath = document.getElementById('resultPath');
const copyBtn = document.getElementById('copyBtn');
const captureToggle = document.getElementById('captureToggle');
const captureStatus = document.getElementById('captureStatus');
const clearBtn = document.getElementById('clearBtn');
const tooltip = document.getElementById('tooltip');

// ─── Theme Init ──────────────────────────────────────────────────────────────
initTheme();

// ─── Toast Helper ────────────────────────────────────────────────────────────
function showToast(message, duration = 2000) {
  tooltip.textContent = message;
  tooltip.classList.add('show');
  setTimeout(() => {
    tooltip.classList.remove('show');
  }, duration);
}

// ─── Health Check ────────────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    if (data.status === 'ok') {
      setStatus('online');
      return true;
    }
  } catch (err) {
    // Backend unreachable
  }
  setStatus('offline');
  return false;
}

function setStatus(state) {
  statusDot.className = 'status-dot ' + state;
  statusBadge.className = 'status-badge ' + state;
  if (state === 'online') {
    statusLabel.textContent = 'Backend connected';
    statusBadge.textContent = 'ONLINE';
  } else {
    statusLabel.textContent = 'Backend offline';
    statusBadge.textContent = 'OFFLINE';
  }
}

// ─── Stats ───────────────────────────────────────────────────────────────────
async function fetchStats() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/stats`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    animateCount(statTexts, data.texts || 0);
    animateCount(statImages, data.images || 0);
    animateCount(statAudios, data.audios || 0);
    animateCount(statYoutubes, data.youtubes || 0);
    animateCount(statPdfs, data.pdfs || 0);
    animateCount(statTweets, data.tweets || 0);
  } catch (err) {
    [statTexts, statImages, statAudios, statYoutubes, statPdfs, statTweets].forEach(el => {
      el.textContent = '–';
    });
  }
}

function animateCount(element, target) {
  const current = parseInt(element.textContent) || 0;
  if (current === target) {
    element.textContent = target;
    return;
  }
  const diff = target - current;
  const step = diff > 0 ? 1 : -1;
  const steps = Math.abs(diff);
  const interval = Math.max(30, Math.floor(300 / steps));
  let count = current;
  const timer = setInterval(() => {
    count += step;
    element.textContent = count;
    if (count === target) clearInterval(timer);
  }, interval);
}

// ─── Generate Daily Note ─────────────────────────────────────────────────────
generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  spinner.classList.add('active');
  btnText.textContent = 'Generating…';
  resultBox.classList.remove('visible');
  resultBox.classList.remove('error');

  try {
    const res = await fetch(`${BACKEND_URL}/api/generate-daily-note`, {
      method: 'POST'
    });
    const data = await res.json();

    if (data.status === 'success') {
      resultBox.classList.remove('error');
      resultTitle.textContent = '✅ Note saved successfully';
      resultPath.textContent = data.relative_path || data.filepath;
      resultBox.classList.add('visible');
      showToast('Daily note generated!');
    } else {
      resultBox.classList.add('error');
      resultTitle.textContent = '⚠️ ' + (data.message || 'Generation failed');
      resultPath.textContent = data.message || 'Check backend logs for details.';
      resultBox.classList.add('visible');
    }
  } catch (err) {
    resultBox.classList.add('error');
    resultTitle.textContent = '❌ Connection failed';
    resultPath.textContent = 'Could not reach the backend. Is it running?';
    resultBox.classList.add('visible');
  } finally {
    generateBtn.disabled = false;
    spinner.classList.remove('active');
    btnText.textContent = '✨ Generate Daily Note';
  }
});

// ─── Copy to Clipboard ──────────────────────────────────────────────────────
copyBtn.addEventListener('click', async () => {
  const text = resultPath.textContent;
  try {
    await navigator.clipboard.writeText(text);
    showToast('📋 Copied to clipboard!');
  } catch (err) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('📋 Copied to clipboard!');
  }
});

// ─── Capture Toggle ──────────────────────────────────────────────────────────
chrome.storage.local.get('captureEnabled', (result) => {
  const enabled = result.captureEnabled !== false;
  captureToggle.checked = enabled;
  captureStatus.textContent = enabled ? 'Active' : 'Paused';
});

captureToggle.addEventListener('change', () => {
  const enabled = captureToggle.checked;
  chrome.storage.local.set({ captureEnabled: enabled });
  captureStatus.textContent = enabled ? 'Active' : 'Paused';
  showToast(enabled ? '▶️ Capture resumed' : '⏸️ Capture paused');
});

// ─── Clear Today's Data ─────────────────────────────────────────────────────
clearBtn.addEventListener('click', async () => {
  clearBtn.textContent = '⏳ Clearing…';
  clearBtn.disabled = true;

  try {
    const res = await fetch(`${BACKEND_URL}/api/clear-today`, { method: 'POST' });
    const data = await res.json();
    if (data.status === 'success') {
      const total = Object.values(data.deleted).reduce((a, b) => a + b, 0);
      showToast(`🗑️ Cleared ${total} items`);
      fetchStats();
    }
  } catch (err) {
    showToast('❌ Failed to clear data');
  } finally {
    clearBtn.textContent = '🗑️ Clear Today';
    clearBtn.disabled = false;
  }
});

// ─── Dashboard & Side Panel Launchers ────────────────────────────────────────
document.getElementById('openDashboard').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
});

document.getElementById('openSidepanel').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
});

// ─── Initialize ──────────────────────────────────────────────────────────────
async function init() {
  const online = await checkHealth();
  if (online) {
    fetchStats();
  }
}

init();

// Re-check health every 30 seconds while popup is open
setInterval(async () => {
  const online = await checkHealth();
  if (online) fetchStats();
}, 30000);

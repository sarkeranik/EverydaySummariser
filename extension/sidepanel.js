/**
 * Everyday Summariser — Side Panel JavaScript
 * Lightweight companion showing today's stats and quick actions.
 */

const BACKEND_URL = 'http://localhost:8000';

const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');
const spToast = document.getElementById('spToast');

function showToast(msg, dur = 2000) {
  spToast.textContent = msg;
  spToast.classList.add('show');
  setTimeout(() => spToast.classList.remove('show'), dur);
}

// Health check
async function checkHealth() {
  try {
    const res = await apiFetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    if (data.status === 'ok') {
      statusPill.className = 'status-pill online';
      statusText.textContent = 'ONLINE';
      return true;
    }
  } catch {}
  statusPill.className = 'status-pill offline';
  statusText.textContent = 'OFFLINE';
  return false;
}

// Stats
async function fetchStats() {
  try {
    const res = await apiFetch(`${BACKEND_URL}/api/stats`);
    const data = await res.json();
    document.getElementById('spTexts').textContent = data.texts || 0;
    document.getElementById('spImages').textContent = data.images || 0;
    document.getElementById('spYoutubes').textContent = data.youtubes || 0;
  } catch {}
}

// Generate daily note
document.getElementById('spGenerateBtn').addEventListener('click', async () => {
  const btn = document.getElementById('spGenerateBtn');
  const result = document.getElementById('spResult');
  btn.textContent = '⏳ Generating...';
  btn.disabled = true;
  result.className = 'result-box';

  try {
    const res = await apiFetch(`${BACKEND_URL}/api/generate-daily-note`, { method: 'POST' });
    const data = await res.json();
    if (data.status === 'success') {
      result.textContent = `✅ Saved: ${data.relative_path}`;
      result.className = 'result-box visible';
      showToast('✨ Note generated!');
    } else {
      result.textContent = `⚠️ ${data.message || 'Error'}`;
      result.className = 'result-box error visible';
    }
  } catch {
    result.textContent = '❌ Backend unreachable';
    result.className = 'result-box error visible';
  } finally {
    btn.textContent = '✨ Generate Daily Note';
    btn.disabled = false;
  }
});

// Capture toggle
chrome.storage.local.get('captureEnabled', (r) => {
  const enabled = r.captureEnabled !== false;
  document.getElementById('spCaptureToggle').checked = enabled;
  document.getElementById('spCaptureStatus').textContent = enabled ? 'Active' : 'Paused';
});

document.getElementById('spCaptureToggle').addEventListener('change', (e) => {
  const enabled = e.target.checked;
  chrome.storage.local.set({ captureEnabled: enabled });
  document.getElementById('spCaptureStatus').textContent = enabled ? 'Active' : 'Paused';
  showToast(enabled ? '▶️ Capture resumed' : '⏸️ Capture paused');
});

// Open dashboard
document.getElementById('spDashboardBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
});

// Clear today
document.getElementById('spClearBtn').addEventListener('click', async () => {
  const btn = document.getElementById('spClearBtn');
  btn.textContent = '⏳ Clearing...';
  btn.disabled = true;
  try {
    const res = await apiFetch(`${BACKEND_URL}/api/clear-today`, { method: 'POST' });
    const data = await res.json();
    if (data.status === 'success') {
      const total = Object.values(data.deleted).reduce((a, b) => a + b, 0);
      showToast(`🗑️ Cleared ${total} items`);
      fetchStats();
    }
  } catch {
    showToast('❌ Failed to clear');
  } finally {
    btn.textContent = '🗑️ Clear Today';
    btn.disabled = false;
  }
});

// Init
async function init() {
  initTheme();
  const online = await checkHealth();
  if (online) fetchStats();
}
init();
setInterval(async () => {
  const online = await checkHealth();
  if (online) fetchStats();
}, 30000);

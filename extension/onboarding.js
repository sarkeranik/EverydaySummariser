/**
 * Everyday Summariser — Onboarding Wizard JavaScript
 * 
 * Multi-step first-run setup: welcome, backend connection, AI config,
 * privacy/blocklist, and completion.
 */

const BACKEND_URL = 'http://localhost:8000';
const TOTAL_STEPS = 5;
let currentStep = 1;

const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const stepIndicator = document.getElementById('stepIndicator');

// ─── Navigation ─────────────────────────────────────────────────────────────
function showStep(step) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById(`step${step}`).classList.add('active');
  stepIndicator.textContent = `Step ${step} / ${TOTAL_STEPS}`;

  // Update progress bar
  document.querySelectorAll('.progress-dot').forEach((dot, i) => {
    dot.className = 'progress-dot';
    if (i + 1 < step) dot.classList.add('done');
    if (i + 1 === step) dot.classList.add('active');
  });

  // Button states
  prevBtn.disabled = step === 1;

  if (step === TOTAL_STEPS) {
    nextBtn.textContent = '🎮 Start Browsing!';
  } else {
    nextBtn.textContent = 'Next →';
  }
}

prevBtn.addEventListener('click', () => {
  if (currentStep > 1) {
    currentStep--;
    showStep(currentStep);
  }
});

nextBtn.addEventListener('click', async () => {
  // Validate current step before advancing
  if (currentStep === 3) {
    await saveAiConfig();
  }
  if (currentStep === 4) {
    await savePrivacyConfig();
  }

  if (currentStep < TOTAL_STEPS) {
    currentStep++;
    showStep(currentStep);
  } else {
    // Done! Mark onboarding as complete and open dashboard
    chrome.storage.local.set({ onboardingComplete: true });
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    window.close();
  }
});

// ─── Step 2: Test Connection ────────────────────────────────────────────────
document.getElementById('testConnectionBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('connectionResult');
  resultEl.style.display = 'block';
  resultEl.className = 'test-result';
  resultEl.textContent = '⏳ Testing connection...';

  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();

    if (data.status === 'ok') {
      resultEl.className = 'test-result success';
      resultEl.textContent = `✅ Connected! Backend v${data.version} is running.`;
      
      try {
        const setRes = await fetch(`${BACKEND_URL}/api/settings`);
        const setData = await setRes.json();
        window.onboardSettings = setData.settings || {};
        
        const isLocal = window.onboardSettings.ai_provider === 'local';
        document.getElementById('onbGeminiGroup').style.display = isLocal ? 'none' : 'block';
        document.getElementById('onbLocalGroup').style.display = isLocal ? 'block' : 'none';
      } catch (e) {
        // Fallback
      }
    } else {
      resultEl.className = 'test-result error';
      resultEl.textContent = '❌ Backend responded but returned unexpected data.';
    }
  } catch (err) {
    resultEl.className = 'test-result error';
    resultEl.textContent = '❌ Could not connect. Make sure the backend is running on port 8000.';
  }
});

// ─── Step 3: AI Provider Toggle ─────────────────────────────────────────────

async function saveAiConfig() {
  const provider = window.onboardSettings?.ai_provider || 'gemini';
  const updates = [];

  if (provider === 'gemini') {
    const key = document.getElementById('onbGeminiKey').value.trim();
    if (key) updates.push({ key: 'gemini_api_key', value: key });
  } else {
    const endpoint = document.getElementById('onbLocalEndpoint').value.trim();
    if (endpoint) updates.push({ key: 'local_ai_endpoint', value: endpoint });
  }

  try {
    if (updates.length > 0) {
      await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    }
  } catch {
    // Settings will use defaults if backend is unreachable
  }
}

// ─── Step 4: Privacy Config ────────────────────────────────────────────────
async function savePrivacyConfig() {
  const blocklist = document.getElementById('onbBlocklist').value.trim();

  // Save to chrome.storage for content scripts
  chrome.storage.local.set({ domainBlocklist: blocklist });

  // Save to backend settings
  try {
    await fetch(`${BACKEND_URL}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ key: 'domain_blocklist', value: blocklist }])
    });
  } catch {
    // Will use local storage value as fallback
  }
}

// ─── Init ───────────────────────────────────────────────────────────────────
showStep(1);

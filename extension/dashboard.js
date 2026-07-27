/**
 * Everyday Summariser — Dashboard JavaScript
 * 
 * Controls all dashboard functionality: navigation, stats, journal timeline,
 * search, raw data browser, tags, settings, and note generation.
 */

const BACKEND_URL = 'http://localhost:8000';

// ─── DOM Elements ───────────────────────────────────────────────────────────
const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');
const toast = document.getElementById('toast');

// ─── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initNavigation();
  initSearch();
  initDataBrowser();
  initTags();
  initGenerate();
  initSettings();

  const online = await checkHealth();
  if (online) {
    fetchStats();
    fetchRecentNotes();
  }
});

// ─── Toast ──────────────────────────────────────────────────────────────────
function showToast(message, duration = 2500) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ─── Health Check ───────────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
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

// ─── Navigation ─────────────────────────────────────────────────────────────
function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      navigateTo(page);
    });
  });

  // Theme toggle button
  document.getElementById('themeToggleBtn').addEventListener('click', async () => {
    const newTheme = await toggleTheme();
    document.getElementById('settingTheme').value = newTheme;
    showToast(`Theme: ${newTheme === 'dark' ? '🌙 Dark' : '☀️ Light'}`);
  });

  // Refresh button
  document.getElementById('refreshBtn').addEventListener('click', async () => {
    showToast('🔄 Refreshing...');
    await checkHealth();
    fetchStats();
    fetchRecentNotes();
  });
}

function navigateTo(page) {
  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navItem) navItem.classList.add('active');

  // Update page sections
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const section = document.getElementById(`page-${page}`);
  if (section) section.classList.add('active');

  // Load data for the page
  if (page === 'journal') loadJournal();
  if (page === 'browser') loadDataBrowser();
  if (page === 'tags') loadTags();
  if (page === 'settings') loadSettings();
}

// ─── Stats ──────────────────────────────────────────────────────────────────
async function fetchStats() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/stats`);
    const data = await res.json();
    animateNumber('dashStatTexts', data.texts || 0);
    animateNumber('dashStatImages', data.images || 0);
    animateNumber('dashStatAudios', data.audios || 0);
    animateNumber('dashStatYoutubes', data.youtubes || 0);
    animateNumber('dashStatPdfs', data.pdfs || 0);
    animateNumber('dashStatTweets', data.tweets || 0);
  } catch {}
}

function animateNumber(elementId, target) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) { el.textContent = target; return; }
  const diff = target - current;
  const step = diff > 0 ? 1 : -1;
  const steps = Math.abs(diff);
  const interval = Math.max(30, Math.floor(300 / steps));
  let count = current;
  const timer = setInterval(() => {
    count += step;
    el.textContent = count;
    if (count === target) clearInterval(timer);
  }, interval);
}

// ─── Recent Notes (Overview) ────────────────────────────────────────────────
async function fetchRecentNotes() {
  const container = document.getElementById('recentNotes');
  try {
    const res = await fetch(`${BACKEND_URL}/api/notes?limit=5`);
    const data = await res.json();
    if (data.notes && data.notes.length > 0) {
      container.innerHTML = data.notes.map(n => `
        <div class="timeline-item" onclick="viewNote('${n.date}')">
          <div class="timeline-date">
            ${n.date}
            <div class="date-type">${n.note_type}</div>
          </div>
          <div class="timeline-content">
            <span class="timeline-type-badge ${n.note_type}">${n.note_type}</span>
            <div class="timeline-preview">${escapeHtml(n.preview || 'No preview available')}</div>
          </div>
        </div>
      `).join('');
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📝</span>
          <div class="empty-title">No notes yet</div>
          <div class="empty-desc">Generate your first daily note from the Generate page!</div>
        </div>
      `;
    }
  } catch {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Could not load notes</div></div>';
  }
}

// ─── Journal Timeline ──────────────────────────────────────────────────────
let journalFilter = '';

function loadJournal() {
  fetchJournalNotes();
}

function initJournalTabs() {
  document.querySelectorAll('#journalTabs .data-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#journalTabs .data-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      journalFilter = tab.dataset.filter;
      fetchJournalNotes();
    });
  });
}

// Run on load
initJournalTabs();

async function fetchJournalNotes() {
  const container = document.getElementById('journalTimeline');
  container.innerHTML = '<div class="loading-text">Loading notes...</div>';
  
  try {
    let url = `${BACKEND_URL}/api/notes?limit=50`;
    if (journalFilter) url += `&note_type=${journalFilter}`;
    
    const res = await fetch(url);
    const data = await res.json();

    if (data.notes && data.notes.length > 0) {
      container.innerHTML = data.notes.map(n => `
        <div class="timeline-item" onclick="viewNote('${n.date}')">
          <div class="timeline-date">
            ${n.date}
            <div class="date-type">${n.note_type}</div>
          </div>
          <div class="timeline-content">
            <span class="timeline-type-badge ${n.note_type}">${n.note_type}</span>
            <div class="timeline-preview">${escapeHtml(n.preview || '')}</div>
          </div>
        </div>
      `).join('');
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📖</span>
          <div class="empty-title">No ${journalFilter || ''} notes found</div>
          <div class="empty-desc">Generate some notes first!</div>
        </div>
      `;
    }
  } catch {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Error loading notes</div></div>';
  }
}

async function viewNote(noteDate) {
  const viewer = document.getElementById('noteViewer');
  const listView = document.getElementById('journalListView');
  const title = document.getElementById('noteViewerTitle');
  const content = document.getElementById('noteContent');

  try {
    const res = await fetch(`${BACKEND_URL}/api/notes/${noteDate}`);
    const data = await res.json();

    if (data.note) {
      title.textContent = `📖 ${data.note.date} (${data.note.note_type})`;
      content.innerHTML = markdownToHtml(data.note.content || 'No content');
      listView.style.display = 'none';
      viewer.classList.add('active');
    }
  } catch {
    showToast('❌ Error loading note');
  }
}

document.getElementById('backToJournal').addEventListener('click', () => {
  document.getElementById('noteViewer').classList.remove('active');
  document.getElementById('journalListView').style.display = 'block';
});

// ─── Search ─────────────────────────────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchBtn');

  btn.addEventListener('click', () => doSearch(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch(input.value);
  });
}

async function doSearch(query) {
  const container = document.getElementById('searchResults');
  if (!query.trim()) return;

  container.innerHTML = '<div class="loading-text">Searching...</div>';

  try {
    const res = await fetch(`${BACKEND_URL}/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (data.results && data.results.length > 0) {
      const typeIcons = { text: '📝', note: '📖', youtube: '🎬', pdf: '📄', twitter: '🐦' };
      container.innerHTML = data.results.map(r => `
        <div class="search-result-item">
          <div class="search-result-type">${typeIcons[r.type] || '📄'} ${r.type}</div>
          <div class="search-result-title">${escapeHtml(r.title || r.date || r.filename || r.author || 'Unknown')}</div>
          <div class="search-result-snippet">${r.snippet || ''}</div>
        </div>
      `).join('');
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🔍</span>
          <div class="empty-title">No results found</div>
          <div class="empty-desc">Try a different search term</div>
        </div>
      `;
    }
  } catch {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Search error</div></div>';
  }
}

// ─── Raw Data Browser ──────────────────────────────────────────────────────
let currentDataType = 'text';
let currentDataPage = 0;

function initDataBrowser() {
  document.querySelectorAll('#dataTabs .data-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#dataTabs .data-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentDataType = tab.dataset.type;
      currentDataPage = 0;
      loadDataBrowser();
    });
  });
}

async function loadDataBrowser() {
  const container = document.getElementById('dataList');
  container.innerHTML = '<div class="loading-text" style="padding:20px;">Loading...</div>';

  try {
    const res = await fetch(`${BACKEND_URL}/api/captured?type=${currentDataType}&limit=30&offset=${currentDataPage * 30}`);
    const data = await res.json();

    if (data.items && data.items.length > 0) {
      const typeEmojis = { text: '📝', images: '🖼️', audio: '🎵', youtube: '🎬', pdf: '📄', twitter: '🐦' };
      container.innerHTML = data.items.map(item => {
        const title = item.title || item.filename || item.video_id || item.author || item.image_url || 'Unknown';
        const url = item.url || '';
        const time = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '';
        let meta = '';
        if (item.extraction_method) meta += `Method: ${item.extraction_method}`;
        if (item.dwell_time_ms) meta += ` | Dwell: ${(item.dwell_time_ms / 1000).toFixed(1)}s`;
        if (item.page_count) meta += `Pages: ${item.page_count}`;
        if (item.tweet_count) meta += `Tweets: ${item.tweet_count}`;
        if (item.duration_seconds) meta += `Duration: ${Math.floor(item.duration_seconds / 60)}m`;
        if (item.channel) meta += `Channel: ${item.channel}`;

        return `
          <div class="data-item">
            <div class="data-item-type">${typeEmojis[currentDataType] || '📄'}</div>
            <div class="data-item-content">
              <div class="data-item-title">${escapeHtml(String(title))}</div>
              <div class="data-item-url">${escapeHtml(url)}</div>
              ${meta ? `<div class="data-item-meta">${meta}</div>` : ''}
            </div>
            <div class="data-item-time">${time}</div>
          </div>
        `;
      }).join('');

      // Pagination
      const pagination = document.getElementById('dataPagination');
      const totalPages = Math.ceil(data.total / 30);
      if (totalPages > 1) {
        let paginationHtml = '';
        if (currentDataPage > 0) {
          paginationHtml += `<button class="pixel-btn sm" onclick="changePage(${currentDataPage - 1})">← Prev</button>`;
        }
        paginationHtml += `<span class="loading-text" style="animation:none; padding: 0 10px;">Page ${currentDataPage + 1} / ${totalPages}</span>`;
        if (currentDataPage < totalPages - 1) {
          paginationHtml += `<button class="pixel-btn sm" onclick="changePage(${currentDataPage + 1})">Next →</button>`;
        }
        pagination.innerHTML = paginationHtml;
      } else {
        pagination.innerHTML = '';
      }
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📦</span>
          <div class="empty-title">No ${currentDataType} data</div>
          <div class="empty-desc">Browse some pages to start capturing!</div>
        </div>
      `;
      document.getElementById('dataPagination').innerHTML = '';
    }
  } catch {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">Error loading data</div></div>';
  }
}

function changePage(page) {
  currentDataPage = page;
  loadDataBrowser();
}

// ─── Tags ───────────────────────────────────────────────────────────────────
function initTags() {
  document.getElementById('createTagBtn').addEventListener('click', createTag);
}

async function loadTags() {
  const grid = document.getElementById('tagsGrid');
  const pagesList = document.getElementById('taggedPagesList');

  try {
    const [tagsRes, pagesRes] = await Promise.all([
      fetch(`${BACKEND_URL}/api/tags`),
      fetch(`${BACKEND_URL}/api/tagged-pages`)
    ]);
    const tagsData = await tagsRes.json();
    const pagesData = await pagesRes.json();

    // Tags grid
    if (tagsData.tags && tagsData.tags.length > 0) {
      grid.innerHTML = tagsData.tags.map(t => `
        <div class="tag-chip" style="border-color: ${t.color}; color: ${t.color};">
          ${escapeHtml(t.name)} (${t.page_count})
          <span class="tag-delete" onclick="deleteTag(${t.id})" title="Delete tag">✕</span>
        </div>
      `).join('');
    } else {
      grid.innerHTML = '<div class="empty-state"><div class="empty-desc">No tags created yet</div></div>';
    }

    // Tagged pages
    if (pagesData.pages && pagesData.pages.length > 0) {
      pagesList.innerHTML = pagesData.pages.map(p => `
        <div class="data-item">
          <div class="data-item-type">🏷️</div>
          <div class="data-item-content">
            <div class="data-item-title">${escapeHtml(p.page_title || p.page_url)}</div>
            <div class="data-item-url">${escapeHtml(p.page_url)}</div>
            <div class="data-item-meta" style="color: ${p.tag_color}">${escapeHtml(p.tag_name)}</div>
          </div>
          <span class="tag-delete" onclick="untagPage(${p.id})" title="Remove tag" style="cursor:pointer; font-size: 14px;">✕</span>
        </div>
      `).join('');
    } else {
      pagesList.innerHTML = '<div class="empty-state"><div class="empty-desc">No pages tagged yet</div></div>';
    }
  } catch {
    grid.innerHTML = '<div class="empty-state"><div class="empty-desc">Error loading tags</div></div>';
  }
}

async function createTag() {
  const name = document.getElementById('tagNameInput').value.trim();
  const color = document.getElementById('tagColorInput').value;
  if (!name) { showToast('Enter a tag name!'); return; }

  try {
    const res = await fetch(`${BACKEND_URL}/api/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color })
    });
    const data = await res.json();
    if (data.status === 'success') {
      document.getElementById('tagNameInput').value = '';
      showToast(`🏷️ Tag "${name}" created!`);
      loadTags();
    } else {
      showToast('Tag already exists!');
    }
  } catch {
    showToast('❌ Error creating tag');
  }
}

async function deleteTag(tagId) {
  try {
    await fetch(`${BACKEND_URL}/api/tags/${tagId}`, { method: 'DELETE' });
    showToast('🗑️ Tag deleted');
    loadTags();
  } catch {
    showToast('❌ Error deleting tag');
  }
}

async function untagPage(pageTagId) {
  try {
    await fetch(`${BACKEND_URL}/api/tag-page/${pageTagId}`, { method: 'DELETE' });
    showToast('🏷️ Tag removed');
    loadTags();
  } catch {
    showToast('❌ Error removing tag');
  }
}

// ─── Generate ───────────────────────────────────────────────────────────────
function initGenerate() {
  document.getElementById('genDailyBtn').addEventListener('click', () => generateNote('daily'));
  document.getElementById('genWeeklyBtn').addEventListener('click', () => generateNote('weekly'));
  document.getElementById('genMonthlyBtn').addEventListener('click', () => generateNote('monthly'));
}

async function generateNote(type) {
  const btn = document.getElementById(`gen${type.charAt(0).toUpperCase() + type.slice(1)}Btn`);
  const resultBox = document.getElementById('generateResult');
  const resultTitle = document.getElementById('genResultTitle');
  const resultContent = document.getElementById('genResultContent');

  btn.textContent = '⏳ Generating...';
  btn.disabled = true;
  resultBox.style.display = 'none';

  const endpoints = {
    daily: '/api/generate-daily-note',
    weekly: '/api/generate-weekly-note',
    monthly: '/api/generate-monthly-note'
  };

  try {
    const res = await fetch(`${BACKEND_URL}${endpoints[type]}`, { method: 'POST' });
    const data = await res.json();

    resultBox.style.display = 'block';

    if (data.status === 'success') {
      resultTitle.textContent = `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} note generated!`;
      resultContent.textContent = `Saved to: ${data.relative_path || data.filepath}`;
      showToast(`✨ ${type} note generated!`);
      fetchRecentNotes(); // Refresh
    } else {
      resultTitle.textContent = '⚠️ Generation Issue';
      resultContent.textContent = data.message || 'Unknown error';
    }
  } catch {
    resultBox.style.display = 'block';
    resultTitle.textContent = '❌ Connection Error';
    resultContent.textContent = 'Could not reach the backend.';
  } finally {
    btn.textContent = `Generate ${type.charAt(0).toUpperCase() + type.slice(1)}`;
    btn.disabled = false;
  }
}

// ─── Settings ───────────────────────────────────────────────────────────────
function initSettings() {
  const providerSelect = document.getElementById('settingAiProvider');
  providerSelect.addEventListener('change', () => {
    const isLocal = providerSelect.value === 'local';
    document.getElementById('geminiKeyRow').style.display = isLocal ? 'none' : 'flex';
    document.getElementById('localEndpointRow').style.display = isLocal ? 'flex' : 'none';
    document.getElementById('localModelRow').style.display = isLocal ? 'flex' : 'none';
  });

  document.getElementById('settingTheme').addEventListener('change', (e) => {
    const theme = e.target.value;
    applyTheme(theme);
    chrome.storage.sync.set({ es_theme: theme });
  });

  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
}

async function loadSettings() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/settings`);
    const data = await res.json();
    if (data.settings) {
      const s = data.settings;
      document.getElementById('settingAiProvider').value = s.ai_provider || 'gemini';
      document.getElementById('settingGeminiKey').value = s.gemini_api_key || '';
      document.getElementById('settingLocalEndpoint').value = s.local_ai_endpoint || '';
      document.getElementById('settingLocalModel').value = s.local_model_name || '';
      document.getElementById('settingBlocklist').value = s.domain_blocklist || '';
      document.getElementById('settingCaptureImages').checked = s.capture_images !== 'false';
      document.getElementById('settingCaptureAudio').checked = s.capture_audio !== 'false';

      // Show/hide local fields
      const isLocal = s.ai_provider === 'local';
      document.getElementById('geminiKeyRow').style.display = isLocal ? 'none' : 'flex';
      document.getElementById('localEndpointRow').style.display = isLocal ? 'flex' : 'none';
      document.getElementById('localModelRow').style.display = isLocal ? 'flex' : 'none';
    }

    // Theme from chrome.storage
    const theme = await getCurrentTheme();
    document.getElementById('settingTheme').value = theme;
  } catch {
    showToast('Could not load settings');
  }
}

async function saveSettings() {
  const updates = [
    { key: 'ai_provider', value: document.getElementById('settingAiProvider').value },
    { key: 'gemini_api_key', value: document.getElementById('settingGeminiKey').value },
    { key: 'local_ai_endpoint', value: document.getElementById('settingLocalEndpoint').value },
    { key: 'local_model_name', value: document.getElementById('settingLocalModel').value },
    { key: 'domain_blocklist', value: document.getElementById('settingBlocklist').value },
    { key: 'capture_images', value: String(document.getElementById('settingCaptureImages').checked) },
    { key: 'capture_audio', value: String(document.getElementById('settingCaptureAudio').checked) },
  ];

  try {
    await fetch(`${BACKEND_URL}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });

    // Sync blocklist to local storage for content scripts
    chrome.storage.local.set({
      domainBlocklist: document.getElementById('settingBlocklist').value
    });

    const saved = document.getElementById('settingsSaved');
    saved.style.display = 'inline';
    setTimeout(() => saved.style.display = 'none', 2000);
    showToast('💾 Settings saved!');
  } catch {
    showToast('❌ Error saving settings');
  }
}

// ─── Utility Functions ──────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function markdownToHtml(md) {
  // Simple markdown to HTML conversion
  let html = escapeHtml(md);

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

// Make functions available globally for inline onclick handlers
window.navigateTo = navigateTo;
window.viewNote = viewNote;
window.deleteTag = deleteTag;
window.untagPage = untagPage;
window.changePage = changePage;

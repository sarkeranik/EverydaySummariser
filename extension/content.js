/**
 * Everyday Summariser — Enhanced Content Script
 *
 * Captures page content using a hybrid extraction approach:
 * 1. Try Readability.js for clean article extraction
 * 2. Fall back to DOM heuristics (<article>, <main>)
 * 3. Fall back to raw document.body.innerText
 *
 * Capture is driven by VISIBLE time, not wall-clock time since load: a tab
 * opened in the background and never looked at accumulates nothing and is never
 * stored. The page is captured once, when it goes hidden (with a fallback for
 * tabs that stay open indefinitely), so dwell time is accurate on the single row
 * we write rather than needing a second update round-trip.
 */

const DEFAULT_DWELL_THRESHOLD_MS = 5000;
const FALLBACK_CAPTURE_MS = 45000; // long-lived tabs still get captured

let visibleMs = 0;
let lastShownAt = document.hidden ? null : Date.now();
let captured = false;
let fallbackTimer = null;

function currentVisibleMs() {
  return visibleMs + (lastShownAt === null ? 0 : Date.now() - lastShownAt);
}

function extractContent() {
  let content = '';
  let extractionMethod = 'raw';

  // Method 1: Readability.js
  if (typeof Readability !== 'undefined') {
    try {
      const documentClone = document.cloneNode(true);
      const reader = new Readability(documentClone);
      const article = reader.parse();
      if (article && article.textContent && article.textContent.length > 100) {
        content = article.textContent.replace(/\s+/g, ' ').trim();
        extractionMethod = 'readability';
      }
    } catch (e) {
      // Readability failed, continue to fallback
    }
  }

  // Method 2: DOM heuristics
  if (!content) {
    const selectors = ['article', 'main', '[role="main"]', '.post-content', '.article-body', '.entry-content'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.length > 100) {
        content = el.innerText.replace(/\s+/g, ' ').trim();
        extractionMethod = 'heuristic';
        break;
      }
    }
  }

  // Method 3: Raw innerText fallback
  if (!content) {
    content = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
    extractionMethod = 'raw';
  }

  return { content, extractionMethod };
}

function collectImages() {
  const images = [];
  document.querySelectorAll('img').forEach(img => {
    if (img.src && img.src.startsWith('http')) {
      // Filter out tiny images (likely tracking pixels or icons)
      const width = img.naturalWidth || img.width || 0;
      const height = img.naturalHeight || img.height || 0;
      if (width > 50 && height > 50) {
        images.push({ url: window.location.href, image_url: img.src, alt_text: img.alt || '' });
      }
    }
  });
  return images;
}

function capturePageData() {
  if (captured) return;

  chrome.storage.local.get(['captureEnabled', 'domainBlocklist', 'dwellThresholdMs'], (result) => {
    if (result.captureEnabled === false) return;

    // Domain blocklist
    const blocklist = (result.domainBlocklist || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    const currentDomain = window.location.hostname.toLowerCase();
    if (blocklist.some(blocked => currentDomain === blocked || currentDomain.endsWith('.' + blocked))) {
      return;
    }

    // Dwell gate — the page must actually have been looked at.
    const threshold = Number.isFinite(result.dwellThresholdMs)
      ? result.dwellThresholdMs
      : DEFAULT_DWELL_THRESHOLD_MS;
    const dwellTimeMs = currentVisibleMs();
    if (dwellTimeMs < threshold) return;

    const { content, extractionMethod } = extractContent();
    if (!content) return;

    captured = true;
    clearTimeout(fallbackTimer);

    // Include raw HTML only when client-side extraction was poor, so the server
    // can retry with trafilatura.
    let rawHtml = null;
    if (extractionMethod === 'raw' && content.length > 200) {
      try {
        const body = document.querySelector('body');
        if (body && body.innerHTML.length < 500000) {
          rawHtml = body.innerHTML;
        }
      } catch (e) {
        // Skip raw HTML
      }
    }

    try {
      chrome.runtime.sendMessage({
        type: 'PAGE_DATA',
        payload: {
          textData: {
            url: window.location.href,
            title: document.title,
            content,
            dwell_time_ms: dwellTimeMs,
            extraction_method: extractionMethod,
            raw_html: rawHtml,
          },
          imageData: collectImages()
        }
      });
    } catch (e) {
      // Extension context may be invalid (e.g. reloaded mid-session)
    }
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (lastShownAt !== null) {
      visibleMs += Date.now() - lastShownAt;
      lastShownAt = null;
    }
    capturePageData(); // the moment we know the visit is over
  } else if (lastShownAt === null) {
    lastShownAt = Date.now();
  }
});

// pagehide is the reliable teardown signal; beforeunload often fires too late
// for an async message to survive.
window.addEventListener('pagehide', capturePageData);

// Tabs left open for a long time would otherwise never report.
fallbackTimer = setTimeout(capturePageData, FALLBACK_CAPTURE_MS);

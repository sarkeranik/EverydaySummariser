/**
 * Everyday Summariser — Enhanced Content Script
 * 
 * Captures page content using a hybrid extraction approach:
 * 1. Try Readability.js for clean article extraction
 * 2. Fall back to DOM heuristics (<article>, <main>)
 * 3. Fall back to raw document.body.innerText
 * 
 * Also tracks time-on-page and respects domain blocklist.
 */

const PAGE_LOAD_TIME = Date.now();

function capturePageData() {
  chrome.storage.local.get(['captureEnabled', 'domainBlocklist'], (result) => {
    const enabled = result.captureEnabled !== false;
    if (!enabled) return;

    // Check domain blocklist
    const blocklist = (result.domainBlocklist || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
    const currentDomain = window.location.hostname.toLowerCase();
    if (blocklist.some(blocked => currentDomain === blocked || currentDomain.endsWith('.' + blocked))) {
      return;
    }

    const url = window.location.href;
    const title = document.title;

    // Calculate dwell time
    const dwellTimeMs = Date.now() - PAGE_LOAD_TIME;

    // Hybrid extraction
    let content = '';
    let extractionMethod = 'raw';

    // Method 1: Try Readability.js (if loaded)
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
    if (!content || extractionMethod === 'raw') {
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

    // Get image URLs (filter out tiny tracking pixels and icons)
    const imgElements = document.querySelectorAll('img');
    const images = [];
    imgElements.forEach(img => {
      if (img.src && img.src.startsWith('http')) {
        // Filter out tiny images (likely tracking pixels or icons)
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (width > 50 && height > 50) {
          images.push({
            url: url,
            image_url: img.src,
            alt_text: img.alt || ''
          });
        }
      }
    });

    // Optionally include raw HTML for server-side fallback (only when extraction was poor)
    let rawHtml = null;
    if (extractionMethod === 'raw' && content.length > 200) {
      // Send a trimmed version of the HTML for server-side processing
      try {
        const mainEl = document.querySelector('body');
        if (mainEl && mainEl.innerHTML.length < 500000) { // Max 500KB
          rawHtml = mainEl.innerHTML;
        }
      } catch (e) {
        // Skip raw HTML
      }
    }

    // Send to background script
    chrome.runtime.sendMessage({
      type: 'PAGE_DATA',
      payload: {
        textData: {
          url: url,
          title: title,
          content: content,
          dwell_time_ms: dwellTimeMs,
          extraction_method: extractionMethod,
          raw_html: rawHtml,
        },
        imageData: images
      }
    });
  });
}

// Run after a short delay to allow dynamic content to load
setTimeout(capturePageData, 3000);

// Also capture when the user leaves (to get final dwell time)
window.addEventListener('beforeunload', () => {
  const dwellTimeMs = Date.now() - PAGE_LOAD_TIME;
  // Send a lightweight update with just the dwell time
  try {
    chrome.runtime.sendMessage({
      type: 'DWELL_UPDATE',
      payload: {
        url: window.location.href,
        dwell_time_ms: dwellTimeMs,
      }
    });
  } catch (e) {
    // Extension context may be invalid
  }
});

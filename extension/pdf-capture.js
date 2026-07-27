/**
 * Everyday Summariser — PDF Text Extraction
 * 
 * Content script for capturing text from PDFs opened in Chrome.
 * Uses pdf.js (loaded from CDN) to parse PDF bytes and extract text.
 * Matches PDF URLs and Chrome's built-in PDF viewer.
 */

(function () {
  // Load pdf.js dynamically
  function loadPdfJs() {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) {
        resolve(window.pdfjsLib);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          resolve(window.pdfjsLib);
        } else {
          reject(new Error('pdf.js failed to load'));
        }
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function extractPdfText(url) {
    try {
      const pdfjsLib = await loadPdfJs();
      const loadingTask = pdfjsLib.getDocument(url);
      const pdf = await loadingTask.promise;

      let fullText = '';
      const pageCount = pdf.numPages;

      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n\n';
      }

      return { text: fullText.trim(), pageCount };
    } catch (err) {
      console.error('[EverydaySummariser] PDF extraction error:', err);
      return null;
    }
  }

  function getFilename(url) {
    try {
      const pathname = new URL(url).pathname;
      return pathname.split('/').pop() || 'document.pdf';
    } catch {
      return 'document.pdf';
    }
  }

  async function capturePdf() {
    // Check if capture is enabled
    const result = await chrome.storage.local.get(['captureEnabled', 'domainBlocklist']);
    if (result.captureEnabled === false) return;

    const url = window.location.href;

    // Check if this is actually a PDF
    if (!url.toLowerCase().endsWith('.pdf') && !document.contentType?.includes('pdf')) {
      return;
    }

    console.log('[EverydaySummariser] Detected PDF, extracting text...');

    const extracted = await extractPdfText(url);
    if (!extracted || !extracted.text || extracted.text.length < 50) {
      console.log('[EverydaySummariser] Could not extract meaningful text from PDF');
      return;
    }

    chrome.runtime.sendMessage({
      type: 'PDF_DATA',
      payload: {
        url: url,
        filename: getFilename(url),
        content: extracted.text,
        page_count: extracted.pageCount,
      }
    });

    console.log('[EverydaySummariser] PDF text captured:', getFilename(url), `(${extracted.pageCount} pages)`);
  }

  // Wait for page to load, then attempt capture
  setTimeout(capturePdf, 4000);
})();

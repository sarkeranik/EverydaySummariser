/**
 * Everyday Summariser — Twitter/X Thread Capture
 * 
 * Content script for twitter.com and x.com.
 * Extracts tweet text from thread pages using DOM selectors.
 * Best-effort extraction — Twitter's DOM is heavily obfuscated.
 */

(function () {
  let lastCapturedUrl = null;

  function isThreadPage() {
    // Check if we're on a status page (individual tweet / thread)
    return /\/(status|i\/web\/status)\/\d+/.test(window.location.pathname);
  }

  function extractThreadData() {
    // Try multiple selectors (Twitter/X changes their DOM frequently)
    const tweetSelectors = [
      '[data-testid="tweetText"]',
      'article [lang]',
      '.tweet-text',
    ];

    let tweets = [];

    for (const selector of tweetSelectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        elements.forEach(el => {
          const text = el.innerText?.trim();
          if (text && text.length > 5 && !tweets.includes(text)) {
            tweets.push(text);
          }
        });
        break;
      }
    }

    // Get thread author
    const authorSelectors = [
      '[data-testid="User-Name"] a[role="link"] span',
      'a[href*="/"] span',
    ];

    let author = '';
    for (const selector of authorSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent?.trim();
        if (text && text.startsWith('@')) {
          author = text.replace('@', '');
          break;
        }
      }
    }

    // Fallback: try to get author from URL
    if (!author) {
      const pathParts = window.location.pathname.split('/');
      if (pathParts.length >= 2) {
        author = pathParts[1];
      }
    }

    return { tweets, author };
  }

  async function captureThread() {
    // Check if capture is enabled
    const result = await chrome.storage.local.get(['captureEnabled', 'domainBlocklist']);
    if (result.captureEnabled === false) return;

    const url = window.location.href;
    if (url === lastCapturedUrl) return;
    if (!isThreadPage()) return;

    // Wait for dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 4000));

    const { tweets, author } = extractThreadData();

    if (tweets.length === 0) {
      console.log('[EverydaySummariser] Could not extract tweets from this page');
      return;
    }

    lastCapturedUrl = url;

    const threadText = tweets.join('\n\n---\n\n');

    chrome.runtime.sendMessage({
      type: 'TWITTER_DATA',
      payload: {
        url: url,
        author: author,
        thread_text: threadText,
        tweet_count: tweets.length,
      }
    });

    console.log(`[EverydaySummariser] Twitter thread captured: @${author} (${tweets.length} tweets)`);
  }

  // Capture on initial load
  if (isThreadPage()) {
    setTimeout(captureThread, 5000);
  }

  // Watch for navigation within Twitter (SPA)
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isThreadPage()) {
        setTimeout(captureThread, 5000);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();

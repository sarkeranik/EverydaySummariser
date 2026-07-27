/**
 * Everyday Summariser — YouTube Transcript Capture
 * 
 * Content script that runs only on youtube.com.
 * Extracts video ID, title, channel name, and transcript/captions
 * using YouTube's built-in timedtext API.
 */

(function () {
  // Debounce: only capture once per video
  let lastCapturedVideoId = null;

  function getVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('v');
  }

  async function fetchTranscript(videoId) {
    try {
      // Fetch the video page HTML to get the captions track URL
      const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
      const html = await response.text();

      // Extract captions URL from ytInitialPlayerResponse
      const captionRegex = /"captionTracks":\s*(\[.*?\])/;
      const match = html.match(captionRegex);

      if (!match) {
        console.log('[EverydaySummariser] No captions found for video:', videoId);
        return null;
      }

      const captionTracks = JSON.parse(match[1]);
      if (!captionTracks || captionTracks.length === 0) return null;

      // Prefer English, then any language
      let track = captionTracks.find(t => t.languageCode === 'en') || captionTracks[0];
      let captionUrl = track.baseUrl;

      // Fetch the XML captions
      const captionResponse = await fetch(captionUrl);
      const captionXml = await captionResponse.text();

      // Parse XML to extract text
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(captionXml, 'text/xml');
      const textNodes = xmlDoc.querySelectorAll('text');

      let transcript = '';
      textNodes.forEach(node => {
        const text = node.textContent
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .trim();
        if (text) {
          transcript += text + ' ';
        }
      });

      return transcript.trim();
    } catch (err) {
      console.error('[EverydaySummariser] Error fetching transcript:', err);
      return null;
    }
  }

  function getVideoInfo() {
    const title = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, h1.ytd-watch-metadata yt-formatted-string')?.textContent
      || document.querySelector('meta[name="title"]')?.content
      || document.title.replace(' - YouTube', '').trim();

    const channel = document.querySelector('#channel-name a, ytd-channel-name a')?.textContent?.trim()
      || document.querySelector('meta[itemprop="author"]')?.getAttribute('content')
      || '';

    return { title, channel };
  }

  function getDuration() {
    const durationEl = document.querySelector('.ytp-time-duration');
    if (!durationEl) return 0;
    const parts = durationEl.textContent.split(':').reverse();
    let seconds = 0;
    if (parts[0]) seconds += parseInt(parts[0]) || 0;
    if (parts[1]) seconds += (parseInt(parts[1]) || 0) * 60;
    if (parts[2]) seconds += (parseInt(parts[2]) || 0) * 3600;
    return seconds;
  }

  async function captureVideo() {
    // Check if capture is enabled
    const result = await chrome.storage.local.get(['captureEnabled', 'domainBlocklist']);
    if (result.captureEnabled === false) return;

    const videoId = getVideoId();
    if (!videoId || videoId === lastCapturedVideoId) return;

    // Wait for page to fully load
    await new Promise(resolve => setTimeout(resolve, 3000));

    const { title, channel } = getVideoInfo();
    const transcript = await fetchTranscript(videoId);

    if (!transcript) {
      console.log('[EverydaySummariser] Could not extract transcript for:', title);
      return;
    }

    lastCapturedVideoId = videoId;

    chrome.runtime.sendMessage({
      type: 'YOUTUBE_DATA',
      payload: {
        url: window.location.href,
        video_id: videoId,
        title: title,
        channel: channel,
        transcript: transcript,
        duration_seconds: getDuration(),
      }
    });

    console.log('[EverydaySummariser] YouTube transcript captured:', title);
  }

  // Capture on initial load
  if (getVideoId()) {
    setTimeout(captureVideo, 5000);
  }

  // Watch for navigation within YouTube (SPA)
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (getVideoId()) {
        setTimeout(captureVideo, 5000);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();

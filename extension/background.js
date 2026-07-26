const BACKEND_URL = "http://localhost:8000";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_DATA') {
    const { textData, imageData } = message.payload;
    
    // Send Text Data
    if (textData && textData.content) {
      fetch(`${BACKEND_URL}/api/text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(textData)
      }).catch(err => console.error("Error sending text:", err));
    }
    
    // Send Image Data
    if (imageData && imageData.length > 0) {
      fetch(`${BACKEND_URL}/api/images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(imageData)
      }).catch(err => console.error("Error sending images:", err));
    }
  }
});

let recordingTabs = new Set();

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Automatically start recording if a tab becomes audible
  if (changeInfo.audible === true && !recordingTabs.has(tabId)) {
    console.log(`Tab ${tabId} became audible. Starting capture...`);
    recordingTabs.add(tabId);
    
    // Check if we already have an offscreen document
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

    // Get stream ID for the tab
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
  } else if (changeInfo.audible === false && recordingTabs.has(tabId)) {
    console.log(`Tab ${tabId} stopped being audible. Stopping capture...`);
    recordingTabs.delete(tabId);
    chrome.runtime.sendMessage({
      type: 'STOP_RECORDING',
      target: 'offscreen',
      payload: {
        tabId: tabId
      }
    });
  }
});

const BACKEND_URL = "http://localhost:8000";
let recorders = {}; // tabId -> MediaRecorder

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'START_RECORDING') {
    startRecording(message.payload);
  } else if (message.type === 'STOP_RECORDING') {
    stopRecording(message.payload.tabId);
  }
});

async function startRecording({ streamId, tabId, url }) {
  if (recorders[tabId]) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        }
      }
    });

    // Continue to play the captured audio to the user.
    const output = new AudioContext();
    const source = output.createMediaStreamSource(stream);
    source.connect(output.destination);

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorders[tabId] = recorder;
    
    recorder.ondataavailable = async (event) => {
      if (event.data.size > 0) {
        // Send chunk to backend
        const formData = new FormData();
        formData.append("url", url);
        formData.append("file", event.data, `tab_${tabId}_audio.webm`);
        
        try {
          await fetch(`${BACKEND_URL}/api/audio`, {
            method: 'POST',
            body: formData
          });
        } catch (err) {
          console.error("Error sending audio chunk:", err);
        }
      }
    };

    // Record in chunks (e.g., every 30 seconds)
    recorder.start(30000); 
    
  } catch (err) {
    console.error("Failed to start recording:", err);
  }
}

function stopRecording(tabId) {
  const recorder = recorders[tabId];
  if (recorder) {
    recorder.stop();
    recorder.stream.getTracks().forEach(t => t.stop());
    delete recorders[tabId];
  }
}

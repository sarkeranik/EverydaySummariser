/**
 * Everyday Summariser — offscreen audio recorder.
 *
 * Recorders run WITHOUT a timeslice argument and are rotated by stop/start.
 * MediaRecorder only writes the webm container header into the first blob of a
 * stream, so a timesliced recorder produces chunks 2..N that ffmpeg and whisper
 * cannot decode at all. Rotating instead means every uploaded file is a complete,
 * self-contained webm.
 */

const sessions = {}; // tabId -> session state

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'START_RECORDING') {
    startRecording(message.payload);
  } else if (message.type === 'STOP_RECORDING') {
    stopRecording(message.payload.tabId);
  }
});

async function startRecording({ streamId, tabId, url, sessionId, rotateMs }) {
  if (sessions[tabId]) return; // never run two recorders on one tab

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        }
      }
    });

    // Keep playing the captured audio to the user.
    const audioCtx = new AudioContext();
    audioCtx.createMediaStreamSource(stream).connect(audioCtx.destination);

    const session = {
      stream,
      audioCtx,
      url,
      sessionId,
      seq: 0,
      recorder: null,
      timer: null,
      rotateMs: rotateMs || 10 * 60 * 1000,
    };
    sessions[tabId] = session;

    beginSegment(tabId);
  } catch (err) {
    console.error('Failed to start recording:', err);
    delete sessions[tabId];
  }
}

/** Start one recording segment; on stop, upload it and optionally begin the next. */
function beginSegment(tabId) {
  const session = sessions[tabId];
  if (!session) return;

  const chunks = [];
  const recorder = new MediaRecorder(session.stream, { mimeType: 'audio/webm' });
  session.recorder = recorder;

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  recorder.onstop = () => {
    if (chunks.length > 0) {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      upload(blob, session.url, session.sessionId, session.seq++);
    }

    // Teardown happens here, not in stopRecording: stopping the stream tracks
    // synchronously after stop() can truncate the final dataavailable event.
    if (recorder.rotating && sessions[tabId] === session) {
      beginSegment(tabId);
    } else {
      teardown(session);
    }
  };

  recorder.start(); // no timeslice: one complete, headered file per segment

  session.timer = setTimeout(() => rotate(tabId), session.rotateMs);
}

/** Close off the current segment and immediately open a new one. */
function rotate(tabId) {
  const session = sessions[tabId];
  if (!session || !session.recorder) return;
  if (session.recorder.state === 'inactive') return;

  session.recorder.rotating = true;
  session.recorder.stop();
}

function stopRecording(tabId) {
  const session = sessions[tabId];
  if (!session) return;

  // Free the slot immediately so a stop/start on the same tab (audio pausing and
  // resuming) isn't rejected while the final segment is still flushing.
  delete sessions[tabId];
  clearTimeout(session.timer);

  if (session.recorder && session.recorder.state !== 'inactive') {
    session.recorder.rotating = false; // final segment: onstop uploads the tail, then tears down
    session.recorder.stop();
  } else {
    teardown(session);
  }
}

function teardown(session) {
  session.stream.getTracks().forEach(t => t.stop());
  session.audioCtx.close().catch(() => {});
}

async function upload(blob, url, sessionId, seq) {
  const formData = new FormData();
  formData.append('url', url);
  formData.append('session_id', sessionId);
  formData.append('seq', String(seq));
  formData.append('file', blob, `${sessionId}_${seq}.webm`);

  try {
    await apiFetch('/api/audio', { method: 'POST', body: formData });
  } catch (err) {
    console.error('Error uploading audio segment:', err);
  }
}
